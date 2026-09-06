// src/components/StoreEditModal.jsx
// Bottom-sheet modal that lets an owner edit their store's profile
// and GIS location (address + draggable Leaflet pin).
//
// On save → supabase.from('stores').update(...).eq('id', store.id) with:
//   name, type, owner_name, contact_number, address, location (PostGIS point)
//
// NOTE ON WRITING GEOGRAPHY COLUMNS: `stores.location` is a
// geography(Point, 4326) column; `latitude`/`longitude` are generated
// (read-only) columns derived from it, so we never write those directly.
// PostgREST/Postgres accepts an EWKT string like "SRID=4326;POINT(lng lat)"
// for a geography column, so we just send that as a plain string value.
//
// NOTE ON STORE_TYPES: dropdown values stay in English regardless of UI
// language — stored as-is in the DB and shown on the public map, so only
// the surrounding labels/messages are translated, not the stored value.

import React, { useState, useEffect, useCallback } from "react";
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
  X,
  Save,
  Search,
  Loader2,
  AlertTriangle,
  MapPin,
  Store,
  Phone,
  Share2,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { getTileUrl, TILE_ATTRIBUTION } from "../config/mapTiles";

// ─── Leaflet icon fix ─────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Terracotta draggable pin — same as registration form for visual
// consistency. NOTE: this is a literal hex, not var(--color-brand-primary)
// — it's baked into a raw SVG string for L.divIcon(), and SVG fill="..."
// attributes don't support var() CSS syntax (only an actual style="..."
// property does). If the brand accent color changes again, this needs
// updating by hand in both this file and StoreRegistrationForm.jsx.
const STORE_PIN_ICON = L.divIcon({
  html: `
    <div style="position:relative;width:36px;height:36px;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
        <path fill="#C85A27" stroke="#fff" stroke-width="1.2"
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <circle cx="12" cy="9" r="2.8" fill="white"/>
      </svg>
    </div>`,
  className: "",
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

const STORE_TYPES = [
  "General Store", "Sari-sari Store", "Mini Grocery", "Pharmacy",
  "Bakery", "Meat & Fish Stall", "Vegetable Stall", "Hardware Store", "Other",
];

// ─── Sheet animation variants ─────────────────────────────────────────────────
const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.16 } },
};

const sheetVariants = {
  hidden:  { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", damping: 28, stiffness: 300, mass: 0.9 } },
  exit:    { y: "100%", opacity: 0, transition: { type: "tween", ease: "easeIn", duration: 0.2 } },
};

// ─── Leaflet inner helpers ────────────────────────────────────────────────────
function ClickHandler({ onMapClick }) {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function FlyController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 17, { animate: true, duration: 0.8 });
  }, [target, map]);
  return null;
}

/**
 * ForceMapHeight — see StoreRegistrationForm.jsx for the full explanation.
 * Same fix applied here defensively: something in this project's global
 * CSS overrides the map container's inline height with an `!important`
 * rule, collapsing it to 0px. This forces it back via setProperty with
 * matching `!important` priority, then invalidates Leaflet's cached size.
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

/**
 * StoreEditModal
 * Two-tab bottom sheet: "Store Details" + "GIS Location".
 * Pre-populated with the current store data on open.
 *
 * @param {{
 *   isOpen: boolean,
 *   onClose: Function,
 *   store: object          — the current store object (from useMyStores, camelCase)
 * }} props
 */
