// src/App.jsx
// Root component — wires the Map view and Owner Dashboard together.
// A simple hash-based router distinguishes the two views:
//   #/  (or default) → Public Map view with SearchBar + StoreDetails
//   #/dashboard       → Owner Dashboard (login-gated)
//
// AUTH NOTE: Supabase auth session state is lifted to the TOP of this file
// (rather than living only inside OwnerDashboard) for two reasons:
//   1. When Google Sign-In redirects back here, the URL arrives as
//      "...#access_token=...&refresh_token=...&..." instead of one of our
//      own routes. Our hash router needs to recognize and neutralize that
//      BEFORE it tries (and fails) to match it as a route.
//   2. OwnerDashboard can receive `session` as a prop and render instantly,
//      instead of running its own separate getSession() round trip.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Store, Languages, Sun, Moon } from "lucide-react";

import MapContainer from "./components/MapContainer";
import SearchBar from "./components/SearchBar";
import StoreDetails from "./components/StoreDetails";
import OwnerDashboard from "./pages/OwnerDashboard";
import { useMapMarkers, useStoreDetails, useDebouncedSearchMatches } from "./hooks/useStores";
import { supabase } from "./config/supabaseClient";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext";
import { ThemeProvider, useTheme } from "./theme/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import OnboardingTour, { hasSeenTour } from "./components/OnboardingTour";
import { MAP_TOUR_STEPS, MAP_TOUR_STORAGE_KEY } from "./tours/mapTourSteps";

import "./styles/App.css";

// ─── OAuth hash sanitizer ─────────────────────────────────────────────────
// Runs ONCE, at module load — before the App component ever renders, and
// before any async continuation of Supabase-js's own internal hash
// detection can run (that happens via a promise, so it's deferred to a
// microtask tick; this synchronous code always beats it).
//
// Why this is needed: Supabase's OAuth redirect appends "access_token=..."
// to whatever `redirectTo` URL you gave it. If that URL already contained
// its own hash (e.g. "...#/dashboard"), the browser doesn't create a
// second fragment — a URL only has ONE "#" delimiter — so you end up with
// a single, literal hash string: "#/dashboard#access_token=...". Supabase-js
// expects the hash to start immediately with "access_token=...", so it
// never recognizes this malformed one and the session never resolves,
// leaving the app stuck on a loading/verifying screen forever.
//
// This strips anything before the real token payload so Supabase-js can
// parse it correctly, regardless of what prefix ended up in front of it.
if (
  window.location.hash.includes("access_token") &&
  !window.location.hash.startsWith("#access_token")
) {
  const tokenIndex = window.location.hash.indexOf("access_token");
  window.location.hash = "#" + window.location.hash.substring(tokenIndex);
}

// Captured ONCE, at module load — before Supabase-js's client gets a
// chance to process (and likely clear/rewrite) the hash itself. This is
// the fix for a real bug: the redirect-to-dashboard logic used to
// re-check `window.location.hash` LIVE, at the moment a session
// resolved. But Supabase-js's own OAuth handling clears the hash as part
// of consuming it — so by the time our session callback fired, the hash
// was often already empty, meaning the "was this an OAuth redirect"
// check silently came back false even though it genuinely was one. That
// produced exactly the reported symptom: sign-in appears to hang, an
// error eventually shows, then landing on the public map instead of the
// dashboard, requiring a second manual tap on the Store FAB even though
// the session was actually already valid. Capturing this flag up front,
// before anything has a chance to touch the hash, removes the race
// entirely — the redirect decision no longer depends on the hash still
// being intact later.
const HAD_OAUTH_HASH_ON_LOAD = window.location.hash.includes("access_token");

/**
 * Tiny hash-router — no external routing library needed for Phase A.
 * Returns [route, setRoute] rather than just `route`: the setter lets a
 * caller force the route to change immediately, without waiting on the
 * native `hashchange` event (which fires as a separate, slightly-delayed
 * task) — see the OAuth redirect handling below for why that matters.
 */
