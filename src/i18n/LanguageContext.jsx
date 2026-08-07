// src/i18n/LanguageContext.jsx
// Lightweight i18n — no external library. This app's translated surface
// is small enough that react-i18next's extra weight (ICU formatting,
// namespace lazy-loading, pluralization rule engines) isn't buying
// anything a simple dot-path lookup + function-valued entries can't
// already do, and it's easier to reason about at this scale.

import React, { createContext, useContext, useState, useCallback } from "react";
import { translations } from "./translations";

const LanguageContext = createContext(null);
const STORAGE_KEY = "shelvd_language";

function getNested(obj, path) {
  return path
    .split(".")
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === "tl" || saved === "en" ? saved : "en";
    } catch {
      return "en";
    }
  });

  const setLanguage = useCallback((lang) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // localStorage can throw in private-browsing modes — language
      // selection just won't persist across visits, which is a fine
      // degradation rather than a crash.
    }
  }, []);

  /**
   * t
   * Looks up a dot-path key (e.g. "search.placeholder") in the current
   * language's dictionary. Entries can be plain strings or functions
   * (for pluralization/interpolation — call with args, e.g.
   * t("storeDetails.fullInventory", 12)).
   *
   * Graceful degradation: an unknown key in the current language falls
   * back to English, then to the raw key string itself — so a missing
   * translation shows SOMETHING readable rather than crashing or
   * rendering blank.
   */
  const t = useCallback(
    (key, ...args) => {
      const dict = translations[language] ?? translations.en;
      let value = getNested(dict, key);
      if (value === undefined) {
        value = getNested(translations.en, key) ?? key;
      }
      return typeof value === "function" ? value(...args) : value;
    },
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * useLanguage
 * @returns {{ language: "en"|"tl", setLanguage: Function, t: Function }}
 */
export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a <LanguageProvider>");
  }
  return ctx;
}
