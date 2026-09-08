// src/tours/ownerTourSteps.js
// Step list for the Owner Dashboard's onboarding tour. Each targetId
// must match a data-tour-id="..." attribute somewhere in
// src/pages/OwnerDashboard.jsx's rendered output — see that file for
// where each one is placed. targetId: null means "always a centered
// card, never anchored" (used for the welcome/closing steps, which
// aren't about one specific button).

import {
  Sparkles,
  Plus,
  ArrowUpDown,
  ShoppingCart,
  FileDown,
  UploadCloud,
  Settings,
  PartyPopper,
} from "lucide-react";

export const OWNER_TOUR_STORAGE_KEY = "shelvd_onboarding_seen_v2";

export const OWNER_TOUR_STEPS = [
  { targetId: null,                  Icon: Sparkles,     titleKey: "owner.onboarding.step1Title", bodyKey: "owner.onboarding.step1Body" },
  { targetId: "add-product-btn",     Icon: Plus,         titleKey: "owner.onboarding.step2Title", bodyKey: "owner.onboarding.step2Body" },
  { targetId: "first-product-card",  Icon: ArrowUpDown,  titleKey: "owner.onboarding.step3Title", bodyKey: "owner.onboarding.step3Body" },
  { targetId: "new-transaction-btn", Icon: ShoppingCart, titleKey: "owner.onboarding.step4Title", bodyKey: "owner.onboarding.step4Body" },
  { targetId: "reports-toolbar",     Icon: FileDown,     titleKey: "owner.onboarding.step5Title", bodyKey: "owner.onboarding.step5Body" },
  { targetId: "bulk-import-btn",     Icon: UploadCloud,  titleKey: "owner.onboarding.step6Title", bodyKey: "owner.onboarding.step6Body" },
  { targetId: "edit-store-btn",      Icon: Settings,     titleKey: "owner.onboarding.step7Title", bodyKey: "owner.onboarding.step7Body" },
  { targetId: "help-btn",            Icon: PartyPopper,  titleKey: "owner.onboarding.step8Title", bodyKey: "owner.onboarding.step8Body" },
];
