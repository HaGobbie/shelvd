// src/components/FreshnessBadge.jsx
// Turns a raw "last updated" timestamp into a plain, color-coded signal a
// shopper notices without having to read or interpret a date themselves.
import React from "react";
import { freshnessLevel } from "../utils/freshness";
import { formatLastUpdated } from "../hooks/useStores";
import { useLanguage } from "../i18n/LanguageContext";

export default function FreshnessBadge({ lastUpdated, showDot = true }) {
  const { t } = useLanguage();
  const level = freshnessLevel(lastUpdated);
  return (
    <span className={`freshness freshness--${level}`}>
      {showDot && <span className="freshness__dot" aria-hidden="true" />}
      {level === "stale" ? `${t("freshness.stale")} · ` : ""}
      {formatLastUpdated(lastUpdated)}
    </span>
  );
}
