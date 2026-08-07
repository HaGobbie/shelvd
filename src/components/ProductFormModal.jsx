// src/components/ProductFormModal.jsx
// Framer Motion bottom-sheet modal for Adding and Editing a product.
// Used by OwnerDashboard — receives an `initialData` prop that is null
// when adding a new product, or a product object when editing.
//
// Supabase operations:
//   ADD  → supabase.from('inventory').insert({ store_id, name, category, price, status })
//   EDIT → supabase.from('inventory').update({ name, category, price, status }).eq('id', productId)
//
// Note: we don't send last_updated manually — the `inventory_touch_last_updated`
// trigger (see 02_functions_and_triggers.sql) bumps it automatically on update,
// and it defaults to now() on insert.
//
// NOTE ON CATEGORIES: the dropdown VALUES stay in English regardless of
// the current UI language — they're stored as-is in the database and
// shown on the public map, so translating only the surrounding labels
// (not the stored value) avoids a mismatch between what's picked and
// what's actually saved.

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  PackageCheck,
  AlertTriangle,
  PackageX,
  Save,
  Plus,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import { useLanguage } from "../i18n/LanguageContext";

// ─── Predefined categories matching your capstone domain ─────────────────────
const CATEGORIES = [
  "Pantry",
  "Grains",
  "Canned Goods",
  "Beverages",
  "Condiments",
  "Dairy & Eggs",
  "Household",
  "Personal Care",
  "Snacks",
  "Frozen Goods",
  "Other",
];

// Colors reference CSS custom properties rather than literal hex — see
// root-tokens-patch.css / COLOR_DECOUPLING_PATCHES.txt from the rebrand
// pass. Labels come from the current language's `status.*` dictionary
// entries (shared with the public-facing status badges) rather than
// being hardcoded here, so there's one source of truth for these three
// words across the whole app.
const STATUS_OPTIONS = [
  {
    value: "available",
    Icon: PackageCheck,
    color: "var(--color-available)",
    bg: "var(--color-available-bg)",
    border: "var(--color-available-border)",
  },
  {
    value: "low",
    Icon: AlertTriangle,
    color: "var(--color-low)",
    bg: "var(--color-low-bg)",
    border: "var(--color-low-border)",
  },
  {
    value: "out",
    Icon: PackageX,
    color: "var(--color-out)",
    bg: "var(--color-out-bg)",
    border: "var(--color-out-border)",
  },
];

// ─── Animation variants ───────────────────────────────────────────────────────
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.16 } },
};

