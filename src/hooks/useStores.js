// src/hooks/useStores.js
//
// Replaces the Firestore version of useStores.js.
//
// BANDWIDTH STRATEGY (Supabase free tier = 5GB egress/month):
//   1. useMapMarkers()   -> tiny payload: id, name, lat, lng only.
//                           This is what renders on the Leaflet map.
//   2. useStoreDetails() -> full store row + inventory, fetched ON DEMAND
//                           only when a resident taps a pin (not preloaded
//                           for every store like your old nested onSnapshot
//                           did for ALL stores at once).
//   3. Realtime channels -> only touch the tables actually being watched,
//                           and are torn down in useEffect cleanup so you
//                           never accumulate zombie WebSocket subscriptions.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase/supabaseClient";

/** @typedef {"available"|"low"|"out"} StockStatus */

/**
 * useMapMarkers
 * Lightweight hook for the public map. Selects ONLY the columns needed
 * to render a pin — never select('*') here, that's the #1 egress killer
 * once you have inventory join data on every row.
 *
 * @returns {{ markers: Array, loading: boolean, error: Error|null }}
 */
export function useMapMarkers() {
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMarkers = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("stores")
      .select("id, name, latitude, longitude") // <-- explicit, minimal columns
      .eq("status", "approved");

    if (fetchError) {
      setError(fetchError);
    } else {
      setMarkers(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMarkers();

    // Realtime: only re-fetch the marker list when a store is
    // inserted/updated/deleted — NOT on every inventory change
    // (inventory changes don't move the pin, so don't re-run this query).
    const channel = supabase
      .channel("public-stores-markers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stores" },
        () => {
          fetchMarkers();
        }
      )
      .subscribe();

    // Cleanup — critical to avoid leaked subscriptions / connection limits
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMarkers]);

  return { markers, loading, error };
}

/**
 * useStoreDetails
 * Fetches the FULL store record + its inventory, only when storeId is set.
 * Call this when a resident taps a map pin — not on initial map load.
 *
 * @param {string|null} storeId
 * @returns {{ store: Object|null, inventory: Array, loading: boolean }}
 */
export function useStoreDetails(storeId) {
  const [store, setStore] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!storeId) {
      setStore(null);
      setInventory([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      const [{ data: storeData }, { data: inventoryData }] = await Promise.all([
        supabase
          .from("stores")
          .select(
            "id, name, type, address, owner_name, contact_number, latitude, longitude, updated_at"
          )
          .eq("id", storeId)
          .single(),
        supabase
          .from("inventory")
          .select("id, name, category, status, last_updated")
          .eq("store_id", storeId),
      ]);

      if (!cancelled) {
        setStore(storeData ?? null);
        setInventory(inventoryData ?? []);
        setLoading(false);
      }
    }

    load();

    // Realtime: watch ONLY this store's inventory while its detail
    // sheet is open. Torn down the instant storeId changes or unmounts.
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
          setInventory((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((item) => item.id !== payload.old.id);
            }
            const exists = prev.some((item) => item.id === payload.new.id);
            if (exists) {
              return prev.map((item) =>
                item.id === payload.new.id ? payload.new : item
              );
            }
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  return { store, inventory, loading };
}

/**
 * useOwnerInventory
 * For the Owner Dashboard: real-time inventory for the logged-in
 * owner's own store, plus mutation helpers.
 *
 * @param {string|null} storeId — the owner's own store id
 */
export function useOwnerInventory(storeId) {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) return;

    let isMounted = true;

    supabase
      .from("inventory")
      .select("id, name, category, status, last_updated")
      .eq("store_id", storeId)
      .then(({ data }) => {
        if (isMounted) {
          setInventory(data ?? []);
          setLoading(false);
        }
      });

    const channel = supabase
      .channel(`owner-inventory-${storeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory",
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => {
          setInventory((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((item) => item.id !== payload.old.id);
            }
            const exists = prev.some((item) => item.id === payload.new.id);
            if (exists) {
              return prev.map((item) =>
                item.id === payload.new.id ? payload.new : item
              );
            }
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  const addProduct = useCallback(
    async ({ name, category, status = "available" }) => {
      return supabase.from("inventory").insert({
        store_id: storeId,
        name,
        category,
        status,
      });
    },
    [storeId]
  );

  const updateProductStatus = useCallback(
    async (productId, status) => {
      const VALID = ["available", "low", "out"];
      if (!VALID.includes(status)) {
        console.error(`Invalid status "${status}". Must be one of: ${VALID.join(", ")}`);
        return;
      }
      return supabase
        .from("inventory")
        .update({ status })
        .eq("id", productId);
    },
    []
  );

  const deleteProduct = useCallback(async (productId) => {
    return supabase.from("inventory").delete().eq("id", productId);
  }, []);

  return { inventory, loading, addProduct, updateProductStatus, deleteProduct };
}

/**
 * searchInventory
 * One-shot helper for the product search bar — uses the search_inventory()
 * Postgres function (see 02_functions_and_triggers.sql) so the ILIKE
 * filtering and the approved-store join happen server-side, not client-side.
 *
 * @param {string} term
 */
export async function searchInventory(term) {
  const { data, error } = await supabase.rpc("search_inventory", {
    search_term: term,
  });
  if (error) {
    console.error("searchInventory failed:", error);
    return [];
  }
  return data ?? [];
}

/**
 * nearbyStores
 * One-shot helper for "stores near me" — uses the nearby_stores() Postgres
 * function so distance sorting happens in Postgres, not in the browser.
 *
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
  return data ?? [];
}
