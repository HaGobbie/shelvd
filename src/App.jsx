// src/App.jsx
// Root component — wires the Map view and Owner Dashboard together.
// A simple hash-based router distinguishes the two views:
//   #/  (or default) → Public Map view with SearchBar + StoreDetails
//   #/dashboard       → Owner Dashboard (login-gated)

import React, { useState, useCallback } from "react";
import { Store } from "lucide-react";

import MapContainer from "./components/MapContainer";
import SearchBar from "./components/SearchBar";
import StoreDetails from "./components/StoreDetails";
import OwnerDashboard from "./pages/OwnerDashboard";
import { useMapMarkers, useStoreDetails, useDebouncedSearchMatches } from "./hooks/useStores";

import "./styles/App.css";

/** Tiny hash-router — no external routing library needed for Phase A */
function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  React.useEffect(() => {
    const handler = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return route;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const route = useHashRoute();

  // Lightweight markers for the whole map (id, name, coords, worstStatus)
  const { markers, loading } = useMapMarkers();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState(null);

  // Full store + inventory, fetched ONLY for the currently selected pin
  const { store: selectedStore } = useStoreDetails(selectedStoreId);

  // Debounced server-side product search (search_inventory() RPC) — powers
  // both the map pin highlighting and the "N stores carry X" badge.
  const { matches: searchMatches } = useDebouncedSearchMatches(searchQuery);

  const handleStoreSelect = useCallback((storeId) => {
    setSelectedStoreId(storeId);
  }, []);

  const handleSheetClose = useCallback(() => {
    setSelectedStoreId(null);
  }, []);

  const handleSearchChange = useCallback((query) => {
    setSearchQuery(query);
    // Close details sheet when user starts a new search
    if (query.trim()) setSelectedStoreId(null);
  }, []);

  // Count stores that match the current search query (server-computed)
  const resultCount = searchQuery.trim() ? searchMatches.size : 0;

  // ─── Owner Dashboard route ──────────────────────────────────────────────
  if (route === "#/dashboard") {
    return (
      <div className="app-container">
        <OwnerDashboard />
        {/* Nav back to map */}
        <a
          href="#/"
          style={{
            position: "fixed",
            bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
            right: 20,
            zIndex: 9999,
            background: "var(--color-brand-primary)",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: "var(--radius-pill)",
            fontSize: 13,
            fontWeight: 700,
            boxShadow: "var(--shadow-lg)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none",
          }}
        >
          ← Back to Map
        </a>
      </div>
    );
  }

  // ─── Public Map view (default) ──────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Full-bleed map */}
      <MapContainer
        markers={markers}
        loading={loading}
        searchQuery={searchQuery}
        searchMatches={searchMatches}
        onStoreSelect={handleStoreSelect}
        selectedStoreId={selectedStoreId}
      />

      {/* Floating search bar — sits above the map */}
      <SearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        resultCount={resultCount}
        loading={loading}
      />

      {/* Bottom sheet — slides up when a pin is tapped */}
      <StoreDetails
        store={selectedStore}
        searchQuery={searchQuery}
        onClose={handleSheetClose}
      />

      {/* Owner Dashboard shortcut FAB */}
      <a
        href="#/dashboard"
        aria-label="Open Store Owner Dashboard"
        style={{
          position: "fixed",
          bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
          right: 20,
          zIndex: 800,
          background: "var(--color-brand-primary)",
          color: "#fff",
          width: 52,
          height: 52,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--shadow-lg)",
          textDecoration: "none",
          transition: "transform 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <Store size={22} />
      </a>
    </div>
  );
}
