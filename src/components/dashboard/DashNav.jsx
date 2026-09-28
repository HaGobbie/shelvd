// src/components/dashboard/DashNav.jsx
// Desktop left sidebar + mobile bottom navigation bar.

import React from "react";
import {
  Store, Package, PackagePlus, UploadCloud, FileDown, Receipt, TrendingUp,
  ShoppingCart, Plus, AlertTriangle, BarChart3, Map as MapIcon, Shield,
} from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";
import { BrandTile } from "../BrandLogo";
import StoreAvatar from "../StoreAvatar";

function SideItem({ icon: Icon, label, active, onClick, tourId, badge }) {
  return (
    <button type="button" className={`side-item ${active ? "side-item--active" : ""}`}
      onClick={onClick} data-tour-id={tourId} aria-current={active ? "page" : undefined}>
      <Icon size={18} strokeWidth={2} />
      <span>{label}</span>
      {badge > 0 && <em className="side-item__badge">{badge}</em>}
    </button>
  );
}

/** Desktop sidebar. `view` is one of: inventory | add | csv | today | monthly. `addTab` is single | many. */
export function Sidebar({ view, addTab, onNavigate, onNewTransaction, canSell, isSuperAdmin, storeName, storeLogoUrl, alertCount }) {
  const { t } = useLanguage();
  return (
    <aside className="sidebar" aria-label={t("dash.nav.main")}>
      <div className="sidebar__brand">
        <BrandTile size={38} tone="light" />
        <div>
          <strong>Shelvd</strong>
          <span>{t("dash.nav.ownerSpace")}</span>
        </div>
      </div>

      <div className="sidebar__store">
        <StoreAvatar name={storeName} logoUrl={storeLogoUrl} size={36} />
        <span title={storeName}>{storeName}</span>
      </div>

      <button type="button" className="sidebar__cta" onClick={onNewTransaction} disabled={!canSell} data-tour-id="new-transaction-btn">
        <ShoppingCart size={18} strokeWidth={2.2} /> {t("owner.dashboard.newTransaction")}
      </button>

      <nav className="sidebar__nav">
        <span className="sidebar__group">{t("dash.nav.manage")}</span>
        <SideItem icon={Package} label={t("owner.dashboard.inventory")} active={view === "inventory"}
          onClick={() => onNavigate("inventory")} badge={alertCount} />
        <SideItem icon={PackagePlus} label={t("owner.dashboard.addProduct")} active={view === "add" && addTab === "single"}
          onClick={() => onNavigate("add", "single")} tourId="add-product-btn" />
        <SideItem icon={UploadCloud} label={t("dash.nav.addMany")} active={view === "add" && addTab === "many"}
          onClick={() => onNavigate("add", "many")} tourId="bulk-import-btn" />

        <span className="sidebar__group">{t("dash.nav.reportsGroup")}</span>
        <div data-tour-id="reports-toolbar" className="sidebar__reports">
          <SideItem icon={FileDown} label={t("owner.dashboard.inventoryCsv")} active={view === "csv"} onClick={() => onNavigate("csv")} />
          <SideItem icon={Receipt} label={t("owner.dashboard.todaysTransactions")} active={view === "today"} onClick={() => onNavigate("today")} />
          <SideItem icon={TrendingUp} label={t("owner.dashboard.monthlyRevenue")} active={view === "monthly"} onClick={() => onNavigate("monthly")} />
        </div>
      </nav>

      <div className="sidebar__foot">
        {isSuperAdmin && (
          <a className="side-item" href="#/admin"><Shield size={18} /><span>{t("dash.nav.admin")}</span></a>
        )}
        <a className="side-item" href="#/"><MapIcon size={18} /><span>{t("dash.nav.viewMap")}</span></a>
      </div>
    </aside>
  );
}

/** Mobile bottom bar. `view`: inventory | add | reports | alerts. Centre button = New transaction. */
export function BottomNav({ view, onNavigate, onNewTransaction, canSell, alertCount }) {
  const { t } = useLanguage();
  const Item = ({ id, icon: Icon, label, badge, tourId }) => (
    <button type="button" className={`bnav__item ${view === id ? "bnav__item--active" : ""}`}
      onClick={() => onNavigate(id)} data-tour-id={tourId} aria-current={view === id ? "page" : undefined}>
      <span className="bnav__icon">
        <Icon size={21} strokeWidth={view === id ? 2.4 : 2} />
        {badge > 0 && <em className="bnav__badge">{badge > 9 ? "9+" : badge}</em>}
      </span>
      <span className="bnav__label">{label}</span>
    </button>
  );
  return (
    <nav className="bnav" aria-label={t("dash.nav.main")}>
      <Item id="inventory" icon={Package} label={t("dash.nav.inventoryShort")} />
      <Item id="add" icon={Plus} label={t("dash.nav.add")} tourId="add-product-btn" />
      <button type="button" className="bnav__fab" onClick={onNewTransaction} disabled={!canSell}
        aria-label={t("owner.dashboard.newTransaction")} data-tour-id="new-transaction-btn">
        <ShoppingCart size={24} strokeWidth={2.2} />
      </button>
      <Item id="reports" icon={BarChart3} label={t("dash.nav.reports")} tourId="reports-toolbar" />
      <Item id="alerts" icon={AlertTriangle} label={t("dash.nav.alerts")} badge={alertCount} />
    </nav>
  );
}
