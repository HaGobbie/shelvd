// src/components/StoreRegistrationForm.jsx
// 3-step store registration wizard for new store owners.
//
// Step 1 — Store Details   : name, type, owner name, contact number
// Step 2 — GIS Location    : Nominatim address search + draggable Leaflet pin
// Step 3 — Review & Submit : summary before writing to Supabase
//
// On submit → supabase.from('stores').insert({ ..., owner_id: user.id, status: 'pending_approval' })
// Coordinates are sent as a single PostGIS `location` field using EWKT text
// ("SRID=4326;POINT(lng lat)") — Postgres casts this to geography(Point,4326)
// automatically; `latitude`/`longitude` are generated columns derived from it.

import React, { useState, useCallback, useEffect } from "react";
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
} from "lucide-react";
import { supabase } from "../config/supabaseClient";

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

// Custom red pin icon so it visually stands out from the public map's pins
const STORE_PIN_ICON = L.divIcon({
  html: `
    <div style="position:relative;width:36px;height:36px;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
        <path fill="#E74C3C" stroke="#fff" stroke-width="1.2"
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

// ─── Stepper config ───────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Store Details",   icon: Store   },
  { id: 2, label: "GIS Location",    icon: MapPin  },
  { id: 3, label: "Review & Submit", icon: CheckCircle2 },
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

/** Listens for map clicks and updates the pin position */
function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
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

// ─────────────────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────────────────

/** Step 1 — Basic store details */
function StepStoreDetails({ data, onChange, errors }) {
  return (
    <div className="regform__step">
      <p className="regform__step-desc">
        Tell us about your store. This information will appear on the community map.
      </p>

      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-name">
          Store Name <span className="pform__required">*</span>
        </label>
        <input
          id="reg-name"
          className={`pform__input ${errors.name ? "pform__input--error" : ""}`}
          type="text"
          placeholder="e.g. Reyes General Merchandise"
          value={data.name}
          onChange={(e) => onChange("name", e.target.value)}
          maxLength={80}
          autoFocus
        />
        {errors.name && <span className="regform__field-error">{errors.name}</span>}
      </div>

      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-type">
          Store Type <span className="pform__required">*</span>
        </label>
        <select
          id="reg-type"
          className="pform__select"
          value={data.type}
          onChange={(e) => onChange("type", e.target.value)}
        >
          <option value="">— Select a type —</option>
          {STORE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {errors.type && <span className="regform__field-error">{errors.type}</span>}
      </div>

      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-owner">
          Owner / Manager Name <span className="pform__required">*</span>
        </label>
        <input
          id="reg-owner"
          className={`pform__input ${errors.ownerName ? "pform__input--error" : ""}`}
          type="text"
          placeholder="e.g. Maria Reyes"
          value={data.ownerName}
          onChange={(e) => onChange("ownerName", e.target.value)}
          maxLength={60}
        />
        {errors.ownerName && <span className="regform__field-error">{errors.ownerName}</span>}
      </div>

      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-contact">
          Contact Number <span className="pform__required">*</span>
        </label>
        <input
          id="reg-contact"
          className={`pform__input ${errors.contactNumber ? "pform__input--error" : ""}`}
          type="tel"
          placeholder="e.g. 0917-123-4567"
          value={data.contactNumber}
          onChange={(e) => onChange("contactNumber", e.target.value)}
          maxLength={20}
        />
        {errors.contactNumber && <span className="regform__field-error">{errors.contactNumber}</span>}
      </div>
    </div>
  );
}

/** Step 2 — GIS location with Nominatim geocoding + draggable pin */
function StepGISLocation({ data, onChange, errors }) {
  const [searchQuery, setSearchQuery] = useState(data.address || "");
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState("");
  const [flyTarget, setFlyTarget] = useState(null);

  const hasCoords = data.lat !== null && data.lng !== null;

  /** Nominatim address → coordinates */
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
        setGeocodeError("Address not found. Try a shorter query or pin manually.");
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
      setGeocodeError("Geocoding failed. Check your connection or pin manually.");
    } finally {
      setGeocoding(false);
    }
  }, [searchQuery, onChange]);

  const handleMapClick = useCallback((lat, lng) => {
    onChange("lat", lat);
    onChange("lng", lng);
  }, [onChange]);

  const handleMarkerDrag = useCallback((e) => {
    const { lat, lng } = e.target.getLatLng();
    onChange("lat", lat);
    onChange("lng", lng);
  }, [onChange]);

  return (
    <div className="regform__step">
      <p className="regform__step-desc">
        Search for your store's address <strong>or</strong> tap the map / drag the pin to set its exact location.
      </p>

      {/* Address search + geocode */}
      <div className="regform__field">
        <label className="regform__label" htmlFor="reg-address">
          Street Address
        </label>
        <div className="regform__geocode-row">
          <input
            id="reg-address"
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

      {/* Leaflet map */}
      <div className="regform__map-wrapper">
        <div className="regform__map-hint">
          {hasCoords
            ? `📍 ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`
            : "Tap on the map or search above to place a pin"}
        </div>

        <MapContainer
          center={
            hasCoords ? [data.lat, data.lng] : CATALUNAN_GRANDE_CENTER
          }
          zoom={DEFAULT_ZOOM}
          style={{ height: "280px", width: "100%", borderRadius: "0 0 12px 12px" }}
          preferCanvas
          zoomControl
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution=""
            subdomains="abcd"
            maxZoom={20}
          />
          <ClickHandler onMapClick={handleMapClick} />
          <FlyController target={flyTarget} />

          {hasCoords && (
            <Marker
              position={[data.lat, data.lng]}
              icon={STORE_PIN_ICON}
              draggable
              eventHandlers={{ dragend: handleMarkerDrag }}
            />
          )}
        </MapContainer>
      </div>

      {/* Manual coordinate display / nudge */}
      {hasCoords && (
        <div className="regform__coord-row">
          <div className="regform__coord-field">
            <label className="regform__label">Latitude</label>
            <input
              className="pform__input"
              type="number"
              step="0.000001"
              value={data.lat}
              onChange={(e) => onChange("lat", parseFloat(e.target.value))}
            />
          </div>
          <div className="regform__coord-field">
            <label className="regform__label">Longitude</label>
            <input
              className="pform__input"
              type="number"
              step="0.000001"
              value={data.lng}
              onChange={(e) => onChange("lng", parseFloat(e.target.value))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 3 — Review summary before final submit */
function StepReview({ data }) {
  const hasCoords = data.lat !== null && data.lng !== null;

  const rows = [
    { label: "Store Name",    value: data.name },
    { label: "Store Type",    value: data.type },
    { label: "Owner / Manager", value: data.ownerName },
    { label: "Contact",       value: data.contactNumber },
    { label: "Address",       value: data.address || "Not provided" },
    { label: "Coordinates",   value: hasCoords ? `${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}` : "Not set" },
  ];

  return (
    <div className="regform__step">
      <p className="regform__step-desc">
        Review your store information before submitting. You can go back to make changes.
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
          <div className="regform__map-hint">📍 Your store pin location</div>
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
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              subdomains="abcd"
              maxZoom={20}
            />
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
};

/**
 * StoreRegistrationForm
 * Shows a 3-step wizard and writes the new store to Supabase on submit,
 * starting in "pending_approval" status per the RLS insert policy.
 *
 * @param {{ user: import("@supabase/supabase-js").User, onComplete: Function }} props
 */
export default function StoreRegistrationForm({ user, onComplete }) {
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

  // ── Per-step validation ──────────────────────────────────────────────────
  const validate = (targetStep) => {
    const errs = {};
    if (targetStep >= 1) {
      if (!data.name.trim())          errs.name         = "Store name is required.";
      if (!data.type)                 errs.type         = "Please select a store type.";
      if (!data.ownerName.trim())     errs.ownerName    = "Owner name is required.";
      if (!data.contactNumber.trim()) errs.contactNumber = "Contact number is required.";
    }
    if (targetStep >= 2) {
      if (data.lat === null || data.lng === null)
        errs.coords = "Please pin your store location on the map.";
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
  const handleSubmit = async () => {
    const errs = validate(2);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

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
      status:         "pending_approval",
    });

    if (insertError) {
      console.error("Store registration failed:", insertError);
      setSubmitError("Registration failed. Please check your connection and try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onComplete?.();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="regform">
      {/* Page header */}
      <div className="regform__header">
        <Store size={28} />
        <div>
          <h1 className="regform__title">Register Your Store</h1>
          <p className="regform__subtitle">Signed in as {user.email}</p>
        </div>
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
              <StepStoreDetails data={data} onChange={onChange} errors={errors} />
            )}
            {step === 2 && (
              <StepGISLocation data={data} onChange={onChange} errors={errors} />
            )}
            {step === 3 && (
              <StepReview data={data} />
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
            <ChevronLeft size={18} /> Back
          </button>
        )}

        {step < 3 && (
          <button type="button" className="regform__nav-next" onClick={goNext}>
            Next <ChevronRight size={18} />
          </button>
        )}

        {step === 3 && (
          <button type="button" className="regform__nav-submit" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                Registering…
              </>
            ) : (
              <>
                <CheckCircle2 size={18} /> Register Store
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
