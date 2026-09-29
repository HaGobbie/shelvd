// src/utils/freshness.js
// Turns "last updated" into a plain-language, color-coded freshness signal
// for shoppers — so "this list might be stale" is visible at a glance
// instead of buried in a timestamp only an attentive reader would notice.

// Deliberately forgiving: a sari-sari store's slower-moving items (rice,
// canned goods, hardware) can go a week or more with no real change, and
// that isn't the same thing as an abandoned listing. These thresholds flag
// genuine neglect, not normal restocking rhythm.
export const FRESH_DAYS = 7;
export const AGING_DAYS = 30;

/** @returns {"fresh"|"aging"|"stale"|"unknown"} */
export function freshnessLevel(lastUpdated) {
  if (!lastUpdated) return "unknown";
  const ms = Date.now() - new Date(lastUpdated).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const days = ms / 864e5;
  if (days < FRESH_DAYS) return "fresh";
  if (days < AGING_DAYS) return "aging";
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
