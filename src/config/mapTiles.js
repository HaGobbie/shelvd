// src/config/mapTiles.js
// Single source of truth for CARTO tile URLs, used by every Leaflet map
// in the app (MapContainer, StoreEditModal, StoreRegistrationForm) —
// previously each file had its own copy of this URL string, which meant
// the API key and dark-mode switch would otherwise need updating in
// three places instead of one.
//
// CARTO now requires an API key on every tile request. Read from an
// environment variable, NOT hardcoded — Vite inlines VITE_-prefixed env
// vars at BUILD time, so:
//   - Local dev: add VITE_CARTO_API_KEY=your_key to a .env file (gitignored).
//   - Deployed build (GitHub Actions): add VITE_CARTO_API_KEY as a
//     repository secret, and reference it in the workflow's build step
//     env block (see .github/workflows/deploy.yml) — the key must be
//     present during `npm run build`, not just at runtime, since Vite
//     bakes it into the compiled bundle.

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY;

if (!CARTO_API_KEY && import.meta.env.DEV) {
  console.warn(
    "[mapTiles] VITE_CARTO_API_KEY is not set — CARTO tiles will fail to " +
      "load (CARTO now requires a key on every request). Add it to a " +
      "local .env file for dev, and as a GitHub Actions secret for the " +
      "deployed build."
  );
}

const keyParam = CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : "";

const TILE_URLS = {
  light: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${keyParam}`,
  dark: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png${keyParam}`,
};

/** Full attribution string — used by the main community map. */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * getTileUrl
 * @param {"light"|"dark"} theme
 * @returns {string} the CARTO tile URL template for react-leaflet's <TileLayer url={...} />
 */
export function getTileUrl(theme) {
  return theme === "dark" ? TILE_URLS.dark : TILE_URLS.light;
}