export default function StoreEditModal({ isOpen, onClose, store }) {
  const { t } = useLanguage();
  const { theme } = useTheme();

  // Tabs defined inside the component so their labels react to language changes
  const TABS = [
    { id: "details",  label: t("owner.storeEdit.tabDetails"), Icon: Store  },
    { id: "location", label: t("owner.storeEdit.tabLocation"), Icon: MapPin },
    { id: "socials",  label: t("owner.storeEdit.tabSocials"), Icon: Share2 },
  ];

  const [activeTab, setActiveTab]       = useState("details");

  // ── Form state ────────────────────────────────────────────────────────────
  const [name, setName]                 = useState("");
  const [type, setType]                 = useState("");
  const [ownerName, setOwnerName]       = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress]           = useState("");
  const [lat, setLat]                   = useState(null);
  const [lng, setLng]                   = useState(null);
  const [facebookUrl, setFacebookUrl]   = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [tiktokUrl, setTiktokUrl]       = useState("");

  // ── UI state ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]   = useState("");
  const [geocoding, setGeocoding]       = useState(false);
  const [geocodeError, setGeocodeError] = useState("");
  const [flyTarget, setFlyTarget]       = useState(null);
  const [errors, setErrors]             = useState({});
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState("");
  const [saved, setSaved]               = useState(false);

  // ── Populate form when modal opens ────────────────────────────────────────
  useEffect(() => {
    if (isOpen && store) {
      setName(store.name ?? "");
      setType(store.type ?? "");
      setOwnerName(store.ownerName ?? "");
      setContactNumber(store.contactNumber ?? "");
      setAddress(store.address ?? "");
      setLat(store.lat ?? null);
      setLng(store.lng ?? null);
      setFacebookUrl(store.facebookUrl ?? "");
      setInstagramUrl(store.instagramUrl ?? "");
      setTiktokUrl(store.tiktokUrl ?? "");
      setSearchQuery(store.address ?? "");
      setActiveTab("details");
      setErrors({});
      setSaveError("");
      setSaved(false);
      setGeocodeError("");
      setFlyTarget(null);
    }
  }, [isOpen, store]);

  // ── Validation ────────────────────────────────────────────────────────────
  // A basic http(s):// prefix check only — deliberately not validating
  // that the domain actually matches facebook.com/instagram.com/tiktok.com,
  // since legitimate pages sometimes sit behind link shorteners or vanity
  // domains. This just catches "pasted plain text instead of a URL."
  const isValidUrl = (value) => !value.trim() || /^https?:\/\//i.test(value.trim());

  const validate = () => {
    const errs = {};
    if (!name.trim())          errs.name          = t("owner.storeEdit.nameRequired");
    if (!type)                 errs.type          = t("owner.storeEdit.typeRequired");
    if (!ownerName.trim())     errs.ownerName     = t("owner.storeEdit.ownerRequired");
    if (!contactNumber.trim()) errs.contactNumber = t("owner.storeEdit.contactRequired");
    if (lat === null || lng === null) errs.coords = t("owner.storeEdit.coordsRequired");
    if (!isValidUrl(facebookUrl))  errs.facebookUrl  = t("owner.storeEdit.invalidUrl");
    if (!isValidUrl(instagramUrl)) errs.instagramUrl = t("owner.storeEdit.invalidUrl");
    if (!isValidUrl(tiktokUrl))    errs.tiktokUrl    = t("owner.storeEdit.invalidUrl");
    return errs;
  };

  // ── Geocoding ─────────────────────────────────────────────────────────────
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
        setGeocodeError(t("owner.storeEdit.addressNotFound"));
        return;
      }
      const newLat = parseFloat(results[0].lat);
      const newLng = parseFloat(results[0].lon);
      setLat(newLat);
      setLng(newLng);
      setAddress(searchQuery.trim());
      setFlyTarget([newLat, newLng]);
      setErrors((prev) => ({ ...prev, coords: undefined }));
    } catch {
      setGeocodeError(t("owner.storeEdit.geocodeFailed"));
    } finally {
      setGeocoding(false);
    }
  }, [searchQuery, t]);

  const handleMapClick = useCallback((newLat, newLng) => {
    setLat(newLat);
    setLng(newLng);
    setErrors((prev) => ({ ...prev, coords: undefined }));
  }, []);

  const handleMarkerDrag = useCallback((e) => {
    const pos = e.target.getLatLng();
    setLat(pos.lat);
    setLng(pos.lng);
    setErrors((prev) => ({ ...prev, coords: undefined }));
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Jump to whichever tab actually has the problem, so the person
      // isn't left staring at "Details" wondering why Save won't work.
      if (errs.coords) setActiveTab("location");
      else if (errs.facebookUrl || errs.instagramUrl || errs.tiktokUrl) setActiveTab("socials");
      return;
    }

    setSaving(true);
    setSaveError("");

    const { error: updateError } = await supabase
      .from("stores")
      .update({
        name:           name.trim(),
        type,
        owner_name:     ownerName.trim(),
        contact_number: contactNumber.trim(),
        address:        address.trim(),
        // EWKT text — Postgres casts this to geography(Point, 4326) automatically.
        location:       `SRID=4326;POINT(${lng} ${lat})`,
        // Empty string -> null, not "", so a cleared field actually
        // clears (and so it satisfies the DB's http(s):// CHECK
        // constraint, which only exempts NULL, not empty string).
        facebook_url:   facebookUrl.trim() || null,
        instagram_url:  instagramUrl.trim() || null,
        tiktok_url:     tiktokUrl.trim() || null,
      })
      .eq("id", store.id);

    if (updateError) {
      console.error("Store update failed:", updateError);
      setSaveError(t("owner.storeEdit.saveFailed"));
      setSaving(false);
      return;
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 900);
  };

  const hasCoords = lat !== null && lng !== null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="sheet-overlay"
            style={{ zIndex: 1000 }}
            variants={overlayVariants}
            initial="hidden" animate="visible" exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet */}
          <motion.div
            className="sheet-panel"
            style={{ zIndex: 1001, maxHeight: "94dvh" }}
            variants={sheetVariants}
            initial="hidden" animate="visible" exit="exit"
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-label={t("owner.storeEdit.title")}
          >
            {/* Drag handle */}
            <div className="sheet-handle" aria-hidden="true" />

            {/* Header */}
            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">{t("owner.storeEdit.title")}</h2>
                <span className="sheet-header__type">
                  {t("owner.storeEdit.subtitle")}
                </span>
              </div>
              <button className="sheet-close-btn" onClick={onClose} aria-label={t("owner.product.close")} type="button">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            {/* Tab bar */}
            <div className="stedit__tabs" role="tablist">
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={activeTab === id}
                  className={`stedit__tab ${activeTab === id ? "stedit__tab--active" : ""}`}
                  onClick={() => setActiveTab(id)}
                  type="button"
                >
                  <Icon size={15} strokeWidth={2} />
                  {label}
                  {id === "location" && errors.coords && (
                    <span className="stedit__tab-error-dot" aria-label="Has errors" />
                  )}
                  {id === "socials" && (errors.facebookUrl || errors.instagramUrl || errors.tiktokUrl) && (
                    <span className="stedit__tab-error-dot" aria-label="Has errors" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content — scrollable */}
            <div className="sheet-inventory" style={{ padding: "16px 20px 8px" }}>

              {/* ── Details tab ── */}
              {activeTab === "details" && (
                <div>
                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-name">
                      {t("owner.storeEdit.nameLabel")} <span className="pform__required">*</span>
                    </label>
                    <input
                      id="se-name"
                      className={`pform__input ${errors.name ? "pform__input--error" : ""}`}
                      type="text"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }}
                      maxLength={80}
                      autoFocus
                    />
                    {errors.name && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.name}</span>}
                  </div>

                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-type">
                      {t("owner.storeEdit.typeLabel")} <span className="pform__required">*</span>
                    </label>
                    <select
                      id="se-type"
                      className={`pform__select ${errors.type ? "pform__input--error" : ""}`}
                      value={type}
                      onChange={(e) => { setType(e.target.value); setErrors((p) => ({ ...p, type: undefined })); }}
                    >
                      <option value="">{t("owner.storeEdit.selectType")}</option>
                      {STORE_TYPES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                    {errors.type && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.type}</span>}
                  </div>

                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-owner">
                      {t("owner.storeEdit.ownerLabel")} <span className="pform__required">*</span>
                    </label>
                    <input
                      id="se-owner"
                      className={`pform__input ${errors.ownerName ? "pform__input--error" : ""}`}
                      type="text"
                      value={ownerName}
                      onChange={(e) => { setOwnerName(e.target.value); setErrors((p) => ({ ...p, ownerName: undefined })); }}
                      maxLength={60}
                    />
                    {errors.ownerName && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.ownerName}</span>}
                  </div>

                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-contact">
                      {t("owner.storeEdit.contactLabel")} <span className="pform__required">*</span>
                    </label>
                    <input
                      id="se-contact"
                      className={`pform__input ${errors.contactNumber ? "pform__input--error" : ""}`}
                      type="tel"
                      value={contactNumber}
                      onChange={(e) => { setContactNumber(e.target.value); setErrors((p) => ({ ...p, contactNumber: undefined })); }}
                      maxLength={20}
                    />
                    {errors.contactNumber && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.contactNumber}</span>}
                  </div>
                </div>
              )}

              {/* ── Location tab ── */}
              {activeTab === "location" && (
                <div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)", lineHeight: 1.6 }}>
                    {t("owner.storeEdit.locationHint")}
                  </p>

                  {/* Address geocode */}
                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-address">{t("owner.storeEdit.addressLabel")}</label>
                    <div className="regform__geocode-row">
                      <input
                        id="se-address"
                        className="pform__input"
                        style={{ flex: 1 }}
                        type="text"
                        placeholder={t("owner.storeEdit.addressPlaceholder")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleGeocode()}
                      />
                      <button
                        type="button"
                        className="regform__geocode-btn"
                        onClick={handleGeocode}
                        disabled={geocoding || !searchQuery.trim()}
                        aria-label={t("search.label")}
                      >
                        {geocoding
                          ? <Loader2 size={18} className="regform__spin" />
                          : <Search size={18} />}
                      </button>
                    </div>
                    {geocodeError && (
                      <span className="regform__field-error">
                        <AlertTriangle size={12} /> {geocodeError}
                      </span>
                    )}
                    {errors.coords && (
                      <span className="regform__field-error">
                        <AlertTriangle size={12} /> {errors.coords}
                      </span>
                    )}
                  </div>

                  {/* Interactive map */}
                  <div className="regform__map-wrapper">
                    <div className="regform__map-hint">
                      {hasCoords
                        ? `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`
                        : t("owner.storeEdit.tapToPlace")}
                    </div>
                    <MapContainer
                      center={hasCoords ? [lat, lng] : [7.0508, 125.5694]}
                      zoom={hasCoords ? 17 : 15}
                      style={{ height: "260px", width: "100%" }}
                      preferCanvas
                      zoomControl
                      attributionControl={false}
                    >
                      <TileLayer
                        key={theme}
                        url={getTileUrl(theme)}
                        attribution={TILE_ATTRIBUTION}
                        subdomains="abcd"
                        maxZoom={20}
                      />
                      <ClickHandler onMapClick={handleMapClick} />
                      <FlyController target={flyTarget} />
                      <ForceMapHeight height="260px" />
                      {hasCoords && (
                        <Marker
                          position={[lat, lng]}
                          icon={STORE_PIN_ICON}
                          draggable
                          eventHandlers={{ dragend: handleMarkerDrag }}
                        />
                      )}
                    </MapContainer>
                  </div>

                  {/* Manual lat/lng inputs */}
                  {hasCoords && (
                    <div className="regform__coord-row" style={{ marginTop: 12 }}>
                      <div className="regform__coord-field">
                        <label className="regform__label">{t("owner.storeEdit.latitude")}</label>
                        <input
                          className="pform__input"
                          type="number"
                          step="0.000001"
                          value={lat}
                          onChange={(e) => setLat(parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="regform__coord-field">
                        <label className="regform__label">{t("owner.storeEdit.longitude")}</label>
                        <input
                          className="pform__input"
                          type="number"
                          step="0.000001"
                          value={lng}
                          onChange={(e) => setLng(parseFloat(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Socials tab ── */}
              {activeTab === "socials" && (
                <div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)", lineHeight: 1.6 }}>
                    {t("owner.storeEdit.socialsHint")}
                  </p>

                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-facebook">{t("owner.storeEdit.facebookLabel")}</label>
                    <input
                      id="se-facebook"
                      className={`pform__input ${errors.facebookUrl ? "pform__input--error" : ""}`}
                      type="url"
                      inputMode="url"
                      placeholder={t("owner.storeEdit.socialUrlPlaceholder")}
                      value={facebookUrl}
                      onChange={(e) => { setFacebookUrl(e.target.value); setErrors((p) => ({ ...p, facebookUrl: undefined })); }}
                      maxLength={300}
                    />
                    {errors.facebookUrl && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.facebookUrl}</span>}
                  </div>

                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-instagram">{t("owner.storeEdit.instagramLabel")}</label>
                    <input
                      id="se-instagram"
                      className={`pform__input ${errors.instagramUrl ? "pform__input--error" : ""}`}
                      type="url"
                      inputMode="url"
                      placeholder={t("owner.storeEdit.socialUrlPlaceholder")}
                      value={instagramUrl}
                      onChange={(e) => { setInstagramUrl(e.target.value); setErrors((p) => ({ ...p, instagramUrl: undefined })); }}
                      maxLength={300}
                    />
                    {errors.instagramUrl && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.instagramUrl}</span>}
                  </div>

                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-tiktok">{t("owner.storeEdit.tiktokLabel")}</label>
                    <input
                      id="se-tiktok"
                      className={`pform__input ${errors.tiktokUrl ? "pform__input--error" : ""}`}
                      type="url"
                      inputMode="url"
                      placeholder={t("owner.storeEdit.socialUrlPlaceholder")}
                      value={tiktokUrl}
                      onChange={(e) => { setTiktokUrl(e.target.value); setErrors((p) => ({ ...p, tiktokUrl: undefined })); }}
                      maxLength={300}
                    />
                    {errors.tiktokUrl && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.tiktokUrl}</span>}
                  </div>
                </div>
              )}

            </div>{/* end scrollable body */}

            {/* Save error */}
            {saveError && (
              <div className="regform__submit-error" style={{ margin: "0 20px 8px" }}>
                <AlertTriangle size={15} /> {saveError}
              </div>
            )}

            {/* Save button — always visible at the bottom */}
            <div style={{ padding: "12px 20px calc(20px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--color-border)" }}>
              <button
                type="button"
                className="pform__submit"
                onClick={handleSave}
                disabled={saving || saved}
                style={saved ? { background: "var(--color-available)" } : {}}
              >
                {saved ? (
                  <><span>✓</span> {t("owner.storeEdit.saved")}</>
                ) : saving ? (
                  <>
                    <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                    {t("owner.storeEdit.saving")}
                  </>
                ) : (
                  <><Save size={18} /> {t("owner.storeEdit.saveChanges")}</>
                )}
              </button>
            </div>

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
