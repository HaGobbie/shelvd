// src/components/LanguageChooserModal.jsx
// A one-time "English or Tagalog?" prompt for first-time visitors — separate
// from (and, for owners, shown only after) the onboarding tour, so it never
// competes with it for attention. See LANGUAGE_PROMPT_KEY usages in App.jsx
// and OwnerDashboard.jsx for exactly when each surface shows it.
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Languages } from "lucide-react";
import BrandLogo from "./BrandLogo";
import { useLanguage } from "../i18n/LanguageContext";

export const LANGUAGE_PROMPT_KEY = "shelvd_lang_prompted_v1";
export function hasSeenLanguagePrompt() {
  try { return localStorage.getItem(LANGUAGE_PROMPT_KEY) === "1"; } catch { return true; }
}
export function markLanguagePromptSeen() {
  try { localStorage.setItem(LANGUAGE_PROMPT_KEY, "1"); } catch { /* best effort */ }
}

export default function LanguageChooserModal({ isOpen, onDone }) {
  const { setLanguage } = useLanguage();
  const choose = (lang) => { setLanguage(lang); markLanguagePromptSeen(); onDone?.(); };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div className="sheet-overlay" style={{ zIndex: 2000 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div className="lang-modal" style={{ zIndex: 2001 }} role="dialog" aria-modal="true" aria-label="Choose your language"
            initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 24, stiffness: 320 }}>
            <BrandLogo size={42} />
            <Languages size={20} className="lang-modal__badge" />
            <h2>Choose your language<br />Piliin ang iyong wika</h2>
            <div className="lang-modal__options">
              <button type="button" onClick={() => choose("en")}><strong>English</strong><span>Continue in English</span></button>
              <button type="button" onClick={() => choose("tl")}><strong>Tagalog</strong><span>Magpatuloy sa Tagalog</span></button>
            </div>
            <p className="lang-modal__note">You can change this anytime · Puwede mong baguhin ito anumang oras</p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
