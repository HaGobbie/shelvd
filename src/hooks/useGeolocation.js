// src/hooks/useGeolocation.js
// Requests the browser's geolocation on mount (per product decision —
// prioritizing "just works on open" over deferring the permission
// prompt), and exposes a `requestLocation()` re-trigger for a "locate
// me" crosshair control, covering the case where the resident initially
// denied the prompt but wants to share their location later.

import { useState, useCallback, useEffect, useRef } from "react";

/**
 * @returns {{
 *   position: [number, number]|null,
 *   status: "idle"|"loading"|"granted"|"denied"|"unsupported",
 *   error: string|null,
 *   requestLocation: Function
 * }}
 */
export function useGeolocation() {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const hasRequestedOnMount = useRef(false);

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus("loading");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setStatus("granted");
      },
      (err) => {
        // Covers both an explicit permission denial and a genuine
        // failure (timeout, position unavailable) — both land the user
        // in the same "location unavailable, try the crosshair button
        // again" state, since the recovery action is identical either way.
        setError(err.message || "Location unavailable");
        setStatus("denied");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Request once on mount, per the product decision to prompt
  // automatically rather than waiting for an explicit tap.
  useEffect(() => {
    if (!hasRequestedOnMount.current) {
      hasRequestedOnMount.current = true;
      requestLocation();
    }
  }, [requestLocation]);

  return { position, status, error, requestLocation };
}
