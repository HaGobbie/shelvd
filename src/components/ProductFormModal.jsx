// src/components/ProductFormModal.jsx
// Framer Motion bottom-sheet modal for Adding and Editing a product.
//
// STATUS AUTOMATION: manual "Stock Status" selection is GONE. Status is
// fully derived server-side by sync_status_from_quantity() from quantity
// vs low_stock_threshold — this form never sends `status`.
//
// SMART STOCK-EDIT LOGGING: when the owner changes the Quantity field,
// this form no longer just silently updates the number:
//   - Quantity INCREASED  -> logged automatically as 'restocked', $0 earnings.
//   - Quantity DECREASED  -> a secondary prompt asks WHY (Spoiled / Personal
//     Use / Other) before saving, logged with that reason, $0 earnings.
//   - Quantity UNCHANGED  -> no ledger entry at all.
// A brand-new product (Add mode) with a nonzero starting quantity also
// gets an initial 'restocked' entry, so the ledger has a complete history
// from day one.
//
// Both the quantity change AND its ledger entry happen together inside
// record_stock_adjustment() (see 18_inventory_transactions_ledger.sql) —
// one atomic RPC call, not two separate writes. The OTHER fields (name,
// category, price, sku, description, unit, threshold) are saved via a
// separate plain .update()/.insert() call. This means there's a small
// residual gap: if the field update succeeds but the RPC call fails
// afterward, the user sees an error and can retry — the fields are
// already correctly saved, only the quantity/ledger write needs another
// attempt. That's a visible, recoverable state, not silent inconsistency,
// so it's an accepted tradeoff rather than something this pass solves.
//
// QUICK ENTRY / ADVANCED DRAWER (new): the default view now shows only
// Name, Category, Price, and Quantity-or-Availability — SKU, Unit,
// Description, and Low Stock Threshold move behind a collapsible
// "Advanced Options" drawer. Category stays in the default view (rather
// than the drawer) for two reasons: `inventory.category` is NOT NULL in
// the schema, and it's what decides whether this is a countable product
// (numeric Quantity) or a service (Available/Unavailable switch) — that
// decision has to be visible before the rest of the form makes sense.
//
// SERVICE PRODUCTS (new): selecting a service category (Water Refill,
// E-Load, LPG / Cooking Gas, Ice) swaps the numeric Quantity input for a
// binary Available/Unavailable switch. On submit this maps straight to
// quantity 999 (Available) / 0 (Unavailable) — see is_service in
// sql/021_frictionless_registration_and_services.sql for why no new
// status logic was needed for this. Toggling a service's availability
// also skips the "why did stock go down" reason prompt entirely — there's
// no spoilage/personal-use concept for a service going unavailable, so
// asking would just be friction with no useful answer.
//
// NOTE ON CATEGORIES: dropdown VALUES stay in English regardless of UI
// language — stored as-is in the DB and shown on the public map.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  PackageCheck,
  AlertTriangle,
  PackageX,
  Save,
  Plus,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Camera,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import { recordStockAdjustment } from "../hooks/useStores";
import { useLanguage } from "../i18n/LanguageContext";
import { scanProductImage } from "../services/geminiScanner";
import { CATEGORIES, SERVICE_CATEGORIES } from "../constants/productCategories";

// Re-exported for back-compat with anything importing these from this
// file directly (e.g. StoreDetails.jsx before this refactor) — the real
// definitions now live in constants/productCategories.js, see that
// file's header for why.
export { CATEGORIES, SERVICE_CATEGORIES };
export { SERVICE_CATEGORY_EMOJI } from "../constants/productCategories";

const STATUS_CONFIG = {
  available: { Icon: PackageCheck, color: "var(--color-available)", bg: "var(--color-available-bg)", border: "var(--color-available-border)" },
  low:       { Icon: AlertTriangle, color: "var(--color-low)", bg: "var(--color-low-bg)", border: "var(--color-low-border)" },
  out:       { Icon: PackageX, color: "var(--color-out)", bg: "var(--color-out-bg)", border: "var(--color-out-border)" },
};

const DECREASE_REASONS = [
  { value: "spoiled", labelKey: "transactionType.spoiled" },
  { value: "personal_use", labelKey: "transactionType.personal_use" },
  { value: "other", labelKey: "transactionType.other" },
];

