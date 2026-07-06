// src/components/MapContainer.jsx
// Main Leaflet map. Centered on Catalunan Grande, Davao City.
// Uses Canvas rendering for optimal performance with many pins.
// Tile source: CartoDB Positron (clean, light, reads well on mobile).
//
// ARCHITECTURE NOTE (post-Supabase-migration):
// This component used to derive each pin's color by scanning the full
// `store.inventory` array that Firestore preloaded for every store. That
// data is no longer fetched for the whole map (useMapMarkers() only
// returns id/name/coords/worstStatus — see src/hooks/useStores.js), so:
//   - With no search active: pins are NEUTRAL (a single brand color, no
//     status meaning) — a status color is only meaningful in response to
//     a search, not as a constant ambient judgment on a store's overall
//     stock.
//   - With a search active: color/highlight comes from `searchMatches`,
//     a Map<storeId, { count, worstStatus }> produced by the
//     useDebouncedSearchMatches() hook in App.jsx, which calls the
//     search_inventory() Postgres RPC.

import React, { useMemo } from "react";
import {
  MapContainer as LeafletMap,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import StoreMarker from "./StoreMarker";

// ─── Fix Leaflet's default icon path issue with Vite bundlers ─────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});
// ──────────────────────────────────────────────────────────────────────────────

/** Center of Catalunan Grande, Davao City */
const CATALUNAN_GRANDE_CENTER = [7.0508, 125.5694];
const DEFAULT_ZOOM = 15;

/**
 * Inner component that has access to the Leaflet map instance.
 * Re-centers the map whenever `flyTo` prop changes.
 */
function MapController({ flyTo }) {
  const map = useMap();

  React.useEffect(() => {
    if (flyTo) {
      map.flyTo(flyTo, 17, { animate: true, duration: 0.8 });
    }
  }, [flyTo, map]);

  return null;
}

/**
 * @typedef {Object} MapContainerProps
 * @property {Array}    markers        — from useMapMarkers(): {id, name, coords, worstStatus}
 * @property {boolean}  loading
 * @property {string}   searchQuery
 * @property {Map}      searchMatches  — from useDebouncedSearchMatches(): Map<storeId, {count, worstStatus}>
 * @property {Function} onStoreSelect  — called with a marker's id when a pin is clicked
 * @property {string|null} selectedStoreId
 */

/**
 * MapContainer
 * Renders the full-bleed Leaflet map with all store pins.
 * When `searchQuery` is active, pins reflect the matched product status
 * from `searchMatches` (server-computed) rather than client-side inventory.
 *
 * @param {MapContainerProps} props
 */
export default function MapContainer({
  markers = [],
  loading = false,
  error = null,
  searchQuery = "",
  searchMatches = new Map(),
  onStoreSelect,
  selectedStoreId = null,
}) {
  const searchActive = searchQuery.trim().length > 0;

  // Derive display data per marker from the current search matches.
  // IMPORTANT: pins are neutral (no status color) when no search is
  // active — they only take on traffic-light coloring once the person is
  // actually searching for a product, matching what a status color is
  // meant to communicate ("this store has/doesn't have what you searched
  // for"), not a constant ambient judgment on every store's overall stock.
  const markerDisplayData = useMemo(() => {
    return markers.map((marker) => {
      if (!searchActive) {
        return {
          marker,
          displayStatus: null,
          hasMatch: true,
          matchCount: 0,
        };
      }
      const match = searchMatches.get(marker.id);
      return {
        marker,
        displayStatus: match ? match.worstStatus : null,
        hasMatch: Boolean(match),
        matchCount: match ? match.count : 0,
      };
    });
  }, [markers, searchActive, searchMatches]);

  // Leaflet canvas renderer for performance
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  return (
    <div className="map-wrapper">
      {loading && (
        <div className="map-loading-overlay">
          <div className="map-loading-spinner" />
          <span>Loading community map…</span>
        </div>
      )}

      {/* Surface fetch/RLS/permission errors instead of silently showing
          an empty map — this is what was missing when a "permission
          denied" error from a missing GRANT went completely unnoticed. */}
      {!loading && error && (
        <div
          className="map-error-banner"
          role="alert"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 900,
            background: "#E74C3C",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            maxWidth: "90%",
            textAlign: "center",
          }}
        >
          <strong>Couldn't load stores.</strong>{" "}
          {error.message || "Please check your connection and try again."}
        </div>
      )}

      <LeafletMap
        center={CATALUNAN_GRANDE_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
        preferCanvas={true}
        renderer={canvasRenderer}
        zoomControl={false}
        attributionControl={true}
      >
        {/* CartoDB Positron — clean, light, minimal visual noise */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={20}
        />

        <MapController flyTo={null} />

        {markerDisplayData.map(({ marker, displayStatus, hasMatch, matchCount }) => (
          <StoreMarker
            key={marker.id}
            store={marker}
            displayStatus={displayStatus}
            isHighlighted={hasMatch}
            matchCount={matchCount}
            isSelected={selectedStoreId === marker.id}
            searchActive={searchActive}
            onClick={() => onStoreSelect && onStoreSelect(marker.id)}
          />
        ))}
      </LeafletMap>

      {/* Search results summary badge */}
      {searchActive && !loading && (
        <div className="search-results-badge">
          {markerDisplayData.filter((d) => d.hasMatch).length} store
          {markerDisplayData.filter((d) => d.hasMatch).length !== 1 ? "s" : ""}{" "}
          carry "{searchQuery}"
        </div>
      )}
    </div>
  );
}
