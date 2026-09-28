// src/pages/AdminDashboard.jsx
// Super Admin console  →  #/admin
//
// Requires the SQL in sql/030_super_admin_part1_enum.sql and
// sql/030_super_admin_part2_policies_and_rpcs.sql, and a profile whose
// role = 'super_admin'. Every action goes through an admin_* RPC that
// re-checks the role server-side, so hiding this page in the UI is a
// convenience — not the security boundary.
//
// Tabs:  Overview │ Stores (view + edit everything, reassign owner account,
//        delete) │ Accounts (change roles, delete, add super admins)

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Store, Users, LayoutDashboard, Search, Pencil, Trash2, X, Check, Loader2, UserPlus,
  Sun, Moon, LogOut, ArrowLeft, Package, Mail, AlertTriangle, RefreshCw, Crown,
} from "lucide-react";
import { supabase } from "../config/supabaseClient";
import AuthScreen from "../components/AuthScreen";
import { useProfileRole } from "../hooks/useProfileRole";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";
import { sanitizePhoneInput, normalizePHPhone, phoneProblem, PH_PHONE_LENGTH } from "../utils/phone";

const ROLES = ["owner", "staff", "barangay_official", "super_admin"];
const STATUSES = ["approved", "pending_approval", "rejected"];
const STORE_TYPES = ["General Store", "Sari-sari Store", "Mini Grocery", "Pharmacy", "Bakery", "Meat & Fish Stall", "Vegetable Stall", "Hardware Store", "Other"];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

// ─── Confirm dialog ──────────────────────────────────────────────────────────
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

