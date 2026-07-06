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

// ─── Traffic-light constants ──────────────────────────────────────────────────
const STATUS_CONFIG = {
  available: {
    color: "#2ECC71",
    label: "Available",
    ringColor: "rgba(46, 204, 113, 0.3)",
  },
  low: {
    color: "#F1C40F",
    label: "Low Stock",
    ringColor: "rgba(241, 196, 15, 0.3)",
  },
  out: {
    color: "#E74C3C",
    label: "Out of Stock",
    ringColor: "rgba(231, 76, 60, 0.3)",
  },
};

const DIMMED_COLOR = "#9B9B9B";
const DIMMED_RING = "rgba(155, 155, 155, 0.2)";

// Default pin appearance when no search is active — just "here's a
// store", not a status judgment. Matches the app's brand color so it
// reads as neutral/informational rather than a 4th traffic-light state.
const NEUTRAL_COLOR = "#2C3E50";
const NEUTRAL_RING = "rgba(44, 62, 80, 0.25)";
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
        <circle cx="12" cy="12" r="10" fill="${color}" />
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
        label: "No match",
        ringColor: DIMMED_RING,
        showStatusLabel: true,
      };
    }
    // Search active and this store matched — show the real status.
    const cfg = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.available;
    return { ...cfg, showStatusLabel: true };
  }, [displayStatus, isDimmed, searchActive]);

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
              {matchCount} matching product{matchCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </Tooltip>
    </Marker>
  );
}
