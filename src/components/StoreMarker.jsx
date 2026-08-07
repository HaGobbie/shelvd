// src/components/StoreMarker.jsx
// Renders a single map pin whose color strictly follows the traffic-light
// palette: Green (#2ECC71), Yellow/Amber (#F1C40F), Red (#E74C3C) — but
// ONLY while a search is active. With no search, pins are neutral (a
// single brand color) — see MapContainer.jsx's ARCHITECTURE NOTE for why.
// Dimmed (gray) when a search is active but the store has no matching product.
// Uses react-leaflet's Marker + custom DivIcon for full color control.

import React, { useMemo } from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import { useLanguage } from "../i18n/LanguageContext";

// ─── Traffic-light constants ──────────────────────────────────────────────────
// Colors reference CSS custom properties rather than literal hex, so a
// palette change (like the Shelvd rebrand) only needs to touch :root in
// App.css — not every component that draws a status-colored pin.
// Ring colors stay as literal rgba() since Leaflet's DivIcon renders raw
// HTML/SVG outside the normal component tree; a plain rgba() with the
// matching alpha is simpler and more reliable here than trying to derive
// a translucent version of a CSS variable at runtime.
const STATUS_CONFIG = {
  available: {
    color: "var(--color-available)",
    ringColor: "rgba(22, 163, 74, 0.3)",
  },
  low: {
    color: "var(--color-low)",
    ringColor: "rgba(217, 119, 6, 0.3)",
  },
  out: {
    color: "var(--color-out)",
    ringColor: "rgba(220, 38, 38, 0.3)",
  },
};

const DIMMED_COLOR = "#9B9B9B";
const DIMMED_RING = "rgba(155, 155, 155, 0.2)";

// Default pin appearance when no search is active — just "here's a
// store", not a status judgment. References the brand accent so it
// stays in sync with whatever the current palette's accent color is.
const NEUTRAL_COLOR = "var(--color-brand-primary)";
const NEUTRAL_RING = "rgba(200, 90, 39, 0.25)";
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a Leaflet DivIcon from inline SVG so we can set arbitrary colors.
 * The icon is a circle with a subtle pulse ring when selected.
 *
 * @param {string}  color       — hex fill color
 * @param {string}  ringColor   — rgba ring color
 * @param {boolean} isSelected  — enlarges the pin and adds a pulse ring
 * @param {boolean} isDimmed    — 50% opacity
 * @returns {L.DivIcon}
 */
function buildDivIcon(color, ringColor, isSelected, isDimmed) {
  const size = isSelected ? 26 : 20;
  const ringSize = size + 12;
  const opacity = isDimmed ? 0.45 : 1;

  const svg = `
    <div style="position:relative; width:${ringSize}px; height:${ringSize}px; opacity:${opacity};">
      ${
        isSelected
          ? `<div style="
              position:absolute;
              top:0; left:0;
              width:${ringSize}px; height:${ringSize}px;
              border-radius:50%;
              background:${ringColor};
              animation: pinPulse 1.4s ease-out infinite;
            "></div>`
          : ""
      }
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${size}"
        height="${size}"
        viewBox="0 0 24 24"
        style="position:absolute; top:${(ringSize - size) / 2}px; left:${(ringSize - size) / 2}px;"
      >
        <circle cx="12" cy="12" r="10" style="fill:${color}" />
        <circle cx="12" cy="12" r="6"  fill="white" fill-opacity="0.35" />
        <circle cx="12" cy="12" r="3"  fill="white" />
      </svg>
    </div>
  `;

  return L.divIcon({
    html: svg,
    className: "", // remove leaflet's default white box
    iconSize: [ringSize, ringSize],
    iconAnchor: [ringSize / 2, ringSize / 2],
    tooltipAnchor: [ringSize / 2, -(ringSize / 2)],
  });
}

/**
 * @typedef {Object} StoreMarkerProps
 * @property {import("../hooks/useStores").Store}       store
 * @property {"available"|"low"|"out"|null} displayStatus
 * @property {boolean} isHighlighted   — false → pin is dimmed (only meaningful during search)
 * @property {boolean} isSelected
 * @property {boolean} searchActive
 * @property {number}  matchCount
 * @property {Function} onClick
 */

/**
 * StoreMarker — a color-coded, clickable Leaflet pin for a single store.
 *
 * @param {StoreMarkerProps} props
 */
export default function StoreMarker({
  store,
  displayStatus,
  isHighlighted,
  isSelected,
  searchActive,
  matchCount,
  onClick,
}) {
  const { t } = useLanguage();
  const isDimmed = searchActive && !isHighlighted;

  const { color, label, ringColor, showStatusLabel } = useMemo(() => {
    // No search active at all → neutral pin, no status label. This is
    // the default resting state for every pin on the map.
    if (!searchActive) {
      return {
        color: NEUTRAL_COLOR,
        label: null,
        ringColor: NEUTRAL_RING,
        showStatusLabel: false,
      };
    }
    // Search active, but this store had no matching product.
    if (isDimmed) {
      return {
        color: DIMMED_COLOR,
        label: t("map.noMatch"),
        ringColor: DIMMED_RING,
        showStatusLabel: true,
      };
    }
    // Search active and this store matched — show the real status.
    const cfg = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.available;
    return { ...cfg, label: t(`status.${displayStatus ?? "available"}`), showStatusLabel: true };
  }, [displayStatus, isDimmed, searchActive, t]);

  const icon = useMemo(
    () => buildDivIcon(color, ringColor, isSelected, isDimmed),
    [color, ringColor, isSelected, isDimmed]
  );

  return (
    <Marker
      position={store.coords}
      icon={icon}
      eventHandlers={{ click: onClick }}
      zIndexOffset={isSelected ? 1000 : isDimmed ? -100 : 0}
    >
      <Tooltip
        direction="top"
        offset={[0, -8]}
        opacity={0.95}
        permanent={false}
      >
        <div className="marker-tooltip">
          <strong className="marker-tooltip__name">{store.name}</strong>
          {showStatusLabel && (
            <span
              className="marker-tooltip__badge"
              style={{ color, borderColor: color }}
            >
              {label}
            </span>
          )}
          {searchActive && isHighlighted && (
            <span className="marker-tooltip__count">
              {t("map.matchCount", matchCount)}
            </span>
          )}
        </div>
      </Tooltip>
    </Marker>
  );
}
