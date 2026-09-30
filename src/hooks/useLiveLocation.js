// src/hooks/useLiveLocation.js
// Continuous location tracking for the route planner — separate from the
// one-shot useGeolocation.js used by the map's "locate me" button, since
// those two have genuinely different needs (a single fix vs. an ongoing
// walking companion).
//
// Also tracks which way the person is facing, for the arrow marker on the
// map:
//   • While actually moving, GPS itself reports a heading (coords.heading) —
//     this is normally the more accurate source, so it always wins when
//     available.
//   • While standing still, GPS heading is null, so this falls back to the
//     device's compass (deviceorientation/deviceorientationabsolute). iOS
//     only allows reading that after an explicit user tap (Safari's motion-
//     sensor permission prompt), which is what requestCompass() is for —
//     canUseCompass tells the UI whether that button needs to be shown at
//     all (there's nothing to ask permission for on Android/desktop).

import { useState, useEffect, useRef, useCallback } from "react";

const MOVEMENT_MAX_AGE_MS = 8000;

function readCompassHeading(event) {
  // iOS Safari: a ready-to-use compass heading, no rotation math needed.
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading;
  }
  // Android/Chrome "absolute" orientation: alpha is degrees counter-clockwise
  // from north, so it has to be inverted to get a clockwise compass heading.
  if (event.absolute && typeof event.alpha === "number") {
    return (360 - event.alpha) % 360;
  }
  return null;
}

export function useLiveLocation({ enabled = true } = {}) {
  const [position, setPosition] = useState(null); // [lat, lng]
  const [accuracy, setAccuracy] = useState(null);
  const [gpsHeading, setGpsHeading] = useState(null);
  const [compassHeading, setCompassHeading] = useState(null);
  const [status, setStatus] = useState("idle"); // idle|loading|granted|denied|unsupported
  const watchIdRef = useRef(null);
  const lastMovementAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!("geolocation" in navigator)) { setStatus("unsupported"); return undefined; }

    setStatus("loading");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setAccuracy(pos.coords.accuracy ?? null);
        if (typeof pos.coords.heading === "number" && !Number.isNaN(pos.coords.heading)) {
          setGpsHeading(pos.coords.heading);
          lastMovementAtRef.current = Date.now();
        } else if (Date.now() - lastMovementAtRef.current > MOVEMENT_MAX_AGE_MS) {
          setGpsHeading(null); // stopped moving — let the compass take over
        }
        setStatus("granted");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onOrientation = (e) => {
      const heading = readCompassHeading(e);
      if (heading !== null) setCompassHeading(heading);
    };
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
    };
  }, [enabled]);

  const compassNeedsPermission = typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
  const requestCompass = useCallback(async () => {
    if (!compassNeedsPermission) return true;
    try { return (await DeviceOrientationEvent.requestPermission()) === "granted"; }
    catch { return false; }
  }, [compassNeedsPermission]);

  return {
    position, accuracy, status,
    heading: gpsHeading ?? compassHeading, // moving GPS heading wins; compass fills in while stationary
    compassNeedsPermission,
    requestCompass,
  };
}
