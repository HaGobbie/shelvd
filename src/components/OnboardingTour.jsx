// src/components/OnboardingTour.jsx
// First-run walkthrough for the Owner Dashboard.
//
// REWRITE NOTE: the original version was a centered modal card cycling
// through plain text — easy to zone out and spam through without really
// looking at anything. This version instead finds the REAL button/panel
// being described (via a `data-tour-id` attribute placed on it in
// OwnerDashboard.jsx), scrolls it into view, draws a glowing highlight
// ring directly around it, and places the explanation tooltip right next
// to it — so the person sees the exact thing being talked about, not an
// abstract description in the middle of the screen.
//
// This is inherently more fragile than a plain centered card, because a
// target element can be off-screen, not yet rendered, or simply not
// exist (there's no product card to point at if the owner has zero
// products yet). Every step falls back to a centered card automatically
// if its target isn't found in the DOM — never a broken-looking empty
// highlight pointing at nothing.
//
// While the tour is open, body scroll is locked and all positioning uses
// viewport-relative (`position: fixed`) coordinates from
// getBoundingClientRect() — simpler and more robust than tracking
// document-scroll offsets, since the target can't move out from under
// the highlight while scrolling is disabled.

import React, { useState, useEffect, useCallback } from "react";
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

export const ONBOARDING_STORAGE_KEY = "shelvd_onboarding_seen_v2";

// targetId: null means "always a centered card, never anchored" (used
// for the welcome/closing steps, which aren't about one specific button).
// For every other step, targetId must match a `data-tour-id="..."`
// attribute somewhere in OwnerDashboard.jsx's rendered output.
const STEPS = [
  { targetId: null,                 Icon: Sparkles,     titleKey: "owner.onboarding.step1Title", bodyKey: "owner.onboarding.step1Body" },
  { targetId: "add-product-btn",    Icon: Plus,         titleKey: "owner.onboarding.step2Title", bodyKey: "owner.onboarding.step2Body" },
  { targetId: "first-product-card", Icon: ArrowUpDown,  titleKey: "owner.onboarding.step3Title", bodyKey: "owner.onboarding.step3Body" },
  { targetId: "new-transaction-btn",Icon: ShoppingCart, titleKey: "owner.onboarding.step4Title", bodyKey: "owner.onboarding.step4Body" },
  { targetId: "reports-toolbar",    Icon: FileDown,     titleKey: "owner.onboarding.step5Title", bodyKey: "owner.onboarding.step5Body" },
  { targetId: "bulk-import-btn",    Icon: UploadCloud,  titleKey: "owner.onboarding.step6Title", bodyKey: "owner.onboarding.step6Body" },
  { targetId: "edit-store-btn",     Icon: Settings,     titleKey: "owner.onboarding.step7Title", bodyKey: "owner.onboarding.step7Body" },
  { targetId: "help-btn",           Icon: PartyPopper,  titleKey: "owner.onboarding.step8Title", bodyKey: "owner.onboarding.step8Body" },
];

const TOOLTIP_WIDTH = 300;
const TOOLTIP_EST_HEIGHT = 210; // rough estimate for above/below placement math
const GAP = 16; // space between the highlight ring and the tooltip

export function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
  } catch {
    // Private browsing etc — the tour will just show again next visit.
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
 * Finds the target element for a step, scrolls it into view, and
 * measures its viewport-relative bounding box. Re-runs on every step
 * change and on window resize while a step with a target is active.
 * Returns null if the step has no targetId, or if the target isn't
 * currently in the DOM — both are treated as "show the centered
 * fallback card instead," by the caller.
 */
function useTourTargetRect(targetId, active) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!active || !targetId) {
      setRect(null);
      return;
    }

    const el = document.querySelector(`[data-tour-id="${targetId}"]`);
    if (!el) {
      setRect(null);
      return;
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    // Wait for the scroll animation to settle before measuring — measuring
    // immediately would capture the element's PRE-scroll position.
    const settleTimer = window.setTimeout(measure, 400);
    window.addEventListener("resize", measure);

    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", measure);
    };
  }, [targetId, active]);

  return rect;
}

