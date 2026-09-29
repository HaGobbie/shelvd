// src/utils/freshness.js
// Turns "last updated" into a plain-language, color-coded freshness signal
// for shoppers — so "this list might be stale" is visible at a glance
// instead of buried in a timestamp only an attentive reader would notice.

export const FRESH_HOURS = 24;
export const AGING_DAYS = 7;

/** @returns {"fresh"|"aging"|"stale"|"unknown"} */
export function freshnessLevel(lastUpdated) {
  if (!lastUpdated) return "unknown";
  const ms = Date.now() - new Date(lastUpdated).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const hours = ms / 36e5;
  if (hours < FRESH_HOURS) return "fresh";
  if (hours < AGING_DAYS * 24) return "aging";
  return "stale";
}

/** Most recent lastUpdated across a list of products — used for a store-level freshness chip. */
export function mostRecentUpdate(products) {
  let best = null;
  for (const p of products) {
    const t = p?.lastUpdated ? new Date(p.lastUpdated).getTime() : NaN;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}
