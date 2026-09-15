// src/components/SellModal.jsx
// Quick "Sell" action — a lightweight centered dialog (not a full bottom
// sheet, since this is a single-field quick action), matching
// ConfirmDeleteModal.jsx's visual language.
//
// REVIVED: this component was built, then superseded mid-migration by
// NewTransactionModal.jsx's multi-item cart flow — but never deleted or
// wired back in, and never translated. Bringing it back deliberately,
// because the two flows solve different problems:
//   - NewTransactionModal: a customer bought several different things —
//     open a sheet, pick each product, add to cart, submit together.
//   - SellModal (this file): a customer bought ONE thing, which is the
//     overwhelmingly common case at a sari-sari store. One tap on the
//     product card, one number, one confirm.
// Without this, the only correct way to log ANY sale was the heavier
// multi-item sheet — meanwhile the fastest, most obvious interaction on
// a product card (the quantity stepper's "−" button) can only log
// Spoiled / Personal Use / Other, with no "Sold" option at all. That
// meant a real sale recorded via the fast path silently produced $0
// logged earnings — actively undermining the Daily Cash-Out card, which
// only counts transactions where transactionType === "sold". This modal
// is the fix: the fast path and the correct path are now the same path.
//
// Calls recordSale() (useStores.js), which wraps the inventory decrement
// + transaction log insert in one atomic Postgres RPC — see
// 18_inventory_transactions_ledger.sql for why this isn't two separate
// client calls. record_sale() logs transaction_type = 'sold' with real
// earnings, which is exactly what Daily Cash-Out / Monthly Revenue read.
//
// NOT rendered for service products (is_service) — "how many did you
// sell" doesn't mean anything for a binary Available/Unavailable
// service; those use ServiceAvailabilityToggle instead. Enforced by the
// caller (OwnerDashboard.jsx) not offering the Sell button for services
// in the first place, but this file only ever deals in countable
// products regardless.

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShoppingCart, AlertTriangle } from "lucide-react";
import { recordSale, formatPrice } from "../hooks/useStores";
import { useLanguage } from "../i18n/LanguageContext";

const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.14 } },
};

const dialogVariants = {
  hidden:  { scale: 0.88, opacity: 0, y: 16 },
  visible: { scale: 1, opacity: 1, y: 0, transition: { type: "spring", damping: 22, stiffness: 340 } },
  exit:    { scale: 0.92, opacity: 0, y: 8, transition: { type: "tween", ease: "easeIn", duration: 0.16 } },
};

/**
 * @param {{
 *   isOpen: boolean,
 *   onClose: Function,
 *   product: { id: string, name: string, price: number, quantity: number, unit: string }|null,
 *   onSold?: Function
 * }} props
 */
export default function SellModal({ isOpen, onClose, product, onSold }) {
  const { t } = useLanguage();
  const [quantitySold, setQuantitySold] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setQuantitySold("1");
      setError("");
    }
  }, [isOpen, product]);

  if (!product) return null;

  const qtyNum = Number(quantitySold);
  const isValidQty = Number.isFinite(qtyNum) && qtyNum > 0 && Number.isInteger(qtyNum);
  const exceedsStock = isValidQty && qtyNum > product.quantity;
  const previewEarnings = isValidQty ? qtyNum * product.price : 0;

  const handleConfirm = async () => {
    if (!isValidQty || exceedsStock) return;
    setSaving(true);
    setError("");

    const { data, error: saleError } = await recordSale(product.id, qtyNum);

    if (saleError) {
      console.error("Sale failed:", saleError);
      setError(saleError.message || t("owner.sell.saveFailed"));
      setSaving(false);
      return;
    }

    setSaving(false);
    onSold?.(data?.[0]);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="sheet-overlay"
            style={{ zIndex: 1100 }}
            variants={overlayVariants}
            initial="hidden" animate="visible" exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            className="confirm-dialog"
            variants={dialogVariants}
            initial="hidden" animate="visible" exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label={t("owner.sell.dialogAria", product.name)}
          >
            <div className="confirm-dialog__icon-wrap">
              <ShoppingCart size={28} className="confirm-dialog__icon" />
            </div>

            <h3 className="confirm-dialog__title">{t("owner.sell.title", product.name)}</h3>
            <p className="confirm-dialog__desc">
              {t("owner.sell.inStock", product.quantity, product.unit || "piece")}
            </p>

            <div className="pform__field" style={{ marginTop: 16, textAlign: "left" }}>
              <label className="pform__label" htmlFor="sell-quantity">{t("owner.sell.quantityLabel")}</label>
              <input
                id="sell-quantity"
                className="pform__input"
                type="number"
                inputMode="numeric"
                min="1"
                max={product.quantity}
                step="1"
                value={quantitySold}
                onChange={(e) => setQuantitySold(e.target.value)}
                autoFocus
              />
            </div>

            <div
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginTop: 12, padding: "10px 14px", borderRadius: 10,
                background: "var(--color-available-bg)", color: "var(--color-available)",
                fontWeight: 700, fontSize: 15,
              }}
            >
              <span>{t("owner.sell.earnings")}</span>
              <span>{formatPrice(previewEarnings)}</span>
            </div>

            {exceedsStock && (
              <p className="confirm-dialog__error">
                <AlertTriangle size={14} style={{ display: "inline", marginRight: 4 }} />
                {t("owner.sell.exceedsStock", product.quantity, qtyNum)}
              </p>
            )}
            {error && <p className="confirm-dialog__error">⚠️ {error}</p>}

            <div className="confirm-dialog__actions">
              <button type="button" className="confirm-dialog__cancel" onClick={onClose} disabled={saving}>
                <X size={16} /> {t("owner.sell.cancel")}
              </button>
              <button
                type="button"
                className="confirm-dialog__delete"
                style={{ background: "var(--color-available)" }}
                onClick={handleConfirm}
                disabled={saving || !isValidQty || exceedsStock}
              >
                {saving ? (
                  <span className="map-loading-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: "#fff" }} />
                ) : (
                  <><ShoppingCart size={16} /> {t("owner.sell.confirm")}</>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}


