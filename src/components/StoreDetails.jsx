// src/components/StoreDetails.jsx
// Framer Motion bottom-sheet that slides up from the bottom of the screen
// when a store pin is tapped.  Shows full inventory with traffic-light badges.
// Drag-to-dismiss supported on mobile.  Click-outside or X button to close.
// Minimum 48 × 48 px touch targets throughout.

import React, { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, Phone, Clock, Package } from "lucide-react";
import { formatLastUpdated } from "../hooks/useStores";

// ─── Status badge config ──────────────────────────────────────────────────────
const STATUS_CONFIG = {
  available: {
    label: "Available",
    color: "#2ECC71",
    bg: "rgba(46, 204, 113, 0.12)",
    emoji: "✅",
  },
  low: {
    label: "Low Stock",
    color: "#F1C40F",
    bg: "rgba(241, 196, 15, 0.12)",
    emoji: "⚠️",
  },
  out: {
    label: "Out of Stock",
    color: "#E74C3C",
    bg: "rgba(231, 76, 60, 0.12)",
    emoji: "❌",
  },
};
// ──────────────────────────────────────────────────────────────────────────────

// ─── Animation variants ───────────────────────────────────────────────────────
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.22 } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
};

const sheetVariants = {
  hidden: { y: "100%", opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", damping: 28, stiffness: 320, mass: 0.9 },
  },
  exit: {
    y: "100%",
    opacity: 0,
    transition: { type: "tween", ease: "easeIn", duration: 0.22 },
  },
};
// ──────────────────────────────────────────────────────────────────────────────

/**
 * StatusBadge — inline pill showing availability
 */
function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.available;
  return (
    <span
      className="status-badge"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.color }}
    >
      {cfg.emoji}&nbsp;{cfg.label}
    </span>
  );
}

/**
 * ProductRow — a single product line in the inventory list
 */
function ProductRow({ product, searchQuery }) {
  const isMatch =
    searchQuery.trim() &&
    product.name.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div className={`product-row ${isMatch ? "product-row--match" : ""}`}>
      <div className="product-row__left">
        <span className="product-row__name">{product.name}</span>
        <span className="product-row__category">{product.category}</span>
      </div>
      <div className="product-row__right">
        <StatusBadge status={product.status} />
        <span className="product-row__timestamp">
          <Clock size={11} />
          &nbsp;{formatLastUpdated(product.lastUpdated)}
        </span>
      </div>
    </div>
  );
}

/**
 * @typedef {Object} StoreDetailsProps
 * @property {import("../hooks/useStores").Store|null} store
 * @property {string} searchQuery
 * @property {Function} onClose
 */

/**
 * StoreDetails
 * Full-featured bottom-sheet panel for a selected store.
 * Animates in/out with Framer Motion spring physics.
 *
 * @param {StoreDetailsProps} props
 */
export default function StoreDetails({ store, searchQuery = "", onClose }) {
  const isOpen = Boolean(store);

  const handleOverlayClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onClose?.();
    },
    [onClose]
  );

  // Sort: matched products to the top, then by status severity
  const sortedInventory = store
    ? [...store.inventory].sort((a, b) => {
        const aMatch = a.name.toLowerCase().includes(searchQuery.toLowerCase());
        const bMatch = b.name.toLowerCase().includes(searchQuery.toLowerCase());
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        const order = { out: 0, low: 1, available: 2 };
        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      })
    : [];

  const matchedProducts = searchQuery.trim()
    ? sortedInventory.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Dimmed backdrop */}
          <motion.div
            className="sheet-overlay"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={handleOverlayClick}
            aria-hidden="true"
          />

          {/* Bottom sheet panel */}
          <motion.div
            className="sheet-panel"
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120) onClose?.();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Store details for ${store?.name}`}
          >
            {/* Drag handle */}
            <div className="sheet-handle" aria-hidden="true" />

            {/* Header */}
            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">{store?.name}</h2>
                <span className="sheet-header__type">{store?.type}</span>
              </div>
              <button
                className="sheet-close-btn"
                onClick={onClose}
                aria-label="Close store details"
                type="button"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            {/* Store meta */}
            <div className="sheet-meta">
              <div className="sheet-meta__item">
                <MapPin size={14} />
                <span>{store?.address}</span>
              </div>
              <div className="sheet-meta__item">
                <Phone size={14} />
                <span>{store?.contactNumber}</span>
              </div>
            </div>

            {/* Search match summary */}
            {searchQuery.trim() && matchedProducts.length > 0 && (
              <div className="sheet-match-banner">
                <Package size={15} />
                <span>
                  <strong>{matchedProducts.length}</strong> matching product
                  {matchedProducts.length !== 1 ? "s" : ""} for "
                  {searchQuery}"
                </span>
              </div>
            )}
            {searchQuery.trim() && matchedProducts.length === 0 && (
              <div className="sheet-no-match-banner">
                "{searchQuery}" is not listed at this store.
              </div>
            )}

            {/* Inventory list */}
            <div className="sheet-inventory">
              <h3 className="sheet-inventory__heading">
                <Package size={15} />
                &nbsp;Full Inventory ({store?.inventory.length ?? 0} items)
              </h3>
              <div className="sheet-inventory__list">
                {sortedInventory.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    searchQuery={searchQuery}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
