// src/components/BrandLogo.jsx
// The Shelvd logo, loaded from public/favicon.svg (a single-colour orange
// glyph on a transparent background). import.meta.env.BASE_URL keeps the path
// correct under GitHub Pages' /<repo>/ sub-path.
import React from "react";

export default function BrandLogo({ size = 32, className = "", style }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}favicon.svg`}
      alt="Shelvd"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", objectFit: "contain", ...style }}
      draggable={false}
    />
  );
}

/** Logo on a rounded tile — for headers/sidebars where the glyph needs a background. */
export function BrandTile({ size = 38, tone = "light" }) {
  return (
    <span
      className={`brand-tile brand-tile--${tone}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <BrandLogo size={Math.round(size * 0.66)} />
    </span>
  );
}
