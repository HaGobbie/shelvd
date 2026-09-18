// src/components/StoreRegistrationForm.jsx
// 3-step store registration wizard for new store owners.
//
// Step 1 — Store Details   : name, type, contact number (owner/manager
//                             name is no longer asked here — it's
//                             auto-filled from the signed-in account so
//                             a first-time merchant has one less field
//                             to type; still editable later from Edit
//                             Store, which keeps its own owner field).
// Step 2 — GIS Location    : auto-pinned from the browser's GPS the
//                             moment this step opens (useGeolocation),
//                             with Nominatim address search + a
//                             draggable Leaflet pin as fallback/fine-tune
// Step 3 — Review & Submit : summary before writing to Supabase
//
// FRICTIONLESS REGISTRATION: on submit this now writes
// status: 'approved' directly — there is no more barangay-approval
// review gate. (The `stores.status` column default was also changed to
// 'approved' at the DB level in
// sql/021_frictionless_registration_and_services.sql; this form sends it
// explicitly too so the behavior doesn't silently depend on that default
// alone.)
//
// Coordinates are sent as a single PostGIS `location` field using EWKT text
// ("SRID=4326;POINT(lng lat)") — Postgres casts this to geography(Point,4326)
// automatically; `latitude`/`longitude` are generated columns derived from it.
//
// NOTE ON STORE_TYPES: dropdown values stay in English regardless of UI
// language — stored as-is in the DB and shown on the public map.

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapContainer,
  TileLayer,
  Marker,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Store,
  Phone,
  MapPin,
  Search,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  LocateFixed,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { useGeolocation } from "../hooks/useGeolocation";
import { getTileUrl, TILE_ATTRIBUTION } from "../config/mapTiles";

/**
 * deriveOwnerNameFromUser
 * `stores.owner_name` is NOT NULL in the schema, but Step 1 no longer
 * asks the merchant to type it (see file header) — this fills it
 * automatically from whatever the signed-in Supabase Auth account
 * already knows, so nothing breaks the NOT NULL constraint and nobody
 * has to type their own name into a form.
 */
function deriveOwnerNameFromUser(user) {
  if (!user) return "";
  const meta = user.user_metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    (user.email ? user.email.split("@")[0] : "") ||
    "Store Owner"
  );
}

// ─── Fix Leaflet default icon path (Vite bundler issue) ──────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Terracotta pin — literal hex, not var(--color-brand-primary): this is
// baked into a raw SVG string for L.divIcon(), and SVG fill="..."
// attributes don't support var() CSS syntax (only style="..." does).
// Same value/limitation as StoreEditModal.jsx's identical pin icon.
const STORE_PIN_ICON = L.divIcon({
  html: `
    <div style="position:relative;width:36px;height:36px;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
        <path fill="#C85A27" stroke="#fff" stroke-width="1.2"
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <circle cx="12" cy="9" r="2.8" fill="white"/>
      </svg>
    </div>
  `,
  className: "",
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36],
});
// ──────────────────────────────────────────────────────────────────────────────

const CATALUNAN_GRANDE_CENTER = [7.0508, 125.5694];
const DEFAULT_ZOOM = 15;

const STORE_TYPES = [
  "General Store",
  "Sari-sari Store",
  "Mini Grocery",
  "Pharmacy",
  "Bakery",
  "Meat & Fish Stall",
  "Vegetable Stall",
  "Hardware Store",
  "Other",
];

// ─── Animation variants ───────────────────────────────────────────────────────
const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? "60%" : "-60%", opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { type: "spring", damping: 26, stiffness: 300 } },
  exit: (dir) => ({ x: dir > 0 ? "-60%" : "60%", opacity: 0, transition: { duration: 0.18 } }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Inner Leaflet helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CenterTracker
 * The engine behind the "move the map, pin stays put" pattern: the pin
 * is a plain CSS element fixed at the exact center of the screen (see
 * the JSX below), never a Leaflet layer — so it can never be dragged,
 * mis-tapped, or fat-fingered off target. Panning the MAP is what
 * changes the location; this component just reads back wherever the map
 * ended up centered once the user stops moving it (`moveend`, not
 * `move`, so we're not writing state on every pixel of a drag) and
 * reports that single point up as the pin's real coordinate.
 */
function CenterTracker({ onCenterChange }) {
  const map = useMapEvents({
    moveend() {
      const c = map.getCenter();
      onCenterChange(c.lat, c.lng);
    },
  });
  return null;
}

/** Flies the map to a new center when `target` changes */
function FlyController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 17, { animate: true, duration: 0.9 });
  }, [target, map]);
  return null;
}

