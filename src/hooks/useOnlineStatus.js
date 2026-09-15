// src/hooks/useOnlineStatus.js
//
// A deliberately small piece of "offline support" — NOT a full offline
// architecture (no request queueing, no service-worker background sync,
// no optimistic writes that replay later). Building that properly is a
// substantial project on its own. What this DOES fix: right now, if a
// merchant's connection drops mid-action, a save just silently fails or
// hangs with a spinner and no explanation — confusing on any app, and
// worse on one aimed at users who may be on inconsistent mobile data.
// This hook powers a small banner (see App.jsx / OwnerDashboard.jsx)
// that at least tells them what's happening and that it isn't their
// fault, rather than leaving them guessing.
//
// Deliberately NOT used to disable buttons or block actions — Supabase
// calls will fail on their own and existing error-handling paths in each
// component already show a message when that happens. This is purely an
// early, ambient heads-up.

import { useState, useEffect } from "react";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}
