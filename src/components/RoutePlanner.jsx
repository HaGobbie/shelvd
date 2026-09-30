// src/components/RoutePlanner.jsx
// "Get directions" for the shopping list.
//
//  1. Tracks the shopper's location CONTINUOUSLY while this is open (not a
//     one-time fix), with a directional arrow marker showing which way
//     they're facing — from GPS heading while walking, falling back to the
//     device compass while stationary. See hooks/useLiveLocation.js.
//  2. Groups the list by store, orders the still-to-visit stores
//     nearest-first, chaining from the previous stop.
//  3. Each stop has a "Got everything here" checkbox. Checking it marks
//     that store's items bought (syncing back to the shopping list),
//     collapses the stop into a compact done row, and — since routing only
//     ever targets stores that AREN'T done — automatically re-centers the
//     route on the next nearest remaining store.
//  4. Draws the real road/footpath route with turn-by-turn steps, refetched
//     as the shopper actually moves (distance-gated, not on every GPS tick,
//     to avoid hammering the routing service) or whenever a stop is
//     checked off. Falls back to straight dashed lines + a Google Maps link
//     if the routing service can't be reached.

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  X, Footprints, Bike, LocateFixed, Loader2, ExternalLink, ChevronDown, AlertTriangle,
  MapPinOff, Check, Undo2, PartyPopper, Compass,
} from "lucide-react";
import { useShoppingList } from "../hooks/useShoppingList";
import { useLiveLocation } from "../hooks/useLiveLocation";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { getTileUrl } from "../config/mapTiles";
import {
  orderStopsNearestFirst, fetchRoute, buildGoogleMapsMultiStopLink, formatDistance, formatDuration, haversineMeters,
} from "../utils/routing";

const REFETCH_DISTANCE_M = 40; // ignore GPS jitter smaller than this
const stopIcon = (n) =>
  L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: `<div class="rp-pin">${n}</div>` });
