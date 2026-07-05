// src/pages/OwnerDashboard.jsx
// Full Owner Dashboard — now includes:
//   ✅ Google Sign-In + Email/Password login
//   ✅ Auto-routing: no store found → StoreRegistrationForm
//   ✅ Real-time Inventory listener
//   ✅ Status toggle, Add, Edit, Delete products
//   ✅ All product writes update `lastUpdated` via serverTimestamp()
//   ✅ Store document `updatedAt` field is bumped on every product write

import React, { useState, useEffect } from "react";
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
  Pencil,
  Trash2,
  Settings,
} from "lucide-react";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { formatLastUpdated } from "../hooks/useStores";
import ProductFormModal from "../components/ProductFormModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import StoreRegistrationForm from "../components/StoreRegistrationForm";
import StoreEditModal from "../components/StoreEditModal";

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("email");
googleProvider.addScope("profile");

const STATUS_OPTIONS = [
  { value: "available", label: "Available",    Icon: PackageCheck, color: "#2ECC71", bg: "rgba(46,204,113,0.1)",  border: "rgba(46,204,113,0.5)"  },
  { value: "low",       label: "Low Stock",    Icon: AlertTriangle, color: "#F1C40F", bg: "rgba(241,196,15,0.1)", border: "rgba(241,196,15,0.5)" },
  { value: "out",       label: "Out of Stock", Icon: PackageX,     color: "#E74C3C", bg: "rgba(231,76,60,0.1)",  border: "rgba(231,76,60,0.5)"  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusRadioGroup({ currentStatus, onChange, productId }) {
  return (
    <div className="status-radio-group" role="radiogroup">
      {STATUS_OPTIONS.map(({ value, label, Icon, color, bg, border }) => {
        const sel = currentStatus === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={sel}
            className={`status-radio-tile ${sel ? "status-radio-tile--active" : ""}`}
            style={sel ? { background: bg, borderColor: border, color } : {}}
            onClick={() => onChange(productId, value)}>
            <Icon size={22} strokeWidth={sel ? 2.5 : 1.8} />
            <span>{label}</span>
            {sel && <CheckCircle2 size={14} className="status-radio-tile__check" style={{ color }} />}
          </button>
        );
      })}
    </div>
  );
}

function ProductCard({ product, storeId, onStatusChange, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const cfg = STATUS_OPTIONS.find((o) => o.value === product.status);

  const handleStatusChange = async (pid, newStatus) => {
    await onStatusChange(storeId, pid, newStatus);
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
            <span className="product-card__category">{product.category}</span>
          </div>
          <div className="product-card__right">
            {localSaved
              ? <span className="product-card__saved"><CheckCircle2 size={14} /> Saved</span>
              : <span className="product-card__status-pill" style={{ color: cfg?.color, borderColor: cfg?.color }}>{cfg?.label}</span>}
            <span className={`product-card__chevron ${expanded ? "product-card__chevron--open" : ""}`}>▾</span>
          </div>
        </button>
        <div className="product-card__actions">
          <button type="button" className="product-card__action-btn product-card__action-btn--edit"
            onClick={() => onEdit(product)} aria-label={`Edit ${product.name}`} title="Edit">
            <Pencil size={15} strokeWidth={2} />
          </button>
          <button type="button" className="product-card__action-btn product-card__action-btn--delete"
            onClick={() => onDelete(product)} aria-label={`Delete ${product.name}`} title="Delete">
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
              <Clock size={12} />&nbsp;Last updated: {formatLastUpdated(product.lastUpdated)}
            </div>
            <StatusRadioGroup currentStatus={product.status} productId={product.id} onChange={handleStatusChange} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Login screen with Google + Email ────────────────────────────────────────
function LoginScreen() {
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [gLoading, setGLoading]   = useState(false);

  const handleGoogle = async () => {
    setError(""); setGLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err.code === "auth/popup-blocked") {
        setError("Popup was blocked by your browser. Please allow popups for this site.");
      } else if (err.code !== "auth/popup-closed-by-user") {
        setError("Google sign-in failed. Please try again.");
      }
    } finally { setGLoading(false); }
  };

  const handleEmail = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        setError("Incorrect email or password.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait before trying again.");
      } else {
        setError("Sign-in failed. Check your connection and try again.");
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__logo"><Store size={36} /></div>
        <h1 className="login-card__title">Store Owner Portal</h1>
        <p className="login-card__subtitle">Sign in to manage your store's inventory for the community.</p>

        {/* Google button */}
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
          {gLoading ? "Signing in…" : "Continue with Google"}
        </button>

        <div className="login-divider"><span>or</span></div>

        {/* Email toggle */}
        <AnimatePresence initial={false}>
          {!showEmailForm ? (
            <motion.button key="toggle" type="button" className="login-email-toggle"
              onClick={() => setShowEmailForm(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Sign in with Email & Password
            </motion.button>
          ) : (
            <motion.form key="emailform" onSubmit={handleEmail} className="login-form" noValidate
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
              <div className="login-form__field">
                <label htmlFor="owner-email">Email address</label>
                <input id="owner-email" type="email" placeholder="owner@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              <div className="login-form__field">
                <label htmlFor="owner-password">Password</label>
                <input id="owner-password" type="password" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <button type="submit" className="login-form__submit" disabled={loading || gLoading}>
                {loading ? <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <LogIn size={18} />}
                {loading ? "Signing in…" : "Sign In"}
              </button>
              <button type="button" onClick={() => setShowEmailForm(false)}
                style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 4, textAlign: "center", width: "100%" }}>
                ← Back
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function OwnerDashboard() {
  const [user, setUser]                       = useState(null);
  const [authLoading, setAuthLoading]         = useState(true);
  const [myStore, setMyStore]                 = useState(null);
  const [storeChecked, setStoreChecked]       = useState(false);
  const [inventory, setInventory]             = useState([]);
  const [storeLoading, setStoreLoading]       = useState(false);
  const [filterQuery, setFilterQuery]         = useState("");
  const [formModalOpen, setFormModalOpen]     = useState(false);
  const [editingProduct, setEditingProduct]   = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [storeEditOpen, setStoreEditOpen]     = useState(false);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) { setMyStore(null); setStoreChecked(false); setInventory([]); }
    });
    return () => unsub();
  }, []);

  // Store lookup
  useEffect(() => {
    if (!user) return;
    setStoreLoading(true);
    const q = query(collection(db, "Stores"), where("ownerId", "==", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setMyStore(null);
      } else {
        const d = snap.docs[0];
        const raw = d.data();
        setMyStore({ id: d.id, ...raw, coords: [raw.lat ?? 0, raw.lng ?? 0] });
      }
      setStoreChecked(true);
      setStoreLoading(false);
    });
    return () => unsub();
  }, [user]);

  // Inventory listener
  useEffect(() => {
    if (!myStore) return;
    const unsub = onSnapshot(collection(db, "Stores", myStore.id, "Inventory"), (snap) => {
      const items = snap.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          name: raw.name ?? "",
          category: raw.category ?? "",
          status: raw.status ?? "available",
          lastUpdated: raw.lastUpdated?.toDate?.().toISOString() ?? new Date().toISOString(),
        };
      });
      items.sort((a, b) => a.name.localeCompare(b.name));
      setInventory(items);
    });
    return () => unsub();
  }, [myStore]);

  // Status toggle — also bumps store updatedAt
  const handleStatusChange = async (storeId, productId, status) => {
    if (!["available", "low", "out"].includes(status)) return;
    setInventory((prev) =>
      prev.map((p) => p.id === productId ? { ...p, status, lastUpdated: new Date().toISOString() } : p)
    );
    try {
      await updateDoc(doc(db, "Stores", storeId, "Inventory", productId), {
        status, lastUpdated: serverTimestamp(),
      });
      await updateDoc(doc(db, "Stores", storeId), { updatedAt: serverTimestamp() });
    } catch (err) { console.error("Status update failed:", err); }
  };

  const openAddModal    = ()   => { setEditingProduct(null);    setFormModalOpen(true); };
  const openEditModal   = (p)  => { setEditingProduct(p);       setFormModalOpen(true); };
  const openDeleteModal = (p)  => { setDeletingProduct(p);      setDeleteModalOpen(true); };

  const filteredInventory = filterQuery.trim()
    ? inventory.filter((p) =>
        p.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(filterQuery.toLowerCase()))
    : inventory;

  // ── Render states ─────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="login-screen">
      <div className="dashboard-loading"><div className="map-loading-spinner" /><span>Checking session…</span></div>
    </div>
  );

  if (!user) return <LoginScreen />;

  if (!storeChecked || storeLoading) return (
    <div className="login-screen">
      <div className="dashboard-loading"><div className="map-loading-spinner" /><span>Loading your store…</span></div>
    </div>
  );

  // No store → Registration wizard
  if (storeChecked && !myStore) {
    return (
      <div className="dashboard" style={{ minHeight: "100dvh", overflowY: "auto" }}>
        <StoreRegistrationForm user={user} onComplete={() => {}} />
        <div style={{ textAlign: "center", padding: "16px 0 32px" }}>
          <button type="button"
            style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "underline" }}
            onClick={() => signOut(auth)}>
            Sign out and use a different account
          </button>
        </div>
      </div>
    );
  }

  // Full dashboard
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header__left">
          <Store size={22} />
          <div>
            <h1 className="dashboard-header__title">{myStore?.name ?? "My Store"}</h1>
            <span className="dashboard-header__subtitle">
              {myStore?.type ? `${myStore.type} · ` : ""}{user.email}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="dashboard-header__edit-store"
            onClick={() => setStoreEditOpen(true)}
            aria-label="Edit store profile and location"
            title="Edit Store"
          >
            <Settings size={16} strokeWidth={2} />
            <span>Edit Store</span>
          </button>
          <button className="dashboard-header__logout" onClick={() => signOut(auth)} type="button">Sign Out</button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-toolbar">
          <div className="dashboard-section-label">
            <Package size={14} />&nbsp;Inventory
            <span className="dashboard-toolbar__count">
              {filteredInventory.length}{filterQuery ? ` of ${inventory.length}` : ""} products
            </span>
          </div>
          <button type="button" className="dashboard-add-btn" onClick={openAddModal}>
            <Plus size={18} strokeWidth={2.5} /> Add Product
          </button>
        </div>

        {inventory.length > 4 && (
          <div className="dashboard-filter">
            <input type="search" className="dashboard-filter__input"
              placeholder="Filter by name or category…" value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)} />
            {filterQuery && (
              <button className="dashboard-filter__clear" onClick={() => setFilterQuery("")} type="button">✕</button>
            )}
          </div>
        )}

        <p className="dashboard-hint">
          Tap a product to update its status. Use the pencil to edit details or the bin icon to remove a product.
        </p>

        {inventory.length === 0 && (
          <div className="dashboard-empty">
            <Package size={36} style={{ opacity: 0.3 }} />
            <span>No products yet.</span>
            <button type="button" className="dashboard-add-btn" onClick={openAddModal} style={{ marginTop: 8 }}>
              <Plus size={18} /> Add Your First Product
            </button>
          </div>
        )}

        {inventory.length > 0 && filteredInventory.length === 0 && (
          <div className="dashboard-empty">No products match "{filterQuery}".</div>
        )}

        <div className="dashboard-product-list">
          <AnimatePresence>
            {filteredInventory.map((product) => (
              <ProductCard key={product.id} product={product} storeId={myStore.id}
                onStatusChange={handleStatusChange} onEdit={openEditModal} onDelete={openDeleteModal} />
            ))}
          </AnimatePresence>
        </div>
      </main>

      <ProductFormModal isOpen={formModalOpen} onClose={() => setFormModalOpen(false)}
        storeId={myStore?.id} initialData={editingProduct} />
      <ConfirmDeleteModal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)}
        storeId={myStore?.id} product={deletingProduct} />
      <StoreEditModal
        isOpen={storeEditOpen}
        onClose={() => setStoreEditOpen(false)}
        store={myStore}
      />
    </div>
  );
}
