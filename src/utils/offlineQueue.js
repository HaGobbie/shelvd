// src/utils/offlineQueue.js
// Lets the dashboard keep working with no signal: stock adjustments and
// sales made while offline are saved to localStorage and replayed against
// the real database the moment the connection comes back.
//
// SCOPE (deliberate): this covers the two highest-frequency, most time-
// sensitive actions — recording a sale and adjusting stock (see the offline-
// aware wrappers in hooks/useStores.js). Adding or editing a PRODUCT
// (name/price/category/photo-scanning a receipt) still needs a live
// connection — those involve server-generated IDs, image uploads, and CSV
// parsing that don't have a safe "apply now, reconcile later" story. The
// queue and the offline banner make this limitation visible rather than
// letting those actions silently fail.
//
// HOW IT WORKS
//  1. A record*() call in useStores.js checks isLikelyOffline(). If offline,
//     it calls enqueue() here instead of hitting the network, applies an
//     optimistic UI update via offlineRegistry.js, and returns immediately
//     with the same {data, error} shape the RPC would have — so SellModal,
//     NewTransactionModal and StockAdjuster need NO changes to handle this.
//  2. Queued items sit in localStorage (shelvd_offline_queue_v1) tagged
//     "pending". A "Syncing 2 changes…" badge (SyncStatusBadge.jsx) shows
//     the count anywhere in the dashboard.
//  3. runSync() replays each item against the real RPC, in the order they
//     were made, one at a time (so a stock adjustment before a sale of the
//     same item still lands in the right order). On success the item is
//     removed. On a genuine business-rule failure (e.g. someone else already
//     sold the last unit from another device) the item is marked "error"
//     and left for the owner to see and discard — it is NOT retried forever.
//  4. runSync() is triggered by the 'online' browser event, on first load if
//     already online, and can be called manually (the sync panel's "Sync
//     now" button).

import { supabase } from "../config/supabaseClient";
import { applyOptimisticQuantity } from "./offlineRegistry";

const QUEUE_KEY = "shelvd_offline_queue_v1";
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function write(queue) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* best effort */ }
  listeners.forEach((fn) => { try { fn(queue); } catch { /* listener's problem, not ours */ } });
}

export function subscribeQueue(fn) {
  listeners.add(fn);
  fn(read());
  return () => listeners.delete(fn);
}
export function getQueue() { return read(); }
export function pendingCount() { return read().filter((i) => i.status === "pending").length; }
export function errorCount() { return read().filter((i) => i.status === "error").length; }

function enqueue(item) {
  const queue = read();
  queue.push({ id: crypto.randomUUID(), createdAt: Date.now(), status: "pending", ...item });
  write(queue);
}
export function discardQueueItem(id) { write(read().filter((i) => i.id !== id)); }
export function discardAllErrors() { write(read().filter((i) => i.status !== "error")); }

// A browser can report navigator.onLine === true on a captive/broken network,
// so this is a best-effort signal, not a guarantee — the real fallback is
// that a genuine fetch failure ALSO routes into the queue (see useStores.js).
export function isLikelyOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Looks like a connectivity failure rather than a server-rejected request. */
export function isNetworkError(error) {
  if (!error) return false;
  const msg = String(error.message ?? error).toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed") || msg.includes("load failed");
}

// ─── Queue a specific action + apply the optimistic UI update ──────────────

export function queueStockAdjustment(snapshot, productId, newQuantity, transactionType, notes) {
  enqueue({ type: "stockAdjustment", storeId: snapshot.storeId, productId,
    payload: { newQuantity, transactionType, notes }, label: snapshot.name });
  applyOptimisticQuantity(productId, newQuantity);
  return { data: [{ new_quantity: newQuantity }], error: null, queued: true };
}

export function queueSale(snapshot, productId, quantitySold) {
  const nextQty = Math.max(0, (snapshot.quantity ?? 0) - quantitySold);
  enqueue({ type: "sale", storeId: snapshot.storeId, productId,
    payload: { quantitySold }, label: snapshot.name });
  applyOptimisticQuantity(productId, nextQty);
  return { data: [{ new_quantity: nextQty, earnings: quantitySold * (snapshot.price ?? 0) }], error: null, queued: true };
}

export function queueMultiSale(snapshots, lineItems, notes) {
  const storeId = snapshots[0]?.storeId;
  enqueue({ type: "multiSale", storeId, payload: { lineItems, notes },
    label: `${lineItems.length} item${lineItems.length !== 1 ? "s" : ""}` });
  const data = lineItems.map((item) => {
    const snap = snapshots.find((s) => s.productId === item.productId);
    const nextQty = Math.max(0, (snap?.quantity ?? 0) - item.quantity);
    if (snap) applyOptimisticQuantity(item.productId, nextQty);
    return { product_id: item.productId, new_quantity: nextQty, earnings: item.quantity * (snap?.price ?? 0) };
  });
  return { data, error: null, queued: true };
}

// ─── Replaying the queue ────────────────────────────────────────────────────

async function runOne(item) {
  if (item.type === "stockAdjustment") {
    return supabase.rpc("record_stock_adjustment", {
      p_product_id: item.productId, p_new_quantity: item.payload.newQuantity,
      p_transaction_type: item.payload.transactionType, p_notes: item.payload.notes ?? null,
    });
  }
  if (item.type === "sale") {
    return supabase.rpc("record_sale", { p_product_id: item.productId, p_quantity_sold: item.payload.quantitySold });
  }
  if (item.type === "multiSale") {
    return supabase.rpc("record_multi_sale", {
      p_line_items: item.payload.lineItems.map((li) => ({ product_id: li.productId, quantity: li.quantity })),
      p_notes: item.payload.notes ?? null,
    });
  }
  return { error: { message: "unknown_queue_item_type" } };
}

let syncing = false;
/** @returns {Promise<{synced: number, failed: number}>} */
export async function runSync() {
  if (syncing || isLikelyOffline()) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0, failed = 0;
  try {
    // Snapshot the pending IDs up front so items added mid-sync (rare but
    // possible if the owner keeps working) wait for the NEXT sync pass,
    // rather than us mutating the list we're iterating.
    const pendingIds = read().filter((i) => i.status === "pending").map((i) => i.id);
    for (const id of pendingIds) {
      const current = read().find((i) => i.id === id);
      if (!current) continue; // discarded mid-sync
      const { error } = await runOne(current);
      if (error) {
        if (isNetworkError(error)) { failed++; break; } // connection dropped again — stop, retry later
        write(read().map((i) => (i.id === id ? { ...i, status: "error", errorMessage: error.message ?? "sync_failed" } : i)));
        failed++;
      } else {
        write(read().filter((i) => i.id !== id));
        synced++;
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}

// Auto-sync: as soon as the browser reports we're back online, and once on
// startup in case we were already online when the tab opened with a
// leftover queue from a previous offline session.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { runSync(); });
  if (!isLikelyOffline()) setTimeout(() => runSync(), 1500);
}
