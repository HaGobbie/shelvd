// src/components/ConfirmDeleteModal.jsx
// A focused, centered confirmation dialog that appears before deleting a product.
// Prevents accidental deletion — the owner must explicitly confirm.
// Uses Framer Motion for a scale-in entrance.
// Firestore: deleteDoc(doc(db, "Stores", storeId, "Inventory", productId))

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, X, AlertTriangle } from "lucide-react";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/config";

// ─── Animation variants ───────────────────────────────────────────────────────
const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.14 } },
};

const dialogVariants = {
  hidden:  { scale: 0.88, opacity: 0, y: 16 },
  visible: {
    scale: 1,
    opacity: 1,
    y: 0,
    transition: { type: "spring", damping: 22, stiffness: 340 },
  },
  exit: {
    scale: 0.92,
    opacity: 0,
    y: 8,
    transition: { type: "tween", ease: "easeIn", duration: 0.16 },
  },
};
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ConfirmDeleteModalProps
 * @property {boolean}      isOpen
 * @property {Function}     onClose
 * @property {string}       storeId
 * @property {Object|null}  product   — the product to be deleted
 */

/**
 * ConfirmDeleteModal
 * Shows the product name prominently so the owner is certain what they're deleting.
 * On confirm, calls Firestore deleteDoc, then closes.
 *
 * @param {ConfirmDeleteModalProps} props
 */
export default function ConfirmDeleteModal({
  isOpen,
  onClose,
  storeId,
  product,
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (!product || !storeId) return;

    setDeleting(true);
    setError("");

    try {
      const productRef = doc(db, "Stores", storeId, "Inventory", product.id);
      await deleteDoc(productRef);
      onClose();
    } catch (err) {
      console.error("Delete failed:", err);
      setError("Could not delete. Please check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && product && (
        <>
          {/* Backdrop */}
          <motion.div
            className="sheet-overlay"
            style={{ zIndex: 1100 }}
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Centered dialog */}
          <motion.div
            className="confirm-dialog"
            variants={dialogVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-desc"
          >
            {/* Warning icon */}
            <div className="confirm-dialog__icon-wrap">
              <AlertTriangle size={28} className="confirm-dialog__icon" />
            </div>

            {/* Text */}
            <h3 id="confirm-delete-title" className="confirm-dialog__title">
              Delete Product?
            </h3>
            <p id="confirm-delete-desc" className="confirm-dialog__desc">
              You are about to permanently remove
            </p>
            <p className="confirm-dialog__product-name">
              "{product.name}"
            </p>
            <p className="confirm-dialog__desc" style={{ marginTop: 4 }}>
              from your inventory. This cannot be undone.
            </p>

            {error && (
              <p className="confirm-dialog__error">⚠️ {error}</p>
            )}

            {/* Action buttons */}
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="confirm-dialog__cancel"
                onClick={onClose}
                disabled={deleting}
              >
                <X size={16} />
                Cancel
              </button>
              <button
                type="button"
                className="confirm-dialog__delete"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <span
                      className="map-loading-spinner"
                      style={{
                        width: 16,
                        height: 16,
                        borderWidth: 2,
                        borderTopColor: "#fff",
                      }}
                    />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Yes, Delete
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
