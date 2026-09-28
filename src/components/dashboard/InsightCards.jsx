// src/components/dashboard/InsightCards.jsx
// The three "at a glance" panels: Daily Cash-Out, Neighborhood Demand, and
// Stock Alerts. On desktop they sit in the right-hand rail; on mobile they
// appear at the top of the Inventory tab (cash-out + demand) and on the
// Alerts tab (stock alerts).

import React, { useState, useEffect } from "react";
import { Wallet, Users, AlertTriangle, PackageX, ArrowRight, CheckCircle2 } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";
import { fetchDailyTransactions, fetchNeighborhoodDemandItems, formatPrice } from "../../hooks/useStores";

function CardHead({ icon: Icon, tone = "brand", title, aside }) {
  return (
    <div className="panel-card__head">
      <span className={`panel-card__icon panel-card__icon--${tone}`}><Icon size={18} strokeWidth={2.1} /></span>
      <h3 className="panel-card__title">{title}</h3>
      {aside}
    </div>
  );
}

export function DailyCashOutCard({ storeId, refreshKey }) {
  const { t } = useLanguage();
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    setLoading(true);
    fetchDailyTransactions(storeId).then((rows) => {
      if (cancelled) return;
      const sold = rows.filter((r) => r.transactionType === "sold");
      setTotals({
        cashEarned: sold.reduce((sum, r) => sum + (r.earnings ?? 0), 0),
        itemsSold: sold.reduce((sum, r) => sum + Math.abs(r.quantityChanged ?? 0), 0),
      });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [storeId, refreshKey]);

  return (
    <section className="panel-card">
      <CardHead icon={Wallet} title={t("owner.dashboard.dailyCashOutTitle")} />
      {loading ? (
        <p className="panel-card__muted">{t("owner.dashboard.cashOutLoading")}</p>
      ) : (
        <div className="cashout">
          <div className="cashout__hero">
            <strong>{formatPrice(totals?.cashEarned ?? 0)}</strong>
            <span>{t("owner.dashboard.cashEarnedToday")}</span>
          </div>
          <div className="cashout__sub">
            <strong>{totals?.itemsSold ?? 0}</strong>
            <span>{t("owner.dashboard.itemsSoldToday")}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function NeighborhoodDemandCard({ storeId }) {
  const { t } = useLanguage();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    setLoading(true);
    fetchNeighborhoodDemandItems(storeId, 7).then((result) => {
      if (!cancelled) { setItems(result); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [storeId]);

  const total = items?.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const max = items?.[0]?.count ?? 1;

  return (
    <section className="panel-card">
      <CardHead icon={Users} tone="ok" title={t("owner.dashboard.neighborhoodDemandTitle")} />
      <p className="panel-card__muted">
        {loading
          ? t("owner.dashboard.neighborhoodDemandLoading")
          : items === null
            ? t("owner.dashboard.neighborhoodDemandError")
            : items.length === 0
              ? t("owner.dashboard.neighborhoodDemandZero")
              : t("owner.dashboard.neighborhoodDemandTotal", total)}
      </p>
      {!loading && items && items.length > 0 && (
        <ul className="demand-list">
          {items.map((item) => (
            <li key={item.productName}>
              <div className="demand-list__row">
                <span className="demand-list__name">{item.productName}</span>
                <span className="demand-list__count">{t("owner.dashboard.neighborhoodDemandItemCount", item.count)}</span>
              </div>
              <div className="demand-list__bar"><span style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * StockAlertsCard — every product that is out of stock or running low,
 * out-of-stock first. "Restock" jumps to that product in the Inventory tab
 * with its stock editor already open.
 */
export function StockAlertsCard({ inventory, onRestock, fill = false }) {
  const { t } = useLanguage();
  const alerts = inventory
    .filter((p) => !p.isService && (p.status === "out" || p.status === "low"))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "out" ? -1 : 1));
  const outCount = alerts.filter((p) => p.status === "out").length;
  const lowCount = alerts.length - outCount;

  return (
    <section className={`panel-card ${fill ? "panel-card--fill" : ""}`}>
      <CardHead
        icon={AlertTriangle}
        tone={outCount ? "out" : "low"}
        title={t("alerts.title")}
        aside={alerts.length > 0 ? <span className="panel-card__badge">{alerts.length}</span> : null}
      />
      {alerts.length === 0 ? (
        <div className="alerts-empty">
          <CheckCircle2 size={28} color="var(--color-available)" />
          <strong>{t("alerts.allGood")}</strong>
          <span>{t("alerts.allGoodBody")}</span>
        </div>
      ) : (
        <>
          <p className="panel-card__muted">{t("alerts.summary", outCount, lowCount)}</p>
          <ul className="alerts-list">
            {alerts.map((p) => (
              <li key={p.id} className={`alerts-list__item alerts-list__item--${p.status}`}>
                <span className="alerts-list__icon">
                  {p.status === "out" ? <PackageX size={15} /> : <AlertTriangle size={15} />}
                </span>
                <div className="alerts-list__info">
                  <strong>{p.name}</strong>
                  <span>
                    {p.status === "out"
                      ? t("alerts.outOfStock")
                      : t("alerts.lowLeft", p.quantity ?? 0, p.unit || "piece", p.lowStockThreshold ?? 5)}
                  </span>
                </div>
                <button type="button" onClick={() => onRestock(p)} className="alerts-list__btn" aria-label={t("alerts.restockAria", p.name)}>
                  {t("alerts.restock")} <ArrowRight size={13} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
