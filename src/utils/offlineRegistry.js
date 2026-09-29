// src/utils/offlineRegistry.js
// A tiny in-memory + localStorage lookup: "given a productId, what store is
// it in and what did it last look like?" Populated by useOwnerInventory
// every time it loads or updates a store's inventory. Read by the offline
// queue (offlineQueue.js) so recordSale/recordStockAdjustment/recordMultiSale
// can queue an action and apply an optimistic UI update WITHOUT needing every
// call site to pass storeId/price/etc. through — they only ever had productId.
//
// This also doubles as the "last known inventory" cache that lets the owner
// dashboard render something useful the moment the app opens offline, before
// any network request has had a chance to (fail to) resolve.

const CACHE_PREFIX = "shelvd_inv_cache_";
const memory = new Map(); // productId -> snapshot

function cacheKey(storeId) {
  return `${CACHE_PREFIX}${storeId}`;
}

/** Called by useOwnerInventory whenever it has a fresh (or cache-hydrated) list for a store. */
export function registerInventory(storeId, inventory) {
  if (!storeId) return;
  for (const p of inventory) {
    memory.set(p.id, {
      storeId,
      name: p.name, price: p.price, unit: p.unit, isService: p.isService,
      quantity: p.quantity, status: p.status, lowStockThreshold: p.lowStockThreshold,
    });
  }
  try {
    localStorage.setItem(cacheKey(storeId), JSON.stringify(inventory));
  } catch { /* storage full/blocked — cache is a nice-to-have, not required */ }
}

export function getProductSnapshot(productId) {
  return memory.get(productId) ?? null;
}

export function getCachedInventory(storeId) {
  if (!storeId) return null;
  try {
    const raw = localStorage.getItem(cacheKey(storeId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Applies an optimistic quantity/status change to the in-memory snapshot AND
 * the localStorage cache, then tells any mounted useOwnerInventory to repaint
 * — see the 'shelvd:inventory-delta' listener in useStores.js.
 */
export function applyOptimisticQuantity(productId, newQuantity) {
  const snap = memory.get(productId);
  if (!snap) return;
  const status = snap.isService
    ? (newQuantity > 0 ? "available" : "out")
    : newQuantity <= 0 ? "out" : newQuantity <= (snap.lowStockThreshold ?? 5) ? "low" : "available";
  memory.set(productId, { ...snap, quantity: newQuantity, status });

  try {
    const cached = getCachedInventory(snap.storeId);
    if (cached) {
      const next = cached.map((p) => (p.id === productId ? { ...p, quantity: newQuantity, status, lastUpdated: new Date().toISOString() } : p));
      localStorage.setItem(cacheKey(snap.storeId), JSON.stringify(next));
    }
  } catch { /* best effort */ }

  window.dispatchEvent(new CustomEvent("shelvd:inventory-delta", { detail: { storeId: snap.storeId, productId, quantity: newQuantity, status } }));
}
