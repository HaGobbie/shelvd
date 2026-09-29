// src/components/dashboard/FirstProductCTA.jsx
// Replaces the plain empty-inventory message with a big, hard-to-miss
// invitation to add the first product — normal page content (not a modal,
// not part of the onboarding tour's overlay layer), so it never competes
// or stacks with the tour's own spotlight/backdrop.
import React from "react";
import { PackagePlus, ScanLine, ArrowRight } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";

export default function FirstProductCTA({ onAddSingle, onAddMany }) {
  const { t } = useLanguage();
  return (
    <div className="first-cta">
      <div className="first-cta__icon"><PackagePlus size={34} strokeWidth={1.8} /></div>
      <h3>{t("firstProduct.title")}</h3>
      <p>{t("firstProduct.body")}</p>
      <div className="first-cta__actions">
        <button type="button" className="first-cta__primary" onClick={onAddSingle}>
          <PackagePlus size={18} /> {t("firstProduct.addOne")} <ArrowRight size={16} />
        </button>
        <button type="button" className="first-cta__secondary" onClick={onAddMany}>
          <ScanLine size={16} /> {t("firstProduct.scanReceipt")}
        </button>
      </div>
    </div>
  );
}
