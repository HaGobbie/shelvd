// src/tours/changelog.js
// "What's new" data for returning store owners — separate from the
// onboarding tour, which only ever plays for a BRAND NEW owner. This is
// for someone who already knows the dashboard but hasn't seen what's
// changed since their last visit.
//
// HOW TO ADD A NEW ENTRY NEXT TIME YOU SHIP SOMETHING:
//   1. Bump CHANGELOG_VERSION by 1.
//   2. Add a new { titleKey, bodyKey } to CHANGELOG_ITEMS (put newest
//      items first — they're shown top to bottom).
//   3. Add the matching titleKey/bodyKey pair to BOTH the "en" and "tl"
//      dictionaries under owner.changelog in src/i18n/translations.js.
// That's it — every returning owner whose last-seen version is below
// the new CHANGELOG_VERSION will automatically see the updated list
// once, then it's marked seen again.
//
// A brand-new owner never sees this at all — see the "first-time vs
// returning" check in OwnerDashboard.jsx, which marks the CURRENT
// version as already-seen the moment their onboarding tour finishes,
// since a first-time user has no "before" to compare against.

import { ShoppingCart, Moon, Share2 } from "lucide-react";

export const CHANGELOG_VERSION = 1;
export const CHANGELOG_STORAGE_KEY = "shelvd_whatsnew_seen_version";

export const CHANGELOG_ITEMS = [
  { Icon: ShoppingCart, titleKey: "owner.changelog.item1Title", bodyKey: "owner.changelog.item1Body" },
  { Icon: Moon,         titleKey: "owner.changelog.item2Title", bodyKey: "owner.changelog.item2Body" },
  { Icon: Share2,       titleKey: "owner.changelog.item3Title", bodyKey: "owner.changelog.item3Body" },
];

export function getLastSeenChangelogVersion() {
  try {
    const stored = localStorage.getItem(CHANGELOG_STORAGE_KEY);
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

export function markChangelogSeen(version = CHANGELOG_VERSION) {
  try {
    localStorage.setItem(CHANGELOG_STORAGE_KEY, String(version));
  } catch {
    // Private browsing etc — it'll just show again next visit.
  }
}
