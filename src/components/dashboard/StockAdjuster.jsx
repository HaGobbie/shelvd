// src/components/dashboard/StockAdjuster.jsx
// Batched stock editing for one product.
//
// Before: "+" wrote +1 to the database immediately (and "−" allowed exactly
// one unit before asking why). Now the owner builds up the change first —
// tap +1/+10 (or −1/−10) as many times as needed, or type a number — and
// nothing touches the database until they press Save:
//
//   • Net increase → saved as a "restocked" ledger entry.
//   • Net decrease → THEN asks why (spoiled / personal use / other), once,
//     for the whole amount, and saves it with that reason.
//
// The dashboard (and its realtime listener) only refreshes on Save.

import React, { useState, useEffect } from "react";
import { Plus, Minus, RotateCcw, Check, Loader2 } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";

const MAX_QTY = 99999;
const DECREASE_REASONS = [
  { value: "spoiled", labelKey: "transactionType.spoiled" },
  { value: "personal_use", labelKey: "transactionType.personal_use" },
  { value: "other", labelKey: "transactionType.other" },
];

export default function StockAdjuster({ product, onCommit }) {
  const { t } = useLanguage();
  const base = product.quantity ?? 0;
  const [draft, setDraft] = useState(base);
  const [touched, setTouched] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Follow live changes (another device, a sale) only while the owner
  // hasn't started editing — never clobber a half-typed change.
  useEffect(() => {
    if (!touched) setDraft(base);
  }, [base, touched]);

  const delta = draft - base;
  const unit = product.unit || "piece";

  const bump = (n) => {
    setTouched(true);
    setAskReason(false);
    setError("");
    setDraft((d) => Math.max(0, Math.min(MAX_QTY, d + n)));
  };

  const onType = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 5);
    setTouched(true);
    setAskReason(false);
    setError("");
    setDraft(digits === "" ? 0 : Math.min(MAX_QTY, parseInt(digits, 10)));
  };

  const reset = () => {
    setDraft(base);
    setTouched(false);
    setAskReason(false);
    setError("");
  };

  const commit = async (type) => {
    setSaving(true);
    setError("");
    const { error: err } = (await onCommit(product.id, draft, type, null)) ?? {};
    setSaving(false);
    if (err) {
      setError(t("stock.saveFailed"));
      return;
    }
    setTouched(false);
    setAskReason(false);
  };

  const handleSave = () => {
    if (delta === 0) return;
    if (delta > 0) commit("restocked");
    else setAskReason(true);
  };

  const stepBtn = (label, n, Icon) => (
    <button type="button" className="stock-adj__step" onClick={() => bump(n)} disabled={saving}
      aria-label={t("stock.adjustBy", n > 0 ? `+${n}` : `${n}`)}>
      {Icon ? <Icon size={15} strokeWidth={2.5} /> : null}{label}
    </button>
  );

  return (
    <div className="stock-adj">
      <div className="stock-adj__row">
        <div className="stock-adj__steps">
          {stepBtn("10", -10, Minus)}
          {stepBtn("", -1, Minus)}
        </div>
        <input
          className="stock-adj__input"
          inputMode="numeric"
          value={draft}
          onChange={onType}
          onFocus={(e) => e.target.select()}
          aria-label={t("stock.newQuantityAria", product.name)}
          disabled={saving}
        />
        <div className="stock-adj__steps">
          {stepBtn("", 1, Plus)}
          {stepBtn("10", 10, Plus)}
        </div>
        <span className="stock-adj__unit">{unit}</span>
      </div>

      {touched && delta !== 0 && !askReason && (
        <div className="stock-adj__summary">
          <span className={delta > 0 ? "stock-adj__delta stock-adj__delta--up" : "stock-adj__delta stock-adj__delta--down"}>
            {base} → {draft} ({delta > 0 ? `+${delta}` : delta})
          </span>
          <div className="stock-adj__actions">
            <button type="button" className="stock-adj__reset" onClick={reset} disabled={saving}>
              <RotateCcw size={14} /> {t("stock.reset")}
            </button>
            <button type="button" className="stock-adj__save" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={15} className="regform__spin" /> : <Check size={15} strokeWidth={3} />}
              {t("stock.save")}
            </button>
          </div>
        </div>
      )}

      {askReason && (
        <div className="stock-adj__reason">
          <p>{t("stock.whyDown", Math.abs(delta))}</p>
          <div className="stock-adj__reason-btns">
            {DECREASE_REASONS.map(({ value, labelKey }) => (
              <button key={value} type="button" onClick={() => commit(value)} disabled={saving}>
                {t(labelKey)}
              </button>
            ))}
            <button type="button" className="stock-adj__cancel" onClick={() => setAskReason(false)} disabled={saving}>
              {t("owner.dashboard.cancel")}
            </button>
          </div>
        </div>
      )}

      {touched && delta === 0 && (
        <button type="button" className="stock-adj__reset" onClick={reset}>
          <RotateCcw size={14} /> {t("stock.reset")}
        </button>
      )}

      {error && <p className="stock-adj__error" role="alert">{error}</p>}
    </div>
  );
}