// ─── Store edit dialog ───────────────────────────────────────────────────────
function StoreEditDialog({ store, users, onClose, onSaved, notify }) {
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
      status: store.status ?? "approved",
      lat: store.latitude != null ? String(store.latitude) : "", lng: store.longitude != null ? String(store.longitude) : "",
    });
  }, [store]);

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
      p_status: f.status, p_lat: lat, p_lng: lng,
    });
    setSaving(false);
    if (error) { console.error(error); notify("error", t("admin.saveFailed")); return; }
    notify("ok", t("admin.storeSaved"));
    onSaved();
    onClose();
  };

  const field = (key, label, props = {}) => (
    <div className="admin-field">
      <label htmlFor={`sf-${key}`}>{label}</label>
      <input id={`sf-${key}`} className={`pform__input ${errors[key] ? "pform__input--error" : ""}`}
        value={f[key]} onChange={(e) => set(key, props.sanitize ? props.sanitize(e.target.value) : e.target.value)} {...props.input} />
      {errors[key] && <span className="regform__field-error">{errors[key]}</span>}
    </div>
  );

  return (
    <>
      <motion.div className="sheet-overlay" style={{ zIndex: 1300 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} />
      <motion.div className="admin-dialog" style={{ zIndex: 1301 }} role="dialog" aria-modal="true"
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
        <div className="admin-dialog__head">
          <div><h3>{t("admin.editStore")}</h3><span>{store.id}</span></div>
          <button type="button" className="sheet-close-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="admin-dialog__body">
          <div className="admin-grid">
            {field("name", t("admin.f.name"), { input: { maxLength: 80 } })}
            <div className="admin-field">
              <label htmlFor="sf-type">{t("admin.f.type")}</label>
              <input id="sf-type" list="admin-store-types" className={`pform__input ${errors.type ? "pform__input--error" : ""}`}
                value={f.type} onChange={(e) => set("type", e.target.value)} />
              <datalist id="admin-store-types">{STORE_TYPES.map((s) => <option key={s} value={s} />)}</datalist>
              {errors.type && <span className="regform__field-error">{errors.type}</span>}
            </div>
            {field("owner_name", t("admin.f.ownerName"), { input: { maxLength: 80 } })}
            {field("contact_number", t("admin.f.contact"), { sanitize: sanitizePhoneInput, input: { inputMode: "numeric", maxLength: PH_PHONE_LENGTH, placeholder: "09XXXXXXXXX" } })}
          </div>
          <div className="admin-field">
            <label htmlFor="sf-address">{t("admin.f.address")}</label>
            <textarea id="sf-address" className="pform__input" rows={2} style={{ resize: "vertical", fontFamily: "inherit" }}
              value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} />
          </div>

          <div className="admin-section-label">{t("admin.f.accountSection")}</div>
          <div className="admin-grid">
            <div className="admin-field">
              <label htmlFor="sf-owner">{t("admin.f.account")}</label>
              <select id="sf-owner" className="pform__select" value={f.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
                <option value="">{t("admin.f.unclaimed")}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="sf-status">{t("admin.f.status")}</label>
              <select id="sf-status" className="pform__select" value={f.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`admin.status.${s}`)}</option>)}
              </select>
            </div>
          </div>
          {!f.owner_id && (
            <div className="admin-field">
              <label htmlFor="sf-claim">{t("admin.f.claimEmail")}</label>
              <input id="sf-claim" type="email" className="pform__input" value={f.owner_email} onChange={(e) => set("owner_email", e.target.value)} placeholder="owner@example.com" />
              <span className="auth-hint">{t("admin.f.claimHint")}</span>
            </div>
          )}

          <div className="admin-section-label">{t("admin.f.locationSection")}</div>
          <div className="admin-grid">
            {field("lat", t("admin.f.lat"), { input: { inputMode: "decimal" } })}
            {field("lng", t("admin.f.lng"), { input: { inputMode: "decimal" } })}
          </div>
          {Number.isFinite(parseFloat(f.lat)) && Number.isFinite(parseFloat(f.lng)) && (
            <a className="rp__link" href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noopener noreferrer">
              {t("admin.f.previewMap")}
            </a>
          )}
        </div>
        <div className="admin-dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>{t("owner.confirmDelete.cancel")}</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={16} className="regform__spin" /> : <Check size={16} />} {t("admin.save")}
          </button>
        </div>
      </motion.div>
    </>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function AdminDashboard({ session }) {
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const wide = useMediaQuery("(min-width: 900px)");
  const user = session?.user ?? null;
  const { isSuperAdmin, loading: roleLoading } = useProfileRole(user?.id ?? null);

  const [tab, setTab] = useState("overview");
  const [stores, setStores] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'store'|'user', target }
  const [busy, setBusy] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [addingAdmin, setAddingAdmin] = useState(false);

  const notify = useCallback((kind, text) => {
    setToast({ kind, text });
    window.clearTimeout(notify._t);
    notify._t = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [s, u] = await Promise.all([supabase.rpc("admin_list_stores"), supabase.rpc("admin_list_users")]);
    if (s.error || u.error) {
      console.error("admin load failed:", s.error || u.error);
      setLoadError(true);
    } else {
      setStores(s.data ?? []);
      setUsers(u.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin, load]);

  const q = query.trim().toLowerCase();
  const shownStores = useMemo(() => stores.filter((s) =>
    !q || [s.name, s.type, s.owner_name, s.address, s.owner_email, s.account_email, s.contact_number].some((v) => (v ?? "").toLowerCase().includes(q))
  ), [stores, q]);
  const shownUsers = useMemo(() => users.filter((u) => !q || (u.email ?? "").toLowerCase().includes(q) || (u.role ?? "").includes(q)), [users, q]);

  const storesByOwner = useMemo(() => {
    const m = new Map();
    stores.forEach((s) => { if (s.owner_id) m.set(s.owner_id, [...(m.get(s.owner_id) ?? []), s.name]); });
    return m;
  }, [stores]);

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

  const runDelete = async () => {
    if (!confirm) return;
    setBusy(true);
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

  const superAdmins = users.filter((u) => u.role === "super_admin");
  const totalProducts = stores.reduce((s, x) => s + Number(x.product_count ?? 0), 0);

  const roleSelect = (u) => (
    <select className="admin-select" value={u.role ?? "owner"} onChange={(e) => changeRole(u, e.target.value)}
      disabled={u.id === user.id} aria-label={t("admin.f.role")}>
      {ROLES.map((r) => <option key={r} value={r}>{t(`admin.role.${r}`)}</option>)}
    </select>
  );

  const statusPill = (s) => <span className={`pill pill--${s === "approved" ? "available" : s === "rejected" ? "out" : "low"}`}>{t(`admin.status.${s}`)}</span>;

  return (
    <div className="admin">
      <header className="admin__bar">
        <div className="admin__brand"><span className="admin__logo"><Shield size={18} /></span><div><strong>Shelvd</strong><span>{t("admin.console")}</span></div></div>
        <div className="admin__bar-right">
          <a className="topbar__icon" href="#/dashboard" style={{ width: "auto", padding: "0 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}><ArrowLeft size={14} />&nbsp;{t("admin.dashboardLink")}</a>
          <button type="button" className="topbar__icon" style={{ width: "auto", padding: "0 10px", fontSize: 11, fontWeight: 700 }} onClick={() => setLanguage(language === "en" ? "tl" : "en")}>{language === "en" ? "TL" : "EN"}</button>
          <button type="button" className="topbar__icon" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
          <button type="button" className="topbar__icon" onClick={() => supabase.auth.signOut()} aria-label={t("owner.dashboard.signOut")} title={t("owner.dashboard.signOut")}><LogOut size={15} /></button>
        </div>
      </header>

      <div className="admin__wrap">
        <div className="admin__tabs" role="tablist">
          {[["overview", LayoutDashboard, t("admin.tab.overview")], ["stores", Store, t("admin.tab.stores")], ["accounts", Users, t("admin.tab.accounts")]].map(([id, Icon, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`admin__tab ${tab === id ? "admin__tab--active" : ""}`}
              onClick={() => { setTab(id); setQuery(""); }}><Icon size={16} /> {label}</button>
          ))}
          <button type="button" className="admin__refresh" onClick={load} disabled={loading} aria-label={t("admin.refresh")} title={t("admin.refresh")}>
            <RefreshCw size={15} className={loading ? "regform__spin" : ""} />
          </button>
        </div>

        {loadError && (
          <div className="admin__error"><AlertTriangle size={18} /> <div><strong>{t("admin.loadFailed")}</strong><p>{t("admin.loadFailedHint")}</p></div></div>
        )}

        {tab === "overview" && (
          <div className="view-stack">
            <div className="stat-grid">
              <div className="stat"><Store size={18} /><strong>{stores.length}</strong><span>{t("admin.stat.stores")}</span></div>
              <div className="stat"><Users size={18} /><strong>{users.length}</strong><span>{t("admin.stat.accounts")}</span></div>
              <div className="stat"><Package size={18} /><strong>{totalProducts}</strong><span>{t("admin.stat.products")}</span></div>
              <div className="stat"><Crown size={18} /><strong>{superAdmins.length}</strong><span>{t("admin.stat.admins")}</span></div>
            </div>
            <section className="panel-card">
              <h3 className="panel-card__title" style={{ marginBottom: 10 }}>{t("admin.recentStores")}</h3>
              <ul className="admin-list">
                {stores.slice(0, 6).map((s) => (
                  <li key={s.id}><div><strong>{s.name}</strong><span>{s.address || "—"}</span></div><span className="admin-list__meta">{s.account_email ?? s.owner_email ?? t("admin.f.unclaimed")}</span></li>
                ))}
                {!stores.length && !loading && <li><span>{t("admin.none")}</span></li>}
              </ul>
            </section>
          </div>
        )}

        {tab !== "overview" && (
          <div className="filter-bar__search admin__search">
            <Search size={16} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "stores" ? t("admin.searchStores") : t("admin.searchAccounts")} />
          </div>
        )}

        {tab === "stores" && (
          wide ? (
            <div className="table-scroll panel-card" style={{ padding: 0 }}>
              <table className="data-table data-table--admin">
                <thead><tr><th>{t("admin.f.name")}</th><th>{t("admin.f.type")}</th><th>{t("admin.f.ownerName")}</th><th>{t("admin.f.account")}</th><th>{t("admin.f.contact")}</th><th>{t("admin.f.address")}</th><th>{t("admin.f.status")}</th><th className="num">{t("admin.stat.products")}</th><th /></tr></thead>
                <tbody>
                  {shownStores.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong></td><td>{s.type}</td><td>{s.owner_name}</td>
                      <td>{s.account_email ?? <em className="muted">{s.owner_email ? `${s.owner_email} (${t("admin.unclaimedShort")})` : t("admin.f.unclaimed")}</em>}</td>
                      <td>{s.contact_number || "—"}</td><td className="clip" title={s.address}>{s.address || "—"}</td>
                      <td>{statusPill(s.status)}</td><td className="num">{s.product_count}</td>
                      <td className="actions">
                        <button type="button" className="icon-btn" onClick={() => setEditing(s)} aria-label={t("admin.edit")} title={t("admin.edit")}><Pencil size={15} /></button>
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
                <div key={s.id} className="panel-card">
                  <div className="admin-cards__top"><strong>{s.name}</strong>{statusPill(s.status)}</div>
                  <p className="admin-cards__line">{s.type} · {s.owner_name}</p>
                  <p className="admin-cards__line"><Mail size={12} /> {s.account_email ?? s.owner_email ?? t("admin.f.unclaimed")}</p>
                  <p className="admin-cards__line">{s.address || "—"}</p>
                  <div className="admin-cards__actions">
                    <button type="button" className="btn btn--ghost" onClick={() => setEditing(s)}><Pencil size={14} /> {t("admin.edit")}</button>
                    <button type="button" className="btn btn--danger" onClick={() => setConfirm({ kind: "store", target: s })}><Trash2 size={14} /> {t("admin.delete")}</button>
                  </div>
                </div>
              ))}
              {!shownStores.length && !loading && <p className="panel-card__muted">{t("admin.none")}</p>}
            </div>
          )
        )}

        {tab === "accounts" && (
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

            {wide ? (
              <div className="table-scroll panel-card" style={{ padding: 0 }}>
                <table className="data-table data-table--admin">
                  <thead><tr><th>{t("admin.f.email")}</th><th>{t("admin.f.role")}</th><th>{t("admin.f.storesOwned")}</th><th>{t("admin.f.created")}</th><th>{t("admin.f.lastSignIn")}</th><th /></tr></thead>
                  <tbody>
                    {shownUsers.map((u) => (
                      <tr key={u.id}>
                        <td><strong>{u.email}</strong>{u.id === user.id && <span className="pill pill--low" style={{ marginLeft: 8 }}>{t("admin.you")}</span>}</td>
                        <td>{roleSelect(u)}</td>
                        <td className="clip" title={(storesByOwner.get(u.id) ?? []).join(", ")}>{Number(u.store_count) ? `${u.store_count} — ${(storesByOwner.get(u.id) ?? []).join(", ")}` : "—"}</td>
                        <td>{fmtDate(u.created_at)}</td><td>{fmtDate(u.last_sign_in_at)}</td>
                        <td className="actions">
                          <button type="button" className="icon-btn icon-btn--danger" disabled={u.id === user.id}
                            onClick={() => setConfirm({ kind: "user", target: u })} aria-label={t("admin.delete")} title={u.id === user.id ? t("admin.cannotDeleteSelf") : t("admin.delete")}><Trash2 size={15} /></button>
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
                    <p className="admin-cards__line">{t("admin.f.storesOwned")}: {u.store_count}</p>
                    <p className="admin-cards__line">{t("admin.f.lastSignIn")}: {fmtDate(u.last_sign_in_at)}</p>
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
        )}
      </div>

      <AnimatePresence>
        {editing && <StoreEditDialog key={editing.id} store={editing} users={users} onClose={() => setEditing(null)} onSaved={load} notify={notify} />}
      </AnimatePresence>

      <ConfirmBox open={Boolean(confirm)} busy={busy} onCancel={() => setConfirm(null)} onConfirm={runDelete}
        title={confirm?.kind === "store" ? t("admin.deleteStoreTitle") : t("admin.deleteUserTitle")}
        body={confirm?.kind === "store"
          ? t("admin.deleteStoreBody", confirm?.target?.name)
          : t("admin.deleteUserBody", confirm?.target?.email, confirm?.target?.store_count ?? 0)}
        confirmLabel={t("admin.delete")} />

      <AnimatePresence>
        {toast && (
          <motion.div className={`admin-toast admin-toast--${toast.kind}`} role="status"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {toast.kind === "ok" ? <Check size={16} /> : <AlertTriangle size={16} />} {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
