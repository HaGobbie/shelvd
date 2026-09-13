// src/components/MapContainer.jsx
// Main Leaflet map. Centered on Catalunan Grande, Davao City.
//
// SEARCH RESULT NAVIGATION: a search that returns matches now actually
// shows WHERE they are, via two cooperating pieces below:
//   - SearchResultsFlyTo: pans/zooms the map to bring matches into view
//     the moment a new search returns results.
//   - OffScreenMatchIndicators: for any match still outside the current
//     view, draws a small arrow pinned to the screen edge pointing
//     toward it, which disappears once that store's real pin is visible.

import React, { useMemo, useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom";
import {
  MapContainer as LeafletMap,
  TileLayer,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed, Loader2, ArrowRight } from "lucide-react";

import StoreMarker from "./StoreMarker";
import { useGeolocation } from "../hooks/useGeolocation";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { getTileUrl, TILE_ATTRIBUTION } from "../config/mapTiles";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const CATALUNAN_GRANDE_CENTER = [7.0508, 125.5694];
const DEFAULT_ZOOM = 15;

function MapController({ flyTo }) {
  const map = useMap();
  React.useEffect(() => {
    if (flyTo) map.flyTo(flyTo, 17, { animate: true, duration: 0.8 });
  }, [flyTo, map]);
  return null;
}

function UserLocationMarker({ position, label }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        html: `
          <div style="position:relative; width:20px; height:20px;">
            <div style="position:absolute; inset:-9px; border-radius:50%; background:rgba(59,130,246,0.25); animation: pinPulse 1.8s ease-out infinite;"></div>
            <div style="position:absolute; inset:0; border-radius:50%; background:#3B82F6; border:3px solid white; box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>
          </div>
        `,
        className: "",
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    []
  );
  if (!position) return null;
  return <Marker position={position} icon={icon} interactive={false} zIndexOffset={2000} alt={label} />;
}

function FlyToPosition({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo(position, 16, { animate: true, duration: 1 });
  }, [position, map]);
  return null;
}

/**
 * SearchResultsFlyTo
 * When a search returns matches, pans/zooms the map to bring them into
 * view — otherwise "2 stores found nearby" gives no indication of
 * WHERE, leaving the resident to manually hunt for them.
 *
 * PRIORITY (so this can't zoom out indefinitely if the store count grows
 * a lot in the future): when the resident's own location is known, only
 * the closest MAX_FIT_COUNT matches are used to compute the view — what's
 * nearby matters more than fitting every distant match into one
 * far-zoomed-out frame. maxZoom caps how far IN it'll go too, so some
 * street context stays visible even for a single very-close match.
 *
 * Only re-fits when the ACTUAL SET of matching store IDs changes — never
 * on a plain re-render, and never because the resident manually panned
 * afterward.
 */
function SearchResultsFlyTo({ markers, matches, userPosition }) {
  const map = useMap();
  const prevMatchKeyRef = useRef("");

  useEffect(() => {
    const matchKey = [...matches.keys()].sort().join(",");
    if (matchKey === prevMatchKeyRef.current) return;
    prevMatchKeyRef.current = matchKey;

    if (matches.size === 0) return;

    let matchedMarkers = markers.filter((m) => matches.has(m.id));
    if (matchedMarkers.length === 0) return;

    const MAX_FIT_COUNT = 8;
    if (userPosition && matchedMarkers.length > MAX_FIT_COUNT) {
      const [uLat, uLng] = userPosition;
      matchedMarkers = [...matchedMarkers]
        .sort((a, b) => {
          const da = (a.coords[0] - uLat) ** 2 + (a.coords[1] - uLng) ** 2;
          const db = (b.coords[0] - uLat) ** 2 + (b.coords[1] - uLng) ** 2;
          return da - db;
        })
        .slice(0, MAX_FIT_COUNT);
    }

    if (matchedMarkers.length === 1) {
      map.flyTo(matchedMarkers[0].coords, 17, { animate: true, duration: 1 });
    } else {
      const bounds = L.latLngBounds(matchedMarkers.map((m) => m.coords));
      map.flyToBounds(bounds, { padding: [70, 70], maxZoom: 17, animate: true, duration: 1 });
    }
  }, [matches, markers, userPosition, map]);

  return null;
}

/**
 * OffScreenMatchIndicators
 * For every matching store currently OUTSIDE the visible map area, draws
 * a small arrow pinned to the edge of the screen pointing toward it.
 * Tapping one flies there; the indicator disappears the instant that
 * store's real pin comes into view.
 *
 * Rendered via a React portal into `.map-wrapper` (the plain div
 * wrapping Leaflet's own container), NOT as a Leaflet marker — Leaflet
 * markers live in a pane Leaflet itself pans as the map moves, which is
 * exactly wrong for something meant to stay pinned to a fixed screen
 * edge. A portal into the plain wrapping div sits in ordinary screen
 * space, unaffected by Leaflet's internal transforms.
 */
