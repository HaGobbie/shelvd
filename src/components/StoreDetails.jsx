// src/components/StoreDetails.jsx
// Framer Motion bottom-sheet that slides up from the bottom of the screen
// when a store pin is tapped.  Shows full inventory with traffic-light badges.
// Drag-to-dismiss supported on mobile.  Click-outside or X button to close.
// Minimum 48 × 48 px touch targets throughout.

import React, { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, Phone, Clock, Package, Navigation } from "lucide-react";
import { formatLastUpdated, formatPrice } from "../hooks/useStores";
import { useLanguage } from "../i18n/LanguageContext";

// ─── Status badge config ──────────────────────────────────────────────────────
// Colors reference CSS custom properties (defined in :root, App.css)
// rather than literal hex — so a future palette change only needs to
// touch one place, not every component that renders a status badge.
// Labels are no longer hardcoded here — they come from the current
// language's dictionary (see src/i18n/translations.js `status.*` keys).
const STATUS_CONFIG = {
  available: {
    color: "var(--color-available)",
    bg: "var(--color-available-bg)",
    emoji: "✅",
  },
  low: {
    color: "var(--color-low)",
    bg: "var(--color-low-bg)",
    emoji: "⚠️",
  },
  out: {
    color: "var(--color-out)",
    bg: "var(--color-out-bg)",
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

// ─── Social link buttons ──────────────────────────────────────────────────────
// Each renders ONLY if the store actually has that URL set — no button
// for a platform the owner never added. Brand colors/glyphs are kept
// exact per each platform's own brand guidelines, same treatment as the
// Google/Facebook sign-in buttons elsewhere in this app. These are
// genuinely simplified glyphs (not the pixel-perfect official marks),
// which is standard practice for a small inline icon at this size —
// what matters is instant recognizability, which flat single/two-color
// versions of all three achieve fine at 18-20px.
function SocialLinkButton({ href, label, background, children }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        borderRadius: "50%",
        background,
        flexShrink: 0,
      }}
    >
      {children}
    </a>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="#fff">
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="#fff" stroke="none" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="#fff">
      <path d="M16.5 3c.3 2.1 1.6 3.6 3.7 3.9v2.6c-1.3.1-2.5-.3-3.7-1.1v6.4c0 3.3-2.7 5.9-6.1 5.7-3-.2-5.3-2.7-5.3-5.7 0-3.1 2.6-5.7 5.8-5.7.3 0 .6 0 .9.1v2.7c-.3-.1-.6-.2-.9-.2-1.6 0-2.9 1.3-2.9 3s1.3 3 2.9 3c1.7 0 3.1-1.4 3.1-3.1V3h2.5z" />
    </svg>
  );
}
// ──────────────────────────────────────────────────────────────────────────────

/**
 * StatusBadge — inline pill showing availability
 */
function StatusBadge({ status }) {
  const { t } = useLanguage();
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.available;
  const label = t(`status.${status ?? "available"}`);
  return (
    <span
      className="status-badge"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.color }}
    >
      {cfg.emoji}&nbsp;{label}
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
        <span
          className="product-row__price"
          style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text-primary, #1a1a1a)" }}
        >
          {formatPrice(product.price)}
        </span>
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
  const { t } = useLanguage();
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

  const hasAnySocialLink = Boolean(store?.facebookUrl || store?.instagramUrl || store?.tiktokUrl);

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
                aria-label={t("storeDetails.close")}
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
              {/* Google Maps deep link — deliberately NOT a straight-line
                  distance/in-app routing calculation. Google's own app
                  already does real turn-by-turn routing, with live
                  traffic, better than anything worth building here; this
                  just hands off to it with the destination pre-filled.
                  No API key needed — this is Google's public "Universal
                  Cross-Platform Maps URL" scheme, not the Directions API. */}
              {store?.lat != null && store?.lng != null && (
                <a
                  className="sheet-meta__item sheet-directions-link"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--color-brand-primary)",
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  <Navigation size={14} />
                  <span>{t("storeDetails.getDirections")}</span>
                </a>
              )}

              {/* Social links — only rendered if the owner set at least
                  one. No row at all appears otherwise, rather than an
                  empty/placeholder row. */}
              {hasAnySocialLink && (
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <SocialLinkButton
                    href={store?.facebookUrl}
                    label="Facebook"
                    background="#1877F2"
                  >
                    <FacebookIcon />
                  </SocialLinkButton>
                  <SocialLinkButton
                    href={store?.instagramUrl}
                    label="Instagram"
                    background="linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)"
                  >
                    <InstagramIcon />
                  </SocialLinkButton>
                  <SocialLinkButton
                    href={store?.tiktokUrl}
                    label="TikTok"
                    background="#000000"
                  >
                    <TikTokIcon />
                  </SocialLinkButton>
                </div>
              )}
            </div>

            {/* Search match summary */}
            {searchQuery.trim() && matchedProducts.length > 0 && (
              <div className="sheet-match-banner">
                <Package size={15} />
                <span>
                  {t("storeDetails.matchingProducts", matchedProducts.length)} "
                  {searchQuery}"
                </span>
              </div>
            )}
            {searchQuery.trim() && matchedProducts.length === 0 && (
              <div className="sheet-no-match-banner">
                {t("storeDetails.notListed", searchQuery)}
              </div>
            )}

            {/* Inventory list */}
            <div className="sheet-inventory">
              <h3 className="sheet-inventory__heading">
                <Package size={15} />
                &nbsp;{t("storeDetails.fullInventory", store?.inventory.length ?? 0)}
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
