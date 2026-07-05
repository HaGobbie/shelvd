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
} from "lucide-react";
import { supabase } from "../config/supabaseClient";

// ─── Leaflet icon fix ─────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Red draggable pin — same as registration form for visual consistency
const STORE_PIN_ICON = L.divIcon({
  html: `
    <div style="position:relative;width:36px;height:36px;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
        <path fill="#E74C3C" stroke="#fff" stroke-width="1.2"
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

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "details",  label: "Store Details", Icon: Store  },
  { id: "location", label: "GIS Location",  Icon: MapPin },
];

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

// ─────────────────────────────────────────────────────────────────────────────

/**
 * StoreEditModal
 * Two-tab bottom sheet: "Store Details" + "GIS Location".
 * Pre-populated with the current store data on open.
 *
 * @param {{
 *   isOpen: boolean,
 *   onClose: Function,
 *   store: object          — the current store object (from useMyStore, camelCase)
 * }} props
 */
export default function StoreEditModal({ isOpen, onClose, store }) {
  const [activeTab, setActiveTab]       = useState("details");

  // ── Form state ────────────────────────────────────────────────────────────
  const [name, setName]                 = useState("");
  const [type, setType]                 = useState("");
  const [ownerName, setOwnerName]       = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress]           = useState("");
  const [lat, setLat]                   = useState(null);
  const [lng, setLng]                   = useState(null);

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
  const validate = () => {
    const errs = {};
    if (!name.trim())          errs.name          = "Store name is required.";
    if (!type)                 errs.type          = "Please select a store type.";
    if (!ownerName.trim())     errs.ownerName     = "Owner name is required.";
    if (!contactNumber.trim()) errs.contactNumber = "Contact number is required.";
    if (lat === null || lng === null) errs.coords = "Please set your store's location on the map.";
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
        setGeocodeError("Address not found. Try a different search or pin manually.");
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
      setGeocodeError("Geocoding failed. Check your connection or pin manually.");
    } finally {
      setGeocoding(false);
    }
  }, [searchQuery]);

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
      // If location error, switch to the location tab to show it
      if (errs.coords) setActiveTab("location");
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
      })
      .eq("id", store.id);

    if (updateError) {
      console.error("Store update failed:", updateError);
      setSaveError("Failed to save. Please check your connection and try again.");
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
            aria-label="Edit store profile"
          >
            {/* Drag handle */}
            <div className="sheet-handle" aria-hidden="true" />

            {/* Header */}
            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">Edit Store Profile</h2>
                <span className="sheet-header__type">
                  Changes are saved to your public map listing.
                </span>
              </div>
              <button className="sheet-close-btn" onClick={onClose} aria-label="Close" type="button">
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
                      Store Name <span className="pform__required">*</span>
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
                      Store Type <span className="pform__required">*</span>
                    </label>
                    <select
                      id="se-type"
                      className={`pform__select ${errors.type ? "pform__input--error" : ""}`}
                      value={type}
                      onChange={(e) => { setType(e.target.value); setErrors((p) => ({ ...p, type: undefined })); }}
                    >
                      <option value="">— Select a type —</option>
                      {STORE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {errors.type && <span className="regform__field-error"><AlertTriangle size={12} /> {errors.type}</span>}
                  </div>

                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-owner">
                      Owner / Manager Name <span className="pform__required">*</span>
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
                      Contact Number <span className="pform__required">*</span>
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
                    Search for your address or tap the map to move your pin to a new location. Drag the pin to fine-tune.
                  </p>

                  {/* Address geocode */}
                  <div className="regform__field">
                    <label className="regform__label" htmlFor="se-address">Street Address</label>
                    <div className="regform__geocode-row">
                      <input
                        id="se-address"
                        className="pform__input"
                        style={{ flex: 1 }}
                        type="text"
                        placeholder="e.g. Blk 4 Lot 12, Catalunan Grande"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleGeocode()}
                      />
                      <button
                        type="button"
                        className="regform__geocode-btn"
                        onClick={handleGeocode}
                        disabled={geocoding || !searchQuery.trim()}
                        aria-label="Search address"
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
                        : "Tap the map to place a pin"}
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
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        subdomains="abcd"
                        maxZoom={20}
                      />
                      <ClickHandler onMapClick={handleMapClick} />
                      <FlyController target={flyTarget} />
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
                        <label className="regform__label">Latitude</label>
                        <input
                          className="pform__input"
                          type="number"
                          step="0.000001"
                          value={lat}
                          onChange={(e) => setLat(parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="regform__coord-field">
                        <label className="regform__label">Longitude</label>
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
                  <><span>✓</span> Saved!</>
                ) : saving ? (
                  <>
                    <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                    Saving…
                  </>
                ) : (
                  <><Save size={18} /> Save Changes</>
                )}
              </button>
            </div>

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
