// src/pages/OwnerDashboard.jsx
// Full Owner Dashboard — includes:
//   ✅ Google Sign-In + Email/Password login (Supabase Auth)
//   ✅ Auto-routing: no stores found → StoreRegistrationForm
//   ✅ MULTI-STORE support: switch between stores, add/delete a store
//   ✅ Inventory management available immediately regardless of approval
//      status — a non-blocking banner informs instead of locking out
//   ✅ Real-time Inventory listener (Supabase Realtime, scoped to store)
//   ✅ Add, Edit, Delete products; quantity quick-adjust
//   ✅ Full Tagalog translation via useLanguage()/t()
//
// STATUS AUTOMATION: the old StatusRadioGroup quick-toggle is GONE. It
// let an owner set `status` directly, which would have silently
// conflicted with sync_status_from_quantity() (17_status_automation_and_
// search_price.sql) — that trigger derives status from quantity/
// threshold on every write, so a stray direct status write would just
// get overwritten the next time quantity changed anyway, creating a
// confusing "why didn't my status stick" experience. Replaced with a
// QuantityStepper that adjusts the real source of truth directly.

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PackageCheck,
  AlertTriangle,
  PackageX,
  CheckCircle2,
  LogIn,
  Store,
  Clock,
  Package,
  Plus,
  Minus,
  Pencil,
  Trash2,
  Settings,
  ChevronDown,
  X,
  UploadCloud,
  ShoppingCart,
  FileDown,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import { useMyStores, useOwnerInventory, deleteStore, formatLastUpdated, formatPrice, fetchDailyTransactions, fetchMonthlyRevenue } from "../hooks/useStores";
import ProductFormModal from "../components/ProductFormModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import StoreRegistrationForm from "../components/StoreRegistrationForm";
import StoreEditModal from "../components/StoreEditModal";
import BulkImportModal from "../components/BulkImportModal";
import SellModal from "../components/SellModal";
import { exportCurrentInventoryCSV, exportDailyTransactionsCSV, exportMonthlyRevenueCSV } from "../utils/csvExport";
import { useLanguage } from "../i18n/LanguageContext";

