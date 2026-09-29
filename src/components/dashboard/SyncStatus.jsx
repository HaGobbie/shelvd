// src/components/dashboard/SyncStatus.jsx
// Small "N changes waiting to sync" indicator + a panel to review/discard
// items that failed to sync (e.g. someone else already sold the last unit
// from another device). See utils/offlineQueue.js for the engine this reads.
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CloudOff, RefreshCw, X, AlertTriangle, Trash2, Check } from "lucide-react";
import { subscribeQueue, runSync, discardQueueItem, discardAllErrors } from "../../utils/offlineQueue";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useLanguage } from "../../i18n/LanguageContext";

export default function SyncStatus() {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
  const [queue, setQueue] = useState([]);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => subscribeQueue(setQueue), []);

  const pending = queue.filter((i) => i.status === "pending");
  const errored = queue.filter((i) => i.status === "error");
  if (queue.length === 0) return null;

  const syncNow = async () => { setSyncing(true); await runSync(); setSyncing(false); };
  const typeLabel = (type) => t(`sync.type.${type}`);

  return (
    <div className="sync-status">
      <button type="button" className={`sync-status__pill ${errored.length ? "sync-status__pill--error" : ""}`} onClick={() => setOpen((v) => !v)}>
        {isOnline ? (syncing ? <RefreshCw size={14} className="regform__spin" /> : <CloudOff size={14} />) : <CloudOff size={14} />}
        {errored.length > 0 ? t("sync.someFailed", errored.length) : isOnline ? t("sync.syncing", pending.length) : t("sync.waiting", pending.length)}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="sheet-overlay" style={{ zIndex: 1250 }} onClick={() => setOpen(false)} />
            <motion.div className="sync-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="sync-panel__head">
                <strong>{t("sync.panelTitle")}</strong>
                <button type="button" onClick={() => setOpen(false)} aria-label={t("storeDetails.close")}><X size={16} /></button>
              </div>
              {!isOnline && <p className="sync-panel__note"><CloudOff size={13} /> {t("sync.offlineNote")}</p>}
              <ul className="sync-panel__list">
                {queue.map((item) => (
                  <li key={item.id} className={item.status === "error" ? "is-error" : ""}>
                    <span className="sync-panel__icon">{item.status === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}</span>
                    <div>
                      <strong>{typeLabel(item.type)} — {item.label}</strong>
                      {item.status === "error" && <span>{item.errorMessage || t("sync.genericError")}</span>}
                    </div>
                    {item.status === "error" && (
                      <button type="button" className="icon-btn icon-btn--danger" onClick={() => discardQueueItem(item.id)} aria-label={t("sync.discard")}><Trash2 size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="sync-panel__actions">
                {errored.length > 0 && <button type="button" className="btn btn--ghost" onClick={discardAllErrors}>{t("sync.discardAll")}</button>}
                <button type="button" className="btn btn--primary" onClick={syncNow} disabled={!isOnline || syncing || pending.length === 0}>
                  {syncing ? <RefreshCw size={15} className="regform__spin" /> : <RefreshCw size={15} />} {t("sync.syncNow")}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
