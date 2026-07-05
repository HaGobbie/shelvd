// src/components/MapContainer.jsx
// Main Leaflet map.  Centered on Catalunan Grande, Davao City.
// Uses Canvas rendering for optimal performance with many pins.
// Tile source: CartoDB Positron (clean, light, reads well on mobile).

import React, { useMemo, useRef } from "react";
import {
  MapContainer as LeafletMap,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import StoreMarker from "./StoreMarker";
import { getWorstStatusForQuery } from "../hooks/useStores";

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
 * @property {import("../hooks/useStores").Store[]} stores
 * @property {boolean}  loading
 * @property {string}   searchQuery
 * @property {Function} onStoreSelect  — called with a Store object when a pin is clicked
 * @property {string|null} selectedStoreId
 */

/**
 * MapContainer
 * Renders the full-bleed Leaflet map with all store pins.
 * When `searchQuery` is active, pins reflect the matched product status.
 * Pins for stores with no matching product are dimmed.
 *
 * @param {MapContainerProps} props
 */
export default function MapContainer({
  stores = [],
  loading = false,
  searchQuery = "",
  onStoreSelect,
  selectedStoreId = null,
}) {
  // Derive display data per store from the current search query
  const storeDisplayData = useMemo(() => {
    return stores.map((store) => {
      const matchedStatus = getWorstStatusForQuery(store.inventory, searchQuery);
      const hasMatch = searchQuery.trim() ? matchedStatus !== null : true;

      // When no search is active, show overall store health
      let displayStatus;
      if (!searchQuery.trim()) {
        // Bubble up worst status across all products
        const allStatuses = store.inventory.map((p) => p.status);
        if (allStatuses.includes("out")) displayStatus = "out";
        else if (allStatuses.includes("low")) displayStatus = "low";
        else displayStatus = "available";
      } else {
        displayStatus = matchedStatus;
      }

      // Count matching products
      const matchCount = searchQuery.trim()
        ? store.inventory.filter((p) =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase())
          ).length
        : store.inventory.length;

      return { store, displayStatus, hasMatch, matchCount };
    });
  }, [stores, searchQuery]);

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

        {storeDisplayData.map(({ store, displayStatus, hasMatch, matchCount }) => (
          <StoreMarker
            key={store.id}
            store={store}
            displayStatus={displayStatus}
            isHighlighted={hasMatch}
            matchCount={matchCount}
            isSelected={selectedStoreId === store.id}
            searchActive={searchQuery.trim().length > 0}
            onClick={() => onStoreSelect && onStoreSelect(store)}
          />
        ))}
      </LeafletMap>

      {/* Search results summary badge */}
      {searchQuery.trim() && !loading && (
        <div className="search-results-badge">
          {storeDisplayData.filter((d) => d.hasMatch).length} store
          {storeDisplayData.filter((d) => d.hasMatch).length !== 1 ? "s" : ""}{" "}
          carry "{searchQuery}"
        </div>
      )}
    </div>
  );
}