/**
 * ForceMapHeight
 * Defensive fix for a real bug seen in production: something in this
 * project's global CSS (likely an `!important` rule from a reset or
 * leftover pre-migration stylesheet) was overriding the map container's
 * inline `height: 280px`, collapsing it to 0px tall. A plain inline
 * style can't beat an external `!important` rule, so instead we grab the
 * real Leaflet container DOM node and set the height directly with
 * `!important` priority, then call invalidateSize() so Leaflet redraws
 * its tiles for the corrected box.
 */
function ForceMapHeight({ height }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    container.style.setProperty("height", height, "important");
    const raf = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(raf);
  }, [map, height]);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────────────────

/** Step 1 — Basic store details */
function StepStoreDetails({ data, onChange, errors, t }) {
  return (
    <div className="regform__step">
      <p className="regform__step-desc">
        {t("owner.registration.stepDetailsDesc")}
      </p>

      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-name">
          {t("owner.registration.storeNameLabel")} <span className="pform__required">*</span>
        </label>
        <input
          id="reg-name"
          className={`pform__input ${errors.name ? "pform__input--error" : ""}`}
          type="text"
          placeholder={t("owner.registration.storeNamePlaceholder")}
          value={data.name}
          onChange={(e) => onChange("name", e.target.value)}
          maxLength={80}
          autoFocus
        />
        {errors.name && <span className="regform__field-error">{errors.name}</span>}
      </div>

      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-type">
          {t("owner.registration.storeTypeLabel")} <span className="pform__required">*</span>
        </label>
        <select
          id="reg-type"
          className="pform__select"
          value={data.type}
          onChange={(e) => onChange("type", e.target.value)}
        >
          <option value="">{t("owner.storeEdit.selectType")}</option>
          {STORE_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
        </select>
        {errors.type && <span className="regform__field-error">{errors.type}</span>}
      </div>

      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-contact">
          {t("owner.registration.contactLabel")} <span className="pform__required">*</span>
        </label>
        <input
          id="reg-contact"
          className={`pform__input ${errors.contactNumber ? "pform__input--error" : ""}`}
          type="tel"
          placeholder={t("owner.registration.contactPlaceholder")}
          value={data.contactNumber}
          onChange={(e) => onChange("contactNumber", e.target.value)}
          maxLength={20}
        />
        {errors.contactNumber && <span className="regform__field-error">{errors.contactNumber}</span>}
      </div>
    </div>
  );
}

/**
 * Step 2 — Location.
 *
 * Flow, in plain terms:
 *   1. Grab GPS automatically the moment this step opens (no button to
 *      tap first — one less thing to figure out).
 *   2. Show a small, non-interactive preview and ask a single yes/no
 *      question: "Is this your store?" Most people just tap Yes and
 *      move on — no map-editing skills required at all for the common
 *      case.
 *   3. If No (or GPS fails/is denied), drop into "adjust" mode: a full
 *      map they can pan freely, with the pin FIXED in the center of the
 *      screen at all times. Moving the map is moving the pin — there's
 *      nothing small to drag, nothing to miss with a fingertip. Typing
 *      a street/subdivision is offered as a secondary way to jump the
 *      map to roughly the right area, for when the GPS spot is far off.
 *   4. Either path ends in the same "Location set" state, with a small
 *      "Change" link in case they want to redo it.
 *
 * `data.confirmed` (not just data.lat/lng existing) is what gates moving
 * to Step 3 — coordinates alone don't mean the owner actually looked at
 * and accepted a location, only that GPS resolved to *something*.
 */
function StepGISLocation({ data, onChange, errors, t, theme }) {
  const [searchQuery, setSearchQuery] = useState(data.address || "");
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState("");
  const [flyTarget, setFlyTarget] = useState(null);
  const [manualMode, setManualMode] = useState(false);

  const hasCoords = data.lat !== null && data.lng !== null;

  const { position: gpsPosition, status: gpsStatus, requestLocation: retryGps } = useGeolocation();

  // Applies a resolved GPS fix to the pin — covers both the initial
  // auto-pin on step entry AND a later "try again" tap from inside
  // manual mode (e.g. GPS timed out indoors the first time but succeeds
  // on retry near a window). Never overrides a location the owner has
  // already explicitly confirmed. Dedupes on the exact fix so it only
  // ever applies (and flies the map to) each new GPS result once.
  const lastAppliedGpsRef = useRef(null);
  useEffect(() => {
    if (data.confirmed) return;
    if (gpsStatus !== "granted" || !gpsPosition) return;
    const key = `${gpsPosition[0]},${gpsPosition[1]}`;
    if (lastAppliedGpsRef.current === key) return;
    lastAppliedGpsRef.current = key;
    onChange("lat", gpsPosition[0]);
    onChange("lng", gpsPosition[1]);
    if (manualMode) setFlyTarget(gpsPosition);
  }, [gpsStatus, gpsPosition, data.confirmed, manualMode, onChange]);

  // If GPS can't help at all, skip straight to manual adjustment —
  // there's nothing to "confirm" without a detected position.
  useEffect(() => {
    if (!data.confirmed && !manualMode && (gpsStatus === "denied" || gpsStatus === "unsupported")) {
      setManualMode(true);
    }
  }, [gpsStatus, data.confirmed, manualMode]);

  /** Nominatim address → coordinates (secondary path, used from adjust mode) */
  const handleGeocode = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setGeocoding(true);
    setGeocodeError("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&countrycodes=ph`;
      const res = await fetch(url, {
        headers: { "Accept-Language": "en", "User-Agent": "GIS-Community-Platform/1.0" },
      });
      const results = await res.json();
      if (results.length === 0) {
        setGeocodeError(t("owner.registration.addressNotFound"));
        return;
      }
      const { lat, lon } = results[0];
      const newLat = parseFloat(lat);
      const newLng = parseFloat(lon);
      onChange("lat", newLat);
      onChange("lng", newLng);
      onChange("address", searchQuery.trim());
      setFlyTarget([newLat, newLng]);
    } catch {
      setGeocodeError(t("owner.registration.geocodeFailed"));
    } finally {
      setGeocoding(false);
    }
  }, [searchQuery, onChange, t]);

  const handleCenterChange = useCallback((lat, lng) => {
    onChange("lat", lat);
    onChange("lng", lng);
  }, [onChange]);

  const acceptLocation = () => onChange("confirmed", true);
  const startAdjusting = () => { onChange("confirmed", false); setManualMode(true); };

  // ── State: already confirmed — small success card, nothing to read ──────────
  if (data.confirmed && hasCoords) {
    return (
      <div className="regform__step">
        <div className="regform__location-card regform__location-card--done">
          <CheckCircle2 size={32} color="var(--color-available)" />
          <p className="regform__location-card-title">{t("owner.registration.locationSetTitle")}</p>
          <button type="button" className="regform__location-change-link" onClick={startAdjusting}>
            {t("owner.registration.changeLocation")}
          </button>
        </div>
      </div>
    );
  }

  // ── State: manual adjustment — pannable map, pin fixed at center ────────────
  if (manualMode) {
    const center = hasCoords ? [data.lat, data.lng] : CATALUNAN_GRANDE_CENTER;
    return (
      <div className="regform__step">
        <p className="regform__step-desc">{t("owner.registration.adjustTitle")}</p>

        {/* key props on both this map and the confirm-preview map above
            are deliberate, not decorative: react-leaflet only applies
            options like `dragging` when a Leaflet map instance is first
            constructed — changing props afterward doesn't reconfigure an
            already-running instance. Without distinct keys, transitioning
            from the confirm preview (built with dragging={false}) into
            this view risked React reusing that same underlying map
            instance here, silently carrying its non-draggable state
            along with it. Distinct keys force a genuinely fresh mount
            every time, guaranteeing this map always gets Leaflet's real
            default (draggable) behavior. */}
        <div className="regform__map-wrapper" style={{ position: "relative" }}>
          <MapContainer
            key="gis-adjust-map"
            center={center}
            zoom={DEFAULT_ZOOM}
            style={{ height: "280px", width: "100%", borderRadius: "12px" }}
            preferCanvas
            zoomControl
            attributionControl={false}
          >
            <TileLayer key={theme} url={getTileUrl(theme)} attribution="" subdomains="abcd" maxZoom={20} />
            <CenterTracker onCenterChange={handleCenterChange} />
            <FlyController target={flyTarget} />
            <ForceMapHeight height="280px" />
          </MapContainer>

          {/* The pin — plain CSS, fixed dead-center, never moves. Moving
              the MAP under it is the entire interaction. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -100%)",
              pointerEvents: "none", zIndex: 500,
              filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))",
            }}
            dangerouslySetInnerHTML={{
              __html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40">
                <path fill="#C85A27" stroke="#fff" stroke-width="1.2"
                  d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                <circle cx="12" cy="9" r="2.8" fill="white"/>
              </svg>`,
            }}
          />

          <div className="regform__map-hint" style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 500, pointerEvents: "none" }}>
            {t("owner.registration.adjustHint")}
          </div>
        </div>

        {gpsStatus === "denied" && (
          <button
            type="button"
            onClick={retryGps}
            style={{
              display: "flex", alignItems: "center", gap: 6, margin: "10px auto 0",
              background: "none", border: "none", color: "var(--color-brand-primary)",
              fontWeight: 700, cursor: "pointer", padding: 4, fontSize: 13,
            }}
          >
            <LocateFixed size={14} /> {t("owner.registration.tryGpsAgain")}
          </button>
        )}

        {/* Secondary path — only needed if the map is showing the wrong
            neighborhood entirely */}
        <div className="regform__field" style={{ marginTop: 12 }}>
          <label className="regform__label" htmlFor="reg-address">
            {t("owner.registration.orSearchAddress")}
          </label>
          <div className="regform__geocode-row">
            <input
              id="reg-address"
              className="pform__input"
              style={{ flex: 1 }}
              type="text"
              placeholder={t("owner.registration.addressPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGeocode()}
            />
            <button type="button" className="regform__geocode-btn" onClick={handleGeocode}
              disabled={geocoding || !searchQuery.trim()} aria-label={t("search.label")}>
              {geocoding ? <Loader2 size={18} className="regform__spin" /> : <Search size={18} />}
            </button>
          </div>
          {geocodeError && (
            <span className="regform__field-error"><AlertTriangle size={12} /> {geocodeError}</span>
          )}
          {errors.coords && (
            <span className="regform__field-error"><AlertTriangle size={12} /> {errors.coords}</span>
          )}
        </div>

        <button type="button" className="regform__nav-next" style={{ width: "100%", marginTop: 16 }}
          onClick={acceptLocation} disabled={!hasCoords}>
          <CheckCircle2 size={18} /> {t("owner.registration.adjustConfirm")}
        </button>
      </div>
    );
  }

  // ── State: waiting on GPS ────────────────────────────────────────────────────
  if (gpsStatus === "loading" || !hasCoords) {
    return (
      <div className="regform__step">
        <div className="regform__location-card">
          <Loader2 size={32} className="regform__spin" color="var(--color-brand-primary)" />
          <p className="regform__location-card-title">{t("owner.registration.locatingGps")}</p>
        </div>
        {errors.coords && (
          <span className="regform__field-error"><AlertTriangle size={12} /> {errors.coords}</span>
        )}
      </div>
    );
  }

  // ── State: confirm — small static preview + Yes/No ──────────────────────────
  return (
    <div className="regform__step">
      <p className="regform__step-desc">{t("owner.registration.confirmTitle")}</p>

      <div className="regform__map-wrapper">
        <MapContainer
          key="gis-confirm-map"
          center={[data.lat, data.lng]}
          zoom={17}
          style={{ height: "180px", width: "100%", borderRadius: "12px" }}
          zoomControl={false}
          attributionControl={false}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          boxZoom={false}
          keyboard={false}
        >
          <TileLayer key={theme} url={getTileUrl(theme)} subdomains="abcd" maxZoom={20} />
          <ForceMapHeight height="180px" />
          <Marker position={[data.lat, data.lng]} icon={STORE_PIN_ICON} />
        </MapContainer>
      </div>

      <p className="regform__step-desc" style={{ fontSize: 12.5, marginTop: 8 }}>
        {t("owner.registration.confirmHint")}
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" className="regform__nav-back" style={{ flex: 1, justifyContent: "center" }}
          onClick={startAdjusting}>
          {t("owner.registration.confirmNo")}
        </button>
        <button type="button" className="regform__nav-next" style={{ flex: 1, justifyContent: "center" }}
          onClick={acceptLocation}>
          <CheckCircle2 size={18} /> {t("owner.registration.confirmYes")}
        </button>
      </div>
      {errors.coords && (
        <span className="regform__field-error" style={{ display: "block", marginTop: 8 }}>
          <AlertTriangle size={12} /> {errors.coords}
        </span>
      )}
    </div>
  );
}

/** Step 3 — Review summary before final submit */
function StepReview({ data, t, theme }) {
  const hasCoords = data.lat !== null && data.lng !== null;

  const rows = [
    { label: t("owner.registration.reviewStoreName"), value: data.name },
    { label: t("owner.registration.reviewStoreType"), value: data.type },
    { label: t("owner.registration.reviewContact"), value: data.contactNumber },
    { label: t("owner.registration.reviewAddress"), value: data.address || t("owner.registration.reviewNotProvided") },
  ];

  return (
    <div className="regform__step">
      <p className="regform__step-desc">
        {t("owner.registration.stepReviewDesc")}
      </p>

      <div className="regform__review-table">
        {rows.map(({ label, value }) => (
          <div key={label} className="regform__review-row">
            <span className="regform__review-label">{label}</span>
            <span className="regform__review-value">{value || <em style={{ color: "var(--color-text-muted)" }}>—</em>}</span>
          </div>
        ))}
      </div>

      {/* Mini map preview of pin location */}
      {hasCoords && (
        <div className="regform__map-wrapper" style={{ marginTop: 16 }}>
          <div className="regform__map-hint">📍 {t("owner.registration.pinPreview")}</div>
          <MapContainer
            center={[data.lat, data.lng]}
            zoom={17}
            style={{ height: "180px", width: "100%", borderRadius: "0 0 12px 12px" }}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
          >
            <TileLayer
              key={theme}
              url={getTileUrl(theme)}
              subdomains="abcd"
              maxZoom={20}
            />
            <ForceMapHeight height="180px" />
            <Marker position={[data.lat, data.lng]} icon={STORE_PIN_ICON} />
          </MapContainer>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported component
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_DATA = {
  name: "",
  type: "",
  ownerName: "",
  contactNumber: "",
  address: "",
  lat: null,
  lng: null,
  // Gates Step 2 -> Step 3, not just lat/lng existing — GPS resolving to
  // *something* isn't the same as the owner having looked at it and
  // said "yes, that's right". See StepGISLocation's file header.
  confirmed: false,
};

/**
 * StoreRegistrationForm
 * Shows a 3-step wizard and writes the new store to Supabase on submit
 * as "approved" — live on the public map immediately, no review step.
 *
 * @param {{
 *   user: import("@supabase/supabase-js").User,
 *   onComplete: Function,
 *   onCancel?: Function  — optional; when provided, shows a "Cancel"
 *     button (only meaningful for the "add another store" flow from
 *     within the dashboard — the mandatory first-time registration has
 *     no legitimate way to cancel, so this stays unset there).
 * }} props
 */
export default function StoreRegistrationForm({ user, onComplete, onCancel }) {
  const { t } = useLanguage();
  const { theme } = useTheme();

  // Defined inside the component so labels react to language changes
  const STEPS = [
    { id: 1, label: t("owner.registration.stepDetails"),   icon: Store   },
    { id: 2, label: t("owner.registration.stepLocation"),  icon: MapPin  },
    { id: 3, label: t("owner.registration.stepReview"), icon: CheckCircle2 },
  ];

  const [step, setStep]       = useState(1);
  const [dir, setDir]         = useState(1);    // animation direction
  const [data, setData]       = useState(INITIAL_DATA);
  const [errors, setErrors]   = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const onChange = useCallback((field, value) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined, coords: undefined }));
  }, []);

  // Owner/manager name is no longer a Step 1 field (see file header) —
  // auto-fill it once from the signed-in account so `owner_name` (NOT
  // NULL in the schema) is always populated without asking the merchant
  // to type their own name during registration.
  useEffect(() => {
    setData((prev) => (prev.ownerName ? prev : { ...prev, ownerName: deriveOwnerNameFromUser(user) }));
  }, [user]);

  // ── Per-step validation ──────────────────────────────────────────────────
  const validate = (targetStep) => {
    const errs = {};
    if (targetStep >= 1) {
      if (!data.name.trim())          errs.name         = t("owner.registration.nameRequired");
      if (!data.type)                 errs.type         = t("owner.registration.typeRequired");
      if (!data.contactNumber.trim()) errs.contactNumber = t("owner.registration.contactRequired");
    }
    if (targetStep >= 2) {
      if (!data.confirmed || data.lat === null || data.lng === null)
        errs.coords = t("owner.registration.coordsRequired");
    }
    return errs;
  };

  const goNext = () => {
    const errs = validate(step);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setDir(1);
    setStep((s) => s + 1);
    setErrors({});
  };

  const goBack = () => {
    setDir(-1);
    setStep((s) => s - 1);
    setErrors({});
  };

  // ── Final submit ──────────────────────────────────────────────────────────
  // isSubmittingRef is a SYNCHRONOUS guard, separate from the `submitting`
  // state. This matters because `disabled={submitting}` on the button only
  // takes effect on the NEXT RENDER — a fast double-click/tap can fire
  // handleSubmit twice before React has re-rendered with the button
  // disabled. That's exactly what produced duplicate store rows in
  // production: two (or three) inserts landing before the UI caught up.
  // Checking a ref at the very top, before any `await` or state update,
  // closes that window regardless of render timing.
  const isSubmittingRef = useRef(false);

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return;

    const errs = validate(2);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    isSubmittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");

    const { error: insertError } = await supabase.from("stores").insert({
      name:           data.name.trim(),
      type:           data.type,
      owner_name:     data.ownerName.trim(),
      contact_number: data.contactNumber.trim(),
      address:        data.address.trim(),
      // EWKT text -> geography(Point, 4326); latitude/longitude are generated
      location:       `SRID=4326;POINT(${data.lng} ${data.lat})`,
      owner_id:       user.id,
      owner_email:    user.email,
      // FRICTIONLESS REGISTRATION: no more review gate — the store is
      // immediately live on the public map. (The DB column default was
      // also changed to 'approved'; sent explicitly here too so this
      // doesn't silently depend on that default alone.)
      status:         "approved",
    });

    if (insertError) {
      console.error("Store registration failed:", insertError);
      setSubmitError(t("owner.registration.submitFailed"));
      setSubmitting(false);
      isSubmittingRef.current = false;
      return;
    }

    setSubmitting(false);
    onComplete?.();
    // Deliberately NOT resetting isSubmittingRef.current on success — the
    // parent immediately swaps this component out for the dashboard/
    // pending view, so there's no legitimate case where this same form
    // instance should accept another submit.
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="regform"
      style={{ minHeight: "100dvh", height: "auto", overflowY: "visible", paddingBottom: 24 }}
    >
      {/* Page header */}
      <div className="regform__header" style={{ position: "relative" }}>
        <Store size={28} />
        <div>
          <h1 className="regform__title">{t("owner.registration.title")}</h1>
          <p className="regform__subtitle">{t("owner.registration.signedInAs", user.email)}</p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("owner.registration.cancel")}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              padding: 8,
            }}
          >
            ✕ {t("owner.registration.cancel")}
          </button>
        )}
      </div>

      {/* Step progress indicator */}
      <div className="regform__stepper">
        {STEPS.map(({ id, label, icon: Icon }) => (
          <React.Fragment key={id}>
            <div className={`regform__step-node ${step === id ? "regform__step-node--active" : ""} ${step > id ? "regform__step-node--done" : ""}`}>
              {step > id
                ? <CheckCircle2 size={16} />
                : <Icon size={16} />}
              <span className="regform__step-label">{label}</span>
            </div>
            {id < STEPS.length && (
              <div className={`regform__step-connector ${step > id ? "regform__step-connector--done" : ""}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Animated step content */}
      <div className="regform__body">
        <AnimatePresence custom={dir} mode="wait">
          <motion.div
            key={step}
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {step === 1 && (
              <StepStoreDetails data={data} onChange={onChange} errors={errors} t={t} />
            )}
            {step === 2 && (
              <StepGISLocation data={data} onChange={onChange} errors={errors} t={t} theme={theme} />
            )}
            {step === 3 && (
              <StepReview data={data} t={t} theme={theme} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Submit error */}
      {submitError && (
        <div className="regform__submit-error">
          <AlertTriangle size={15} /> {submitError}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="regform__nav">
        {step > 1 && (
          <button type="button" className="regform__nav-back" onClick={goBack} disabled={submitting}>
            <ChevronLeft size={18} /> {t("owner.registration.back")}
          </button>
        )}

        {step < 3 && (
          <button type="button" className="regform__nav-next" onClick={goNext}>
            {t("owner.registration.next")} <ChevronRight size={18} />
          </button>
        )}

        {step === 3 && (
          <button type="button" className="regform__nav-submit" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                {t("owner.registration.registering")}
              </>
            ) : (
              <>
                <CheckCircle2 size={18} /> {t("owner.registration.registerStore")}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}


