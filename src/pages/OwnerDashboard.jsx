// src/pages/OwnerDashboard.jsx
// Owner Dashboard — v2 layout.
//
// DESKTOP (≥ 1100px): left sidebar (navigation) │ main work area │ right rail
//   (Daily Cash-Out, Neighborhood Demand, Stock Alerts). "New transaction"
//   stays at the front — pinned at the top of the sidebar.
// MOBILE / TABLET:   compact top bar, one view at a time, and a bottom
//   navigation bar: Inventory │ Add │ (New transaction) │ Reports │ Alerts.
//
// Views:
//   inventory  – product list, filters, cash-out/demand summary (mobile)
//   add        – Single product │ Add many items (receipt scan / CSV) — both
//                render inline in the page instead of as pop-up sheets
//   csv / today / monthly – reports (mobile groups these under "Reports")
//   alerts     – low/out-of-stock warnings (mobile; desktop shows them in the rail)
//
// The existing modals (ProductFormModal, BulkImportModal, DailyTransactionsModal,
// MonthlyRevenueModal) are reused as-is: wrapped in `.inline-host`, whose CSS
// (shelvd-v2.css) turns their sheet chrome into a normal page section.
//
// Stock editing: see components/dashboard/StockAdjuster.jsx (batched + Save).
// Auth screens: see components/AuthScreen.jsx.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Package, Plus, Pencil, Trash2, Settings, ChevronDown, X, ShoppingCart,
  FileDown, Languages, Sun, Moon, HelpCircle, MoreVertical, Store, Shield, Map as MapIcon,
  PackagePlus, UploadCloud, Search, LogOut,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import {
  useMyStores, useOwnerInventory, deleteStore, formatPrice, recordStockAdjustment,
} from "../hooks/useStores";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useProfileRole } from "../hooks/useProfileRole";
import AuthScreen from "../components/AuthScreen";
import StoreAvatar from "../components/StoreAvatar";
import { removeStoreLogo } from "../utils/storeLogo";
import ProductCard from "../components/dashboard/ProductCard";
import { Sidebar, BottomNav } from "../components/dashboard/DashNav";
import { DailyCashOutCard, NeighborhoodDemandCard, StockAlertsCard } from "../components/dashboard/InsightCards";
import ProductFormModal from "../components/ProductFormModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import StoreRegistrationForm from "../components/StoreRegistrationForm";
import StoreEditModal from "../components/StoreEditModal";
import BulkImportModal from "../components/BulkImportModal";
import NewTransactionModal from "../components/NewTransactionModal";
import SellModal from "../components/SellModal";
import DailyTransactionsModal from "../components/DailyTransactionsModal";
import MonthlyRevenueModal from "../components/MonthlyRevenueModal";
import OnboardingTour, { hasSeenTour } from "../components/OnboardingTour";
import { OWNER_TOUR_STEPS, OWNER_TOUR_STORAGE_KEY } from "../tours/ownerTourSteps";
import WhatsNewModal from "../components/WhatsNewModal";
import { CHANGELOG_VERSION, getLastSeenChangelogVersion, markChangelogSeen } from "../tours/changelog";
import { exportCurrentInventoryCSV } from "../utils/csvExport";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";

const STATUS_SEVERITY = { out: 0, low: 1, available: 2 };
const DESKTOP_QUERY = "(min-width: 1100px)";

