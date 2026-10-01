// src/hooks/useLanguagePrompt.js
// A single, app-wide controller for the first-launch "English or Tagalog?"
// prompt (LanguageChooserModal), mounted once at the very top of the app
// (see App.jsx) so there's only ever one instance — no risk of it and some
// other full-screen prompt both ending up open at once.
//
// Priority: this ALWAYS shows first, before anything else that might also
// want the screen on a first visit. The owner dashboard's onboarding tour
// specifically waits for this to close (see onLanguagePromptClosed(), used
// in OwnerDashboard.jsx) rather than racing it — on the public map there's
// nothing else competing for the screen, so showing it is already enough.
//
// Earlier version of this file had the sequencing backwards (tour first,
// language prompt waiting on the tour's close event) using a
// "shelvd:tour-closed" event. That's been inverted: this prompt no longer
// waits on anything, and it's the tour that now waits on THIS one.

import { useState, useEffect, useCallback } from "react";
import { hasSeenLanguagePrompt } from "../components/LanguageChooserModal";

const CLOSED_EVENT = "shelvd:language-prompt-closed";
const SHOW_DELAY_MS = 500; // just enough to avoid a flash on first paint

/** Call this (or just use the hook below) wherever something needs to wait
 *  for the language prompt to be answered before showing its own first-run
 *  UI — e.g. OwnerDashboard's onboarding tour. Fires immediately if the
 *  prompt has already been answered in an earlier session. */
export function onLanguagePromptClosed(fn) {
  if (hasSeenLanguagePrompt()) { fn(); return () => {}; }
  window.addEventListener(CLOSED_EVENT, fn);
  return () => window.removeEventListener(CLOSED_EVENT, fn);
}

export function useLanguagePrompt() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hasSeenLanguagePrompt()) return undefined;
    const id = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent(CLOSED_EVENT));
  }, []);

  return { open, close };
}
