// src/components/MonthlyRevenueModal.jsx
// Viewer for aggregated monthly revenue, with a month picker to jump to
// a specific month, plus a list of every month on record for context,
// and a CSV export covering all months.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileDown, Calendar } from "lucide-react";
import { fetchMonthlyRevenue, formatPrice } from "../hooks/useStores";
import { exportMonthlyRevenueCSV } from "../utils/csvExport";
import { useLanguage } from "../i18n/LanguageContext";

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

/** "YYYY-MM" for a Date, for the <input type="month"> value. */
function toMonthInputValue(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * @param {{ isOpen: boolean, onClose: Function, storeId: string, storeName: string }} props
 */
export default function MonthlyRevenueModal({ isOpen, onClose, storeId, storeName }) {
  const { t } = useLanguage();
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthInputValue(new Date()));
  const [monthlyData, setMonthlyData] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadRevenue = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const data = await fetchMonthlyRevenue(storeId);
    setMonthlyData(data);
    setLoading(false);
  }, [storeId]);

  useEffect(() => {
    if (isOpen) loadRevenue();
  }, [isOpen, loadRevenue]);

  const selectedMonthData = useMemo(
    () => monthlyData.find((m) => toMonthInputValue(m.month) === selectedMonth),
    [monthlyData, selectedMonth]
  );

  const handleExport = () => {
    exportMonthlyRevenueCSV(monthlyData, storeName);
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
            role="dialog" aria-modal="true" aria-label={t("owner.transactions.monthlyTitle")}
          >
            <div className="sheet-handle" aria-hidden="true" />

            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">{t("owner.transactions.monthlyTitle")}</h2>
                <span className="sheet-header__type">{t("owner.transactions.monthlySubtitle")}</span>
              </div>
              <button className="sheet-close-btn" onClick={onClose} aria-label={t("owner.transactions.close")} type="button">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            <div style={{ padding: "12px 20px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--color-border)" }}>
              <Calendar size={16} style={{ color: "var(--color-text-muted)" }} />
              <input
                type="month"
                className="pform__input"
                style={{ flex: 1 }}
                value={selectedMonth}
                max={toMonthInputValue(new Date())}
                onChange={(e) => setSelectedMonth(e.target.value)}
              />
              <button
                type="button"
                onClick={handleExport}
                disabled={monthlyData.length === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 12px",
                  borderRadius: "var(--radius-md, 8px)", fontSize: 12, fontWeight: 700,
                  background: "var(--color-surface-3)", color: "var(--color-text-secondary)", border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                <FileDown size={14} /> {t("owner.transactions.exportAllCsv")}
              </button>
            </div>

            <div className="sheet-inventory" style={{ padding: "16px 20px 24px", flex: 1, overflowY: "auto" }}>
              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
                  <div className="map-loading-spinner" />
                </div>
              ) : (
                <>
                  {/* Focused view of the picked month */}
                  <div
                    style={{
                      padding: "16px", borderRadius: 12, marginBottom: 20,
                      background: selectedMonthData ? "var(--color-available-bg)" : "var(--color-surface-3)",
                      color: selectedMonthData ? "var(--color-available)" : "var(--color-text-muted)",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      {new Date(selectedMonth + "-02").toLocaleDateString(undefined, { year: "numeric", month: "long" })}
                    </div>
                    {selectedMonthData ? (
                      <>
                        <div style={{ fontSize: 24, fontWeight: 800 }}>{formatPrice(selectedMonthData.totalEarnings)}</div>
                        <div style={{ fontSize: 13 }}>{t("owner.transactions.unitsSold", selectedMonthData.unitsSold)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 14 }}>{t("owner.transactions.noSalesMonth")}</div>
                    )}
                  </div>

                  {/* All months, for context/comparison */}
                  {monthlyData.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                        {t("owner.transactions.allMonths")}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {monthlyData.map((m) => (
                          <button
                            key={m.month}
                            type="button"
                            onClick={() => setSelectedMonth(toMonthInputValue(m.month))}
                            style={{
                              display: "flex", justifyContent: "space-between", alignItems: "center",
                              padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                              textAlign: "left",
                              background: toMonthInputValue(m.month) === selectedMonth ? "var(--color-available-bg)" : "var(--color-surface-3)",
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600 }}>
                              {new Date(m.month).toLocaleDateString(undefined, { year: "numeric", month: "long" })}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{formatPrice(m.totalEarnings)}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