// ─── Delete store confirmation (unchanged behaviour) ────────────────────────
function DeleteStoreConfirm({ isOpen, onClose, store, onDeleted }) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (!store) return;
    setDeleting(true);
    setError("");
    // Best effort: clear the logo file out of the repo first so it isn't orphaned.
    if (store.logoUrl) { try { await removeStoreLogo(store.id); } catch (e) { console.warn("logo cleanup skipped:", e); } }
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
          <motion.div className="sheet-overlay" style={{ zIndex: 1100 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden="true" />
          <motion.div className="confirm-dialog"
            initial={{ scale: 0.88, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0, transition: { type: "spring", damping: 22, stiffness: 340 } }}
            exit={{ scale: 0.92, opacity: 0, y: 8 }} role="alertdialog" aria-modal="true">
            <div className="confirm-dialog__icon-wrap"><AlertTriangle size={28} className="confirm-dialog__icon" /></div>
            <h3 className="confirm-dialog__title">{t("owner.dashboard.deleteStoreTitle")}</h3>
            <p className="confirm-dialog__desc">{t("owner.dashboard.deleteStoreDesc1")}</p>
            <p className="confirm-dialog__product-name">"{store.name}"</p>
            <p className="confirm-dialog__desc" style={{ marginTop: 4 }}>{t("owner.dashboard.deleteStoreDesc2")}</p>
            {error && <p className="confirm-dialog__error">⚠️ {error}</p>}
            <div className="confirm-dialog__actions">
              <button type="button" className="confirm-dialog__cancel" onClick={onClose} disabled={deleting}>
                <X size={16} /> {t("owner.confirmDelete.cancel")}
              </button>
              <button type="button" className="confirm-dialog__delete" onClick={handleDelete} disabled={deleting}>
                {deleting ? (
                  <><span className="map-loading-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: "#fff" }} />{t("owner.confirmDelete.deleting")}</>
                ) : (<><Trash2 size={16} /> {t("owner.confirmDelete.confirm")}</>)}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Store switcher ─────────────────────────────────────────────────────────
function StoreSwitcher({ stores, selectedStoreId, onSelect }) {
  const { t } = useLanguage();
  if (stores.length <= 1) return null;
  return (
    <div className="store-switch">
      <select value={selectedStoreId ?? ""} onChange={(e) => onSelect(e.target.value)} aria-label={t("owner.dashboard.switchStoreAria")}>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <ChevronDown size={14} />
    </div>
  );
}

// ─── Small view helpers ─────────────────────────────────────────────────────
function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h2 className="page-head__title">{title}</h2>
        {subtitle && <p className="page-head__sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

function Segmented({ options, value, onChange, tourIds = {} }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
          className={`segmented__btn ${value === o.value ? "segmented__btn--active" : ""}`}
          onClick={() => onChange(o.value)} data-tour-id={tourIds[o.value]}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Inventory CSV view — summary, preview, and the download button. */
function CsvView({ inventory, storeName }) {
  const { t } = useLanguage();
  const units = inventory.reduce((s, p) => s + (p.isService ? 0 : p.quantity ?? 0), 0);
  const low = inventory.filter((p) => p.status === "low").length;
  const out = inventory.filter((p) => p.status === "out").length;
  const preview = inventory.slice(0, 8);
  return (
    <div className="view-stack">
      <PageHeader title={t("owner.dashboard.inventoryCsv")} subtitle={t("dash.csv.subtitle")}
        actions={
          <button type="button" className="btn btn--primary" disabled={inventory.length === 0}
            onClick={() => exportCurrentInventoryCSV(inventory, storeName)}>
            <FileDown size={16} /> {t("dash.csv.download")}
          </button>
        } />
      <div className="stat-grid">
        <div className="stat"><strong>{inventory.length}</strong><span>{t("dash.csv.products")}</span></div>
        <div className="stat"><strong>{units}</strong><span>{t("dash.csv.units")}</span></div>
        <div className="stat stat--low"><strong>{low}</strong><span>{t("dash.csv.low")}</span></div>
        <div className="stat stat--out"><strong>{out}</strong><span>{t("dash.csv.out")}</span></div>
      </div>
      <section className="panel-card">
        <h3 className="panel-card__title" style={{ marginBottom: 10 }}>{t("dash.csv.preview")}</h3>
        {inventory.length === 0 ? (
          <p className="panel-card__muted">{t("owner.dashboard.noProducts")}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("owner.bulkImport.colName")}</th><th>{t("owner.bulkImport.colCategory")}</th>
                  <th className="num">{t("owner.bulkImport.colPrice")}</th><th className="num">{t("owner.bulkImport.colQuantity")}</th>
                  <th>{t("dash.csv.status")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td><td>{p.category}</td>
                    <td className="num">{formatPrice(p.price)}</td>
                    <td className="num">{p.isService ? "—" : p.quantity}</td>
                    <td><span className={`pill pill--${p.status}`}>{t(`status.${p.status}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inventory.length > preview.length && (
          <p className="panel-card__muted" style={{ marginTop: 10 }}>{t("dash.csv.more", inventory.length - preview.length)}</p>
        )}
      </section>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function OwnerDashboard({ session }) {
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const user = session?.user ?? null;
  const { isSuperAdmin } = useProfileRole(user?.id ?? null);

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
    if (!stores.some((s) => s.id === selectedStoreId)) {
      if (justAddedRef.current) {
        const newest = [...stores].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        setSelectedStoreId(newest.id);
        justAddedRef.current = false;
      } else {
        setSelectedStoreId(stores[0].id);
      }
    }
  }, [stores, selectedStoreId]);

  const myStore = stores.find((s) => s.id === selectedStoreId) ?? null;
  const { inventory } = useOwnerInventory(myStore?.id ?? null);

  // ── Navigation state ──
  const [view, setView] = useState("inventory");       // inventory|add|csv|today|monthly|reports|alerts
  const [addTab, setAddTab] = useState("single");      // single|many
  const [reportTab, setReportTab] = useState("today"); // today|monthly|csv  (mobile "Reports")
  const [focusRequest, setFocusRequest] = useState(null);

  // Map the raw view onto what the current screen size can actually show.
  const effectiveView = (() => {
    if (isDesktop) {
      if (view === "reports") return reportTab;
      if (view === "alerts") return "inventory";
      return view;
    }
    if (view === "csv" || view === "today" || view === "monthly") return "reports";
    return view;
  })();
  const activeReportTab = ["csv", "today", "monthly"].includes(view) ? view : reportTab;

  const navigate = (next, tab) => {
    if (next === "add" && tab) setAddTab(tab);
    if (["csv", "today", "monthly"].includes(next)) setReportTab(next);
    setView(next);
    window.scrollTo({ top: 0 });
  };

  const [filterQuery, setFilterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [sellingProduct, setSellingProduct] = useState(null);
  const [storeEditOpen, setStoreEditOpen] = useState(false);
  const [newTransactionOpen, setNewTransactionOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  useEffect(() => {
    if (!user || !storesChecked || storesLoading) return;
    if (!hasSeenTour(OWNER_TOUR_STORAGE_KEY)) {
      setOnboardingOpen(true);
      markChangelogSeen(CHANGELOG_VERSION);
    } else if (getLastSeenChangelogVersion() < CHANGELOG_VERSION) {
      setWhatsNewOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, storesChecked, storesLoading]);

  const tourLabels = {
    skip: t("owner.onboarding.skip"), next: t("owner.onboarding.next"),
    back: t("owner.onboarding.back"), done: t("owner.onboarding.done"),
    stepCounter: (current, total) => t("owner.onboarding.stepCounter", current, total),
  };

  // Returns { error } so StockAdjuster can show "couldn't save" instead of
  // pretending it worked.
  const handleQuantityChange = async (productId, quantity, transactionType, notes = null) => {
    const { error } = await recordStockAdjustment(productId, quantity, transactionType, notes);
    if (error) console.error("Quantity update failed:", error);
    return { error };
  };

  const openEditModal = (p) => { setEditingProduct(p); setFormModalOpen(true); };
  const openDeleteModal = (p) => { setDeletingProduct(p); setDeleteModalOpen(true); };
  const openSellModal = (p) => { setSellingProduct(p); setSellModalOpen(true); };
  const restockProduct = (p) => {
    setFilterQuery(""); setStatusFilter("all");
    setView("inventory");
    setFocusRequest({ id: p.id, n: Date.now() });
  };

  const alertCount = useMemo(
    () => inventory.filter((p) => !p.isService && (p.status === "out" || p.status === "low")).length,
    [inventory]
  );

  const filteredInventory = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    const list = inventory.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    });
    return [...list].sort((a, b) => {
      const d = (STATUS_SEVERITY[a.status] ?? 99) - (STATUS_SEVERITY[b.status] ?? 99);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }, [inventory, filterQuery, statusFilter]);

  if (!user) return <AuthScreen />;

  if (!storesChecked || storesLoading) return (
    <div className="login-screen">
      <div className="dashboard-loading"><div className="map-loading-spinner" /><span>{t("owner.dashboard.loadingStores")}</span></div>
    </div>
  );

  if (storesChecked && stores.length === 0) {
    return (
      <div style={{ minHeight: "100dvh", height: "auto", overflowY: "auto", overflowX: "hidden" }}>
        <StoreRegistrationForm user={user} onComplete={() => { justAddedRef.current = true; refetchStores(); }} />
        <div style={{ textAlign: "center", padding: "16px 0 32px" }}>
          <button type="button" style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "underline" }}
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
        <StoreRegistrationForm user={user} onCancel={() => setAddingStore(false)}
          onComplete={() => { justAddedRef.current = true; refetchStores(); setAddingStore(false); }} />
      </div>
    );
  }

  const cashRefreshKey = inventory.length + inventory.reduce((s, p) => s + (p.quantity ?? 0), 0);
  const goInventory = () => navigate("inventory");

  // ── Views ──
  const inventoryView = (
    <div className="view-stack">
      {!isDesktop && myStore && (
        <>
          <DailyCashOutCard storeId={myStore.id} refreshKey={cashRefreshKey} />
          {alertCount > 0 && (
            <button type="button" className="alert-banner" onClick={() => navigate("alerts")}>
              <AlertTriangle size={18} />
              <span>{t("alerts.banner", alertCount)}</span>
              <em>{t("alerts.view")} →</em>
            </button>
          )}
          <NeighborhoodDemandCard storeId={myStore.id} />
        </>
      )}

      <PageHeader
        title={t("owner.dashboard.inventory")}
        subtitle={filterQuery || statusFilter !== "all"
          ? t("owner.dashboard.productsCountFiltered", filteredInventory.length, inventory.length)
          : t("owner.dashboard.productsCount", filteredInventory.length)}
        actions={isDesktop ? (
          <button type="button" className="btn btn--primary" onClick={() => navigate("add", "single")}>
            <Plus size={16} strokeWidth={2.5} /> {t("owner.dashboard.addProduct")}
          </button>
        ) : null}
      />

      {inventory.length > 0 && (
        <div className="filter-bar">
          <div className="filter-bar__search">
            <Search size={16} />
            <input type="search" placeholder={t("owner.dashboard.filterPlaceholder")} value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)} />
            {filterQuery && <button type="button" onClick={() => setFilterQuery("")} aria-label="Clear">✕</button>}
          </div>
          <div className="chips" role="group">
            {[["all", t("dash.filter.all")], ["low", t("status.low")], ["out", t("status.out")]].map(([v, label]) => (
              <button key={v} type="button" className={`chip ${statusFilter === v ? "chip--active" : ""} ${v !== "all" ? `chip--${v}` : ""}`}
                onClick={() => setStatusFilter(v)}>{label}</button>
            ))}
          </div>
        </div>
      )}

      <p className="dashboard-hint">{t("owner.dashboard.hint")}</p>

      {inventory.length === 0 && (
        <div className="dashboard-empty">
          <Package size={40} style={{ opacity: 0.3 }} />
          <span>{t("owner.dashboard.noProducts")}</span>
          <button type="button" className="btn btn--primary" onClick={() => navigate("add", "single")}>
            <Plus size={16} /> {t("owner.dashboard.addFirstProduct")}
          </button>
        </div>
      )}
      {inventory.length > 0 && filteredInventory.length === 0 && (
        <div className="dashboard-empty">{t("owner.dashboard.noMatch", filterQuery)}</div>
      )}

      <div className="dashboard-product-list">
        <AnimatePresence>
          {filteredInventory.map((product, index) => (
            <ProductCard key={product.id} product={product} focusRequest={focusRequest}
              tourId={index === 0 ? "first-product-card" : undefined}
              onQuantityChange={handleQuantityChange} onEdit={openEditModal} onDelete={openDeleteModal} onSell={openSellModal} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );

  const addView = (
    <div className="view-stack">
      <PageHeader title={t("dash.add.title")} subtitle={t("dash.add.subtitle")} />
      <Segmented value={addTab} onChange={setAddTab}
        options={[
          { value: "single", label: t("dash.add.single"), icon: <PackagePlus size={16} /> },
          { value: "many", label: t("dash.add.many"), icon: <UploadCloud size={16} /> },
        ]} />
      {addTab === "single" ? (
        <div className="inline-host" key="single">
          <ProductFormModal isOpen onClose={goInventory} storeId={myStore?.id} initialData={null} />
        </div>
      ) : (
        <div className="inline-host inline-host--wide" key="many">
          <BulkImportModal isOpen onClose={goInventory} storeId={myStore?.id} />
        </div>
      )}
    </div>
  );

  const todayView = (
    <div className="inline-host inline-host--wide" key="today">
      <DailyTransactionsModal isOpen onClose={goInventory} storeId={myStore?.id} storeName={myStore?.name} />
    </div>
  );
  const monthlyView = (
    <div className="inline-host inline-host--wide" key="monthly">
      <MonthlyRevenueModal isOpen onClose={goInventory} storeId={myStore?.id} storeName={myStore?.name} />
    </div>
  );
  const csvView = <CsvView inventory={inventory} storeName={myStore?.name} />;

  const reportsView = (
    <div className="view-stack">
      <PageHeader title={t("dash.nav.reports")} />
      <Segmented value={activeReportTab} onChange={(v) => { setReportTab(v); setView(v); }}
        options={[
          { value: "today", label: t("dash.reports.today") },
          { value: "monthly", label: t("dash.reports.monthly") },
          { value: "csv", label: t("dash.reports.csv") },
        ]} />
      {activeReportTab === "today" && todayView}
      {activeReportTab === "monthly" && monthlyView}
      {activeReportTab === "csv" && csvView}
    </div>
  );

  const alertsView = (
    <div className="view-stack">
      <PageHeader title={t("alerts.title")} subtitle={t("alerts.subtitle")} />
      <StockAlertsCard inventory={inventory} onRestock={restockProduct} />
    </div>
  );

  const content = {
    inventory: inventoryView, add: addView, csv: csvView, today: todayView,
    monthly: monthlyView, reports: reportsView, alerts: alertsView,
  }[effectiveView] ?? inventoryView;

  const sidebarView = effectiveView === "reports" ? reportTab : effectiveView;

  // ── Top bar controls ──
  const iconBtn = "topbar__icon";
  const menuItem = (Icon, label, onClick, danger) => (
    <button type="button" role="menuitem" className={`menu-item ${danger ? "menu-item--danger" : ""}`}
      onClick={() => { setHeaderMenuOpen(false); onClick(); }}>
      <Icon size={16} strokeWidth={2} /> {label}
    </button>
  );

  return (
    <div className={`dash ${isDesktop ? "dash--desktop" : "dash--mobile"}`}>
      {isDesktop && (
        <Sidebar
          view={sidebarView} addTab={addTab} onNavigate={navigate}
          onNewTransaction={() => setNewTransactionOpen(true)} canSell={inventory.length > 0}
          isSuperAdmin={isSuperAdmin} storeName={myStore?.name ?? ""} storeLogoUrl={myStore?.logoUrl} alertCount={alertCount}
        />
      )}

      <div className="dash__body">
        <header className="topbar">
          <div className="topbar__title">
            <StoreAvatar name={myStore?.name ?? ""} logoUrl={myStore?.logoUrl} size={isDesktop ? 40 : 36} />
            <div style={{ minWidth: 0 }}>
              <h1>{myStore?.name ?? t("owner.dashboard.myStore")}</h1>
              <span>{myStore?.type ? `${myStore.type} · ` : ""}{user.email}</span>
            </div>
          </div>

          <div className="topbar__controls">
            <StoreSwitcher stores={stores} selectedStoreId={selectedStoreId} onSelect={setSelectedStoreId} />
            <button type="button" data-tour-id="lang-theme-toggle" className={iconBtn} style={{ width: "auto", padding: "0 10px", fontSize: 11, fontWeight: 700 }}
              onClick={() => setLanguage(language === "en" ? "tl" : "en")} aria-label={t("common.language")} title={t("common.language")}>
              <Languages size={14} />&nbsp;{language === "en" ? "TL" : "EN"}
            </button>
            <button type="button" className={iconBtn} onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {theme === "dark" ? <Sun size={15} strokeWidth={2.2} /> : <Moon size={15} strokeWidth={2.2} />}
            </button>
            <button type="button" data-tour-id="help-btn" className={iconBtn} onClick={() => setOnboardingOpen(true)}
              aria-label={t("owner.onboarding.helpAria")} title={t("owner.onboarding.helpAria")}>
              <HelpCircle size={16} strokeWidth={2.2} />
            </button>

            <div style={{ position: "relative" }}>
              <button type="button" data-tour-id="edit-store-btn" className={iconBtn}
                onClick={() => setHeaderMenuOpen((v) => !v)} aria-label={t("owner.dashboard.moreActionsAria")} aria-expanded={headerMenuOpen}>
                <MoreVertical size={16} strokeWidth={2.2} />
              </button>
              {headerMenuOpen && (
                <>
                  <div onClick={() => setHeaderMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} aria-hidden="true" />
                  <div role="menu" className="menu">
                    {menuItem(Plus, t("owner.dashboard.addStore"), () => setAddingStore(true))}
                    {menuItem(Settings, t("owner.dashboard.editStoreLabel"), () => setStoreEditOpen(true))}
                    {menuItem(Trash2, t("owner.dashboard.deleteStoreLabel"), () => setDeleteStoreConfirmOpen(true), true)}
                    <div className="menu__sep" />
                    {isSuperAdmin && (
                      <a role="menuitem" className="menu-item" href="#/admin"><Shield size={16} /> {t("dash.nav.admin")}</a>
                    )}
                    <a role="menuitem" className="menu-item" href="#/"><MapIcon size={16} /> {t("dash.nav.viewMap")}</a>
                    {menuItem(LogOut, t("owner.dashboard.signOut"), () => supabase.auth.signOut())}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="dash__content">
          <main className="dash__main">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={effectiveView} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                {content}
              </motion.div>
            </AnimatePresence>
          </main>

          {isDesktop && myStore && (
            <aside className="dash__rail" aria-label={t("dash.rail")}>
              <DailyCashOutCard storeId={myStore.id} refreshKey={cashRefreshKey} />
              <NeighborhoodDemandCard storeId={myStore.id} />
              <StockAlertsCard inventory={inventory} onRestock={restockProduct} fill />
            </aside>
          )}
        </div>
      </div>

      {!isDesktop && (
        <BottomNav
          view={effectiveView === "csv" || effectiveView === "today" || effectiveView === "monthly" ? "reports" : effectiveView}
          onNavigate={navigate} onNewTransaction={() => setNewTransactionOpen(true)}
          canSell={inventory.length > 0} alertCount={alertCount}
        />
      )}

      {/* Modals that stay modal: editing/deleting/selling a product, editing the store, new transaction. */}
      <ProductFormModal isOpen={formModalOpen} onClose={() => setFormModalOpen(false)} storeId={myStore?.id} initialData={editingProduct} />
      <SellModal isOpen={sellModalOpen} onClose={() => setSellModalOpen(false)} product={sellingProduct} onSold={() => setSellModalOpen(false)} />
      <ConfirmDeleteModal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} storeId={myStore?.id} product={deletingProduct} />
      <StoreEditModal isOpen={storeEditOpen} onClose={() => setStoreEditOpen(false)} store={myStore} />
      <NewTransactionModal isOpen={newTransactionOpen} onClose={() => setNewTransactionOpen(false)} inventory={inventory} />
      <DeleteStoreConfirm isOpen={deleteStoreConfirmOpen} onClose={() => setDeleteStoreConfirmOpen(false)} store={myStore} onDeleted={() => refetchStores()} />
      <OnboardingTour isOpen={onboardingOpen} onClose={() => setOnboardingOpen(false)}
        steps={OWNER_TOUR_STEPS} storageKey={OWNER_TOUR_STORAGE_KEY} labels={tourLabels} />
      <WhatsNewModal isOpen={whatsNewOpen} onClose={() => { setWhatsNewOpen(false); markChangelogSeen(CHANGELOG_VERSION); }} />
    </div>
  );
}
