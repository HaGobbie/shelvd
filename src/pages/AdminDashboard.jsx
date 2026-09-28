// src/pages/AdminDashboard.jsx
// Super Admin console  →  #/admin      (v2 redesign)
//
// Layout mirrors the owner dashboard: desktop sidebar / mobile bottom bar.
//   Overview  – totals + "Needs attention" (unclaimed / legacy-pending / empty stores)
//   Stores    – search + filters, logo + owner + status at a glance, edit drawer
//   Accounts  – roles (Owner / Super admin), add super admins, delete accounts
//
// Every action goes through an admin_* RPC (sql/030 + 031) that re-checks the
// role on the server; this page being hidden is a convenience, not the lock.
//
// The store editor is a SIDE DRAWER (full-screen on phones). The old centred
// dialog used translate(-50%,-50%), which Framer Motion's animation overwrote
// — that's what pushed it off the bottom of the screen.

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Store, Users, LayoutDashboard, Search, Pencil, Trash2, X, Check, Loader2, UserPlus, Sun, Moon,
  LogOut, ArrowLeft, Package, Mail, AlertTriangle, RefreshCw, Crown, Map as MapIcon, Rocket, UserX, PackageOpen, ChevronRight,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import AuthScreen from "../components/AuthScreen";
import { BrandTile } from "../components/BrandLogo";
import StoreAvatar from "../components/StoreAvatar";
import StoreLogoUploader from "../components/StoreLogoUploader";
import { useProfileRole } from "../hooks/useProfileRole";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { sanitizePhoneInput, normalizePHPhone, phoneProblem, PH_PHONE_LENGTH } from "../utils/phone";

const ROLES = ["owner", "super_admin"];
const STORE_TYPES = ["General Store", "Sari-sari Store", "Mini Grocery", "Pharmacy", "Bakery", "Meat & Fish Stall", "Vegetable Stall", "Hardware Store", "Other"];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const isLive = (s) => s.status === "approved";