const sheetVariants = {
  hidden:  { y: "100%", opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", damping: 28, stiffness: 320, mass: 0.9 },
  },
  exit: {
    y: "100%",
    opacity: 0,
    transition: { type: "tween", ease: "easeIn", duration: 0.2 },
  },
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProductFormModalProps
 * @property {boolean}       isOpen
 * @property {Function}      onClose
 * @property {string}        storeId      — the store this product belongs to
 * @property {Object|null}   initialData  — null = Add mode, object = Edit mode
 */

/**
 * ProductFormModal
 * Single component that handles both Add and Edit flows.
 * The title and submit button label change based on whether initialData is provided.
 *
 * @param {ProductFormModalProps} props
 */
export default function ProductFormModal({
  isOpen,
  onClose,
  storeId,
  initialData = null,
}) {
  const { t } = useLanguage();
  const isEditMode = Boolean(initialData);

  // ─── Form state ────────────────────────────────────────────────────────────
  const [name, setName]           = useState("");
  const [category, setCategory]   = useState(CATEGORIES[0]);
  const [price, setPrice]         = useState("");
  const [status, setStatus]       = useState("available");
  const [description, setDescription] = useState("");
  const [unit, setUnit]           = useState("piece");
  const [sku, setSku]             = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const nameInputRef              = useRef(null);

  // Populate form when editing or reset when adding
  useEffect(() => {
    if (isOpen) {
      if (isEditMode && initialData) {
        setName(initialData.name ?? "");
        setStatus(initialData.status ?? "available");
        setPrice(
          initialData.price !== null && initialData.price !== undefined
            ? String(initialData.price)
            : ""
        );
        // Graceful degradation: null/undefined sku or description just
        // become an empty string in the input, not "null" text.
        setDescription(initialData.description ?? "");
        setUnit(initialData.unit ?? "piece");
        setSku(initialData.sku ?? "");
        // If the stored category matches a preset, select it; otherwise use "Other"
        const match = CATEGORIES.includes(initialData.category);
        setCategory(match ? initialData.category : "Other");
        setCustomCategory(match ? "" : (initialData.category ?? ""));
      } else {
        setName("");
        setCategory(CATEGORIES[0]);
        setPrice("");
        setStatus("available");
        setCustomCategory("");
        setDescription("");
        setUnit("piece");
        setSku("");
      }
      setError("");
      // Auto-focus the name field after the animation settles
      setTimeout(() => nameInputRef.current?.focus(), 320);
    }
  }, [isOpen, isEditMode, initialData]);

  // ─── Validation ────────────────────────────────────────────────────────────
  const validate = () => {
    if (!name.trim()) return t("owner.product.requiredName");
    if (name.trim().length > 80) return t("owner.product.nameTooLong");
    if (category === "Other" && !customCategory.trim())
      return t("owner.product.customCategoryRequired");
    if (price.trim() === "") return t("owner.product.priceRequired");
    const priceNum = Number(price);
    if (Number.isNaN(priceNum)) return t("owner.product.priceInvalid");
    if (priceNum < 0) return t("owner.product.priceNegative");
    return null;
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError("");

    const finalCategory =
      category === "Other" ? customCategory.trim() : category;
    const finalPrice = Number(price);
    // Optional fields: empty string -> null/default rather than storing
    // an empty string, so "no SKU" reads as genuinely absent, not as a
    // blank-but-present value.
    const finalSku = sku.trim() || null;
    const finalDescription = description.trim() || null;
    const finalUnit = unit.trim() || "piece";

    try {
      if (isEditMode) {
        // EDIT: update the existing row (last_updated bumped by trigger)
        const { error: updateError } = await supabase
          .from("inventory")
          .update({
            name: name.trim(),
            category: finalCategory,
            price: finalPrice,
            status,
            sku: finalSku,
            description: finalDescription,
            unit: finalUnit,
          })
          .eq("id", initialData.id);

        if (updateError) throw updateError;
      } else {
        // ADD: insert a new row (id + last_updated default automatically)
        const { error: insertError } = await supabase.from("inventory").insert({
          store_id: storeId,
          name: name.trim(),
          category: finalCategory,
          price: finalPrice,
          status,
          sku: finalSku,
          description: finalDescription,
          unit: finalUnit,
        });

        if (insertError) throw insertError;
      }
      onClose();
    } catch (err) {
      console.error("Supabase write failed:", err);
      // The partial unique index on (store_id, sku) throws a specific,
      // recognizable Postgres error — worth a clearer message than the
      // generic fallback, since "duplicate key" would otherwise look
      // like an unexplained failure to the store owner.
      if (err?.message?.includes("inventory_store_sku_uidx")) {
        setError(t("owner.product.skuDuplicate"));
      } else {
        setError(t("owner.product.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Dimmed backdrop */}
          <motion.div
            className="sheet-overlay"
            style={{ zIndex: 1000 }}
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet panel */}
          <motion.div
            className="sheet-panel"
            style={{ zIndex: 1001, maxHeight: "92dvh" }}
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => { if (info.offset.y > 100) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-label={isEditMode ? t("owner.product.editTitle") : t("owner.product.addTitle")}
          >
            {/* Drag handle */}
            <div className="sheet-handle" aria-hidden="true" />

            {/* Header */}
            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">
                  {isEditMode ? t("owner.product.editTitle") : t("owner.product.addTitle")}
                </h2>
                <span className="sheet-header__type">
                  {isEditMode
                    ? t("owner.product.editSubtitle")
                    : t("owner.product.addSubtitle")}
                </span>
              </div>
              <button
                className="sheet-close-btn"
                onClick={onClose}
                aria-label={t("owner.product.close")}
                type="button"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            {/* Form body */}
            <div className="sheet-inventory" style={{ padding: "16px 20px 32px" }}>
              <form onSubmit={handleSubmit} noValidate>

                {/* ── Product Name ── */}
                <div className="pform__field">
                  <label className="pform__label" htmlFor="pform-name">
                    {t("owner.product.nameLabel")} <span className="pform__required">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    id="pform-name"
                    className="pform__input"
                    type="text"
                    placeholder={t("owner.product.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    autoComplete="off"
                  />
                  <span className="pform__char-count">{name.length}/80</span>
                </div>

                {/* ── Category ── */}
                <div className="pform__field">
                  <label className="pform__label" htmlFor="pform-category">
                    {t("owner.product.categoryLabel")} <span className="pform__required">*</span>
                  </label>
                  <select
                    id="pform-category"
                    className="pform__select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  {/* Custom category input shown only when "Other" is selected */}
                  <AnimatePresence>
                    {category === "Other" && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        style={{ overflow: "hidden" }}
                      >
                        <input
                          className="pform__input"
                          style={{ marginTop: 8 }}
                          type="text"
                          placeholder={t("owner.product.customCategoryPlaceholder")}
                          value={customCategory}
                          onChange={(e) => setCustomCategory(e.target.value)}
                          maxLength={40}
                          autoComplete="off"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── Price ── */}
                <div className="pform__field">
                  <label className="pform__label" htmlFor="pform-price">
                    {t("owner.product.priceLabel")} <span className="pform__required">*</span>
                  </label>
                  <input
                    id="pform-price"
                    className="pform__input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>

                {/* ── Unit (optional) ── */}
                <div className="pform__field">
                  <label className="pform__label" htmlFor="pform-unit">
                    {t("owner.product.unitLabel")}
                  </label>
                  <input
                    id="pform-unit"
                    className="pform__input"
                    type="text"
                    list="pform-unit-options"
                    placeholder="piece"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={20}
                  />
                  <datalist id="pform-unit-options">
                    <option value="piece" />
                    <option value="pack" />
                    <option value="kg" />
                    <option value="g" />
                    <option value="liter" />
                    <option value="ml" />
                    <option value="box" />
                    <option value="sack" />
                    <option value="bottle" />
                  </datalist>
                </div>

                {/* ── SKU / Barcode (optional) ── */}
                <div className="pform__field">
                  <label className="pform__label" htmlFor="pform-sku">
                    {t("owner.product.skuLabel")}
                  </label>
                  <input
                    id="pform-sku"
                    className="pform__input"
                    type="text"
                    placeholder={t("owner.product.skuPlaceholder")}
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    maxLength={64}
                  />
                </div>

                {/* ── Description (optional) ── */}
                <div className="pform__field">
                  <label className="pform__label" htmlFor="pform-description">
                    {t("owner.product.descriptionLabel")}
                  </label>
                  <textarea
                    id="pform-description"
                    className="pform__input"
                    style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit" }}
                    placeholder={t("owner.product.descriptionPlaceholder")}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                  />
                  <span className="pform__char-count">{description.length}/500</span>
                </div>

                {/* ── Status ── */}
                <div className="pform__field">
                  <label className="pform__label">
                    {t("owner.product.statusLabel")} <span className="pform__required">*</span>
                  </label>
                  <div className="status-radio-group">
                    {STATUS_OPTIONS.map(({ value, Icon, color, bg, border }) => {
                      const isSelected = status === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`status-radio-tile ${isSelected ? "status-radio-tile--active" : ""}`}
                          style={isSelected ? { background: bg, borderColor: border, color } : {}}
                          onClick={() => setStatus(value)}
                        >
                          <Icon size={22} strokeWidth={isSelected ? 2.5 : 1.8} />
                          <span>{t(`status.${value}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Error message ── */}
                {error && (
                  <motion.p
                    className="pform__error"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    ⚠️ {error}
                  </motion.p>
                )}

                {/* ── Submit button ── */}
                <button
                  type="submit"
                  className="pform__submit"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <span
                        className="map-loading-spinner"
                        style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }}
                      />
                      {t("owner.product.saving")}
                    </>
                  ) : isEditMode ? (
                    <>
                      <Save size={18} />
                      {t("owner.product.saveChanges")}
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      {t("owner.product.addProduct")}
                    </>
                  )}
                </button>

              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