/** Decides whether the tooltip sits above/below the target, and its clamped horizontal position. */
function computeTooltipPlacement(rect) {
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  const spaceBelow = viewportH - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const placeBelow = spaceBelow >= TOOLTIP_EST_HEIGHT + GAP || spaceBelow >= spaceAbove;

  const top = placeBelow
    ? rect.top + rect.height + GAP
    : Math.max(12, rect.top - TOOLTIP_EST_HEIGHT - GAP);

  let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
  left = Math.max(12, Math.min(left, viewportW - TOOLTIP_WIDTH - 12));

  return { top, left, placeBelow };
}

const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.16 } },
};

const cardVariants = {
  enter:  { opacity: 0, scale: 0.96 },
  center: { opacity: 1, scale: 1, transition: { type: "spring", damping: 26, stiffness: 320 } },
  exit:   { opacity: 0, scale: 0.98, transition: { duration: 0.12 } },
};

/**
 * @param {{ isOpen: boolean, onClose: Function }} props
 */
export default function OnboardingTour({ isOpen, onClose }) {
  const { t } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex];
  const targetRect = useTourTargetRect(step.targetId, isOpen);
  const isAnchored = Boolean(step.targetId && targetRect);

  // Reset to step 1 every time the tour (re)opens, and lock body scroll
  // for the duration — see file header for why the fixed-position math
  // depends on this.
  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isOpen]);

  const finish = useCallback(() => {
    markOnboardingSeen();
    onClose();
  }, [onClose]);

  const goNext = () => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  if (!isOpen) return null;

  const isLastStep = stepIndex === STEPS.length - 1;
  const { Icon, titleKey, bodyKey } = step;

  const content = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: "rgba(200,90,39,0.12)", color: "var(--color-brand-primary)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Icon size={17} strokeWidth={2} />
        </div>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
          {t(titleKey)}
        </h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.55, margin: "0 0 16px" }}>
        {t(bodyKey)}
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {stepIndex > 0 ? (
          <button
            type="button"
            onClick={goBack}
            style={{
              display: "flex", alignItems: "center", gap: 2, height: 36, padding: "0 8px",
              border: "none", background: "none", color: "var(--color-text-secondary)",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            <ChevronLeft size={14} /> {t("owner.onboarding.back")}
          </button>
        ) : (
          <button
            type="button"
            onClick={finish}
            style={{
              height: 36, padding: "0 8px", border: "none", background: "none",
              color: "var(--color-text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("owner.onboarding.skip")}
          </button>
        )}

        <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600 }}>
          {t("owner.onboarding.stepCounter", stepIndex + 1, STEPS.length)}
        </span>

        <button
          type="button"
          onClick={goNext}
          style={{
            display: "flex", alignItems: "center", gap: 2, height: 36, padding: "0 14px",
            borderRadius: "var(--radius-pill, 999px)", border: "none",
            background: "var(--color-brand-primary)", color: "#fff",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          {isLastStep ? t("owner.onboarding.done") : t("owner.onboarding.next")}
          {!isLastStep && <ChevronRight size={14} />}
        </button>
      </div>
    </>
  );

  const placement = isAnchored ? computeTooltipPlacement(targetRect) : null;

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
          background: "rgba(0, 0, 0, 0.55)",
        }}
      />

      <button
        type="button"
        onClick={finish}
        aria-label={t("owner.onboarding.skip")}
        style={{
          position: "fixed", top: 16, right: 16, zIndex: 2003,
          width: 36, height: 36, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)", color: "#fff",
          border: "none", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <X size={18} />
      </button>

      {isAnchored ? (
        <React.Fragment key={`anchored-${stepIndex}`}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              top: targetRect.top - 6,
              left: targetRect.left - 6,
              width: targetRect.width + 12,
              height: targetRect.height + 12,
              borderRadius: 14,
              border: "3px solid var(--color-brand-primary)",
              boxShadow: "0 0 0 4px rgba(200,90,39,0.28)",
              pointerEvents: "none",
              zIndex: 2001,
            }}
          />
          <motion.div
            variants={cardVariants}
            initial="enter"
            animate="center"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: placement.top,
              left: placement.left,
              width: TOOLTIP_WIDTH,
              zIndex: 2002,
              background: "var(--color-surface)",
              borderRadius: 14,
              padding: 16,
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {content}
          </motion.div>
        </React.Fragment>
      ) : (
        <motion.div
          key={`centered-${stepIndex}`}
          variants={cardVariants}
          initial="enter"
          animate="center"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(340px, calc(100vw - 40px))",
            zIndex: 2002,
            background: "var(--color-surface)",
            borderRadius: 18,
            padding: 20,
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {content}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
