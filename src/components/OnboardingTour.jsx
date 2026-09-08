// src/components/OnboardingTour.jsx
// Generic first-run walkthrough engine — finds a real element on screen
// (via a `data-tour-id` attribute), scrolls it into view, draws a glowing
// highlight ring around it, and places an explanation tooltip beside it.
// Falls back to a centered card automatically if a step's target isn't
// currently in the DOM (off-screen, not rendered, or genuinely absent —
// e.g. no product cards exist yet).
//
// REUSABLE BY DESIGN: this component takes `steps` and `storageKey` as
// props rather than hardcoding one fixed tour, so it backs BOTH the
// Owner Dashboard's tour (src/pages/OwnerDashboard.jsx) and the public
// map's tour (src/App.jsx) — same anchoring/highlight/placement engine,
// different content and a different "have they seen this one" flag per
// surface. See ownerTourSteps.js and mapTourSteps.js for the two step
// lists actually used.
//
// While open, body scroll is locked and all positioning uses
// viewport-relative (`position: fixed`) coordinates from
// getBoundingClientRect() — the target can't move out from under the
// highlight while scrolling is disabled, so no continuous scroll
// tracking is needed. (On the public map, which doesn't scroll at all,
// this lock is a harmless no-op.)

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";

const TOOLTIP_WIDTH = 300;
const TOOLTIP_EST_HEIGHT = 210; // rough estimate for above/below placement math
const GAP = 16; // space between the highlight ring and the tooltip

/**
 * markTourSeen / hasSeenTour
 * Generic localStorage read/write, parameterized by storageKey so each
 * tour (dashboard, map, and any future one) tracks its own "seen" state
 * independently under its own key.
 */
export function markTourSeen(storageKey) {
  try {
    localStorage.setItem(storageKey, "true");
  } catch {
    // Private browsing etc — the tour will just show again next visit.
  }
}

export function hasSeenTour(storageKey) {
  try {
    return localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

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
 * @param {{
 *   isOpen: boolean,
 *   onClose: Function,
 *   steps: Array<{ targetId: string|null, Icon: React.ComponentType, titleKey: string, bodyKey: string }>,
 *   storageKey: string,
 *   labels: { skip: string, next: string, back: string, done: string, stepCounter: (current:number, total:number)=>string }
 * }} props
 */
export default function OnboardingTour({ isOpen, onClose, steps, storageKey, labels }) {
  const { t } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);

  const step = steps[stepIndex];
  const targetRect = useTourTargetRect(step?.targetId, isOpen);
  const isAnchored = Boolean(step?.targetId && targetRect);

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
    markTourSeen(storageKey);
    onClose();
  }, [onClose, storageKey]);

  const goNext = () => {
    if (stepIndex >= steps.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  if (!isOpen || !step) return null;

  const isLastStep = stepIndex === steps.length - 1;
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
            <ChevronLeft size={14} /> {labels.back}
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
            {labels.skip}
          </button>
        )}

        <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600 }}>
          {labels.stepCounter(stepIndex + 1, steps.length)}
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
          {isLastStep ? labels.done : labels.next}
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
        aria-label={labels.skip}
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
