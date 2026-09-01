// src/components/DailyTransactionsModal.jsx
// Viewer for a single day's transaction ledger, with a date picker to
// look at any day (not just today), plus a CSV export for whatever day
// is currently selected.

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileDown, Calendar } from "lucide-react";
import { fetchDailyTransactions, formatPrice } from "../hooks/useStores";
import { exportDailyTransactionsCSV } from "../utils/csvExport";

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

const TYPE_LABELS = {
  sold: "Sold",
  spoiled: "Spoiled",
  personal_use: "Personal Use",
  other: "Other",
  restocked: "Restocked",
};

/** Local YYYY-MM-DD for a Date, for the <input type="date"> value. */
function toDateInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ isOpen: boolean, onClose: Function, storeId: string, storeName: string }} props
 */
export default function DailyTransactionsModal({ isOpen, onClose, storeId, storeName }) {
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadTransactions = useCallback(async () => {
    if (!storeId || !selectedDate) return;
    setLoading(true);
    // selectedDate is "YYYY-MM-DD" from the date input — parse as a local
    // date (not UTC) so "today" in the picker matches the owner's actual
    // local day, same reasoning as fetchDailyTransactions' own default.
    const [year, month, day] = selectedDate.split("-").map(Number);
    const localDate = new Date(year, month - 1, day);
    const data = await fetchDailyTransactions(storeId, localDate);
    setTransactions(data);
    setLoading(false);
  }, [storeId, selectedDate]);

  useEffect(() => {
    if (isOpen) loadTransactions();
  }, [isOpen, loadTransactions]);

  const totalEarnings = transactions
    .filter((t) => t.transactionType === "sold")
    .reduce((sum, t) => sum + Number(t.earnings), 0);

  const handleExport = () => {
    exportDailyTransactionsCSV(transactions, storeName);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="sheet-overlay" style={{ zIndex: 1200 }}
            variants={overlayVariants} initial="hidden" animate="visible" exit="exit"
            onClick={onClose} aria-hidden="true"
          />
          <motion.div
            className="sheet-panel" style={{ zIndex: 1201, maxHeight: "94dvh", display: "flex", flexDirection: "column" }}
            variants={sheetVariants} initial="hidden" animate="visible" exit="exit"
            role="dialog" aria-modal="true" aria-label="Daily transactions"
          >
            <div className="sheet-handle" aria-hidden="true" />

            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">Daily Transactions</h2>
                <span className="sheet-header__type">
                  {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} · {formatPrice(totalEarnings)} earned
                </span>
              </div>
              <button className="sheet-close-btn" onClick={onClose} aria-label="Close" type="button">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            <div style={{ padding: "12px 20px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--color-border)" }}>
              <Calendar size={16} style={{ color: "var(--color-text-muted)" }} />
              <input
                type="date"
                className="pform__input"
                style={{ flex: 1 }}
                value={selectedDate}
                max={toDateInputValue(new Date())}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
              <button
                type="button"
                onClick={handleExport}
                disabled={transactions.length === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 12px",
                  borderRadius: "var(--radius-md, 8px)", fontSize: 12, fontWeight: 700,
                  background: "var(--color-surface-3)", color: "var(--color-text-secondary)", border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                <FileDown size={14} /> Export CSV
              </button>
            </div>

            <div className="sheet-inventory" style={{ padding: "16px 20px 24px", flex: 1, overflowY: "auto" }}>
              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
                  <div className="map-loading-spinner" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="dashboard-empty" style={{ padding: "24px 0" }}>
                  <span>No transactions on this day.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {transactions.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 12px", borderRadius: 10, background: "var(--color-surface-3)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.productName}</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {TYPE_LABELS[t.transactionType] ?? t.transactionType} · {new Date(t.createdAt).toLocaleTimeString()}
                          {t.notes ? ` · ${t.notes}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: t.quantityChanged < 0 ? "var(--color-out)" : "var(--color-available)" }}>
                          {t.quantityChanged > 0 ? "+" : ""}{t.quantityChanged}
                        </div>
                        {t.transactionType === "sold" && (
                          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{formatPrice(t.earnings)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
