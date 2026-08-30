// src/hooks/useStores.js
//
// Central data layer for the whole app. Every component keeps working with
// the SAME camelCase shapes it always used (store.ownerName, product.lastUpdated,
// store.coords, etc). This file is the only place that knows about Supabase's
// snake_case columns — it maps in both directions so the rest of your
// components (StoreDetails, ProductFormModal, StoreEditModal, etc.) needed
// minimal changes.
//
// STATUS AUTOMATION: as of 17_status_automation_and_search_price.sql,
// `status` is fully derived server-side from quantity vs
// low_stock_threshold. Nothing in this file writes `status` directly
// anymore — updateProductStatus() is gone, replaced by
// updateProductQuantity(), and bulkUpsertInventory() no longer sends a
// status field at all.

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
    quantity: row.quantity,
    lowStockThreshold: row.low_stock_threshold,
    sku: row.sku,
    description: row.description,
    unit: row.unit,
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

export function formatPrice(price) {
  const num = typeof price === "number" ? price : Number(price);
  if (price === null || price === undefined || Number.isNaN(num)) return "—";
  return `₱${num.toFixed(2)}`;
}

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
          .select("id, store_id, name, category, price, status, quantity, low_stock_threshold, sku, description, unit, last_updated")
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
 * store_id is injected client-side from the trusted `storeId` argument —
 * never trusted from the CSV. All rows go in ONE .upsert() call so
 * Postgres treats the whole batch as one atomic statement.
 *
 * STATUS AUTOMATION: `status` is deliberately NOT sent — the
 * sync_status_from_quantity() trigger derives it from quantity/
 * low_stock_threshold on every insert and every update touching either
 * column, which this upsert always does.
 *
 * @param {string} storeId
 * @param {Array<{name, category, price, quantity?, lowStockThreshold?, sku?, description?, unit?}>} rows
 * @param {{ overwrite: boolean }} options
 */
export async function bulkUpsertInventory(storeId, rows, { overwrite } = { overwrite: false }) {
  const payload = rows.map((row) => ({
    store_id: storeId,
    name: row.name,
    category: row.category,
    price: row.price,
    quantity: row.quantity ?? 0,
    low_stock_threshold: row.lowStockThreshold ?? 5,
    sku: row.sku ?? null,
    description: row.description ?? null,
    unit: row.unit ?? "piece",
  }));

  return supabase
    .from("inventory")
    .upsert(payload, {
      onConflict: "store_id,name_normalized",
      ignoreDuplicates: !overwrite,
    })
    .select("id, name, price, status, quantity, low_stock_threshold, sku, description, unit");
}

export async function deleteStore(storeId) {
  return supabase.from("stores").delete().eq("id", storeId);
}

// ─── useOwnerInventory ───────────────────────────────────────────────────────

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
      .select("id, store_id, name, category, price, status, quantity, low_stock_threshold, sku, description, unit, last_updated")
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

  /**
   * updateProductQuantity
   * REPLACES the old updateProductStatus() — status is no longer directly
   * settable. Updates quantity (and optionally low_stock_threshold); the
   * DB trigger derives status the instant this UPDATE lands.
   *
   * @param {string} productId
   * @param {number} quantity
   * @param {number} [lowStockThreshold] — omit to leave threshold unchanged
   */
  const updateProductQuantity = useCallback(async (productId, quantity, lowStockThreshold) => {
    if (!Number.isFinite(quantity) || quantity < 0) {
      console.error(`Invalid quantity "${quantity}" — must be a non-negative number.`);
      return { error: new Error("invalid quantity") };
    }
    const patch = { quantity: Math.floor(quantity) };
    if (lowStockThreshold !== undefined) {
      if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
        console.error(`Invalid low_stock_threshold "${lowStockThreshold}" — must be a non-negative number.`);
        return { error: new Error("invalid low_stock_threshold") };
      }
      patch.low_stock_threshold = Math.floor(lowStockThreshold);
    }
    return supabase.from("inventory").update(patch).eq("id", productId);
  }, []);

  return { inventory, loading, updateProductQuantity };
}

// ─── One-shot server-side helpers (RPCs) ────────────────────────────────────

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
    price: row.price,
    status: row.status,
    rank: row.rank,
  }));
}

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
