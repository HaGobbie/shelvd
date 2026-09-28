// src/components/StoreAvatar.jsx
// A store's logo, or (when it has none / the image fails to load) a coloured
// tile with the store's first letter.
import React, { useState, useEffect } from "react";

const TONES = ["#c85a27", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#1d4ed8", "#4d7c0f"];
const toneFor = (name = "") => TONES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % TONES.length];

export default function StoreAvatar({ name = "", logoUrl, size = 40, radius }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl]);
  const r = radius ?? Math.round(size * 0.28);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="store-avatar store-avatar--img"
        style={{ width: size, height: size, borderRadius: r }}
      />
    );
  }
  return (
    <span
      className="store-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: r, background: toneFor(name), fontSize: Math.round(size * 0.44) }}
    >
      {(name.trim()[0] || "S").toUpperCase()}
    </span>
  );
}
