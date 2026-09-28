// src/components/MonthlyRevenueModal.jsx
// Monthly revenue report: a 12-month bar chart (tap a bar to pick that month),
// the picked month's total with a month-over-month change, and the month's
// best-selling products (or all-time, via the toggle).
//
// Data: monthly_revenue_report() for the chart, top_products_sold() (sql/031)
// for the best sellers. CSV export of all months is unchanged.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileDown, TrendingUp, TrendingDown, Minus, Trophy } from "lucide-react";
import { fetchMonthlyRevenue, fetchTopProducts, formatPrice } from "../hooks/useStores";
import { exportMonthlyRevenueCSV } from "../utils/csvExport";
import { useLanguage } from "../i18n/LanguageContext";

const overlayVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.2 } }, exit: { opacity: 0, transition: { duration: 0.16 } } };
const sheetVariants = {
  hidden: { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", damping: 28, stiffness: 300, mass: 0.9 } },
  exit: { y: "100%", opacity: 0, transition: { type: "tween", ease: "easeIn", duration: 0.2 } },
};

const CHART_MONTHS = 12;
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
// The RPC returns dates like "2026-09-01": read the text directly instead of
// going through Date (which can slip a month in some time zones).
const rowYm = (m) => String(m.month).slice(0, 7);
const monthLabel = (key, opts) => new Date(`${key}-15T12:00:00`).toLocaleDateString(undefined, opts);

function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(ym(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}

function compactPeso(n) {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `₱${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `₱${Math.round(n)}`;
}

function RevenueChart({ series, selected, onSelect, t }) {
  const max = Math.max(...series.map((s) => s.value), 1);
  return (
    <div className="rev-chart" role="group" aria-label={t("revenue.chartAria")}>
      {series.map((s) => {
        const h = s.value > 0 ? Math.max(6, (s.value / max) * 100) : 0;
        const active = s.key === selected;
        return (
          <button key={s.key} type="button" className={`rev-chart__col ${active ? "rev-chart__col--active" : ""}`}
            onClick={() => onSelect(s.key)} title={`${monthLabel(s.key, { month: "long", year: "numeric" })}: ${formatPrice(s.value)}`}
            aria-pressed={active} aria-label={`${monthLabel(s.key, { month: "long", year: "numeric" })}: ${formatPrice(s.value)}`}>
            <span className="rev-chart__value">{s.value > 0 ? compactPeso(s.value) : ""}</span>
            <span className="rev-chart__track">
              <span className="rev-chart__bar" style={{ height: `${h}%` }} />
            </span>
            <span className="rev-chart__label">{monthLabel(s.key, { month: "short" })}</span>
          </button>
        );
      })}
    </div>
  );
}

/** @param {{ isOpen: boolean, onClose: Function, storeId: string, storeName: string }} props */
export default function MonthlyRevenueModal({ isOpen, onClose, storeId, storeName }) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState(() => ym(new Date()));
  const [monthlyData, setMonthlyData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState("month"); // "month" | "all"
  const [top, setTop] = useState([]);
  const [topLoading, setTopLoading] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setMonthlyData(await fetchMonthlyRevenue(storeId));
    setLoading(false);
  }, [storeId]);
  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen || !storeId) return;
    let cancelled = false;
    setTopLoading(true);
    fetchTopProducts(storeId, scope === "month" ? selected : null, 5).then((rows) => {
      if (!cancelled) { setTop(rows); setTopLoading(false); }
    });
    return () => { cancelled = true; };
  }, [isOpen, storeId, selected, scope]);

  const byMonth = useMemo(() => new Map(monthlyData.map((m) => [rowYm(m), m])), [monthlyData]);
  const series = useMemo(
    () => lastMonths(CHART_MONTHS).map((key) => ({ key, value: Number(byMonth.get(key)?.totalEarnings ?? 0) })),
    [byMonth]
  );

  const cur = byMonth.get(selected);
  const prevKey = (() => { const [y, m] = selected.split("-").map(Number); return ym(new Date(y, m - 2, 1)); })();
  const prev = byMonth.get(prevKey);
  const curTotal = Number(cur?.totalEarnings ?? 0);
  const prevTotal = Number(prev?.totalEarnings ?? 0);
  const pct = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal) * 100 : null;
  const yearTotal = series.reduce((s, x) => s + x.value, 0);
  const topMax = top[0]?.unitsSold || 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div className="sheet-overlay" style={{ zIndex: 1200 }} variants={overlayVariants} initial="hidden" animate="visible" exit="exit" onClick={onClose} aria-hidden="true" />
          <motion.div className="sheet-panel" style={{ zIndex: 1201, maxHeight: "94dvh", display: "flex", flexDirection: "column" }}
            variants={sheetVariants} initial="hidden" animate="visible" exit="exit" role="dialog" aria-modal="true" aria-label={t("owner.transactions.monthlyTitle")}>
            <div className="sheet-handle" aria-hidden="true" />

            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">{t("owner.transactions.monthlyTitle")}</h2>
                <span className="sheet-header__type">{t("revenue.subtitle")}</span>
              </div>
              <button type="button" className="rev-export" onClick={() => exportMonthlyRevenueCSV(monthlyData, storeName)} disabled={monthlyData.length === 0}>
                <FileDown size={14} /> {t("owner.transactions.exportAllCsv")}
              </button>
              <button className="sheet-close-btn" onClick={onClose} aria-label={t("owner.transactions.close")} type="button"><X size={20} strokeWidth={2} /></button>
            </div>

            <div className="sheet-inventory rev-body">
              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><div className="map-loading-spinner" /></div>
              ) : (
                <>
                  <section className="rev-card">
                    <div className="rev-card__head">
                      <h3>{t("revenue.last12")}</h3>
                      <span>{t("revenue.yearTotal", formatPrice(yearTotal))}</span>
                    </div>
                    {yearTotal === 0 ? (
                      <p className="rev-empty">{t("revenue.noSalesYet")}</p>
                    ) : (
                      <RevenueChart series={series} selected={selected} onSelect={setSelected} t={t} />
                    )}
                  </section>

                  <section className="rev-kpis">
                    <div className="rev-kpi rev-kpi--main">
                      <span>{monthLabel(selected, { month: "long", year: "numeric" })}</span>
                      <strong>{formatPrice(curTotal)}</strong>
                      <em>{cur ? t("owner.transactions.unitsSold", cur.unitsSold) : t("owner.transactions.noSalesMonth")}</em>
                    </div>
                    <div className={`rev-kpi ${pct === null ? "" : pct >= 0 ? "rev-kpi--up" : "rev-kpi--down"}`}>
                      <span>{t("revenue.vsLast")}</span>
                      <strong>
                        {pct === null ? <Minus size={18} /> : pct >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                        {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
                      </strong>
                      <em>{pct === null ? t("revenue.noPrev") : t("revenue.prevWas", formatPrice(prevTotal))}</em>
                    </div>
                  </section>

                  <section className="rev-card">
                    <div className="rev-card__head">
                      <h3><Trophy size={15} /> {t("revenue.topProducts")}</h3>
                      <div className="rev-toggle" role="group">
                        <button type="button" className={scope === "month" ? "is-active" : ""} onClick={() => setScope("month")}>{monthLabel(selected, { month: "short" })}</button>
                        <button type="button" className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>{t("revenue.allTime")}</button>
                      </div>
                    </div>
                    {topLoading ? (
                      <p className="rev-empty">{t("owner.dashboard.cashOutLoading")}</p>
                    ) : top.length === 0 ? (
                      <p className="rev-empty">{t("revenue.noTop")}</p>
                    ) : (
                      <ol className="rev-top">
                        {top.map((p, i) => (
                          <li key={p.productId}>
                            <span className="rev-top__rank">{i + 1}</span>
                            <div className="rev-top__main">
                              <div className="rev-top__row"><strong>{p.name}</strong><span>{t("revenue.units", p.unitsSold)}</span></div>
                              <div className="rev-top__bar"><span style={{ width: `${Math.max(6, (p.unitsSold / topMax) * 100)}%` }} /></div>
                              <em>{formatPrice(p.earnings)}</em>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