function computeStatus(quantity, lowStockThreshold) {
  if (quantity <= 0) return "out";
  if (quantity <= lowStockThreshold) return "low";
  return "available";
}

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.16 } },
};

const sheetVariants = {
  hidden:  { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", damping: 28, stiffness: 320, mass: 0.9 } },
  exit:    { y: "100%", opacity: 0, transition: { type: "tween", ease: "easeIn", duration: 0.2 } },
};

export default function ProductFormModal({ isOpen, onClose, storeId, initialData = null }) {
  const { t } = useLanguage();
  const isEditMode = Boolean(initialData);

  const [name, setName]           = useState("");
  const [category, setCategory]   = useState(CATEGORIES[0]);
  const [price, setPrice]         = useState("");
  const [quantity, setQuantity]   = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [description, setDescription] = useState("");
  const [unit, setUnit]           = useState("piece");
  const [sku, setSku]             = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const nameInputRef              = useRef(null);
  const priceInputRef             = useRef(null);
  const scanFileInputRef          = useRef(null);
  const [scanning, setScanning]   = useState(false);
  const [scanError, setScanError] = useState("");

  const [showReasonPrompt, setShowReasonPrompt] = useState(false);
  const [decreaseReason, setDecreaseReason] = useState("spoiled");
  const [decreaseNotes, setDecreaseNotes] = useState("");
  const pendingSaveRef = useRef(null);

  // Advanced Options drawer — collapsed by default so a first-time
  // merchant only sees Name / Category / Price / Quantity up front.
  const [showAdvanced, setShowAdvanced] = useState(false);

  const finalCategoryPreview = category === "Other" ? customCategory.trim() : category;
  const isService = SERVICE_CATEGORIES.includes(finalCategoryPreview);

  useEffect(() => {
    if (isOpen) {
      if (isEditMode && initialData) {
        setName(initialData.name ?? "");
        setPrice(initialData.price !== null && initialData.price !== undefined ? String(initialData.price) : "");
        setQuantity(initialData.quantity !== null && initialData.quantity !== undefined ? String(initialData.quantity) : "0");
        setLowStockThreshold(initialData.lowStockThreshold !== null && initialData.lowStockThreshold !== undefined ? String(initialData.lowStockThreshold) : "5");
        setDescription(initialData.description ?? "");
        setUnit(initialData.unit ?? "piece");
        setSku(initialData.sku ?? "");
        const match = CATEGORIES.includes(initialData.category);
        setCategory(match ? initialData.category : "Other");
        setCustomCategory(match ? "" : (initialData.category ?? ""));
      } else {
        setName(""); setCategory(CATEGORIES[0]); setPrice("");
        setQuantity("0"); setLowStockThreshold("5"); setCustomCategory("");
        setDescription(""); setUnit("piece"); setSku("");
      }
      setError("");
      setScanError("");
      setScanning(false);
      setShowReasonPrompt(false);
      setDecreaseReason("spoiled");
      setDecreaseNotes("");
      // Auto-open the drawer in Edit mode when any advanced field is
      // already filled in, so an owner editing an existing product with
      // a description/SKU doesn't have to go hunting for the toggle to
      // see what they already saved.
      setShowAdvanced(
        isEditMode && Boolean(initialData?.sku || initialData?.description || (initialData?.unit && initialData.unit !== "piece"))
      );
      setTimeout(() => nameInputRef.current?.focus(), 320);
    }
  }, [isOpen, isEditMode, initialData]);

  // Whenever the category flips into "service" territory, normalize
  // whatever numeric quantity was sitting there into service space
  // (0 or 999) so the Available/Unavailable switch below has a sane
  // starting position instead of showing garbage like "12".
  useEffect(() => {
    if (isService) {
      setQuantity((prev) => (Number(prev) > 0 ? "999" : "0"));
    }
  }, [isService]);

  /**
   * handleScanFile — "AI Snap & Fill". Sends a photo to the
   * scan-product-image Edge Function (see that file + geminiScanner.js
   * for why the Gemini key never touches this component) and, on
   * success, fills in Name / Category / Unit / Price. If the scan
   * couldn't find a price on the packaging, focus jumps to the Price
   * field so the merchant can type it and immediately hit Save — the
   * whole point is cutting the data entry down to "type one number."
   * The scan only ever populates form state; nothing is saved until the
   * merchant reviews it and taps Save themselves.
   */
  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    setScanning(true);
    setScanError("");
    try {
      const result = await scanProductImage(file);
      if (result.name) setName(result.name);
      setCategory(result.category);
      if (result.category === "Other") setCustomCategory(result.customCategory);
      setUnit(result.unit);
      if (result.estimatedPrice !== null) {
        setPrice(String(result.estimatedPrice));
      } else {
        setTimeout(() => priceInputRef.current?.focus(), 50);
      }
      // Service/quantity normalization is handled by the isService
      // effect above once `category` updates.
    } catch (err) {
      console.error("AI Snap & Fill failed:", err);
      setScanError(err.message || t("owner.product.aiScanError"));
    } finally {
      setScanning(false);
    }
  };

  const previewStatus = useMemo(() => {
    const qtyNum = Number(quantity);
    const thresholdNum = Number(lowStockThreshold);
    const safeQty = Number.isFinite(qtyNum) && qtyNum >= 0 ? qtyNum : 0;
    const safeThreshold = Number.isFinite(thresholdNum) && thresholdNum >= 0 ? thresholdNum : 5;
    return computeStatus(safeQty, safeThreshold);
  }, [quantity, lowStockThreshold]);

  const previewCfg = STATUS_CONFIG[previewStatus];

  const validate = () => {
    if (!name.trim()) return t("owner.product.requiredName");
    if (name.trim().length > 80) return t("owner.product.nameTooLong");
    if (category === "Other" && !customCategory.trim()) return t("owner.product.customCategoryRequired");
    if (price.trim() === "") return t("owner.product.priceRequired");
    const priceNum = Number(price);
    if (Number.isNaN(priceNum)) return t("owner.product.priceInvalid");
    if (priceNum < 0) return t("owner.product.priceNegative");
    return null;
  };

  const performSave = async (fields, finalQuantity, adjustment) => {
    setSaving(true);
    setError("");

    try {
      let productId = initialData?.id;

      if (isEditMode) {
        const { error: updateError } = await supabase.from("inventory").update({
          ...fields,
          quantity: finalQuantity,
        }).eq("id", productId);
        if (updateError) throw updateError;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("inventory")
          .insert({ store_id: storeId, ...fields, quantity: finalQuantity })
          .select("id")
          .single();
        if (insertError) throw insertError;
        productId = inserted.id;
      }

      if (adjustment) {
        const { error: adjustError } = await recordStockAdjustment(
          productId,
          finalQuantity,
          adjustment.transactionType,
          adjustment.notes
        );
        if (adjustError) throw adjustError;
      }

      onClose();
    } catch (err) {
      console.error("Supabase write failed:", err);
      if (err?.message?.includes("inventory_store_sku_uidx")) {
        setError(t("owner.product.skuDuplicate"));
      } else {
        setError(err?.message || t("owner.product.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    const finalCategory = category === "Other" ? customCategory.trim() : category;
    const finalPrice = Number(price);
    const finalSku = sku.trim() || null;
    const finalDescription = description.trim() || null;
    const finalUnit = unit.trim() || "piece";
    const qtyNum = Number(quantity);
    const thresholdNum = Number(lowStockThreshold);
    const finalQuantity = Number.isFinite(qtyNum) && qtyNum >= 0 ? Math.floor(qtyNum) : 0;
    const finalLowStockThreshold = Number.isFinite(thresholdNum) && thresholdNum >= 0 ? Math.floor(thresholdNum) : 5;

    const fields = {
      name: name.trim(),
      category: finalCategory,
      price: finalPrice,
      low_stock_threshold: finalLowStockThreshold,
      sku: finalSku,
      description: finalDescription,
      unit: finalUnit,
    };

    const originalQuantity = isEditMode ? (initialData.quantity ?? 0) : 0;

    // Services skip the "why did stock go down" prompt entirely — a
    // service going from Available to Unavailable isn't spoilage or
    // personal use, so asking would just be friction with no useful
    // answer. Still logs through recordStockAdjustment() so the ledger
    // and status derivation stay consistent — it just picks the
    // transaction type automatically instead of asking.
    if (isService) {
      if (finalQuantity === originalQuantity) {
        await performSave(fields, finalQuantity, null);
      } else if (finalQuantity > originalQuantity) {
        await performSave(fields, finalQuantity, { transactionType: "restocked", notes: null });
      } else {
        await performSave(fields, finalQuantity, { transactionType: "other", notes: "Marked unavailable" });
      }
      return;
    }

    if (finalQuantity < originalQuantity) {
      pendingSaveRef.current = { fields, finalQuantity };
      setShowReasonPrompt(true);
      return;
    }

    if (finalQuantity > originalQuantity) {
      await performSave(fields, finalQuantity, { transactionType: "restocked", notes: null });
      return;
    }

    await performSave(fields, finalQuantity, null);
  };

  const handleConfirmDecreaseReason = async () => {
    if (!pendingSaveRef.current) return;
    const { fields, finalQuantity } = pendingSaveRef.current;
    const notes = decreaseReason === "other" ? (decreaseNotes.trim() || null) : null;
    setShowReasonPrompt(false);
    await performSave(fields, finalQuantity, { transactionType: decreaseReason, notes });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div className="sheet-overlay" style={{ zIndex: 1000 }}
            variants={overlayVariants} initial="hidden" animate="visible" exit="exit"
            onClick={onClose} aria-hidden="true" />

          <motion.div className="sheet-panel" style={{ zIndex: 1001, maxHeight: "92dvh" }}
            variants={sheetVariants} initial="hidden" animate="visible" exit="exit"
            drag={showReasonPrompt ? false : "y"} dragConstraints={{ top: 0 }} dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => { if (info.offset.y > 100) onClose(); }}
            role="dialog" aria-modal="true"
            aria-label={isEditMode ? t("owner.product.editTitle") : t("owner.product.addTitle")}>

            <div className="sheet-handle" aria-hidden="true" />

            {showReasonPrompt ? (
              <div className="sheet-inventory" style={{ padding: "16px 20px 32px" }}>
                <div className="sheet-header" style={{ padding: 0, marginBottom: 16 }}>
                  <button
                    type="button"
                    onClick={() => setShowReasonPrompt(false)}
                    aria-label={t("owner.product.decreaseReasonBack")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)" }}
                  >
                    <ArrowLeft size={20} />
                  </button>
                </div>

                <h2 className="sheet-header__name" style={{ marginBottom: 4 }}>{t("owner.product.decreaseReasonTitle")}</h2>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
                  {t("owner.product.decreaseReasonDesc", initialData?.quantity ?? 0, pendingSaveRef.current?.finalQuantity ?? 0)}
                </p>

                <div className="status-radio-group" role="radiogroup" style={{ marginBottom: 16 }}>
                  {DECREASE_REASONS.map(({ value, labelKey }) => {
                    const selected = decreaseReason === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`status-radio-tile ${selected ? "status-radio-tile--active" : ""}`}
                        onClick={() => setDecreaseReason(value)}
                      >
                        <span>{t(labelKey)}</span>
                      </button>
                    );
                  })}
                </div>

                {decreaseReason === "other" && (
                  <div className="pform__field">
                    <label className="pform__label" htmlFor="decrease-notes">{t("owner.product.noteOptional")}</label>
                    <textarea
                      id="decrease-notes"
                      className="pform__input"
                      style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                      placeholder={t("owner.product.whatHappenedPlaceholder")}
                      value={decreaseNotes}
                      onChange={(e) => setDecreaseNotes(e.target.value)}
                      maxLength={300}
                    />
                  </div>
                )}

                {error && <p className="pform__error">⚠️ {error}</p>}

                <button
                  type="button"
                  className="pform__submit"
                  onClick={handleConfirmDecreaseReason}
                  disabled={saving}
                  style={{ marginTop: 8 }}
                >
                  {saving ? (
                    <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                  ) : (
                    <>{t("owner.product.confirmAndSave")}</>
                  )}
                </button>
              </div>
            ) : (
              <>
                <div className="sheet-header">
                  <div className="sheet-header__info">
                    <h2 className="sheet-header__name">
                      {isEditMode ? t("owner.product.editTitle") : t("owner.product.addTitle")}
                    </h2>
                    <span className="sheet-header__type">
                      {isEditMode ? t("owner.product.editSubtitle") : t("owner.product.addSubtitle")}
                    </span>
                  </div>
                  <button className="sheet-close-btn" onClick={onClose} aria-label={t("owner.product.close")} type="button">
                    <X size={20} strokeWidth={2} />
                  </button>
                </div>

                <div className="sheet-inventory" style={{ padding: "16px 20px 32px" }}>
                  <form onSubmit={handleSubmit} noValidate>

                    {/* AI Snap & Fill — populates Name/Category/Unit/Price
                        from a photo; the merchant still reviews and taps
                        Save themselves, nothing here saves automatically. */}
                    <input
                      ref={scanFileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: "none" }}
                      onChange={handleScanFile}
                    />
                    <button
                      type="button"
                      onClick={() => scanFileInputRef.current?.click()}
                      disabled={scanning}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", minHeight: 46, marginBottom: 16,
                        borderRadius: "var(--radius-md, 10px)", border: "1.5px dashed var(--color-brand-primary)",
                        background: "var(--color-brand-primary-bg, transparent)", color: "var(--color-brand-primary)",
                        fontWeight: 700, fontSize: 14, cursor: scanning ? "default" : "pointer",
                        opacity: scanning ? 0.7 : 1,
                      }}
                    >
                      {scanning
                        ? <><span className="map-loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t("owner.product.aiScanning")}</>
                        : <><Camera size={18} strokeWidth={2} /> {t("owner.product.aiScanButton")}</>}
                    </button>
                    {scanError && (
                      <p className="pform__error" style={{ marginTop: -8, marginBottom: 14 }}>
                        ⚠️ {scanError}
                      </p>
                    )}

                    <div className="pform__field">
                      <label className="pform__label" htmlFor="pform-name">
                        {t("owner.product.nameLabel")} <span className="pform__required">*</span>
                      </label>
                      <input ref={nameInputRef} id="pform-name" className="pform__input" type="text"
                        placeholder={t("owner.product.namePlaceholder")} value={name}
                        onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
                      <span className="pform__char-count">{name.length}/80</span>
                    </div>

                    <div className="pform__field">
                      <label className="pform__label" htmlFor="pform-category">
                        {t("owner.product.categoryLabel")} <span className="pform__required">*</span>
                      </label>
                      <select id="pform-category" className="pform__select" value={category}
                        onChange={(e) => setCategory(e.target.value)}>
                        {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                      <AnimatePresence>
                        {category === "Other" && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} style={{ overflow: "hidden" }}>
                            <input className="pform__input" style={{ marginTop: 8 }} type="text"
                              placeholder={t("owner.product.customCategoryPlaceholder")} value={customCategory}
                              onChange={(e) => setCustomCategory(e.target.value)} maxLength={40} autoComplete="off" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="pform__field">
                      <label className="pform__label" htmlFor="pform-price">
                        {t("owner.product.priceLabel")} <span className="pform__required">*</span>
                      </label>
                      <input ref={priceInputRef} id="pform-price" className="pform__input" type="number" inputMode="decimal"
                        min="0" step="0.01" placeholder="0.00" value={price}
                        onChange={(e) => setPrice(e.target.value)} />
                    </div>

                    {isService ? (
                      <div className="pform__field">
                        <label className="pform__label">{t("owner.product.availabilityLabel")}</label>
                        <div role="group" aria-label={t("owner.product.availabilityLabel")}
                          style={{ display: "flex", borderRadius: "var(--radius-pill, 999px)", overflow: "hidden", border: "1.5px solid var(--color-border)" }}>
                          <button
                            type="button"
                            onClick={() => setQuantity("999")}
                            aria-pressed={Number(quantity) > 0}
                            style={{
                              flex: 1, minHeight: 44, border: "none", cursor: "pointer",
                              fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center",
                              justifyContent: "center", gap: 6,
                              background: Number(quantity) > 0 ? "var(--color-available)" : "var(--color-surface)",
                              color: Number(quantity) > 0 ? "#fff" : "var(--color-text-secondary)",
                            }}
                          >
                            <PackageCheck size={16} /> {t("owner.product.markAvailable")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuantity("0")}
                            aria-pressed={Number(quantity) <= 0}
                            style={{
                              flex: 1, minHeight: 44, border: "none", cursor: "pointer",
                              fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center",
                              justifyContent: "center", gap: 6,
                              background: Number(quantity) <= 0 ? "var(--color-out)" : "var(--color-surface)",
                              color: Number(quantity) <= 0 ? "#fff" : "var(--color-text-secondary)",
                            }}
                          >
                            <PackageX size={16} /> {t("owner.product.markUnavailable")}
                          </button>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>
                          {t("owner.product.serviceHint")}
                        </p>
                      </div>
                    ) : (
                      <div className="pform__field">
                        <label className="pform__label" htmlFor="pform-quantity">{t("owner.product.quantityLabel")}</label>
                        <input id="pform-quantity" className="pform__input" type="number" inputMode="numeric"
                          min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                      </div>
                    )}

                    {/* Advanced Options drawer — SKU, Unit, Description,
                        and (for countable products) Low Stock Threshold
                        all live here, collapsed by default. See file
                        header for why Category/Price/Quantity stay
                        outside it. */}
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      aria-expanded={showAdvanced}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, width: "100%",
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--color-brand-primary)", fontWeight: 700, fontSize: 13,
                        padding: "8px 0", margin: "4px 0 8px",
                      }}
                    >
                      {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {showAdvanced ? t("owner.product.advancedHide") : t("owner.product.advancedShow")}
                    </button>

                    <AnimatePresence initial={false}>
                      {showAdvanced && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          style={{ overflow: "hidden" }}
                        >
                          <div className="pform__field">
                            <label className="pform__label" htmlFor="pform-sku">{t("owner.product.skuLabel")}</label>
                            <input id="pform-sku" className="pform__input" type="text"
                              placeholder={t("owner.product.skuPlaceholder")} value={sku}
                              onChange={(e) => setSku(e.target.value)} maxLength={64} />
                          </div>

                          <div className="pform__field">
                            <label className="pform__label" htmlFor="pform-unit">{t("owner.product.unitLabel")}</label>
                            <input id="pform-unit" className="pform__input" type="text" list="pform-unit-options"
                              placeholder="piece" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
                            <datalist id="pform-unit-options">
                              <option value="piece" /><option value="pack" /><option value="kg" />
                              <option value="g" /><option value="liter" /><option value="ml" />
                              <option value="box" /><option value="sack" /><option value="bottle" />
                            </datalist>
                          </div>

                          <div className="pform__field">
                            <label className="pform__label" htmlFor="pform-description">{t("owner.product.descriptionLabel")}</label>
                            <textarea id="pform-description" className="pform__input"
                              style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit" }}
                              placeholder={t("owner.product.descriptionPlaceholder")} value={description}
                              onChange={(e) => setDescription(e.target.value)} maxLength={500} />
                            <span className="pform__char-count">{description.length}/500</span>
                          </div>

                          {!isService && (
                            <div className="pform__field">
                              <label className="pform__label" htmlFor="pform-threshold">{t("owner.product.thresholdLabel")}</label>
                              <input id="pform-threshold" className="pform__input" type="number" inputMode="numeric"
                                min="0" step="1" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} />
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {!isService && (
                      <div className="pform__field">
                        <label className="pform__label">{t("owner.product.resultingStatusLabel")}</label>
                        <div style={{
                          display: "inline-flex", alignItems: "center", gap: 8,
                          padding: "8px 16px", borderRadius: "var(--radius-pill, 999px)",
                          background: previewCfg.bg, border: `1.5px solid ${previewCfg.border}`,
                          color: previewCfg.color, fontWeight: 700, fontSize: 14,
                        }}>
                          <previewCfg.Icon size={18} strokeWidth={2.2} />
                          {t(`status.${previewStatus}`)}
                        </div>
                        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>
                          {t("owner.product.resultingStatusHint")}
                        </p>
                      </div>
                    )}

                    {!isService && isEditMode && Number(quantity) < (initialData?.quantity ?? 0) && (
                      <p style={{ fontSize: 12, color: "var(--color-low)", marginTop: -8, marginBottom: 12 }}>
                        <AlertTriangle size={12} style={{ display: "inline", marginRight: 4 }} />
                        {t("owner.product.decreaseWillAsk")}
                      </p>
                    )}

                    {error && (
                      <motion.p className="pform__error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                        ⚠️ {error}
                      </motion.p>
                    )}

                    <button type="submit" className="pform__submit" disabled={saving}>
                      {saving ? (
                        <>
                          <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                          {t("owner.product.saving")}
                        </>
                      ) : isEditMode ? (
                        <><Save size={18} /> {t("owner.product.saveChanges")}</>
                      ) : (
                        <><Plus size={18} /> {t("owner.product.addProduct")}</>
                      )}
                    </button>

                  </form>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}