const doneIcon = () =>
  L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="rp-pin rp-pin--done">✓</div>` });
const youIcon = (heading) =>
  L.divIcon({
    className: "", iconSize: [30, 30], iconAnchor: [15, 15],
    html: heading === null
      ? `<div class="rp-you"></div>`
      : `<div class="rp-you rp-you--heading" style="transform: rotate(${Math.round(heading)}deg)"></div>`,
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
  const { routeOpen, setRouteOpen, setListOpen } = useShoppingList();

  return (
    <AnimatePresence>
      {routeOpen && (
        <motion.div className="rp" role="dialog" aria-modal="true" aria-label={t("route.title")}
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22 }}>
          <PlannerBody theme={theme} t={t}
            onClose={() => setRouteOpen(false)}
            onBackToList={() => { setRouteOpen(false); setListOpen(true); }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlannerBody({ theme, t, onClose, onBackToList }) {
  // Only mounted while open, so the location/compass permission prompts
  // appear when the person actually asks for directions — not on page load.
  const { position, accuracy, status, heading, compassNeedsPermission, requestCompass } = useLiveLocation({ enabled: true });
  const { items, setBought } = useShoppingList();
  const [mode, setMode] = useState("walk");
  const [route, setRoute] = useState(null);
  const [routeError, setRouteError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openLeg, setOpenLeg] = useState(0);
  const [doneStoreIds, setDoneStoreIds] = useState(() => new Set());
  const [compassOffered, setCompassOffered] = useState(false);

  // Every store on the list, regardless of done/undone — done ones still
  // render (collapsed) so checking one off feels like progress, not like
  // the stop just vanished.
  const allStops = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.storeId)) map.set(it.storeId, { storeId: it.storeId, storeName: it.storeName, lat: it.lat, lng: it.lng, products: [] });
      map.get(it.storeId).products.push(it.name);
    }
    return [...map.values()];
  }, [items]);

  const remainingStops = useMemo(() => allStops.filter((s) => !doneStoreIds.has(s.storeId)), [allStops, doneStoreIds]);
  const doneStops = useMemo(() => allStops.filter((s) => doneStoreIds.has(s.storeId)), [allStops, doneStoreIds]);
  const allDone = allStops.length > 0 && remainingStops.length === 0;

  const ordered = useMemo(
    () => (position ? orderStopsNearestFirst(position, remainingStops) : []),
    [position, remainingStops]
  );

  const markStoreDone = useCallback((storeId) => {
    setDoneStoreIds((prev) => new Set(prev).add(storeId));
    items.filter((i) => i.storeId === storeId).forEach((i) => setBought(i.productId, true));
  }, [items, setBought]);
  const undoStoreDone = useCallback((storeId) => {
    setDoneStoreIds((prev) => { const next = new Set(prev); next.delete(storeId); return next; });
  }, []);

  // Refetch the turn-by-turn route when the set of remaining stops changes
  // (a stop was checked off) or the shopper has genuinely moved — NOT on
  // every GPS tick, which would hammer the routing service while walking.
  const lastFetchRef = useRef({ origin: null, stopsKey: null });
  useEffect(() => {
    if (!position || ordered.length === 0) { setRoute(null); return; }
    const stopsKey = `${ordered.map((s) => s.storeId).join(",")}|${mode}`;
    const last = lastFetchRef.current;
    const movedFar = !last.origin || haversineMeters(last.origin, position) > REFETCH_DISTANCE_M;
    if (last.stopsKey === stopsKey && !movedFar) return;

    const controller = new AbortController();
    setLoading(true);
    setRouteError(false);
    fetchRoute(mode, [position, ...ordered.map((s) => [s.lat, s.lng])], controller.signal)
      .then((r) => { setRoute(r); setOpenLeg(0); lastFetchRef.current = { origin: position, stopsKey }; })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error("Route lookup failed:", err);
        setRoute(null);
        setRouteError(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, ordered, mode]);

  const googleLink = buildGoogleMapsMultiStopLink(position, ordered.length ? ordered : remainingStops, mode);
  const boundsPoints = useMemo(
    () => [...(position ? [position] : []), ...ordered.map((s) => [s.lat, s.lng])],
    [position, ordered]
  );
  const mapCenter = position ?? (remainingStops[0] ? [remainingStops[0].lat, remainingStops[0].lng] : [7.0508, 125.5694]);

  const locating = status === "idle" || status === "loading";
  const noLocation = status === "denied" || status === "unsupported";
  const onRetry = useCallback(() => window.location.reload(), []); // simplest reliable re-prompt for watchPosition

  const onEnableCompass = async () => { setCompassOffered(true); await requestCompass(); };

  return (
    <>
      <header className="rp__header">
        <div>
          <h2 className="rp__title">{t("route.title")}</h2>
          <p className="rp__subtitle">{allDone ? t("route.allDoneSubtitle") : t("route.subtitle", remainingStops.length)}</p>
        </div>
        <button type="button" className="sheet-close-btn" onClick={onClose} aria-label={t("storeDetails.close")}>
          <X size={20} />
        </button>
      </header>

      {allDone ? (
        <div className="rp__celebrate">
          <PartyPopper size={44} />
          <h3>{t("route.allDoneTitle")}</h3>
          <p>{t("route.allDoneBody")}</p>
          <button type="button" className="rp__link" onClick={onBackToList}>{t("route.backToList")}</button>
        </div>
      ) : (
        <div className="rp__layout">
          <div className="rp__map">
            <MapContainer center={mapCenter} zoom={15} zoomControl attributionControl={false} preferCanvas>
              <TileLayer key={theme} url={getTileUrl(theme)} subdomains="abcd" maxZoom={20} />
              {route && <Polyline positions={route.coords} pathOptions={{ color: "#c85a27", weight: 5, opacity: 0.9 }} />}
              {!route && position && ordered.length > 0 && (
                <Polyline positions={[position, ...ordered.map((s) => [s.lat, s.lng])]}
                  pathOptions={{ color: "#c85a27", weight: 4, dashArray: "8 8", opacity: 0.8 }} />
              )}
              {position && <Marker position={position} icon={youIcon(heading)} />}
              {ordered.map((s, i) => (
                <Marker key={s.storeId} position={[s.lat, s.lng]} icon={stopIcon(i + 1)} />
              ))}
              {doneStops.map((s) => (
                <Marker key={s.storeId} position={[s.lat, s.lng]} icon={doneIcon()} />
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
                {compassNeedsPermission && heading === null && !compassOffered && (
                  <button type="button" className="rp__compass-btn" onClick={onEnableCompass}>
                    <Compass size={14} /> {t("route.enableCompass")}
                  </button>
                )}

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
                {accuracy != null && accuracy > 100 && (
                  <p className="rp__accuracy-note">{t("route.lowAccuracy")}</p>
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
                        <button type="button" className="rp__done-btn" onClick={() => markStoreDone(s.storeId)}>
                          <Check size={15} strokeWidth={3} /> {t("route.gotEverything")}
                        </button>
                      </li>
                    );
                  })}
                </ol>

                {doneStops.length > 0 && (
                  <ul className="rp__done-list">
                    {doneStops.map((s) => (
                      <li key={s.storeId}>
                        <Check size={14} /> <span>{s.storeName}</span>
                        <button type="button" onClick={() => undoStoreDone(s.storeId)} aria-label={t("route.undo", s.storeName)}>
                          <Undo2 size={13} /> {t("route.undo0")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
      )}
    </>
  );
}
