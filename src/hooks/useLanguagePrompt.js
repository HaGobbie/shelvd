// src/hooks/useLanguagePrompt.js
// A single, app-wide controller for the first-launch "English or Tagalog?"
// prompt (LanguageChooserModal). This used to be two separate instances —
// one in App.jsx for map visitors, one in OwnerDashboard.jsx for owners,
// each with its own timer — and they could both end up open at once (the
// owner's onboarding tour rendering on top of the map's still-mounted
// language modal) depending on navigation timing. One controller, mounted
// once at the very top of the app (see App.jsx), removes the race by
// construction: there is only ever one instance to show.
//
// Sequencing:
//   • On the public map: shown shortly after the page loads.
//   • In the owner dashboard, for a first-time owner: waits for the
//     onboarding tour to close (see notifyTourClosed(), called from
//     OwnerDashboard's <OnboardingTour onClose>) before showing, so the two
//     full-screen prompts never overlap.
//   • In the owner dashboard, for a returning owner who has already seen the
//     tour but somehow never got this prompt: shown shortly after landing.
//   • Never shown at all once answered once, anywhere in the app.

import { useState, useEffect, useCallback } from "react";
import { hasSeenLanguagePrompt } from "../components/LanguageChooserModal";
import { hasSeenTour } from "../components/OnboardingTour";
import { OWNER_TOUR_STORAGE_KEY } from "../tours/ownerTourSteps";

const TOUR_CLOSED_EVENT = "shelvd:tour-closed";
const MAP_DELAY_MS = 900;
const RETURNING_OWNER_DELAY_MS = 500;

/** Call this when the onboarding tour closes (skip, X, or finishing it). */
export function notifyTourClosed() {
  window.dispatchEvent(new CustomEvent(TOUR_CLOSED_EVENT));
}

function isDashboardish(hash) {
  return hash === "#/dashboard" || hash === "#/admin";
}

export function useLanguagePrompt() {
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState(() => window.location.hash || "#/");

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (open || hasSeenLanguagePrompt()) return undefined;

    if (isDashboardish(hash)) {
      // A first-time owner is about to see the onboarding tour — wait for
      // the tour-closed event below instead of racing it.
      if (!hasSeenTour(OWNER_TOUR_STORAGE_KEY)) return undefined;
      const id = setTimeout(() => setOpen(true), RETURNING_OWNER_DELAY_MS);
      return () => clearTimeout(id);
    }

    const id = setTimeout(() => setOpen(true), MAP_DELAY_MS);
    return () => clearTimeout(id);
  }, [hash, open]);

  useEffect(() => {
    const onTourClosed = () => { if (!hasSeenLanguagePrompt()) setOpen(true); };
    window.addEventListener(TOUR_CLOSED_EVENT, onTourClosed);
    return () => window.removeEventListener(TOUR_CLOSED_EVENT, onTourClosed);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  return { open, close };
}
