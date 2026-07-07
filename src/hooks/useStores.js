// src/hooks/useStores.js
//
// Central data layer for the whole app. Every component keeps working with
// the SAME camelCase shapes it always used (store.ownerName, product.lastUpdated,
// store.coords, etc). This file is the only place that knows about Supabase's
// snake_case columns — it maps in both directions so the rest of your
// components (StoreDetails, ProductFormModal, StoreEditModal, etc.) needed
// minimal changes.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../config/supabaseClient";

// ─── Mapping helpers (DB row <-> app-shape object) ──────────────────────────

/** stores row -> app Store object (camelCase, with `coords` for Leaflet) */
function mapStoreRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address ?? "",
    ownerName: row.owner_name ?? "",
    contactNumber: row.contact_number ?? "",
    ownerId: row.owner_id,
    ownerEmail: row.owner_email ?? "",
    lat: row.latitude,
    lng: row.longitude,
    coords: [row.latitude, row.longitude],
    status: row.status,
    worstStatus: row.worst_status ?? "available",
    rejectionReason: row.rejection_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** inventory row -> app Product object */
function mapProductRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    category: row.category,
    price: row.price,
    status: row.status,
    lastUpdated: row.last_updated,
  };
}

/** Lightweight marker row -> app MapMarker object */
function mapMarkerRow(row) {
  return {
    id: row.id,
    name: row.name,
    coords: [row.latitude, row.longitude],
    worstStatus: row.worst_status ?? "available",
  };
}

// ─── Public utility: relative time formatting ───────────────────────────────

/**
 * formatLastUpdated
 * Formats a Supabase `timestamptz` (ISO string) into a short relative
 * string like "Updated 2 mins ago". Falls back gracefully on bad input.
 *
 * @param {string|Date|null|undefined} timestamp
 * @returns {string}
 */
export function formatLastUpdated(timestamp) {
  if (!timestamp) return "Updated recently";

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Updated recently";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 30) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds} secs ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min${minutes !== 1 ? "s" : ""} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr${hours !== 1 ? "s" : ""} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days} day${days !== 1 ? "s" : ""} ago`;

  return `Updated on ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  })}`;
}

/**
 * formatPrice
 * Formats a numeric price as a clean peso string, e.g. 55 -> "₱55.00".
 * Returns a neutral placeholder for null/undefined/invalid values rather
 * than throwing or rendering "₱NaN" — shouldn't normally happen now that
 * price is NOT NULL in the DB, but defends against stale cached data.
 *
 * @param {number|string|null|undefined} price
 * @returns {string}
 */
export function formatPrice(price) {
  const num = typeof price === "number" ? price : Number(price);
  if (price === null || price === undefined || Number.isNaN(num)) return "—";
  return `₱${num.toFixed(2)}`;
}

/**
 * getWorstStatusForQuery
 * Given a store's full inventory array and a search query, returns the
 * worst status ("out" > "low" > "available") among matching products, or
 * null if nothing matches. Used when you already have inventory loaded
 * (e.g. inside an open StoreDetails sheet) — NOT for the map, which uses
 * the server-side search_inventory() RPC instead (see searchInventory below).
 *
 * @param {Array} inventory
 * @param {string} query
 * @returns {"out"|"low"|"available"|null}
 */
export function getWorstStatusForQuery(inventory, query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const matches = inventory.filter((p) => p.name.toLowerCase().includes(q));
  if (matches.length === 0) return null;

  if (matches.some((p) => p.status === "out")) return "out";
  if (matches.some((p) => p.status === "low")) return "low";
  return "available";
}

// ─── useMapMarkers ───────────────────────────────────────────────────────────

/**
 * useMapMarkers
 * Minimal payload for the public map: id, name, coords, worstStatus.
 * Never selects full inventory — that stays on-demand (see useStoreDetails).
 */
export function useMapMarkers() {
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMarkers = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("stores")
      .select("id, name, latitude, longitude, worst_status")
      .eq("status", "approved");

    if (fetchError) {
      setError(fetchError);
    } else {
      setMarkers((data ?? []).map(mapMarkerRow));
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMarkers();

    const channel = supabase
      .channel("public-stores-markers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stores" },
        () => fetchMarkers()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMarkers]);

  return { markers, loading, error };
}

// ─── useStoreDetails ─────────────────────────────────────────────────────────

/**
 * useStoreDetails
 * Full store + inventory, fetched ONLY when storeId is set (i.e. a pin
 * was tapped). Returns a single merged object shaped like your old
 * Firestore `store` (with `.inventory` attached), so StoreDetails.jsx,
 * ProductFormModal.jsx, etc. need no prop-shape changes.
 *
 * @param {string|null} storeId
 */