// Colors reference CSS custom properties rather than literal hex — see
// root-tokens-patch.css from the rebrand pass. Labels come from the
// `status.*` dictionary entries shared with the public-facing badges.
// Still used for the READ-ONLY status pill display — just no longer for
// an interactive status picker.
const STATUS_CONFIG = {
  available: { Icon: PackageCheck, color: "var(--color-available)" },
  low:       { Icon: AlertTriangle, color: "var(--color-low)" },
  out:       { Icon: PackageX,     color: "var(--color-out)" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * QuantityStepper
 * Replaces the old manual status radio group. Adjusting quantity here
 * writes directly to the DB via updateProductQuantity() — the
 * sync_status_from_quantity() trigger derives status the instant this
 * lands, so there's no separate "now set the status" step anymore.
 */
function QuantityStepper({ product, onChange }) {
  const { t } = useLanguage();
  const [pending, setPending] = useState(false);

  const adjust = async (delta) => {
    const next = Math.max(0, (product.quantity ?? 0) + delta);
    if (next === product.quantity) return;
    setPending(true);
    await onChange(product.id, next);
    setPending(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => adjust(-1)}
        disabled={pending || (product.quantity ?? 0) <= 0}
        aria-label={t("owner.dashboard.quickAdjustAria")}
        style={{
          width: 32, height: 32, borderRadius: "50%",
          border: "1px solid var(--color-border)", background: "var(--color-surface)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}
      >
        <Minus size={14} />
      </button>
      <span style={{ minWidth: 40, textAlign: "center", fontWeight: 700, fontSize: 15 }}>
        {product.quantity ?? 0}
      </span>
      <button
        type="button"
        onClick={() => adjust(1)}
        disabled={pending}
        aria-label={t("owner.dashboard.quickAdjustAria")}
        style={{
          width: 32, height: 32, borderRadius: "50%",
          border: "1px solid var(--color-border)", background: "var(--color-surface)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}
      >
        <Plus size={14} />
      </button>
      <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        {(product.unit || "piece")} {t("owner.dashboard.stockLabel")}
      </span>
    </div>
  );
}

// Units where "15 packs" reads naturally with a trailing "s"; metric
// units (kg, g, liter, ml) don't pluralize the same way in everyday use,
// so they're deliberately left alone. (Tagalog doesn't pluralize nouns
// with a suffix at all, so this only applies in English.)
const PLURALIZABLE_UNITS = new Set(["piece", "pack", "box", "sack", "bottle"]);

function formatStockLine(quantity, unit, language) {
  const qty = quantity ?? 0;
  const u = (unit || "piece").trim();
  if (language === "tl") return `${qty} ${u}`;
  const displayUnit =
    PLURALIZABLE_UNITS.has(u.toLowerCase()) && qty !== 1 ? `${u}s` : u;
  return `${qty} ${displayUnit}`;
}

function ProductCard({ product, onQuantityChange, onEdit, onDelete, onSell }) {
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const cfg = STATUS_CONFIG[product.status] ?? STATUS_CONFIG.available;

  const handleQuantityChange = async (pid, newQuantity) => {
    await onQuantityChange(pid, newQuantity);
    setLocalSaved(true);
    setTimeout(() => setLocalSaved(false), 1800);
  };

  return (
    <motion.div className="product-card" layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.22 }}>
      <div className="product-card__header-row">
        <button className="product-card__header" style={{ flex: 1 }}
          onClick={() => setExpanded(v => !v)} type="button" aria-expanded={expanded}>
          <div className="product-card__info">
            <span className="product-card__name">{product.name}</span>
            <span className="product-card__category">
              {product.category} · <strong style={{ color: "var(--color-text-primary)" }}>{formatPrice(product.price)}</strong>
            </span>
            <span className="product-card__stock-line" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {formatStockLine(product.quantity, product.unit, language)}
            </span>
          </div>
          <div className="product-card__right">
            {localSaved
              ? <span className="product-card__saved"><CheckCircle2 size={14} /> {t("owner.dashboard.saved")}</span>
              : <span className="product-card__status-pill" style={{ color: cfg.color, borderColor: cfg.color }}>{t(`status.${product.status}`)}</span>}
            <span className={`product-card__chevron ${expanded ? "product-card__chevron--open" : ""}`}>▾</span>
          </div>
        </button>
        <div className="product-card__actions">
          <button type="button" className="product-card__action-btn"
            onClick={() => onSell(product)} disabled={(product.quantity ?? 0) <= 0}
            aria-label={`Sell ${product.name}`} title="Sell"
            style={{ color: "var(--color-available)" }}>
            <ShoppingCart size={15} strokeWidth={2} />
          </button>
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
            <div className="product-card__timestamp">
              <Clock size={12} />&nbsp;{formatLastUpdated(product.lastUpdated)}
            </div>
            {product.sku && (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                SKU: {product.sku}
              </div>
            )}
            {product.description && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4, lineHeight: 1.5 }}>
                {product.description}
              </p>
            )}
            <QuantityStepper product={product} onChange={handleQuantityChange} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Login screen with Google + Email (Supabase Auth) ────────────────────────
function LoginScreen() {
  const { t } = useLanguage();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [gLoading, setGLoading]   = useState(false);

  const handleGoogle = async () => {
    setError(""); setGLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (oauthError) {
      setError(t("owner.login.googleFailed"));
      setGLoading(false);
    }
  };

  const handleEmail = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      if (signInError.message.toLowerCase().includes("invalid login credentials")) {
        setError(t("owner.login.incorrectCreds"));
      } else if (signInError.message.toLowerCase().includes("rate limit")) {
        setError(t("owner.login.rateLimited"));
      } else {
        setError(t("owner.login.signInFailed"));
      }
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__logo"><Store size={36} /></div>
        <h1 className="login-card__title">{t("owner.login.title")}</h1>
        <p className="login-card__subtitle">{t("owner.login.subtitle")}</p>

        {/* Google button — brand colors below are Google's own official
            colors and must stay exactly as-is per Google's brand guidelines. */}
        <button type="button" className="google-signin-btn" onClick={handleGoogle} disabled={gLoading || loading}>
          {gLoading
            ? <span className="map-loading-spinner" style={{ width: 20, height: 20, borderWidth: 2.5, borderTopColor: "#4285F4" }} />
            : (
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
            )}
          {gLoading ? t("owner.login.signingIn") : t("owner.login.continueGoogle")}
        </button>

        <div className="login-divider"><span>{t("owner.login.or")}</span></div>

        <AnimatePresence initial={false}>
          {!showEmailForm ? (
            <motion.button key="toggle" type="button" className="login-email-toggle"
              onClick={() => setShowEmailForm(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {t("owner.login.signInEmail")}
            </motion.button>
          ) : (
            <motion.form key="emailform" onSubmit={handleEmail} className="login-form" noValidate
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
              <div className="login-form__field">
                <label htmlFor="owner-email">{t("owner.login.emailLabel")}</label>
                <input id="owner-email" type="email" placeholder="owner@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              <div className="login-form__field">
                <label htmlFor="owner-password">{t("owner.login.passwordLabel")}</label>
                <input id="owner-password" type="password" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <button type="submit" className="login-form__submit" disabled={loading || gLoading}>
                {loading ? <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <LogIn size={18} />}
                {loading ? t("owner.login.signingIn") : t("owner.login.signIn")}
              </button>
              <button type="button" onClick={() => setShowEmailForm(false)}
                style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 4, textAlign: "center", width: "100%" }}>
                {t("owner.login.back")}
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {error && (
          <motion.p className="login-form__error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {error}
          </motion.p>
        )}
      </div>
    </div>
  );
}

// ─── Non-blocking approval status banner ─────────────────────────────────────
function ApprovalBanner({ store }) {
  const { t } = useLanguage();
  if (store.status === "approved") return null;

  const isRejected = store.status === "rejected";
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 16px", borderRadius: "var(--radius-md, 8px)",
        marginBottom: 16, fontSize: 13, fontWeight: 600,
        background: isRejected ? "var(--color-out-bg)" : "var(--color-low-bg)",
        border: `1px solid ${isRejected ? "var(--color-out-border)" : "var(--color-low-border)"}`,
        color: isRejected ? "var(--color-out)" : "var(--color-low)",
      }}
    >
      {isRejected ? <AlertTriangle size={16} /> : <Clock size={16} />}
      <span>
        {isRejected
          ? t("owner.dashboard.approvalRejected", store.rejectionReason)
          : t("owner.dashboard.approvalPending")}
      </span>
    </div>
  );
}

// ─── Delete store confirmation ────────────────────────────────────────────────
function DeleteStoreConfirm({ isOpen, onClose, store, onDeleted }) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (!store) return;
    setDeleting(true);
    setError("");
    const { error: deleteError } = await deleteStore(store.id);
    if (deleteError) {
      console.error("Delete store failed:", deleteError);
      setError(t("owner.confirmDelete.error"));
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onDeleted?.();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && store && (
        <>
          <motion.div
            className="sheet-overlay" style={{ zIndex: 1100 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} aria-hidden="true"
          />
          <motion.div
            className="confirm-dialog"
            initial={{ scale: 0.88, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0, transition: { type: "spring", damping: 22, stiffness: 340 } }}
            exit={{ scale: 0.92, opacity: 0, y: 8 }}
            role="alertdialog" aria-modal="true"
          >
            <div className="confirm-dialog__icon-wrap">
              <AlertTriangle size={28} className="confirm-dialog__icon" />
            </div>
            <h3 className="confirm-dialog__title">{t("owner.dashboard.deleteStoreTitle")}</h3>
            <p className="confirm-dialog__desc">{t("owner.dashboard.deleteStoreDesc1")}</p>
            <p className="confirm-dialog__product-name">"{store.name}"</p>
            <p className="confirm-dialog__desc" style={{ marginTop: 4 }}>
              {t("owner.dashboard.deleteStoreDesc2")}
            </p>
            {error && <p className="confirm-dialog__error">⚠️ {error}</p>}
            <div className="confirm-dialog__actions">
              <button type="button" className="confirm-dialog__cancel" onClick={onClose} disabled={deleting}>
                <X size={16} /> {t("owner.confirmDelete.cancel")}
              </button>
              <button type="button" className="confirm-dialog__delete" onClick={handleDelete} disabled={deleting}>
                {deleting ? (
                  <>
                    <span className="map-loading-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: "#fff" }} />
                    {t("owner.confirmDelete.deleting")}
                  </>
                ) : (
                  <><Trash2 size={16} /> {t("owner.confirmDelete.confirm")}</>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Store switcher ───────────────────────────────────────────────────────────
function StoreSwitcher({ stores, selectedStoreId, onSelect }) {
  const { t } = useLanguage();
  if (stores.length <= 1) return null;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <select
        value={selectedStoreId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        aria-label={t("owner.dashboard.switchStoreAria")}
        style={{
          appearance: "none", background: "var(--color-surface)",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-md, 8px)",
          padding: "6px 30px 6px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}
      >
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{s.status !== "approved" ? ` (${s.status === "rejected" ? t("owner.dashboard.rejected") : t("owner.dashboard.pending")})` : ""}
          </option>
        ))}
      </select>
      <ChevronDown size={14}
        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function OwnerDashboard({ session }) {
  const { t } = useLanguage();
  const user = session?.user ?? null;

  const { stores, checked: storesChecked, loading: storesLoading, refetch: refetchStores } = useMyStores(user?.id ?? null);

  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [addingStore, setAddingStore] = useState(false);
  const [deleteStoreConfirmOpen, setDeleteStoreConfirmOpen] = useState(false);
  const justAddedRef = useRef(false);

  useEffect(() => {
    if (stores.length === 0) {
      if (selectedStoreId !== null) setSelectedStoreId(null);
      return;
    }
    const stillValid = stores.some((s) => s.id === selectedStoreId);
    if (!stillValid) {
      if (justAddedRef.current) {
        const newest = [...stores].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
        setSelectedStoreId(newest.id);
        justAddedRef.current = false;
      } else {
        setSelectedStoreId(stores[0].id);
      }
    }
  }, [stores, selectedStoreId]);

  const myStore = stores.find((s) => s.id === selectedStoreId) ?? null;

  const { inventory, updateProductQuantity } = useOwnerInventory(myStore?.id ?? null);

  const [filterQuery, setFilterQuery]         = useState("");
  const [formModalOpen, setFormModalOpen]     = useState(false);
  const [editingProduct, setEditingProduct]   = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [storeEditOpen, setStoreEditOpen]     = useState(false);
  const [bulkImportOpen, setBulkImportOpen]   = useState(false);
  const [sellModalOpen, setSellModalOpen]     = useState(false);
  const [sellingProduct, setSellingProduct]   = useState(null);
  const [reportBusy, setReportBusy]           = useState(false);

  const handleQuantityChange = async (productId, quantity) => {
    const { error } = await updateProductQuantity(productId, quantity);
    if (error) console.error("Quantity update failed:", error);
  };

  const openAddModal    = ()   => { setEditingProduct(null);    setFormModalOpen(true); };
  const openEditModal   = (p)  => { setEditingProduct(p);       setFormModalOpen(true); };
  const openDeleteModal = (p)  => { setDeletingProduct(p);      setDeleteModalOpen(true); };
  const openSellModal   = (p)  => { setSellingProduct(p);       setSellModalOpen(true); };

  const handleExportInventory = () => {
    exportCurrentInventoryCSV(inventory, myStore?.name);
  };

  const handleExportDaily = async () => {
    if (!myStore?.id) return;
    setReportBusy(true);
    const transactions = await fetchDailyTransactions(myStore.id);
    exportDailyTransactionsCSV(transactions, myStore.name);
    setReportBusy(false);
  };

  const handleExportMonthly = async () => {
    if (!myStore?.id) return;
    setReportBusy(true);
    const monthly = await fetchMonthlyRevenue(myStore.id);
    exportMonthlyRevenueCSV(monthly, myStore.name);
    setReportBusy(false);
  };

  const filteredInventory = filterQuery.trim()
    ? inventory.filter((p) =>
        p.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(filterQuery.toLowerCase()))
    : inventory;

  if (!user) return <LoginScreen />;

  if (!storesChecked || storesLoading) return (
    <div className="login-screen">
      <div className="dashboard-loading"><div className="map-loading-spinner" /><span>{t("owner.dashboard.loadingStores")}</span></div>
    </div>
  );

  if (storesChecked && stores.length === 0) {
    return (
      <div style={{ minHeight: "100dvh", height: "auto", overflowY: "auto", overflowX: "hidden" }}>
        <StoreRegistrationForm
          user={user}
          onComplete={() => { justAddedRef.current = true; refetchStores(); }}
        />
        <div style={{ textAlign: "center", padding: "16px 0 32px" }}>
          <button type="button"
            style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "underline" }}
            onClick={() => supabase.auth.signOut()}>
            {t("owner.dashboard.signOutDifferent")}
          </button>
        </div>
      </div>
    );
  }

  if (addingStore) {
    return (
      <div style={{ minHeight: "100dvh", height: "auto", overflowY: "auto", overflowX: "hidden" }}>
        <StoreRegistrationForm
          user={user}
          onCancel={() => setAddingStore(false)}
          onComplete={() => { justAddedRef.current = true; refetchStores(); setAddingStore(false); }}
        />
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header__left">
          <Store size={22} />
          <div>
            <h1 className="dashboard-header__title">{myStore?.name ?? t("owner.dashboard.myStore")}</h1>
            <span className="dashboard-header__subtitle">
              {myStore?.type ? `${myStore.type} · ` : ""}{user.email}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <StoreSwitcher stores={stores} selectedStoreId={selectedStoreId} onSelect={setSelectedStoreId} />
          <button type="button" className="dashboard-header__edit-store" onClick={() => setAddingStore(true)}>
            <Plus size={16} strokeWidth={2} />
            <span>{t("owner.dashboard.addStore")}</span>
          </button>
          <button type="button" className="dashboard-header__edit-store" onClick={() => setStoreEditOpen(true)}
            aria-label={t("owner.dashboard.editStoreAria")} title={t("owner.dashboard.editStoreLabel")}>
            <Settings size={16} strokeWidth={2} />
            <span>{t("owner.dashboard.editStoreLabel")}</span>
          </button>
          <button type="button" className="dashboard-header__edit-store" onClick={() => setDeleteStoreConfirmOpen(true)}
            aria-label={t("owner.dashboard.deleteStoreAria")} title={t("owner.dashboard.deleteStoreLabel")}
            style={{ color: "var(--color-out)", borderColor: "var(--color-out-border)" }}>
            <Trash2 size={16} strokeWidth={2} />
            <span>{t("owner.dashboard.deleteStoreLabel")}</span>
          </button>
          <button className="dashboard-header__logout" onClick={() => supabase.auth.signOut()} type="button">{t("owner.dashboard.signOut")}</button>
        </div>
      </header>

      <main className="dashboard-main">
        {myStore && <ApprovalBanner store={myStore} />}

        <div className="dashboard-toolbar">
          <div className="dashboard-section-label">
            <Package size={14} />&nbsp;{t("owner.dashboard.inventory")}
            <span className="dashboard-toolbar__count">
              {filterQuery
                ? t("owner.dashboard.productsCountFiltered", filteredInventory.length, inventory.length)
                : t("owner.dashboard.productsCount", filteredInventory.length)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setBulkImportOpen(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: 44, padding: "0 16px",
                borderRadius: "var(--radius-pill, 999px)", fontSize: 13, fontWeight: 700,
                fontFamily: "var(--font-heading, inherit)", whiteSpace: "nowrap",
                background: "transparent", color: "var(--color-brand-primary)",
                border: "1.5px solid var(--color-brand-primary)",
              }}
            >
              <UploadCloud size={16} strokeWidth={2} />
              <span>{t("owner.dashboard.bulkImportCsv")}</span>
            </button>
            <button type="button" className="dashboard-add-btn" onClick={openAddModal}>
              <Plus size={18} strokeWidth={2.5} /> {t("owner.dashboard.addProduct")}
            </button>
          </div>
        </div>

        {/* Reports — CSV downloads, built entirely from data already
            available (current inventory) or fetched fresh for the report
            (daily transactions, monthly revenue). */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <button
            type="button"
            onClick={handleExportInventory}
            disabled={inventory.length === 0}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px",
              borderRadius: "var(--radius-md, 8px)", fontSize: 12, fontWeight: 600,
              background: "var(--color-surface-3)", color: "var(--color-text-secondary)", border: "none",
            }}
          >
            <FileDown size={14} /> Inventory CSV
          </button>
          <button
            type="button"
            onClick={handleExportDaily}
            disabled={reportBusy}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px",
              borderRadius: "var(--radius-md, 8px)", fontSize: 12, fontWeight: 600,
              background: "var(--color-surface-3)", color: "var(--color-text-secondary)", border: "none",
            }}
          >
            <FileDown size={14} /> Today's Transactions CSV
          </button>
          <button
            type="button"
            onClick={handleExportMonthly}
            disabled={reportBusy}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px",
              borderRadius: "var(--radius-md, 8px)", fontSize: 12, fontWeight: 600,
              background: "var(--color-surface-3)", color: "var(--color-text-secondary)", border: "none",
            }}
          >
            <FileDown size={14} /> Monthly Revenue CSV
          </button>
        </div>

        {inventory.length > 4 && (
          <div className="dashboard-filter">
            <input type="search" className="dashboard-filter__input"
              placeholder={t("owner.dashboard.filterPlaceholder")} value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)} />
            {filterQuery && (
              <button className="dashboard-filter__clear" onClick={() => setFilterQuery("")} type="button">✕</button>
            )}
          </div>
        )}

        <p className="dashboard-hint">{t("owner.dashboard.hint")}</p>

        {inventory.length === 0 && (
          <div className="dashboard-empty">
            <Package size={36} style={{ opacity: 0.3 }} />
            <span>{t("owner.dashboard.noProducts")}</span>
            <button type="button" className="dashboard-add-btn" onClick={openAddModal} style={{ marginTop: 8 }}>
              <Plus size={18} /> {t("owner.dashboard.addFirstProduct")}
            </button>
          </div>
        )}

        {inventory.length > 0 && filteredInventory.length === 0 && (
          <div className="dashboard-empty">{t("owner.dashboard.noMatch", filterQuery)}</div>
        )}

        <div className="dashboard-product-list">
          <AnimatePresence>
            {filteredInventory.map((product) => (
              <ProductCard key={product.id} product={product}
                onQuantityChange={handleQuantityChange} onEdit={openEditModal} onDelete={openDeleteModal} onSell={openSellModal} />
            ))}
          </AnimatePresence>
        </div>
      </main>

      <ProductFormModal isOpen={formModalOpen} onClose={() => setFormModalOpen(false)}
        storeId={myStore?.id} initialData={editingProduct} />
      <ConfirmDeleteModal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)}
        storeId={myStore?.id} product={deletingProduct} />
      <StoreEditModal isOpen={storeEditOpen} onClose={() => setStoreEditOpen(false)} store={myStore} />
      <BulkImportModal isOpen={bulkImportOpen} onClose={() => setBulkImportOpen(false)} storeId={myStore?.id} />
      <SellModal
        isOpen={sellModalOpen}
        onClose={() => setSellModalOpen(false)}
        product={sellingProduct}
      />
      <DeleteStoreConfirm
        isOpen={deleteStoreConfirmOpen}
        onClose={() => setDeleteStoreConfirmOpen(false)}
        store={myStore}
        onDeleted={() => refetchStores()}
      />
    </div>
  );
}