function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const handler = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return [route, setRoute];
}

// ─────────────────────────────────────────────────────────────────────────────

function AppShell() {
  const [route, setRoute] = useHashRoute();
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  // ─── Global Supabase auth session ────────────────────────────────────────
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Set only if we detect a token in the hash but never manage to resolve
  // a session from it within a reasonable time — the actual gap this
  // whole block exists to close (see comment below).
  const [oauthStuckError, setOauthStuckError] = useState(null);
  // Tracks whether we've ALREADY forced the #/dashboard redirect once for
  // this OAuth flow — without this, a second onAuthStateChange event
  // (e.g. a token refresh shortly after login) could theoretically
  // re-trigger navigation logic. Using a ref rather than state since this
  // doesn't need to cause a re-render.
  const oauthHandledRef = useRef(false);

  /**
   * If a session just came in AND this page load genuinely started as an
   * OAuth redirect (per the ref captured at module load, NOT a live
   * re-check of the current hash — see HAD_OAUTH_HASH_ON_LOAD above),
   * rewrite the hash to a clean "#/dashboard" so the user lands somewhere
   * meaningful instead of our router silently failing to match the token
   * string and falling back to the public map.
   *
   * We update BOTH window.location.hash (so the address bar is clean and
   * back/forward navigation behaves sanely) AND call setRoute directly
   * (so React's route state updates in the SAME render pass, rather than
   * waiting for the native `hashchange` event to fire on its own).
   */
  const redirectFromOAuthHashIfNeeded = useCallback(
    (currentSession) => {
      if (currentSession && HAD_OAUTH_HASH_ON_LOAD && !oauthHandledRef.current) {
        oauthHandledRef.current = true;
        window.location.hash = "/dashboard";
        setRoute("#/dashboard");
        setOauthStuckError(null);
      }
    },
    [setRoute]
  );

  useEffect(() => {
    let isMounted = true;

    // Safety valve: if the hash contained a token on load but we never
    // end up with a session from it (Supabase rejected the redirect, a
    // network hiccup, a misconfigured Redirect URL allowlist, etc.), the
    // loading guard below would otherwise spin forever with zero
    // visibility into why. This gives it a hard ceiling and turns
    // silence into a visible, actionable error instead. 10s rather than
    // the original 8s — a bit more headroom for slower connections, now
    // that the actual race-condition bug above is fixed and this timer
    // is back to being a genuine last-resort safety net rather than
    // something firing on ordinary successful logins.
    const stuckTimer = HAD_OAUTH_HASH_ON_LOAD
      ? window.setTimeout(() => {
          if (isMounted && !oauthHandledRef.current) {
            setOauthStuckError(
              "Sign-in is taking longer than expected. This can happen if the " +
                "redirect URL isn't in Supabase's allowed Redirect URLs list."
            );
          }
        }, 10000)
      : null;

    // Resolve whatever session already exists (page load, refresh, or the
    // tail end of an OAuth redirect that Supabase-js has already parsed
    // out of the URL by the time this promise resolves).
    supabase.auth.getSession().then(({ data: { session: initialSession }, error }) => {
      if (!isMounted) return;
      if (error) {
        console.error("supabase.auth.getSession() error:", error);
      }
      setSession(initialSession);
      setAuthLoading(false);
      redirectFromOAuthHashIfNeeded(initialSession);
    });

    // Reactively track logins, logouts, and token refreshes for the rest
    // of the app's lifetime.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.log("[auth]", event, newSession ? `session for ${newSession.user?.email}` : "no session");
      setSession(newSession);
      setAuthLoading(false);
      redirectFromOAuthHashIfNeeded(newSession);
    });

    return () => {
      isMounted = false;
      if (stuckTimer) window.clearTimeout(stuckTimer);
      subscription.unsubscribe();
    };
  }, [redirectFromOAuthHashIfNeeded]);

  // ─── Map / search state (unchanged) ──────────────────────────────────────
  const { markers, loading, error: markersError } = useMapMarkers();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState(null);

  const { store: selectedStore } = useStoreDetails(selectedStoreId);
  const { matches: searchMatches } = useDebouncedSearchMatches(searchQuery);

  const handleStoreSelect = useCallback((storeId) => {
    setSelectedStoreId(storeId);
  }, []);

  const handleSheetClose = useCallback(() => {
    setSelectedStoreId(null);
  }, []);

  const handleSearchChange = useCallback((query) => {
    setSearchQuery(query);
    if (query.trim()) setSelectedStoreId(null);
  }, []);

  const resultCount = searchQuery.trim() ? searchMatches.size : 0;

  // ─── Public map onboarding tour ─────────────────────────────────────────
  // Auto-shows once per browser, the first time the map has actually
  // loaded (not while the loading spinner is still up, and not for
  // anyone mid-OAuth-redirect — this only runs on the public map route,
  // which those states already gate above). Separate localStorage key
  // and step content from the Owner Dashboard's tour — see
  // src/tours/mapTourSteps.js.
  const [mapTourOpen, setMapTourOpen] = useState(false);

  useEffect(() => {
    if (!loading && route !== "#/dashboard" && !hasSeenTour(MAP_TOUR_STORAGE_KEY)) {
      setMapTourOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, route]);

  // Reuses the SAME button-label keys as the Owner Dashboard's tour
  // (owner.onboarding.skip/next/back/done/stepCounter) — "Skip", "Next",
  // "Back", "Got it!" are genuinely generic UI words with no
  // owner-specific meaning, so this avoids duplicating four near-
  // identical translation strings under a second namespace. Only the
  // actual step titles/bodies differ (map.onboarding.* vs
  // owner.onboarding.*), since those really are different content.
  const mapTourLabels = {
    skip: t("owner.onboarding.skip"),
    next: t("owner.onboarding.next"),
    back: t("owner.onboarding.back"),
    done: t("owner.onboarding.done"),
    stepCounter: (current, total) => t("owner.onboarding.stepCounter", current, total),
  };

  // ─── Guard: still resolving auth, or this load started as an OAuth
  // redirect we haven't finished handling yet ───────────────────────────────
  // Uses the captured HAD_OAUTH_HASH_ON_LOAD flag (not a live hash
  // re-check) for the same race-condition reason as the redirect logic
  // above — the hash may already be gone by now even though this load
  // genuinely started as an OAuth callback.
  if (oauthStuckError) {
    return (
      <div
        className="app-container"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
          padding: 24,
          textAlign: "center",
          gap: 12,
        }}
      >
        <p style={{ maxWidth: 360, color: "var(--color-text-secondary, #555)" }}>
          {oauthStuckError}
        </p>
        <a
          href={window.location.origin + window.location.pathname}
          style={{
            background: "var(--color-brand-primary)",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: "var(--radius-pill, 999px)",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Start Over
        </a>
      </div>
    );
  }

  if (authLoading || (HAD_OAUTH_HASH_ON_LOAD && !oauthHandledRef.current)) {
    return (
      <div
        className="app-container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
        }}
      >
        <div className="map-loading-spinner" />
      </div>
    );
  }

  // ─── Owner Dashboard route ──────────────────────────────────────────────
  if (route === "#/dashboard") {
    return (
      // NOTE: .app-container is shared with the full-bleed map view, which
      // needs a fixed, non-scrolling viewport (so Leaflet has a stable box
      // to measure). The dashboard/registration flow needs the opposite —
      // a normal, scrollable page. Rather than touching the shared class
      // (which the map still depends on), we override it here with inline
      // styles so this route gets natural document flow and scrolling
      // regardless of what .app-container's own rules are.
      <div
        className="app-container"
        style={{
          position: "static",
          height: "auto",
          minHeight: "100dvh",
          overflow: "visible",
        }}
      >
        <OwnerDashboard session={session} />
        {/* Nav back to map */}
        <a
          href="#/"
          style={{
            position: "fixed",
            bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
            right: 20,
            zIndex: 9999,
            background: "var(--color-brand-primary)",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: "var(--radius-pill)",
            fontSize: 13,
            fontWeight: 700,
            boxShadow: "var(--shadow-lg)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none",
          }}
        >
          ← Back to Map
        </a>
      </div>
    );
  }

  // ─── Public Map view (default) ──────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Full-bleed map */}
      <MapContainer
        markers={markers}
        loading={loading}
        error={markersError}
        searchQuery={searchQuery}
        searchMatches={searchMatches}
        onStoreSelect={handleStoreSelect}
        selectedStoreId={selectedStoreId}
      />

      {/* Floating search bar — sits above the map. NOTE: no data-tour-id
          wrapper here anymore — SearchBar.jsx positions itself via
          absolute/fixed CSS internally, which escapes a plain wrapping
          div's normal-flow box entirely (an absolutely-positioned child
          contributes nothing to its non-positioned parent's size), so a
          wrapper here would report a bounding box that has nothing to do
          with where the search bar actually renders — exactly what
          caused the tour's "search" step to highlight the wrong area.
          That step now uses a centered card instead (see
          mapTourSteps.js) until SearchBar.jsx itself can carry the
          attribute on its real positioned root element. */}
      <SearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        resultCount={resultCount}
        loading={loading}
      />

      {/* Bottom sheet — slides up when a pin is tapped */}
      <StoreDetails
        store={selectedStore}
        searchQuery={searchQuery}
        onClose={handleSheetClose}
      />

      {/* Owner Dashboard shortcut FAB */}
      <a
        href="#/dashboard"
        data-tour-id="map-store-fab"
        aria-label="Open Store Owner Dashboard"
        style={{
          position: "fixed",
          bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
          right: 20,
          zIndex: 800,
          background: "var(--color-brand-primary)",
          color: "#fff",
          width: 52,
          height: 52,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--shadow-lg)",
          textDecoration: "none",
          transition: "transform 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <Store size={22} />
      </a>

      {/* Language + theme toggles — a single horizontal row, top-left,
          ABOVE the search bar (which now starts lower — see
          --searchbar-top in App.css). These two used to be stacked
          vertically at the same left edge the search bar itself starts
          from, which visually overlapped the search bar's input text on
          narrow phones — there was nowhere for a second stacked row to
          go without colliding with search bar. Side-by-side, both fit
          within the space now reserved above the search bar instead. */}
      <div
        style={{
          position: "fixed",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          left: 16,
          zIndex: 800,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setLanguage(language === "en" ? "tl" : "en")}
          aria-label={t("common.language")}
          title={t("common.language")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 40,
            padding: "0 14px",
            borderRadius: "var(--radius-pill, 999px)",
            background: "var(--color-surface)",
            color: "var(--color-text-primary)",
            border: "none",
            boxShadow: "var(--shadow-md)",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <Languages size={16} strokeWidth={2.2} />
          {language === "en" ? "TL" : "EN"}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--color-surface)",
            color: "var(--color-text-primary)",
            border: "none",
            boxShadow: "var(--shadow-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {theme === "dark" ? <Sun size={16} strokeWidth={2.2} /> : <Moon size={16} strokeWidth={2.2} />}
        </button>
      </div>

      <OnboardingTour
        isOpen={mapTourOpen}
        onClose={() => setMapTourOpen(false)}
        steps={MAP_TOUR_STEPS}
        storageKey={MAP_TOUR_STORAGE_KEY}
        labels={mapTourLabels}
      />
    </div>
  );
}

/**
 * App
 * ErrorBoundary sits OUTSIDE both providers deliberately — it catches
 * errors even if ThemeProvider or LanguageProvider themselves throw
 * during initialization, not just errors from AppShell's own content.
 * That's also why ErrorBoundary's fallback UI can't use useLanguage()
 * (it might be rendering precisely because that provider crashed) — it
 * reads the persisted language choice directly instead.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <AppShell />
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