export function useStoreDetails(storeId) {
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!storeId) {
      setStore(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      const [{ data: storeRow }, { data: inventoryRows }] = await Promise.all([
        supabase
          .from("stores")
          .select(
            "id, name, type, address, owner_name, contact_number, owner_id, owner_email, latitude, longitude, status, worst_status, updated_at"
          )
          .eq("id", storeId)
          .single(),
        supabase
          .from("inventory")
          .select("id, store_id, name, category, price, status, last_updated")
          .eq("store_id", storeId),
      ]);

      if (!cancelled) {
        const mappedStore = mapStoreRow(storeRow);
        if (mappedStore) {
          mappedStore.inventory = (inventoryRows ?? []).map(mapProductRow);
        }
        setStore(mappedStore);
        setLoading(false);
      }
    }

    load();

    const channel = supabase
      .channel(`store-inventory-${storeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory",
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => {
          setStore((prev) => {
            if (!prev) return prev;
            const inventory = prev.inventory ?? [];
            if (payload.eventType === "DELETE") {
              return { ...prev, inventory: inventory.filter((p) => p.id !== payload.old.id) };
            }
            const mapped = mapProductRow(payload.new);
            const exists = inventory.some((p) => p.id === mapped.id);
            const nextInventory = exists
              ? inventory.map((p) => (p.id === mapped.id ? mapped : p))
              : [...inventory, mapped];
            return { ...prev, inventory: nextInventory };
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  return { store, loading };
}

// ─── useMyStores (all stores owned by this account, any status) ────────────

/**
 * useMyStores
 * For the Owner Dashboard: finds ALL stores owned by the logged-in user
 * (regardless of approval status — pending/approved/rejected all return
 * here), with realtime updates (e.g. when a barangay official approves
 * one, or another tab adds/removes a store). Supports multiple stores
 * per account.
 *
 * @param {string|null} userId — supabase auth user id (user.id)
 */
export function useMyStores(userId) {
  const [stores, setStores] = useState([]);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchStores = useCallback(async () => {
    if (!userId) {
      setStores([]);
      setChecked(true);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("stores")
      .select(
        "id, name, type, address, owner_name, contact_number, owner_id, owner_email, latitude, longitude, status, worst_status, rejection_reason, created_at, updated_at"
      )
      .eq("owner_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("useMyStores fetch failed:", error);
      setStores([]);
    } else {
      setStores((data ?? []).map(mapStoreRow));
    }
    setChecked(true);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setStores([]);
      setChecked(true);
      return;
    }

    fetchStores();

    const channel = supabase
      .channel(`my-stores-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stores", filter: `owner_id=eq.${userId}` },
        () => fetchStores()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchStores]);

  return { stores, checked, loading, refetch: fetchStores };
}

/**
 * bulkUpsertInventory
 * Used by the CSV bulk-import feature. Two things this function is
 * deliberately strict about:
 *
 * 1. SCOPING: `store_id` is injected into every row HERE, client-side,
 *    from the trusted `storeId` argument — never trust a store_id that
 *    might be present in an uploaded CSV. Even if a malicious or
 *    corrupted file contained a store_id column, it's discarded; the
 *    caller's own active store is the only source of truth.
 * 2. ATOMICITY: all rows are sent in ONE .upsert() call, which Postgres/
 *    PostgREST executes as a single statement in a single transaction —
 *    if any row violates a constraint (e.g. the NOT NULL price check),
 *    the ENTIRE batch is rejected and nothing is written. Do not loop
 *    this per-row; that would insert some rows and not others on a
 *    partial failure, which is exactly what this function exists to avoid.
 *
 * @param {string} storeId
 * @param {Array<{name: string, category: string, price: number, status: string}>} rows
 * @param {{ overwrite: boolean }} options
 *   overwrite: true  -> matching (store_id, name) rows are UPDATED (last write wins)
 *   overwrite: false -> matching (store_id, name) rows are SKIPPED, only new rows inserted
 */
export async function bulkUpsertInventory(storeId, rows, { overwrite } = { overwrite: false }) {
  const payload = rows.map((row) => ({
    store_id: storeId, // injected here — never taken from the CSV/caller-supplied row
    name: row.name,
    category: row.category,
    price: row.price,
    status: row.status ?? "available",
  }));

  return supabase
    .from("inventory")
    .upsert(payload, {
      onConflict: "store_id,name_normalized",
      ignoreDuplicates: !overwrite,
    })
    .select("id, name, price, status");
}

