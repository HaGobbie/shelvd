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

import React, { useState, useEffect, useCallback } from "react";
import { Store } from "lucide-react";

import MapContainer from "./components/MapContainer";
import SearchBar from "./components/SearchBar";
import StoreDetails from "./components/StoreDetails";
import OwnerDashboard from "./pages/OwnerDashboard";
import { useMapMarkers, useStoreDetails, useDebouncedSearchMatches } from "./hooks/useStores";
import { supabase } from "./config/supabaseClient";

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

export default function App() {
  const [route, setRoute] = useHashRoute();

  // ─── Global Supabase auth session ────────────────────────────────────────
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  /**
   * If a session just came in AND the URL hash still holds the raw OAuth
   * redirect payload (`#access_token=...`), rewrite the hash to a clean
   * "#/dashboard" so the user lands somewhere meaningful instead of our
   * router silently failing to match the token string and falling back
   * to the public map.
   *
   * We update BOTH window.location.hash (so the address bar is clean and
   * back/forward navigation behaves sanely) AND call setRoute directly
   * (so React's route state updates in the SAME render pass, rather than
   * waiting for the native `hashchange` event to fire on its own — that
   * event is dispatched as a separate task, which would otherwise cause
   * one render where the token is already stripped from the hash but our
   * route state hasn't caught up yet, flashing the public map first).
   */
  const redirectFromOAuthHashIfNeeded = useCallback(
    (currentSession) => {
      if (currentSession && window.location.hash.includes("access_token")) {
        window.location.hash = "/dashboard";
        setRoute("#/dashboard");
      }
    },
    [setRoute]
  );

  useEffect(() => {
    let isMounted = true;

    // Resolve whatever session already exists (page load, refresh, or the
    // tail end of an OAuth redirect that Supabase-js has already parsed
    // out of the URL by the time this promise resolves).
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!isMounted) return;
      setSession(initialSession);
      setAuthLoading(false);
      redirectFromOAuthHashIfNeeded(initialSession);
    });

    // Reactively track logins, logouts, and token refreshes for the rest
    // of the app's lifetime.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthLoading(false);
      redirectFromOAuthHashIfNeeded(newSession);
    });

    return () => {
      isMounted = false;
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

  // ─── Guard: still resolving auth, or hash still holds a raw OAuth token ──
  // Covers the brief window before redirectFromOAuthHashIfNeeded has run
  // (e.g. auth is still loading on first paint) so we never flash the
  // public map or a broken route mid-redirect.
  const hashHasPendingOAuthToken = window.location.hash.includes("access_token");

  if (authLoading || hashHasPendingOAuthToken) {
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
      <div className="app-container">
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

      {/* Floating search bar — sits above the map */}
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
    </div>
  );
}
