// src/components/RoutePlanner.jsx
// "Get directions" for the shopping list.
//
//  1. Asks for the shopper's current location (browser geolocation).
//  2. Takes every store that still has un-checked items on the list.
//  3. Orders them nearest-first, chaining from the previous stop
//     (you → nearest store → next nearest to THAT store → …).
//  4. Draws the real road/footpath route on a map and lists the turns.
//
// Falls back to straight dashed lines + a Google Maps link if the routing
// service can't be reached, so the person is never left with nothing.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  X, Footprints, Bike, LocateFixed, Loader2, ExternalLink, ChevronDown, AlertTriangle, MapPinOff,
} from "lucide-react";
import { useShoppingList } from "../hooks/useShoppingList";
import { useGeolocation } from "../hooks/useGeolocation";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { getTileUrl } from "../config/mapTiles";
import {
  orderStopsNearestFirst, fetchRoute, buildGoogleMapsMultiStopLink, formatDistance, formatDuration,
} from "../utils/routing";

const stopIcon = (n) =>
  L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="rp-pin">${n}</div>`,
  });
const YOU_ICON = L.divIcon({
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div class="rp-you"></div>`,
});

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => {
      map.invalidateSize();
      if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 17 });
      else if (points.length === 1) map.setView(points[0], 16);
    }, 120);
    return () => clearTimeout(id);
  }, [map, points]);
  return null;
}

