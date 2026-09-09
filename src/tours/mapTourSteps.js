// src/tours/mapTourSteps.js
// Step list for the public map's onboarding tour — a much lighter,
// 4-step version aimed at a first-time resident visitor, not a store
// owner. targetId must match a data-tour-id="..." attribute placed in
// src/App.jsx (search bar wrapper, store FAB) or
// src/components/MapContainer.jsx (locate-me button).

import { Sparkles, Search, LocateFixed, Store } from "lucide-react";

export const MAP_TOUR_STORAGE_KEY = "shelvd_map_tour_seen_v1";

export const MAP_TOUR_STEPS = [
  { targetId: null,             Icon: Sparkles,    titleKey: "map.onboarding.step1Title", bodyKey: "map.onboarding.step1Body" },
  // NOTE: this step is deliberately NOT anchored to the search bar.
  // SearchBar.jsx positions itself via absolute/fixed CSS internally, so
  // a wrapping data-tour-id div in App.jsx can't correctly measure its
  // real on-screen position (an absolutely-positioned child contributes
  // nothing to its parent's normal-flow box) — that produced a highlight
  // in the wrong place. Falls back to a centered card until
  // SearchBar.jsx itself can carry the attribute directly on its real
  // positioned root element.
  { targetId: null,             Icon: Search,      titleKey: "map.onboarding.step2Title", bodyKey: "map.onboarding.step2Body" },
  { targetId: "map-locate-btn", Icon: LocateFixed, titleKey: "map.onboarding.step3Title", bodyKey: "map.onboarding.step3Body" },
  { targetId: "map-store-fab",  Icon: Store,       titleKey: "map.onboarding.step4Title", bodyKey: "map.onboarding.step4Body" },
];