function OffScreenMatchIndicators({ markers, matches, searchActive }) {
  const map = useMap();
  const [indicators, setIndicators] = useState([]);
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    setPortalTarget(map.getContainer().parentElement);
  }, [map]);

  useEffect(() => {
    if (!searchActive || matches.size === 0) {
      setIndicators([]);
      return;
    }

    const recompute = () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const centerPoint = { x: size.x / 2, y: size.y / 2 };
      const next = [];

      for (const marker of markers) {
        if (!matches.has(marker.id)) continue;

        const latlng = L.latLng(marker.coords[0], marker.coords[1]);
        if (bounds.contains(latlng)) continue;

        const point = map.latLngToContainerPoint(latlng);
        const dx = point.x - centerPoint.x;
        const dy = point.y - centerPoint.y;
        if (dx === 0 && dy === 0) continue;

        const margin = 46;
        const halfW = size.x / 2 - margin;
        const halfH = size.y / 2 - margin;
        const scale = Math.min(
          dx !== 0 ? Math.abs(halfW / dx) : Infinity,
          dy !== 0 ? Math.abs(halfH / dy) : Infinity
        );

        next.push({
          id: marker.id,
          name: marker.name,
          coords: marker.coords,
          x: centerPoint.x + dx * scale,
          y: centerPoint.y + dy * scale,
          angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
        });
      }
      setIndicators(next);
    };

    recompute();
    map.on("move", recompute);
    map.on("zoom", recompute);
    map.on("resize", recompute);
    return () => {
      map.off("move", recompute);
      map.off("zoom", recompute);
      map.off("resize", recompute);
    };
  }, [map, markers, matches, searchActive]);

  if (!portalTarget || indicators.length === 0) return null;

  return ReactDOM.createPortal(
    indicators.map((ind) => (
      <button
        key={ind.id}
        type="button"
        onClick={() => map.flyTo(ind.coords, 17, { animate: true, duration: 1 })}
        aria-label={ind.name}
        title={ind.name}
        style={{
          position: "absolute",
          left: ind.x,
          top: ind.y,
          transform: "translate(-50%, -50%)",
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "var(--color-brand-primary)",
          border: "2px solid #fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 750,
          pointerEvents: "auto",
        }}
      >
        <ArrowRight size={16} color="#fff" strokeWidth={2.5} style={{ transform: `rotate(${ind.angleDeg}deg)` }} />
      </button>
    )),
    portalTarget
  );
}

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
        return { marker, displayStatus: null, hasMatch: true, matchCount: 0 };
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
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 900,
            background: "var(--color-out)", color: "#fff", padding: "10px 16px", borderRadius: 8,
            fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.2)", maxWidth: "90%", textAlign: "center",
          }}
        >
          <strong>Couldn't load stores.</strong> {error.message || "Please check your connection and try again."}
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
        <TileLayer
          key={theme}
          url={tileUrl}
          attribution={TILE_ATTRIBUTION}
          subdomains="abcd"
          maxZoom={20}
        />

        <MapController flyTo={null} />
        <FlyToPosition position={userPosition} />
        <UserLocationMarker position={userPosition} label={t("map.youAreHere")} />
        <SearchResultsFlyTo markers={markers} matches={searchMatches} userPosition={userPosition} />
        <OffScreenMatchIndicators markers={markers} matches={searchMatches} searchActive={searchActive} />

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

      <button
        type="button"
        data-tour-id="map-locate-btn"
        onClick={requestLocation}
        aria-label={geoStatus === "loading" ? t("map.locating") : t("map.locateMe")}
        title={geoStatus === "denied" ? t("map.locationDenied") : t("map.locateMe")}
        style={{
          position: "fixed", bottom: "calc(92px + env(safe-area-inset-bottom, 0px))", right: 20, zIndex: 800,
          width: 48, height: 48, borderRadius: "50%", background: "var(--color-surface)",
          color: geoStatus === "denied" ? "var(--color-out)" : "var(--color-brand-primary)",
          border: "none", boxShadow: "var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.2))",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}
      >
        {geoStatus === "loading" ? <Loader2 size={22} className="regform__spin" /> : <LocateFixed size={22} strokeWidth={2.2} />}
      </button>

      {searchActive && !loading && (
        <div className="search-results-badge">
          {markerDisplayData.filter((d) => d.hasMatch).length} store
          {markerDisplayData.filter((d) => d.hasMatch).length !== 1 ? "s" : ""} carry "{searchQuery}"
        </div>
      )}
    </div>
  );
}
