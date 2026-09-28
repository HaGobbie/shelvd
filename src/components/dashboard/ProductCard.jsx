// src/components/dashboard/ProductCard.jsx
// One product row in the owner's inventory list. Stock editing now goes
// through <StockAdjuster> (batched, with an explicit Save) instead of the old
// one-unit-at-a-time stepper.

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PackageCheck, PackageX, AlertTriangle, CheckCircle2, Clock, Pencil, Trash2, ShoppingCart } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";
import { formatLastUpdated, formatPrice } from "../../hooks/useStores";
import StockAdjuster from "./StockAdjuster";

export const STATUS_CONFIG = {
  available: { Icon: PackageCheck, color: "var(--color-available)" },
  low:       { Icon: AlertTriangle, color: "var(--color-low)" },
  out:       { Icon: PackageX,     color: "var(--color-out)" },
};

const PLURALIZABLE_UNITS = new Set(["piece", "pack", "box", "sack", "bottle"]);

export function formatStockLine(quantity, unit, language) {
  const qty = quantity ?? 0;
  const u = (unit || "piece").trim();
  if (language === "tl") return `${qty} ${u}`;
  const displayUnit = PLURALIZABLE_UNITS.has(u.toLowerCase()) && qty !== 1 ? `${u}s` : u;
  return `${qty} ${displayUnit}`;
}

/** 1-tap Available / Unavailable switch for service products (no stock count). */
function ServiceAvailabilityToggle({ product, onChange }) {
  const { t } = useLanguage();
  const [pending, setPending] = useState(false);
  const isAvailable = (product.quantity ?? 0) > 0;

  const handleToggle = async (nextAvailable) => {
    if (nextAvailable === isAvailable || pending) return;
    setPending(true);
    await onChange(product.id, nextAvailable ? 999 : 0, nextAvailable ? "restocked" : "other", nextAvailable ? null : "Marked unavailable");
    setPending(false);
  };

  return (
    <div className="svc-toggle">
      <button type="button" onClick={() => handleToggle(true)} disabled={pending} aria-pressed={isAvailable}
        className={isAvailable ? "svc-toggle__btn svc-toggle__btn--on" : "svc-toggle__btn"}>
        <PackageCheck size={14} /> {t("owner.product.markAvailable")}
      </button>
      <button type="button" onClick={() => handleToggle(false)} disabled={pending} aria-pressed={!isAvailable}
        className={!isAvailable ? "svc-toggle__btn svc-toggle__btn--off" : "svc-toggle__btn"}>
        <PackageX size={14} /> {t("owner.product.markUnavailable")}
      </button>
    </div>
  );
}

export default function ProductCard({ product, onQuantityChange, onEdit, onDelete, onSell, tourId, focusRequest }) {
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const rootRef = useRef(null);
  const cfg = STATUS_CONFIG[product.status] ?? STATUS_CONFIG.available;

  // "Restock" from the alerts panel: open this card and scroll it into view.
  useEffect(() => {
    if (focusRequest && focusRequest.id === product.id) {
      setExpanded(true);
      requestAnimationFrame(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  }, [focusRequest, product.id]);

  const handleQuantityChange = async (pid, newQuantity, transactionType, notes) => {
    const result = await onQuantityChange(pid, newQuantity, transactionType, notes);
    if (!result?.error) {
      setLocalSaved(true);
      setTimeout(() => setLocalSaved(false), 1800);
    }
    return result;
  };

  const stockLine = product.isService
    ? ((product.quantity ?? 0) > 0 ? t("owner.product.markAvailable") : t("owner.product.markUnavailable"))
    : formatStockLine(product.quantity, product.unit, language);

  return (
    <motion.div ref={rootRef} className="product-card" data-tour-id={tourId} layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.22 }}>
      <div className="product-card__header-row">
        <button className="product-card__header" style={{ flex: 1 }}
          onClick={() => setExpanded((v) => !v)} type="button" aria-expanded={expanded}>
          <div className="product-card__info">
            <span className="product-card__name">{product.name}</span>
            <span className="product-card__category">
              {product.category} · <strong style={{ color: "var(--color-text-primary)" }}>{formatPrice(product.price)}</strong>
            </span>
            <span className="product-card__stock-line">{stockLine}</span>
          </div>
          <div className="product-card__right">
            {localSaved
              ? <span className="product-card__saved"><CheckCircle2 size={14} /> {t("owner.dashboard.saved")}</span>
              : <span className="product-card__status-pill" style={{ color: cfg.color, borderColor: cfg.color }}>{t(`status.${product.status}`)}</span>}
            <span className={`product-card__chevron ${expanded ? "product-card__chevron--open" : ""}`}>▾</span>
          </div>
        </button>
        <div className="product-card__actions">
          {!product.isService && (
            <button type="button" className="product-card__action-btn product-card__action-btn--sell"
              onClick={() => onSell(product)} disabled={(product.quantity ?? 0) <= 0}
              aria-label={t("owner.sell.sellAria", product.name)}
              title={(product.quantity ?? 0) <= 0 ? t("status.out") : t("owner.sell.sellAria", product.name)}>
              <ShoppingCart size={15} strokeWidth={2} />
            </button>
          )}
          <button type="button" className="product-card__action-btn product-card__action-btn--edit"
            onClick={() => onEdit(product)} aria-label={t("owner.dashboard.editAria", product.name)} title={t("owner.dashboard.edit")}>
            <Pencil size={15} strokeWidth={2} />
          </button>
          <button type="button" className="product-card__action-btn product-card__action-btn--delete"
            onClick={() => onDelete(product)} aria-label={t("owner.dashboard.deleteAria", product.name)} title={t("owner.dashboard.delete")}>
            <Trash2 size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div className="product-card__body"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="product-card__meta">
              <div className="product-card__timestamp"><Clock size={12} />&nbsp;{formatLastUpdated(product.lastUpdated)}</div>
              {product.sku && <div className="product-card__sku">SKU: {product.sku}</div>}
              {product.description && <p className="product-card__desc">{product.description}</p>}
            </div>
            {product.isService
              ? <ServiceAvailabilityToggle product={product} onChange={handleQuantityChange} />
              : <StockAdjuster product={product} onCommit={handleQuantityChange} />}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
