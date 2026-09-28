// src/utils/routing.js
// Multi-stop route planning for the shopping list.
//
//  • orderStopsNearestFirst()  greedy nearest-neighbour ordering: closest
//    store to the shopper first, then the closest remaining store to THAT
//    store, and so on (exactly the "nearest, then next nearest" behaviour).
//  • fetchRoute()              real road/footpath geometry + turn-by-turn
//    steps from OSRM (free, no API key).
//  • buildGoogleMapsMultiStopLink()  optional hand-off to Google Maps.
//
// OSRM NOTE: the public servers below are community demo servers — fine for a
// capstone/small community, but they carry no uptime guarantee. If Shelvd
// grows, self-host OSRM or swap fetchRoute() for OpenRouteService / Mapbox
// (only this file needs to change).

const EARTH_RADIUS_M = 6371000;

export function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * @param {[number, number]} origin  [lat, lng] of the shopper
 * @param {Array<{storeId, lat, lng}>} stops
 * @returns same stops, reordered (each gets .straightMeters from the previous point)
 */
export function orderStopsNearestFirst(origin, stops) {
  const remaining = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const ordered = [];
  let current = origin;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((s, i) => {
      const d = haversineMeters(current, [s.lat, s.lng]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push({ ...next, straightMeters: bestDist });
    current = [next.lat, next.lng];
  }
  return ordered;
}

const ROUTE_ENDPOINTS = {
  // walking / footpaths
  walk: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
  // motorbike / car / tricycle
  drive: "https://router.project-osrm.org/route/v1/driving",
};

/**
 * @param {"walk"|"drive"} mode
 * @param {Array<[number, number]>} points  [lat, lng] — origin first, then each stop in order
 * @returns {Promise<{ coords: [number, number][], distance: number, duration: number,
 *                     legs: Array<{ distance, duration, steps: Array<{text, distance}> }> }>}
 */
export async function fetchRoute(mode, points, signal) {
  const coordString = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `${ROUTE_ENDPOINTS[mode] ?? ROUTE_ENDPOINTS.walk}/${coordString}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing service returned ${res.status}`);
  const json = await res.json();
  if (json.code !== "Ok" || !json.routes?.length) throw new Error(json.message || "No route found");
  const route = json.routes[0];
  return {
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: route.distance,
    duration: route.duration,
    legs: route.legs.map((leg) => ({
      distance: leg.distance,
      duration: leg.duration,
      steps: leg.steps.map((s) => ({ text: describeStep(s), distance: s.distance })),
    })),
  };
}

function describeStep(step) {
  const { type, modifier } = step.maneuver || {};
  const road = step.name ? ` onto ${step.name}` : "";
  const dir = modifier ? modifier.replace("slight ", "slight ").replace("sharp ", "sharp ") : "";
  switch (type) {
    case "depart":       return `Head ${step.name ? `along ${step.name}` : "out"}`.trim();
    case "arrive":       return "Arrive at the store";
    case "turn":         return `Turn ${dir}${road}`;
    case "new name":
    case "continue":     return `Continue ${dir === "straight" || !dir ? "straight" : dir}${road}`;
    case "merge":        return `Merge${road}`;
    case "on ramp":
    case "off ramp":     return `Take the ramp${road}`;
    case "fork":         return `Keep ${dir || "straight"} at the fork${road}`;
    case "end of road":  return `At the end of the road turn ${dir}${road}`;
    case "roundabout":
    case "rotary":       return `Enter the roundabout and exit${road}`;
    default:             return `Continue${road}`;
  }
}

/** Google Maps allows up to 9 waypoints in this URL form. */
export function buildGoogleMapsMultiStopLink(origin, stops, mode = "walk") {
  if (!stops.length) return null;
  const last = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).slice(0, 9).map((s) => `${s.lat},${s.lng}`).join("|");
  const params = new URLSearchParams({
    api: "1",
    destination: `${last.lat},${last.lng}`,
    travelmode: mode === "walk" ? "walking" : "driving",
  });
  if (origin) params.set("origin", `${origin[0]},${origin[1]}`);
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "—";
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
