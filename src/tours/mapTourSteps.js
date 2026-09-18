// src/tours/mapTourSteps.js
// Step list for the public map's onboarding tour — a lighter, short
// version aimed at a first-time resident visitor, not a store owner.
// targetId must match a data-tour-id="..." attribute placed in
// src/App.jsx (language toggle, store FAB) or
// src/components/SearchBar.jsx / MapContainer.jsx (search bar,
// locate-me button).

import { Sparkles, Search, LocateFixed, Store, Languages } from "lucide-react";

export const MAP_TOUR_STORAGE_KEY = "shelvd_map_tour_seen_v2";

export const MAP_TOUR_STEPS = [
  { targetId: null,               Icon: Sparkles,    titleKey: "map.onboarding.step1Title", bodyKey: "map.onboarding.step1Body" },
  { targetId: "map-search-bar",   Icon: Search,      titleKey: "map.onboarding.step2Title", bodyKey: "map.onboarding.step2Body" },
  { targetId: "map-locate-btn",   Icon: LocateFixed, titleKey: "map.onboarding.step3Title", bodyKey: "map.onboarding.step3Body" },
  { targetId: "map-lang-toggle",  Icon: Languages,   titleKey: "map.onboarding.step4Title", bodyKey: "map.onboarding.step4Body" },
  { targetId: "map-store-fab",    Icon: Store,       titleKey: "map.onboarding.step5Title", bodyKey: "map.onboarding.step5Body" },
];


