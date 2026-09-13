// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// IMPORTANT: replace "gis-community-platform" below with your ACTUAL
// GitHub repo name. GitHub Pages serves project sites from
// https://<username>.github.io/<repo-name>/ — every asset path (JS, CSS,
// manifest icons, the service worker) has to be prefixed with that
// sub-path, or you'll get a blank white page / 404s in production.
//
// If you're deploying to a USER/ORG page (repo named
// <username>.github.io) instead of a project page, set base to "/".
const REPO_NAME = "shelvd";

export default defineConfig({
  base: `/${REPO_NAME}/`,

  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Shelvd",
        short_name: "Shelvd",
        description:
          "Find essential products at nearby stores in your barangay — real-time stock visibility.",
        // Matches --color-stone-dark / --color-stone-darker from
        // src/styles/App.css — these were still the OLD pre-rebrand
        // navy (#2c3e50 / #1a252f) until now. This is what an INSTALLED
        // PWA actually reads for its status bar and splash-screen
        // background — it's baked into the generated manifest.webmanifest
        // at BUILD time, not read live from index.html's own <meta
        // name="theme-color"> tag (that tag only affects an open browser
        // tab; ThemeContext.jsx already keeps that one in sync with the
        // live light/dark toggle — see src/theme/ThemeContext.jsx).
        // Existing installed users pick this up automatically once this
        // rebuilds and redeploys, thanks to registerType: "autoUpdate" below.
        theme_color: "#292524",
        background_color: "#1c1917",
        display: "standalone",
        orientation: "portrait-primary",
        // GitHub Pages serves from a sub-path, so start_url/scope must
        // match it or the installed PWA will open to a 404.
        start_url: `/${REPO_NAME}/`,
        scope: `/${REPO_NAME}/`,
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            // Matches BOTH light_all and dark_all — dark mode was added
            // after this rule was originally written for light_all only,
            // so dark-theme users were getting no caching benefit for
            // their map tiles at all until this was broadened.
            urlPattern:
              /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/(light_all|dark_all)\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: {},
  },

  server: {
    port: 5173,
    open: true,
  },

  build: {
    outDir: "dist",
  },
});
