// src/components/OnboardingTour.jsx
// First-run walkthrough for the Owner Dashboard — a series of centered
// cards over a dimmed backdrop, one per feature, with Next/Back/Skip and
// dot progress indicators. Click anywhere on the dimmed backdrop (i.e.
// outside the card) also dismisses it, same as tapping Skip.
//
// DESIGN CHOICE: this does NOT spotlight/highlight actual live DOM
// elements (no bounding-rect measurement, no cutout in the overlay
// pointing at the real "Add Product" button, etc). That approach is
// fragile across the range of screen sizes and layouts this app already
// has to support (narrow phones, the toolbar's buttons wrapping
// differently at different widths, elements not being mounted yet on
// first render) — a step that's supposed to point at a button which has
// wrapped to a different row, or hasn't rendered yet, actively teaches
// the wrong thing. A plain centered card describing each feature is less
// flashy but always correct regardless of viewport or scroll position.
//
// PERSISTENCE: shown automatically once per browser (localStorage flag,
// versioned so a future content rewrite can force it to reappear for
// everyone by bumping the version number), and re-openable anytime via
// the "?" button in the dashboard header — see OwnerDashboard.jsx.

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Sparkles,
  Plus,
  ArrowUpDown,
  ShoppingCart,
  FileDown,
  UploadCloud,
  Settings,
  PartyPopper,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";

export const ONBOARDING_STORAGE_KEY = "shelvd_onboarding_seen_v1";

const STEPS = [
  { Icon: Sparkles,      titleKey: "owner.onboarding.step1Title", bodyKey: "owner.onboarding.step1Body" },
  { Icon: Plus,          titleKey: "owner.onboarding.step2Title", bodyKey: "owner.onboarding.step2Body" },
  { Icon: ArrowUpDown,   titleKey: "owner.onboarding.step3Title", bodyKey: "owner.onboarding.step3Body" },
  { Icon: ShoppingCart,  titleKey: "owner.onboarding.step4Title", bodyKey: "owner.onboarding.step4Body" },
  { Icon: FileDown,      titleKey: "owner.onboarding.step5Title", bodyKey: "owner.onboarding.step5Body" },
  { Icon: UploadCloud,   titleKey: "owner.onboarding.step6Title", bodyKey: "owner.onboarding.step6Body" },
  { Icon: Settings,      titleKey: "owner.onboarding.step7Title", bodyKey: "owner.onboarding.step7Body" },
  { Icon: PartyPopper,   titleKey: "owner.onboarding.step8Title", bodyKey: "owner.onboarding.step8Body" },
];

const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.16 } },
};

const cardVariants = {
  enter:  (dir) => ({ opacity: 0, x: dir > 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0, transition: { type: "spring", damping: 26, stiffness: 300 } },
  exit:   (dir) => ({ opacity: 0, x: dir > 0 ? -40 : 40, transition: { duration: 0.15 } }),
};

/**
 * markOnboardingSeen
 * Exported so OwnerDashboard.jsx's "?" help button and the tour's own
 * completion/skip both write the same flag through one function, rather
 * than duplicating the localStorage key/try-catch in two places.
 */
export function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
  } catch {
    // Private browsing etc — the tour will just show again next visit,
    // which is a fine degradation, not worth surfacing as an error.
  }
}

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * @param {{ isOpen: boolean, onClose: Function }} props
 */
export default function OnboardingTour({ isOpen, onClose }) {
  const { t } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);
  const [dir, setDir] = useState(1);

  const finish = () => {
    markOnboardingSeen();
    onClose();
  };

  const goNext = () => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    setDir(1);
    setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    setDir(-1);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  // Reset to step 1 every time the tour is (re)opened, so replaying via
  // the "?" button always starts from the beginning rather than resuming
  // wherever it was last closed.
  React.useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
      setDir(1);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const { Icon, titleKey, bodyKey } = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={finish}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(2px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        {/* Stop propagation so clicking the card itself doesn't dismiss —
            only clicks on the dimmed backdrop outside it do. */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--color-surface)",
            borderRadius: 20,
            padding: "28px 24px 24px",
            width: "100%",
            maxWidth: 380,
            boxShadow: "var(--shadow-lg)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={finish}
            aria-label={t("owner.onboarding.skip")}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 36,
              height: 36,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>

          <AnimatePresence custom={dir} mode="wait">
            <motion.div
              key={stepIndex}
              custom={dir}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              style={{ textAlign: "center" }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: "var(--color-available-bg, rgba(200,90,39,0.12))",
                  color: "var(--color-brand-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 18px",
                }}
              >
                <Icon size={28} strokeWidth={2} />
              </div>

              <h2
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 19,
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  marginBottom: 10,
                }}
              >
                {t(titleKey)}
              </h2>

              <p
                style={{
                  fontSize: 14,
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.6,
                  marginBottom: 0,
                }}
              >
                {t(bodyKey)}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Dot progress indicator */}
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 22, marginBottom: 22 }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === stepIndex ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === stepIndex ? "var(--color-brand-primary)" : "var(--color-border)",
                  transition: "width 0.2s, background 0.2s",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={goBack}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  height: 44, padding: "0 14px",
                  border: "none", background: "none",
                  color: "var(--color-text-secondary)", fontSize: 13, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <ChevronLeft size={16} /> {t("owner.onboarding.back")}
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                style={{
                  height: 44, padding: "0 14px",
                  border: "none", background: "none",
                  color: "var(--color-text-muted)", fontSize: 13, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("owner.onboarding.skip")}
              </button>
            )}

            <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600 }}>
              {t("owner.onboarding.stepCounter", stepIndex + 1, STEPS.length)}
            </span>

            <button
              type="button"
              onClick={goNext}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                height: 44, padding: "0 18px",
                borderRadius: "var(--radius-pill, 999px)",
                border: "none", background: "var(--color-brand-primary)",
                color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isLastStep ? t("owner.onboarding.done") : t("owner.onboarding.next")}
              {!isLastStep && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
