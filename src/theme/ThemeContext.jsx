// src/theme/ThemeContext.jsx
// Light/dark mode. Auto-detects the device's system preference on first
// visit (prefers-color-scheme), and keeps following live system changes
// UNTIL the person explicitly picks a theme via the toggle — at which
// point that choice is remembered (localStorage) and system changes are
// no longer auto-applied, since an explicit choice should stick.

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "shelvd_theme"; // "light" | "dark"

function getSystemPreference() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function getStoredTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => getStoredTheme() ?? getSystemPreference());
  // Whether we should keep following the system's live theme changes —
  // true only when the person has never made an explicit choice here.
  const [followSystem, setFollowSystem] = useState(() => getStoredTheme() === null);

  // Apply the theme to <html data-theme="..."> so App.css's
  // html[data-theme="dark"] overrides take effect, and so native form
  // controls (date/month pickers, scrollbars) pick up the matching
  // browser-native dark styling via `color-scheme`.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Live-follow the system preference for as long as the person hasn't
  // explicitly overridden it.
  useEffect(() => {
    if (!followSystem || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => setThemeState(e.matches ? "dark" : "light");
    // addEventListener is the modern API; addListener is the deprecated
    // fallback some older WebViews (common on budget Android devices,
    // relevant for this app's actual audience) still require.
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, [followSystem]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    setFollowSystem(false);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private-browsing mode etc — the choice just won't persist across
      // visits, which is a fine degradation rather than a crash.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * useTheme
 * @returns {{ theme: "light"|"dark", setTheme: Function, toggleTheme: Function }}
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}