// ─── Confirm dialog (existing .confirm-dialog is centred with inset+margin:auto) ──
function ConfirmBox({ open, title, body, confirmLabel, busy, onConfirm, onCancel }) {
  const { t } = useLanguage();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="sheet-overlay" style={{ zIndex: 1400 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} />
          <motion.div className="confirm-dialog" style={{ zIndex: 1401 }} role="alertdialog" aria-modal="true"
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
            <div className="confirm-dialog__icon-wrap"><AlertTriangle size={28} className="confirm-dialog__icon" /></div>
            <h3 className="confirm-dialog__title">{title}</h3>
            <p className="confirm-dialog__desc">{body}</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="confirm-dialog__cancel" onClick={onCancel} disabled={busy}><X size={16} /> {t("owner.confirmDelete.cancel")}</button>
              <button type="button" className="confirm-dialog__delete" onClick={onConfirm} disabled={busy}>
                {busy ? <Loader2 size={16} className="regform__spin" /> : <Trash2 size={16} />} {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Store editor drawer ─────────────────────────────────────────────────────
function StoreDrawer({ store, users, onClose, onSaved, onDelete, notify }) {
  const { t } = useLanguage();
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!store) { setF(null); return; }
    setErrors({});
    setF({
      name: store.name ?? "", type: store.type ?? "", owner_name: store.owner_name ?? "",
      contact_number: sanitizePhoneInput(normalizePHPhone(store.contact_number ?? "")),
      address: store.address ?? "", owner_id: store.owner_id ?? "", owner_email: store.owner_email ?? "",
      live: store.status === "approved",
      lat: store.latitude != null ? String(store.latitude) : "", lng: store.longitude != null ? String(store.longitude) : "",
    });
  }, [store]);

  useEffect(() => {
    if (!store) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, onClose]);

  if (!store || !f) return null;
  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setErrors((p) => ({ ...p, [k]: undefined })); };

  const save = async () => {
    const errs = {};
    if (!f.name.trim()) errs.name = t("admin.required");
    if (!f.type.trim()) errs.type = t("admin.required");
    if (!f.owner_name.trim()) errs.owner_name = t("admin.required");
    const pp = phoneProblem(f.contact_number);
    if (pp === "empty") errs.contact_number = t("admin.required");
    else if (pp === "invalid") errs.contact_number = t("phone.invalid");
    const lat = parseFloat(f.lat), lng = parseFloat(f.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errs.lat = t("admin.badCoord");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errs.lng = t("admin.badCoord");
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const account = users.find((u) => u.id === f.owner_id);
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_store", {
      p_store_id: store.id, p_name: f.name.trim(), p_type: f.type.trim(), p_owner_name: f.owner_name.trim(),
      p_contact_number: normalizePHPhone(f.contact_number), p_address: f.address.trim(),
      p_owner_id: f.owner_id || null, p_owner_email: (account?.email ?? f.owner_email).trim() || null,
      p_status: f.live ? "approved" : "rejected", p_lat: lat, p_lng: lng,
    });
    setSaving(false);
    if (error) { console.error(error); notify("error", t("admin.saveFailed")); return; }
    notify("ok", t("admin.storeSaved"));
    onSaved();
    onClose();
  };

  const text = (key, label, extra = {}) => (
    <div className="admin-field">
      <label htmlFor={`sf-${key}`}>{label}</label>
      <input id={`sf-${key}`} className={`pform__input ${errors[key] ? "pform__input--error" : ""}`} value={f[key]}
        onChange={(e) => set(key, extra.sanitize ? extra.sanitize(e.target.value) : e.target.value)} {...(extra.input ?? {})} />
      {errors[key] && <span className="regform__field-error">{errors[key]}</span>}
    </div>
  );

  return (
    <>
      <motion.div className="drawer-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside className="drawer" role="dialog" aria-modal="true" aria-label={t("admin.editStore")}
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "tween", duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
        <header className="drawer__head">
          <StoreAvatar name={f.name} logoUrl={store.logo_url} size={44} />
          <div className="drawer__title">
            <h3>{store.name}</h3>
            <span>{t("admin.addedOn", fmtDate(store.created_at))}</span>
          </div>
          <button type="button" className="sheet-close-btn" onClick={onClose} aria-label={t("storeDetails.close")}><X size={20} /></button>
        </header>

        <div className="drawer__body">
          <section className="drawer__section">
            <h4>{t("admin.sec.logo")}</h4>
            <StoreLogoUploader storeId={store.id} storeName={store.name} logoUrl={store.logo_url} onChanged={onSaved} />
          </section>

          <section className="drawer__section">
            <h4>{t("admin.sec.basics")}</h4>
            <div className="admin-grid">
              {text("name", t("admin.f.name"), { input: { maxLength: 80 } })}
              <div className="admin-field">
                <label htmlFor="sf-type">{t("admin.f.type")}</label>
                <input id="sf-type" list="admin-store-types" className={`pform__input ${errors.type ? "pform__input--error" : ""}`} value={f.type} onChange={(e) => set("type", e.target.value)} />
                <datalist id="admin-store-types">{STORE_TYPES.map((s) => <option key={s} value={s} />)}</datalist>
                {errors.type && <span className="regform__field-error">{errors.type}</span>}
              </div>
              {text("owner_name", t("admin.f.ownerName"), { input: { maxLength: 80 } })}
              {text("contact_number", t("admin.f.contact"), { sanitize: sanitizePhoneInput, input: { inputMode: "numeric", maxLength: PH_PHONE_LENGTH, placeholder: "09XXXXXXXXX" } })}
            </div>
            <div className="admin-field">
              <label htmlFor="sf-address">{t("admin.f.address")}</label>
              <textarea id="sf-address" className="pform__input" rows={2} style={{ resize: "vertical", fontFamily: "inherit" }} value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} />
            </div>
          </section>

          <section className="drawer__section">
            <h4>{t("admin.sec.visibility")}</h4>
            <label className="switch-row">
              <span>
                <strong>{f.live ? t("admin.live") : t("admin.hidden")}</strong>
                <em>{f.live ? t("admin.liveHint") : t("admin.hiddenHint")}</em>
              </span>
              <input type="checkbox" checked={f.live} onChange={(e) => set("live", e.target.checked)} />
              <span className="switch" aria-hidden="true" />
            </label>
          </section>

          <section className="drawer__section">
            <h4>{t("admin.sec.owner")}</h4>
            <div className="admin-field">
              <label htmlFor="sf-owner">{t("admin.f.account")}</label>
              <select id="sf-owner" className="pform__select" value={f.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
                <option value="">{t("admin.f.unclaimed")}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </div>
            {!f.owner_id && (
              <div className="admin-field">
                <label htmlFor="sf-claim">{t("admin.f.claimEmail")}</label>
                <input id="sf-claim" type="email" className="pform__input" value={f.owner_email} onChange={(e) => set("owner_email", e.target.value)} placeholder="owner@example.com" />
                <span className="auth-hint">{t("admin.f.claimHint")}</span>
              </div>
            )}
          </section>

          <section className="drawer__section">
            <h4>{t("admin.sec.location")}</h4>
            <div className="admin-grid">
              {text("lat", t("admin.f.lat"), { input: { inputMode: "decimal" } })}
              {text("lng", t("admin.f.lng"), { input: { inputMode: "decimal" } })}
            </div>
            {Number.isFinite(parseFloat(f.lat)) && Number.isFinite(parseFloat(f.lng)) && (
              <a className="rp__link" style={{ justifyContent: "flex-start" }} href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noopener noreferrer">
                <MapIcon size={14} /> {t("admin.f.previewMap")}
              </a>
            )}
          </section>

          <section className="drawer__section drawer__danger">
            <h4>{t("admin.sec.danger")}</h4>
            <p>{t("admin.dangerBody")}</p>
            <button type="button" className="btn btn--danger" onClick={() => onDelete(store)}><Trash2 size={15} /> {t("admin.deleteStoreBtn")}</button>
          </section>
        </div>

        <footer className="drawer__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>{t("owner.confirmDelete.cancel")}</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={16} className="regform__spin" /> : <Check size={16} />} {t("admin.save")}
          </button>
        </footer>
      </motion.aside>
    </>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function AdminDashboard({ session }) {
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const desktop = useMediaQuery("(min-width: 1000px)");
  const wide = useMediaQuery("(min-width: 820px)");
  const user = session?.user ?? null;
  const { isSuperAdmin, loading: roleLoading } = useProfileRole(user?.id ?? null);

  const [tab, setTab] = useState("overview");
  const [stores, setStores] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [makingLive, setMakingLive] = useState(false);

  const notify = useCallback((kind, text) => {
    setToast({ kind, text });
    window.clearTimeout(notify._t);
    notify._t = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [s, u] = await Promise.all([supabase.rpc("admin_list_stores"), supabase.rpc("admin_list_users")]);
    if (s.error || u.error) { console.error("admin load failed:", s.error || u.error); setLoadError(true); }
    else { setStores(s.data ?? []); setUsers(u.data ?? []); }
    setLoading(false);
  }, []);
  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin, load]);

  const editing = useMemo(() => stores.find((s) => s.id === editingId) ?? null, [stores, editingId]);
  const closeDrawer = useCallback(() => setEditingId(null), []);

  const q = query.trim().toLowerCase();
  const shownStores = useMemo(() => stores.filter((s) => {
    if (filter === "live" && !isLive(s)) return false;
    if (filter === "hidden" && isLive(s)) return false;
    if (filter === "unclaimed" && s.owner_id) return false;
    if (filter === "empty" && Number(s.product_count) > 0) return false;
    return !q || [s.name, s.type, s.owner_name, s.address, s.owner_email, s.account_email, s.contact_number].some((v) => (v ?? "").toLowerCase().includes(q));
  }), [stores, q, filter]);
  const shownUsers = useMemo(() => users.filter((u) => !q || (u.email ?? "").toLowerCase().includes(q) || (u.role ?? "").includes(q)), [users, q]);

  const hiddenStores = stores.filter((s) => !isLive(s));
  const unclaimed = stores.filter((s) => !s.owner_id);
  const emptyStores = stores.filter((s) => Number(s.product_count) === 0);
  const superAdmins = users.filter((u) => u.role === "super_admin");
  const totalProducts = stores.reduce((s, x) => s + Number(x.product_count ?? 0), 0);

  if (!user) return <AuthScreen />;
  if (roleLoading) return <div className="login-screen"><div className="map-loading-spinner" /></div>;
  if (!isSuperAdmin) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ alignItems: "center" }}>
          <div className="login-card__logo"><Shield size={34} /></div>
          <h1 className="login-card__title">{t("admin.deniedTitle")}</h1>
          <p className="login-card__subtitle">{t("admin.deniedBody")}</p>
          <a className="login-form__submit" href="#/dashboard" style={{ textDecoration: "none", justifyContent: "center" }}><ArrowLeft size={18} /> {t("admin.backToDashboard")}</a>
        </div>
      </div>
    );
  }

  const changeRole = async (u, role) => {
    if (role === u.role) return;
    const { error } = await supabase.rpc("admin_set_user_role", { p_user_id: u.id, p_role: role });
    if (error) { notify("error", error.message.includes("last super admin") ? t("admin.lastAdmin") : t("admin.saveFailed")); return; }
    notify("ok", t("admin.roleSaved"));
    load();
  };

  const makeAllLive = async () => {
    setMakingLive(true);
    const { data, error } = await supabase.rpc("admin_make_all_stores_live");
    setMakingLive(false);
    if (error) { notify("error", t("admin.saveFailed")); return; }
    notify("ok", t("admin.madeLive", data ?? 0));
    load();
  };

  const runDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    // Clear the store's logo file from the repo first (best effort) so it isn't orphaned.
    const logoOwners = confirm.kind === "store" ? [confirm.target] : stores.filter((s) => s.owner_id === confirm.target.id);
    for (const s of logoOwners) {
      if (s.logo_url) { try { await supabase.functions.invoke("upload-store-logo", { body: { action: "remove", storeId: s.id } }); } catch (e) { console.warn("logo cleanup skipped", e); } }
    }
    const { error } = confirm.kind === "store"
      ? await supabase.rpc("admin_delete_store", { p_store_id: confirm.target.id })
      : await supabase.rpc("admin_delete_user", { p_user_id: confirm.target.id });
    setBusy(false);
    if (error) {
      const m = error.message || "";
      notify("error", m.includes("own account") ? t("admin.cannotDeleteSelf") : m.includes("last super admin") ? t("admin.lastAdmin") : t("admin.deleteFailed"));
      return;
    }
    notify("ok", confirm.kind === "store" ? t("admin.storeDeleted") : t("admin.userDeleted"));
    setConfirm(null);
    if (confirm.kind === "store") setEditingId(null);
    load();
  };

  const addAdmin = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail.trim())) { notify("error", t("auth.invalidEmail")); return; }
    setAddingAdmin(true);
    const { data, error } = await supabase.rpc("admin_add_super_admin", { p_email: adminEmail.trim() });
    setAddingAdmin(false);
    if (error) { notify("error", t("admin.saveFailed")); return; }
    notify("ok", data === "promoted" ? t("admin.adminPromoted", adminEmail.trim()) : t("admin.adminInvited", adminEmail.trim()));
    setAdminEmail("");
    load();
  };

  const go = (id) => { setTab(id); setQuery(""); setFilter("all"); window.scrollTo({ top: 0 }); };
  const statusPill = (s) => (isLive(s)
    ? <span className="pill pill--available">{t("admin.live")}</span>
    : <span className="pill pill--low">{t("admin.hidden")}</span>);
  const ownerLabel = (s) => s.account_email ?? (s.owner_email ? `${s.owner_email} · ${t("admin.unclaimedShort")}` : null);

  const roleSelect = (u) => (
    <select className="admin-select" value={u.role === "super_admin" ? "super_admin" : "owner"} onChange={(e) => changeRole(u, e.target.value)} disabled={u.id === user.id} aria-label={t("admin.f.role")}>
      {ROLES.map((r) => <option key={r} value={r}>{t(`admin.role.${r}`)}</option>)}
    </select>
  );

  const NAV = [["overview", LayoutDashboard, t("admin.tab.overview")], ["stores", Store, t("admin.tab.stores")], ["accounts", Users, t("admin.tab.accounts")]];

  // ── Overview ──
  const attention = [
    hiddenStores.length > 0 && { key: "hidden", icon: Rocket, tone: "low", title: t("admin.att.hiddenTitle", hiddenStores.length), body: t("admin.att.hiddenBody"),
      action: <button type="button" className="btn btn--primary" onClick={makeAllLive} disabled={makingLive}>{makingLive ? <Loader2 size={15} className="regform__spin" /> : <Rocket size={15} />} {t("admin.att.makeLive")}</button> },
    unclaimed.length > 0 && { key: "unclaimed", icon: UserX, tone: "out", title: t("admin.att.unclaimedTitle", unclaimed.length), body: t("admin.att.unclaimedBody"),
      action: <button type="button" className="btn btn--ghost" onClick={() => { go("stores"); setFilter("unclaimed"); }}>{t("admin.att.review")} <ChevronRight size={15} /></button> },
    emptyStores.length > 0 && { key: "empty", icon: PackageOpen, tone: "brand", title: t("admin.att.emptyTitle", emptyStores.length), body: t("admin.att.emptyBody"),
      action: <button type="button" className="btn btn--ghost" onClick={() => { go("stores"); setFilter("empty"); }}>{t("admin.att.review")} <ChevronRight size={15} /></button> },
  ].filter(Boolean);

  const overview = (
    <div className="view-stack">
      <div className="stat-grid">
        <div className="stat"><Store size={18} /><strong>{stores.length}</strong><span>{t("admin.stat.stores")}</span></div>
        <div className="stat"><Users size={18} /><strong>{users.length}</strong><span>{t("admin.stat.accounts")}</span></div>
        <div className="stat"><Package size={18} /><strong>{totalProducts}</strong><span>{t("admin.stat.products")}</span></div>
        <div className="stat"><Crown size={18} /><strong>{superAdmins.length}</strong><span>{t("admin.stat.admins")}</span></div>
      </div>

      <section className="panel-card">
        <h3 className="panel-card__title" style={{ marginBottom: 10 }}>{t("admin.att.title")}</h3>
        {attention.length === 0 ? (
          <div className="alerts-empty"><Check size={26} color="var(--color-available)" /><strong>{t("admin.att.allGood")}</strong><span>{t("admin.att.allGoodBody")}</span></div>
        ) : (
          <ul className="att-list">
            {attention.map((a) => (
              <li key={a.key}>
                <span className={`panel-card__icon panel-card__icon--${a.tone}`}><a.icon size={18} /></span>
                <div><strong>{a.title}</strong><p>{a.body}</p></div>
                {a.action}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-card">
        <h3 className="panel-card__title" style={{ marginBottom: 6 }}>{t("admin.recentStores")}</h3>
        <ul className="admin-list">
          {stores.slice(0, 6).map((s) => (
            <li key={s.id} onClick={() => setEditingId(s.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setEditingId(s.id)}>
              <StoreAvatar name={s.name} logoUrl={s.logo_url} size={38} />
              <div><strong>{s.name}</strong><span>{s.address || "—"}</span></div>
              <span className="admin-list__meta">{ownerLabel(s) ?? t("admin.f.unclaimed")}</span>
            </li>
          ))}
          {!stores.length && !loading && <li><span>{t("admin.none")}</span></li>}
        </ul>
      </section>
    </div>
  );

  // ── Stores ──
  const filters = [["all", t("dash.filter.all"), stores.length], ["live", t("admin.live"), stores.length - hiddenStores.length], ["hidden", t("admin.hidden"), hiddenStores.length], ["unclaimed", t("admin.f.unclaimedShort"), unclaimed.length], ["empty", t("admin.f.noProducts"), emptyStores.length]];
  const storesView = (
    <div className="view-stack">
      <div className="admin-toolbar">
        <div className="filter-bar__search"><Search size={16} /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.searchStores")} /></div>
        <div className="chips chips--scroll">
          {filters.map(([v, label, n]) => (
            <button key={v} type="button" className={`chip ${filter === v ? "chip--active" : ""}`} onClick={() => setFilter(v)}>{label} <em>{n}</em></button>
          ))}
        </div>
      </div>

      {wide ? (
        <div className="table-scroll panel-card" style={{ padding: 0 }}>
          <table className="data-table data-table--admin">
            <thead><tr><th>{t("admin.f.store")}</th><th>{t("admin.f.ownerName")}</th><th>{t("admin.f.account")}</th><th>{t("admin.f.contact")}</th><th>{t("admin.f.status")}</th><th className="num">{t("admin.stat.products")}</th><th /></tr></thead>
            <tbody>
              {shownStores.map((s) => (
                <tr key={s.id} className="row-click" onClick={() => setEditingId(s.id)}>
                  <td>
                    <div className="cell-store">
                      <StoreAvatar name={s.name} logoUrl={s.logo_url} size={38} />
                      <div><strong>{s.name}</strong><span>{s.type}{s.address ? ` · ${s.address}` : ""}</span></div>
                    </div>
                  </td>
                  <td>{s.owner_name}</td>
                  <td>{ownerLabel(s) ?? <em className="muted">{t("admin.f.unclaimed")}</em>}</td>
                  <td>{s.contact_number || "—"}</td>
                  <td>{statusPill(s)}</td>
                  <td className="num">{s.product_count}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="icon-btn" onClick={() => setEditingId(s.id)} aria-label={t("admin.edit")} title={t("admin.edit")}><Pencil size={15} /></button>
                    <button type="button" className="icon-btn icon-btn--danger" onClick={() => setConfirm({ kind: "store", target: s })} aria-label={t("admin.delete")} title={t("admin.delete")}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shownStores.length && !loading && <p className="panel-card__muted" style={{ padding: 16 }}>{t("admin.none")}</p>}
        </div>
      ) : (
        <div className="admin-cards">
          {shownStores.map((s) => (
            <div key={s.id} className="panel-card admin-scard" onClick={() => setEditingId(s.id)} role="button" tabIndex={0}>
              <div className="admin-scard__top">
                <StoreAvatar name={s.name} logoUrl={s.logo_url} size={44} />
                <div><strong>{s.name}</strong><span>{s.type}</span></div>
                {statusPill(s)}
              </div>
              <p className="admin-cards__line"><Mail size={12} /> {ownerLabel(s) ?? t("admin.f.unclaimed")}</p>
              <p className="admin-cards__line">{s.address || "—"}</p>
              <p className="admin-cards__line"><Package size={12} /> {t("admin.productsN", s.product_count)}</p>
            </div>
          ))}
          {!shownStores.length && !loading && <p className="panel-card__muted">{t("admin.none")}</p>}
        </div>
      )}
    </div>
  );

  // ── Accounts ──
  const accountsView = (
    <div className="view-stack">
      <section className="panel-card">
        <h3 className="panel-card__title" style={{ marginBottom: 4 }}><UserPlus size={16} style={{ verticalAlign: "-3px" }} /> {t("admin.addAdminTitle")}</h3>
        <p className="panel-card__muted" style={{ marginBottom: 10 }}>{t("admin.addAdminBody")}</p>
        <form className="admin-add" onSubmit={addAdmin}>
          <input type="email" className="pform__input" placeholder="new-admin@example.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          <button type="submit" className="btn btn--primary" disabled={addingAdmin || !adminEmail.trim()}>
            {addingAdmin ? <Loader2 size={16} className="regform__spin" /> : <Shield size={16} />} {t("admin.addAdminBtn")}
          </button>
        </form>
      </section>

      <div className="admin-toolbar"><div className="filter-bar__search"><Search size={16} /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.searchAccounts")} /></div></div>

      {wide ? (
        <div className="table-scroll panel-card" style={{ padding: 0 }}>
          <table className="data-table data-table--admin">
            <thead><tr><th>{t("admin.f.email")}</th><th>{t("admin.f.role")}</th><th>{t("admin.f.storesOwned")}</th><th>{t("admin.f.created")}</th><th>{t("admin.f.lastSignIn")}</th><th /></tr></thead>
            <tbody>
              {shownUsers.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.email}</strong>{u.id === user.id && <span className="pill pill--low" style={{ marginLeft: 8 }}>{t("admin.you")}</span>}</td>
                  <td>{roleSelect(u)}</td>
                  <td>{Number(u.store_count) || "—"}</td>
                  <td>{fmtDate(u.created_at)}</td><td>{fmtDate(u.last_sign_in_at)}</td>
                  <td className="actions">
                    <button type="button" className="icon-btn icon-btn--danger" disabled={u.id === user.id} onClick={() => setConfirm({ kind: "user", target: u })}
                      aria-label={t("admin.delete")} title={u.id === user.id ? t("admin.cannotDeleteSelf") : t("admin.delete")}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-cards">
          {shownUsers.map((u) => (
            <div key={u.id} className="panel-card">
              <div className="admin-cards__top"><strong style={{ wordBreak: "break-all" }}>{u.email}</strong>{u.id === user.id && <span className="pill pill--low">{t("admin.you")}</span>}</div>
              <p className="admin-cards__line">{t("admin.f.storesOwned")}: {u.store_count} · {t("admin.f.lastSignIn")}: {fmtDate(u.last_sign_in_at)}</p>
              <div className="admin-cards__actions">
                {roleSelect(u)}
                <button type="button" className="btn btn--danger" disabled={u.id === user.id} onClick={() => setConfirm({ kind: "user", target: u })}><Trash2 size={14} /> {t("admin.delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!shownUsers.length && !loading && <p className="panel-card__muted">{t("admin.none")}</p>}
    </div>
  );

  const pageTitle = { overview: t("admin.tab.overview"), stores: t("admin.tab.stores"), accounts: t("admin.tab.accounts") }[tab];

  return (
    <div className={`adm ${desktop ? "adm--desktop" : ""}`}>
      {desktop && (
        <aside className="sidebar">
          <div className="sidebar__brand"><BrandTile size={38} tone="light" /><div><strong>Shelvd</strong><span>{t("admin.console")}</span></div></div>
          <nav className="sidebar__nav">
            <span className="sidebar__group">{t("admin.manage")}</span>
            {NAV.map(([id, Icon, label]) => (
              <button key={id} type="button" className={`side-item ${tab === id ? "side-item--active" : ""}`} onClick={() => go(id)} aria-current={tab === id ? "page" : undefined}>
                <Icon size={18} /><span>{label}</span>
                {id === "overview" && attention.length > 0 && <em className="side-item__badge">{attention.length}</em>}
              </button>
            ))}
          </nav>
          <div className="sidebar__foot">
            <a className="side-item" href="#/dashboard"><ArrowLeft size={18} /><span>{t("admin.dashboardLink")}</span></a>
            <a className="side-item" href="#/"><MapIcon size={18} /><span>{t("dash.nav.viewMap")}</span></a>
          </div>
        </aside>
      )}

      <div className="adm__body">
        <header className="topbar">
          <div className="topbar__title">
            {!desktop && <BrandTile size={34} tone="dark" />}
            <div style={{ minWidth: 0 }}><h1>{pageTitle}</h1><span>{user.email}</span></div>
          </div>
          <div className="topbar__controls">
            <button type="button" className="topbar__icon" onClick={load} disabled={loading} aria-label={t("admin.refresh")} title={t("admin.refresh")}><RefreshCw size={15} className={loading ? "regform__spin" : ""} /></button>
            <button type="button" className="topbar__icon" style={{ padding: "0 10px", fontSize: 11, fontWeight: 700 }} onClick={() => setLanguage(language === "en" ? "tl" : "en")}>{language === "en" ? "TL" : "EN"}</button>
            <button type="button" className="topbar__icon" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
            {!desktop && <a className="topbar__icon" href="#/dashboard" aria-label={t("admin.dashboardLink")} title={t("admin.dashboardLink")}><ArrowLeft size={15} /></a>}
            <button type="button" className="topbar__icon" onClick={() => supabase.auth.signOut()} aria-label={t("owner.dashboard.signOut")} title={t("owner.dashboard.signOut")}><LogOut size={15} /></button>
          </div>
        </header>

        <main className="adm__main">
          {loadError && <div className="admin__error"><AlertTriangle size={18} /><div><strong>{t("admin.loadFailed")}</strong><p>{t("admin.loadFailedHint")}</p></div></div>}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {tab === "overview" && overview}
              {tab === "stores" && storesView}
              {tab === "accounts" && accountsView}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {!desktop && (
        <nav className="bnav bnav--3" aria-label={t("dash.nav.main")}>
          {NAV.map(([id, Icon, label]) => (
            <button key={id} type="button" className={`bnav__item ${tab === id ? "bnav__item--active" : ""}`} onClick={() => go(id)}>
              <span className="bnav__icon"><Icon size={21} strokeWidth={tab === id ? 2.4 : 2} />{id === "overview" && attention.length > 0 && <em className="bnav__badge">{attention.length}</em>}</span>
              <span className="bnav__label">{label}</span>
            </button>
          ))}
        </nav>
      )}

      <AnimatePresence>
        {editing && <StoreDrawer key={editing.id} store={editing} users={users} onClose={closeDrawer} onSaved={load} onDelete={(s) => setConfirm({ kind: "store", target: s })} notify={notify} />}
      </AnimatePresence>

      <ConfirmBox open={Boolean(confirm)} busy={busy} onCancel={() => setConfirm(null)} onConfirm={runDelete}
        title={confirm?.kind === "store" ? t("admin.deleteStoreTitle") : t("admin.deleteUserTitle")}
        body={confirm?.kind === "store" ? t("admin.deleteStoreBody", confirm?.target?.name) : t("admin.deleteUserBody", confirm?.target?.email, confirm?.target?.store_count ?? 0)}
        confirmLabel={t("admin.delete")} />

      <AnimatePresence>
        {toast && (
          <motion.div className={`admin-toast admin-toast--${toast.kind}`} role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {toast.kind === "ok" ? <Check size={16} /> : <AlertTriangle size={16} />} {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
