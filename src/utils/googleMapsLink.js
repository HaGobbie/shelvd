// src/utils/googleMapsLink.js
//
// Handles a Google Maps link an owner pastes in for their store.
//
// HONEST LIMITATION: a share link like "https://maps.app.goo.gl/5mDLk..."
// is a SHORTENED redirect URL — it does not contain the actual
// coordinates anywhere in the string itself. Resolving it to real
// coordinates requires actually following the redirect, which is a
// network request Google's servers have to answer. This app has no
// backend server of its own (it's a static site talking directly to
// Supabase) to make that request from — doing it from the BROWSER hits
// a hard wall: browsers block cross-origin `fetch()` redirect
// inspection for exactly this kind of third-party redirect chain (CORS),
// so there is no purely-client-side way to turn a shortened link into
// real coordinates.
//
// What this DOES do:
//   - If the pasted link is a FULL (non-shortened) Google Maps URL that
//     already contains coordinates in a recognizable place (the common
//     ".../@lat,lng,zoomz" pattern, or a "?q=lat,lng" / "&query=lat,lng"
//     parameter — both of which desktop Google Maps often produces),
//     coordinates are extracted directly via plain string parsing — no
//     network request needed, since the data was already sitting in the
//     URL.
//   - Otherwise (a shortened maps.app.goo.gl / goo.gl/maps link, or any
//     URL without a recognizable coordinate pattern), the ORIGINAL link
//     is used as-is — tapping "View on Google Maps" just opens exactly
//     what the owner pasted, and Google's own site/app takes it from
//     there (including its own one-tap directions option once the user
//     is there).
//
// A real fix for the shortened-link case would need a small server-side
// proxy (a Supabase Edge Function could do this — make the redirect
// request server-side, where CORS doesn't apply, and return the
// resolved Location header) — a legitimate future enhancement, not
// something achievable in this file alone.

const COORD_PATTERNS = [
  // .../@14.5995,120.9842,17z  (the most common form)
  /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  // ?q=14.5995,120.9842  or  &query=14.5995,120.9842
  /[?&](?:q|query)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
];

/**
 * extractCoordsFromGoogleMapsUrl
 * @param {string} url
 * @returns {{ lat: number, lng: number } | null}
 */
export function extractCoordsFromGoogleMapsUrl(url) {
  if (!url) return null;
  for (const pattern of COORD_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  }
  return null;
}

/**
 * buildGoogleMapsViewLink
 * Given whatever Google Maps URL the owner pasted, returns the best
 * link to actually send a resident to:
 *   - If coordinates could be parsed directly from the URL, builds a
 *     proper Google Maps "get directions" deep link with travel mode
 *     pre-selected (walking, since this app is for finding stores
 *     within an immediate neighborhood), using Google's public
 *     Universal Cross-Platform Maps URL scheme (no API key needed).
 *   - Otherwise, returns the original link unchanged.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function buildGoogleMapsViewLink(rawUrl) {
  const coords = extractCoordsFromGoogleMapsUrl(rawUrl);
  if (coords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}&travelmode=walking`;
  }
  return rawUrl;
}

/**
 * looksLikeGoogleMapsUrl
 * Soft check only — used for a gentle inline hint in the edit form, NOT
 * a hard validation block.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function looksLikeGoogleMapsUrl(url) {
  if (!url.trim()) return true;
  return /^https?:\/\/(www\.)?(maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i.test(
    url.trim()
  );
}
