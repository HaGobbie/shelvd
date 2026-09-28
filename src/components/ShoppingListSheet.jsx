// src/components/ShoppingListSheet.jsx
// The resident's shopping list: a checkbox list grouped by store, with a
// "Get directions" button that opens the multi-stop route planner.

import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Navigation, ShoppingBasket, Store as StoreIcon, Check } from "lucide-react";
import { useShoppingList } from "../hooks/useShoppingList";
import { useLanguage } from "../i18n/LanguageContext";
import { formatPrice } from "../hooks/useStores";

const sheetVariants = {
  hidden: { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", damping: 28, stiffness: 320, mass: 0.9 } },
  exit: { y: "100%", opacity: 0, transition: { type: "tween", ease: "easeIn", duration: 0.22 } },
};

export default function ShoppingListSheet() {
  const { t } = useLanguage();
  const {
    items, pendingCount, pendingTotal, listOpen, setListOpen, setRouteOpen,
    remove, setBought, clear, clearBought,
  } = useShoppingList();

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.storeId)) map.set(item.storeId, { storeId: item.storeId, storeName: item.storeName, items: [] });
      map.get(item.storeId).items.push(item);
    }
    return [...map.values()];
  }, [items]);

  const boughtCount = items.length - pendingCount;
  const close = () => setListOpen(false);

  return (
    <AnimatePresence>
      {listOpen && (
        <>
          <motion.div className="sheet-overlay" style={{ zIndex: 1000 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={close} aria-hidden="true" />
          <motion.div className="sheet-panel slist" style={{ zIndex: 1001 }}
            variants={sheetVariants} initial="hidden" animate="visible" exit="exit"
            role="dialog" aria-modal="true" aria-label={t("list.title")}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <div className="sheet-header__info">
                <h2 className="sheet-header__name">{t("list.title")}</h2>
                <span className="sheet-header__type">{t("list.subtitle", pendingCount, groups.length)}</span>
              </div>
              <button className="sheet-close-btn" onClick={close} aria-label={t("storeDetails.close")} type="button">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            <div className="slist__body">
              {items.length === 0 ? (
                <div className="slist__empty">
                  <ShoppingBasket size={40} style={{ opacity: 0.3 }} />
                  <strong>{t("list.emptyTitle")}</strong>
                  <span>{t("list.emptyBody")}</span>
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.storeId} className="slist__group">
                    <h3 className="slist__store"><StoreIcon size={14} /> {g.storeName}</h3>
                    <ul className="slist__items">
                      {g.items.map((item) => (
                        <li key={item.productId} className={`slist__item ${item.bought ? "slist__item--done" : ""}`}>
                          <label className="slist__check">
                            <input type="checkbox" checked={item.bought}
                              onChange={(e) => setBought(item.productId, e.target.checked)} />
                            <span className="slist__box" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
                            <span className="slist__name">{item.name}</span>
                          </label>
                          <span className="slist__price">{formatPrice(item.price)}</span>
                          <button type="button" className="slist__remove" onClick={() => remove(item.productId)}
                            aria-label={t("list.remove", item.name)} title={t("list.remove", item.name)}>
                            <X size={15} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>

            {items.length > 0 && (
              <div className="slist__footer">
                <div className="slist__total">
                  <span>{t("list.estimatedTotal")}</span>
                  <strong>{formatPrice(pendingTotal)}</strong>
                </div>
                <button type="button" className="slist__directions" disabled={pendingCount === 0}
                  onClick={() => { setListOpen(false); setRouteOpen(true); }}>
                  <Navigation size={18} /> {t("list.getDirections")}
                </button>
                <div className="slist__secondary">
                  {boughtCount > 0 && (
                    <button type="button" onClick={clearBought}>{t("list.clearChecked", boughtCount)}</button>
                  )}
                  <button type="button" className="slist__danger" onClick={clear}>
                    <Trash2 size={13} /> {t("list.clearAll")}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