export default function RoutePlanner() {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { items, routeOpen, setRouteOpen, setListOpen } = useShoppingList();

  return (
    <AnimatePresence>
      {routeOpen && (
        <motion.div className="rp" role="dialog" aria-modal="true" aria-label={t("route.title")}
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22 }}>
          <PlannerBody items={items} theme={theme} t={t}
            onClose={() => setRouteOpen(false)}
            onBackToList={() => { setRouteOpen(false); setListOpen(true); }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlannerBody({ items, theme, t, onClose, onBackToList }) {
  // Only mounted while open, so the geolocation permission prompt appears
  // when the person actually asks for directions — not on page load.
  const { position, status, requestLocation } = useGeolocation();
  const [mode, setMode] = useState("walk");
  const [route, setRoute] = useState(null);
  const [routeError, setRouteError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openLeg, setOpenLeg] = useState(0);

  // One stop per store that still has something left to buy.
  const stops = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (it.bought) continue;
      if (!map.has(it.storeId)) {
        map.set(it.storeId, { storeId: it.storeId, storeName: it.storeName, lat: it.lat, lng: it.lng, products: [] });
      }
      map.get(it.storeId).products.push(it.name);
    }
    return [...map.values()];
  }, [items]);

  const ordered = useMemo(
    () => (position ? orderStopsNearestFirst(position, stops) : []),
    [position, stops]
  );

  useEffect(() => {
    if (!position || ordered.length === 0) { setRoute(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setRouteError(false);
    fetchRoute(mode, [position, ...ordered.map((s) => [s.lat, s.lng])], controller.signal)
      .then((r) => { setRoute(r); setOpenLeg(0); })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error("Route lookup failed:", err);
        setRoute(null);
        setRouteError(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [position, ordered, mode]);

  const googleLink = buildGoogleMapsMultiStopLink(position, ordered.length ? ordered : stops, mode);
  const boundsPoints = useMemo(
    () => [...(position ? [position] : []), ...ordered.map((s) => [s.lat, s.lng])],
    [position, ordered]
  );
  const mapCenter = position ?? (stops[0] ? [stops[0].lat, stops[0].lng] : [7.0508, 125.5694]);

  const locating = status === "idle" || status === "loading";
  const noLocation = status === "denied" || status === "unsupported";

  const onRetry = useCallback(() => requestLocation(), [requestLocation]);

  return (
    <>
      <header className="rp__header">
        <div>
          <h2 className="rp__title">{t("route.title")}</h2>
          <p className="rp__subtitle">{t("route.subtitle", stops.length)}</p>
        </div>
        <button type="button" className="sheet-close-btn" onClick={onClose} aria-label={t("storeDetails.close")}>
          <X size={20} />
        </button>
      </header>

      <div className="rp__layout">
        <div className="rp__map">
          <MapContainer center={mapCenter} zoom={15} zoomControl attributionControl={false} preferCanvas>
            <TileLayer key={theme} url={getTileUrl(theme)} subdomains="abcd" maxZoom={20} />
            {route && <Polyline positions={route.coords} pathOptions={{ color: "#c85a27", weight: 5, opacity: 0.9 }} />}
            {!route && position && ordered.length > 0 && (
              <Polyline positions={[position, ...ordered.map((s) => [s.lat, s.lng])]}
                pathOptions={{ color: "#c85a27", weight: 4, dashArray: "8 8", opacity: 0.8 }} />
            )}
            {position && <Marker position={position} icon={YOU_ICON} />}
            {(ordered.length ? ordered : []).map((s, i) => (
              <Marker key={s.storeId} position={[s.lat, s.lng]} icon={stopIcon(i + 1)} />
            ))}
            <FitBounds points={boundsPoints} />
          </MapContainer>
        </div>

        <div className="rp__panel">
          <div className="rp__modes" role="group" aria-label={t("route.travelMode")}>
            <button type="button" className={mode === "walk" ? "is-active" : ""} onClick={() => setMode("walk")}>
              <Footprints size={16} /> {t("route.walk")}
            </button>
            <button type="button" className={mode === "drive" ? "is-active" : ""} onClick={() => setMode("drive")}>
              <Bike size={16} /> {t("route.drive")}
            </button>
          </div>

          {locating && (
            <div className="rp__state"><Loader2 size={22} className="regform__spin" /> {t("route.locating")}</div>
          )}

          {noLocation && (
            <div className="rp__state rp__state--warn">
              <MapPinOff size={22} />
              <div>
                <strong>{t("route.noLocationTitle")}</strong>
                <p>{t("route.noLocationBody")}</p>
                <button type="button" className="rp__link" onClick={onRetry}>
                  <LocateFixed size={14} /> {t("owner.registration.tryGpsAgain")}
                </button>
              </div>
            </div>
          )}

          {position && (
            <>
              {loading && <div className="rp__state"><Loader2 size={22} className="regform__spin" /> {t("route.calculating")}</div>}

              {routeError && (
                <div className="rp__state rp__state--warn">
                  <AlertTriangle size={22} />
                  <div><strong>{t("route.failedTitle")}</strong><p>{t("route.failedBody")}</p></div>
                </div>
              )}

              {route && (
                <div className="rp__summary">
                  <div><strong>{formatDistance(route.distance)}</strong><span>{t("route.totalDistance")}</span></div>
                  <div><strong>{formatDuration(route.duration)}</strong><span>{t("route.totalTime")}</span></div>
                  <div><strong>{ordered.length}</strong><span>{t("route.stops")}</span></div>
                </div>
              )}

              <ol className="rp__stops">
                {ordered.map((s, i) => {
                  const leg = route?.legs?.[i];
                  const open = openLeg === i;
                  return (
                    <li key={s.storeId} className="rp__stop">
                      <div className="rp__stop-head">
                        <span className="rp-pin rp-pin--static">{i + 1}</span>
                        <div className="rp__stop-info">
                          <strong>{s.storeName}</strong>
                          <span className="rp__stop-meta">
                            {leg
                              ? `${formatDistance(leg.distance)} · ${formatDuration(leg.duration)} ${i === 0 ? t("route.fromYou") : t("route.fromPrevious")}`
                              : `${formatDistance(s.straightMeters)} ${t("route.straightLine")}`}
                          </span>
                          <span className="rp__stop-items">{t("route.buyHere")}: {s.products.join(", ")}</span>
                        </div>
                        {leg && (
                          <button type="button" className="rp__toggle" aria-expanded={open}
                            onClick={() => setOpenLeg(open ? -1 : i)} aria-label={t("route.showSteps")}>
                            <ChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                          </button>
                        )}
                      </div>
                      {leg && open && (
                        <ul className="rp__steps">
                          {leg.steps.map((st, k) => (
                            <li key={k}><span>{st.text}</span>{st.distance > 0 && <em>{formatDistance(st.distance)}</em>}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          <div className="rp__actions">
            {googleLink && (
              <a href={googleLink} target="_blank" rel="noopener noreferrer" className="rp__google">
                <ExternalLink size={15} /> {t("route.openGoogle")}
              </a>
            )}
            <button type="button" className="rp__link" onClick={onBackToList}>{t("route.backToList")}</button>
          </div>
        </div>
      </div>
    </>
  );
}
