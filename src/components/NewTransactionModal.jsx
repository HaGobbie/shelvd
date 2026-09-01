// src/components/NewTransactionModal.jsx
// Replaces the old per-product "Sell" quick-action with a single
// transaction that can cover multiple products at once — pick a
// product, enter quantity, add it to the cart, repeat, then submit the
// whole thing together.
//
// All line items are submitted in ONE call to recordMultiSale(), which
// wraps them in a single atomic Postgres transaction (see
// 20_record_multi_sale.sql) — either every line item succeeds, or none
// do. A naive loop of separate per-item calls could leave a transaction
// half-sold if one line item fails partway through (e.g. someone else
// sold the last few units in another tab first).

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2, ShoppingCart, AlertTriangle } from "lucide-react";
import { recordMultiSale, formatPrice } from "../hooks/useStores";

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.16 } },
};
const sheetVariants = {
  hidden:  { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", damping: 28, stiffness: 300, mass: 0.9 } },
  exit:    { y: "100%", opacity: 0, transition: { type: "tween", ease: "easeIn", duration: 0.2 } },
};

/**
 * @param {{
 *   isOpen: boolean,
 *   onClose: Function,
 *   inventory: Array — the store's current products, from useOwnerInventory()
 *   onCompleted?: Function
 * }} props
 */
export default function NewTransactionModal({ isOpen, onClose, inventory, onCompleted }) {
  const [cart, setCart] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [addQuantity, setAddQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const resetAndClose = () => {
    setCart([]);
    setSelectedProductId("");
    setAddQuantity("1");
    setNotes("");
    setError("");
    onClose();
  };

  const sellableInventory = useMemo(
    () => inventory.filter((p) => (p.quantity ?? 0) > 0),
    [inventory]
  );

  const selectedProduct = inventory.find((p) => p.id === selectedProductId);

  const alreadyInCart = cart
    .filter((line) => line.productId === selectedProductId)
    .reduce((sum, line) => sum + line.quantity, 0);
  const remainingForSelected = selectedProduct
    ? selectedProduct.quantity - alreadyInCart
    : 0;

  const handleAddToCart = () => {
    const qty = Number(addQuantity);
    if (!selectedProduct || !Number.isInteger(qty) || qty <= 0) return;
    if (qty > remainingForSelected) return;

    setCart((prev) => {
      const existingIndex = prev.findIndex((l) => l.productId === selectedProductId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + qty,
        };
        return updated;
      }
      return [
        ...prev,
        {
          productId: selectedProduct.id,
          name: selectedProduct.name,
          price: selectedProduct.price,
          unit: selectedProduct.unit || "piece",
          availableQty: selectedProduct.quantity,
          quantity: qty,
        },
      ];
    });
    setSelectedProductId("");
    setAddQuantity("1");
  };

  const handleRemoveLine = (productId) => {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  };

  const handleLineQuantityChange = (productId, newQty) => {
    setCart((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, quantity: newQty } : l))
    );
  };

  const total = cart.reduce((sum, l) => sum + l.quantity * l.price, 0);

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    setSaving(true);
    setError("");

    const { error: saleError } = await recordMultiSale(
      cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      notes.trim() || null
    );

    if (saleError) {
      console.error("Transaction failed:", saleError);
      setError(saleError.message || "Could not complete this transaction. Please try again.");
      setSaving(false);
      return;
    }

    setSaving(false);
    onCompleted?.();
    resetAndClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="sheet-overlay" style={{ zIndex: 1200 }}
            variants={overlayVariants} initial="hidden" animate="visible" exit="exit"
            onClick={resetAndClose} aria-hidden="true"
          />
          <motion.div
            className="sheet-panel" style={{ zIndex: 1201, maxHeight: "94dvh", display: "flex", flexDirection: "column" }}
            variants={sheetVariants} initial="hidden" animate="visible" exit="exit"
            role="dialog" aria-modal="true" aria-label="New transaction"
          >
            <div className="sheet-handle" aria-hidden="true" />

            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">New Transaction</h2>
                <span className="sheet-header__type">Add one or more products sold, then submit together.</span>
              </div>
              <button className="sheet-close-btn" onClick={resetAndClose} aria-label="Close" type="button">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            <div className="sheet-inventory" style={{ padding: "16px 20px 24px", flex: 1, overflowY: "auto" }}>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 16 }}>
                <div className="pform__field" style={{ flex: 2, marginBottom: 0 }}>
                  <label className="pform__label" htmlFor="txn-product">Product</label>
                  <select
                    id="txn-product"
                    className="pform__select"
                    value={selectedProductId}
                    onChange={(e) => { setSelectedProductId(e.target.value); setAddQuantity("1"); }}
                  >
                    <option value="">— Choose a product —</option>
                    {sellableInventory.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.quantity} {p.unit || "piece"} left)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="pform__field" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="pform__label" htmlFor="txn-qty">Qty</label>
                  <input
                    id="txn-qty"
                    className="pform__input"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={remainingForSelected || 1}
                    step="1"
                    value={addQuantity}
                    onChange={(e) => setAddQuantity(e.target.value)}
                    disabled={!selectedProductId}
                  />
                </div>
                <button
                  type="button"
                  className="dashboard-add-btn"
                  style={{ height: 44, whiteSpace: "nowrap" }}
                  onClick={handleAddToCart}
                  disabled={
                    !selectedProductId ||
                    !Number.isInteger(Number(addQuantity)) ||
                    Number(addQuantity) <= 0 ||
                    Number(addQuantity) > remainingForSelected
                  }
                >
                  <Plus size={16} /> Add
                </button>
              </div>

              {selectedProductId && Number(addQuantity) > remainingForSelected && (
                <p className="pform__error" style={{ marginTop: -8, marginBottom: 16 }}>
                  ⚠️ Only {remainingForSelected} left to add (some may already be in your cart below).
                </p>
              )}

              {cart.length === 0 ? (
                <div className="dashboard-empty" style={{ padding: "24px 0" }}>
                  <ShoppingCart size={32} style={{ opacity: 0.3 }} />
                  <span>No items added yet.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cart.map((line) => (
                    <div
                      key={line.productId}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 10,
                        background: "var(--color-surface-3)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {line.name}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {formatPrice(line.price)} each
                        </div>
                      </div>
                      <input
                        type="number"
                        min="1"
                        max={line.availableQty}
                        step="1"
                        value={line.quantity}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(line.availableQty, Number(e.target.value) || 1));
                          handleLineQuantityChange(line.productId, v);
                        }}
                        style={{ width: 56, textAlign: "center", padding: "6px 4px", borderRadius: 8, border: "1px solid var(--color-border)" }}
                      />
                      <div style={{ minWidth: 70, textAlign: "right", fontWeight: 700, fontSize: 14 }}>
                        {formatPrice(line.quantity * line.price)}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(line.productId)}
                        aria-label={`Remove ${line.name}`}
                        style={{ background: "none", border: "none", color: "var(--color-out)", cursor: "pointer", display: "flex" }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {cart.length > 0 && (
                <div
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginTop: 16, padding: "12px 16px", borderRadius: 10,
                    background: "var(--color-available-bg)", color: "var(--color-available)",
                    fontWeight: 700, fontSize: 16,
                  }}
                >
                  <span>Total Sale</span>
                  <span>{formatPrice(total)}</span>
                </div>
              )}

              <div className="pform__field" style={{ marginTop: 16 }}>
                <label className="pform__label" htmlFor="txn-notes">Description (optional)</label>
                <textarea
                  id="txn-notes"
                  className="pform__input"
                  style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                  placeholder="e.g. Morning batch, walk-in customer, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={300}
                />
              </div>

              {error && (
                <p className="pform__error" style={{ marginTop: 12 }}>
                  <AlertTriangle size={14} style={{ display: "inline", marginRight: 4 }} /> {error}
                </p>
              )}
            </div>

            <div style={{ padding: "12px 20px calc(16px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--color-border)" }}>
              <button
                type="button"
                className="pform__submit"
                onClick={handleSubmit}
                disabled={saving || cart.length === 0}
              >
                {saving ? (
                  <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                ) : (
                  <><ShoppingCart size={18} /> Submit Transaction ({formatPrice(total)})</>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
