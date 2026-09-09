// src/components/WhatsNewModal.jsx
// A compact, dismissible list of what's changed since the owner's last
// visit — distinct from OnboardingTour, which only ever plays once for
// a brand-new owner.

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";
import { CHANGELOG_ITEMS } from "../tours/changelog";

const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.16 } },
};

const cardVariants = {
  hidden:  { opacity: 0, scale: 0.95, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", damping: 26, stiffness: 320 } },
  exit:    { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.14 } },
};

/**
 * @param {{ isOpen: boolean, onClose: Function }} props
 */
export default function WhatsNewModal({ isOpen, onClose }) {
  const { t } = useLanguage();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            style={{ position: "fixed", inset: 0, zIndex: 1500, background: "rgba(0,0,0,0.5)" }}
          />
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("owner.whatsNew.title")}
            style={{
              // Centered via fixed inset + margin: auto — NOT transform.
              // cardVariants animates y/scale, and Framer Motion writes
              // that as an inline transform at runtime, which silently
              // overrode translate(-50%,-50%) here — this is what was
              // actually causing the modal to render off-screen/clipped
              // instead of centered. No transform here means nothing
              // for Framer Motion's own animated transform to conflict with.
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              margin: "auto",
              zIndex: 1501,
              width: "min(380px, calc(100vw - 32px))",
              height: "fit-content",
              maxHeight: "calc(100dvh - 32px)",
              overflowY: "auto",
              background: "var(--color-surface)",
              borderRadius: 20,
              padding: "24px 22px",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={t("owner.whatsNew.close")}
              style={{
                position: "absolute", top: 14, right: 14,
                width: 32, height: 32, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer",
              }}
            >
              <X size={16} />
            </button>

            <div
              style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "rgba(200,90,39,0.12)", color: "var(--color-brand-primary)",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <Sparkles size={24} strokeWidth={2} />
            </div>

            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>
              {t("owner.whatsNew.title")}
            </h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 18 }}>
              {t("owner.whatsNew.subtitle")}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              {CHANGELOG_ITEMS.map(({ Icon, titleKey, bodyKey }) => (
                <div key={titleKey} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                      background: "var(--color-surface-3)", color: "var(--color-brand-primary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Icon size={16} strokeWidth={2} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 2 }}>
                      {t(titleKey)}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                      {t(bodyKey)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="pform__submit"
              style={{ marginTop: 0 }}
            >
              {t("owner.whatsNew.gotIt")}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
