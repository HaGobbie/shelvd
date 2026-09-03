// src/components/MapContainer.jsx
// Main Leaflet map. Centered on Catalunan Grande, Davao City.
// Uses Canvas rendering for optimal performance with many pins.
// Tile source: CARTO (Positron/light or Dark Matter/dark, switching with
// the app's theme — see src/config/mapTiles.js).
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

import React, { useMemo, useEffect } from "react";
import {
  MapContainer as LeafletMap,
  TileLayer,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed, Loader2 } from "lucide-react";

import StoreMarker from "./StoreMarker";
import { useGeolocation } from "../hooks/useGeolocation";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { getTileUrl, TILE_ATTRIBUTION } from "../config/mapTiles";

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
 * Blue pulsing "you are here" dot — visually distinct from store pins
 * (which use the brand-neutral/status colors) so it reads unambiguously
 * as "this is you," not another store.
 */
function UserLocationMarker({ position, label }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        html: `
          <div style="position:relative; width:20px; height:20px;">
            <div style="
              position:absolute; inset:-9px;
              border-radius:50%;
              background:rgba(59,130,246,0.25);
              animation: pinPulse 1.8s ease-out infinite;
            "></div>
            <div style="
              position:absolute; inset:0;
              border-radius:50%;
              background:#3B82F6;
              border:3px solid white;
              box-shadow:0 1px 4px rgba(0,0,0,0.4);
            "></div>
          </div>
        `,
        className: "",
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    []
  );

  if (!position) return null;

  return (
    <Marker
      position={position}
      icon={icon}
      interactive={false}
      zIndexOffset={2000}
      alt={label}
    />
  );
}

/**
 * Flies the map to `position` whenever it changes — fires on initial
 * geolocation success AND every subsequent explicit "locate me" tap.
 */
function FlyToPosition({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, 16, { animate: true, duration: 1 });
    }
  }, [position, map]);
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
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { position: userPosition, status: geoStatus, requestLocation } = useGeolocation();

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

  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  // Tile URL depends on the current theme — re-derived whenever theme
  // changes, so toggling dark/light mode swaps the actual map tiles too,
  // not just the surrounding UI chrome.
  const tileUrl = useMemo(() => getTileUrl(theme), [theme]);

  return (
    <div className="map-wrapper">
      {loading && (
        <div className="map-loading-overlay">
          <div className="map-loading-spinner" />
          <span>Loading community map…</span>
        </div>
      )}

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
            background: "var(--color-out)",
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
        {/* CARTO — Positron (light) or Dark Matter (dark), matching the
            app's current theme. Requires VITE_CARTO_API_KEY — see
            src/config/mapTiles.js. */}
        <TileLayer
          key={theme} /* force remount on theme change so the old tile layer doesn't linger */
          url={tileUrl}
          attribution={TILE_ATTRIBUTION}
          subdomains="abcd"
          maxZoom={20}
        />

        <MapController flyTo={null} />
        <FlyToPosition position={userPosition} />
        <UserLocationMarker position={userPosition} label={t("map.youAreHere")} />

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

      {/* "Locate me" crosshair control */}
      <button
        type="button"
        onClick={requestLocation}
        aria-label={
          geoStatus === "loading" ? t("map.locating") : t("map.locateMe")
        }
        title={geoStatus === "denied" ? t("map.locationDenied") : t("map.locateMe")}
        style={{
          position: "fixed",
          bottom: "calc(92px + env(safe-area-inset-bottom, 0px))",
          right: 20,
          zIndex: 800,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "var(--color-surface)",
          color: geoStatus === "denied" ? "var(--color-out)" : "var(--color-brand-primary)",
          border: "none",
          boxShadow: "var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.2))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {geoStatus === "loading" ? (
          <Loader2 size={22} className="regform__spin" />
        ) : (
          <LocateFixed size={22} strokeWidth={2.2} />
        )}
      </button>

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