/**
 * deleteStore
 * Deletes a store the current user owns. Inventory/feedback/user_alerts
 * rows cascade-delete automatically (see 01_schema_and_postgis.sql FK
 * definitions); a linked profiles.store_id is set NULL instead of blocking
 * the delete. Requires 13_store_owner_delete.sql to have been run (RLS +
 * grant for DELETE on stores didn't exist before that).
 *
 * @param {string} storeId
 */
export async function deleteStore(storeId) {
  return supabase.from("stores").delete().eq("id", storeId);
}

// ─── useOwnerInventory ───────────────────────────────────────────────────────

/**
 * useOwnerInventory
 * Realtime inventory list + mutation helpers for the Owner Dashboard.
 * @param {string|null} storeId
 */
export function useOwnerInventory(storeId) {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setInventory([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    supabase
      .from("inventory")
      .select("id, store_id, name, category, price, status, last_updated")
      .eq("store_id", storeId)
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (isMounted) {
          setInventory((data ?? []).map(mapProductRow));
          setLoading(false);
        }
      });

    const channel = supabase
      .channel(`owner-inventory-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory", filter: `store_id=eq.${storeId}` },
        (payload) => {
          setInventory((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((p) => p.id !== payload.old.id);
            }
            const mapped = mapProductRow(payload.new);
            const exists = prev.some((p) => p.id === mapped.id);
            return exists
              ? prev.map((p) => (p.id === mapped.id ? mapped : p))
              : [...prev, mapped];
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  const updateProductStatus = useCallback(async (productId, status) => {
    const VALID = ["available", "low", "out"];
    if (!VALID.includes(status)) {
      console.error(`Invalid status "${status}". Must be one of: ${VALID.join(", ")}`);
      return { error: new Error("invalid status") };
    }
    return supabase.from("inventory").update({ status }).eq("id", productId);
  }, []);

  return { inventory, loading, updateProductStatus };
}

// ─── One-shot server-side helpers (RPCs) ────────────────────────────────────

/**
 * searchInventory
 * Runs the search_inventory() Postgres function — filtering happens in
 * the DB, not in the browser. Returns rows shaped for the map/search UI.
 * @param {string} term
 */
export async function searchInventory(term) {
  if (!term || !term.trim()) return [];
  const { data, error } = await supabase.rpc("search_inventory", { search_term: term.trim() });
  if (error) {
    console.error("searchInventory failed:", error);
    return [];
  }
  return (data ?? []).map((row) => ({
    storeId: row.store_id,
    storeName: row.store_name,
    coords: [row.latitude, row.longitude],
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    status: row.status,
    rank: row.rank,
  }));
}

/**
 * nearbyStores — "stores near me", sorted server-side by distance.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 */
export async function nearbyStores(lat, lng, radiusMeters = 5000) {
  const { data, error } = await supabase.rpc("nearby_stores", {
    lat,
    lng,
    radius_m: radiusMeters,
  });
  if (error) {
    console.error("nearbyStores failed:", error);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    coords: [row.latitude, row.longitude],
    distanceMeters: row.distance_m,
  }));
}

/**
 * useDebouncedSearchMatches
 * Convenience hook for App.jsx: debounces `searchQuery`, calls
 * searchInventory(), and returns a Map<storeId, { count, worstStatus }>
 * that MapContainer/StoreMarker can use to highlight/color pins without
 * ever loading full inventory into the client.
 *
 * @param {string} searchQuery
 * @param {number} debounceMs
 */
export function useDebouncedSearchMatches(searchQuery, debounceMs = 300) {
  const [matches, setMatches] = useState(new Map());
  const [searching, setSearching] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (!searchQuery.trim()) {
      setMatches(new Map());
      setSearching(false);
      return;
    }

    setSearching(true);
    timeoutRef.current = setTimeout(async () => {
      const results = await searchInventory(searchQuery);
      const byStore = new Map();
      const severity = { out: 0, low: 1, available: 2 };

      for (const r of results) {
        const existing = byStore.get(r.storeId);
        if (!existing) {
          byStore.set(r.storeId, { count: 1, worstStatus: r.status });
        } else {
          existing.count += 1;
          if (severity[r.status] < severity[existing.worstStatus]) {
            existing.worstStatus = r.status;
          }
        }
      }
      setMatches(byStore);
      setSearching(false);
    }, debounceMs);

    return () => clearTimeout(timeoutRef.current);
  }, [searchQuery, debounceMs]);

  return { matches, searching };
}
