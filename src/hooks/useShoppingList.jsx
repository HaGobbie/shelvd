// src/hooks/useShoppingList.jsx
// The resident's shopping list. Lives in a context (mounted once in App.jsx)
// so StoreDetails (which adds items), the floating list button, the list
// sheet and the route planner all share one list.
//
// Each item remembers which store it came from (id, name, coordinates) so a
// multi-store route can be built later without another database round trip.
// Persisted to this browser's localStorage — no account needed.

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";

const STORAGE_KEY = "shelvd_shopping_list_v1";
const ShoppingListContext = createContext(null);

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ShoppingListProvider({ children }) {
  const [items, setItems] = useState(load);
  const [listOpen, setListOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* storage full/blocked */ }
  }, [items]);

  const has = useCallback((productId) => items.some((i) => i.productId === productId), [items]);

  /** item: { productId, name, price, unit?, storeId, storeName, lat, lng } */
  const toggle = useCallback((item) => {
    setItems((prev) =>
      prev.some((i) => i.productId === item.productId)
        ? prev.filter((i) => i.productId !== item.productId)
        : [...prev, { ...item, bought: false, addedAt: Date.now() }]
    );
  }, []);

  const remove = useCallback((productId) => setItems((prev) => prev.filter((i) => i.productId !== productId)), []);

  const setBought = useCallback((productId, bought) => {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, bought } : i)));
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const clearBought = useCallback(() => setItems((prev) => prev.filter((i) => !i.bought)), []);

  const value = useMemo(() => {
    const pending = items.filter((i) => !i.bought);
    return {
      items,
      pendingCount: pending.length,
      pendingTotal: pending.reduce((s, i) => s + (Number(i.price) || 0), 0),
      has, toggle, remove, setBought, clear, clearBought,
      listOpen, setListOpen, routeOpen, setRouteOpen,
    };
  }, [items, has, toggle, remove, setBought, clear, clearBought, listOpen, routeOpen]);

  return <ShoppingListContext.Provider value={value}>{children}</ShoppingListContext.Provider>;
}

export function useShoppingList() {
  const ctx = useContext(ShoppingListContext);
  if (!ctx) throw new Error("useShoppingList must be used within <ShoppingListProvider>");
  return ctx;
}
