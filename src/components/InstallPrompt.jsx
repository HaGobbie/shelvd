// src/components/InstallPrompt.jsx
// A custom "Install Shelvd" banner using the browser's beforeinstallprompt
// event, so people don't have to dig through their browser's menu to find
// "Add to Home Screen". Dismissing it doesn't lose the option: a small
// floating "Install app" pill (InstallLauncher) stays available afterwards
// for as long as the browser says installing is still possible.
//
// iOS Safari never fires beforeinstallprompt, so there we instead show
// on-screen instructions (Share → Add to Home Screen) the first time, since
// there's no programmatic install call there at all.

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X, Share, SquarePlus } from "lucide-react";
import BrandLogo from "./BrandLogo";
import { useLanguage } from "../i18n/LanguageContext";

const DISMISS_KEY = "shelvd_install_banner_dismissed_v1";
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;

/** Captures the deferred prompt once, at the app root, so any component can trigger it. */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onBip = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const canInstall = !installed && (Boolean(deferred) || isIOS());
  const promptInstall = useCallback(async () => {
    if (!deferred) return "ios"; // no programmatic prompt on iOS — caller shows instructions instead
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome; // "accepted" | "dismissed"
  }, [deferred]);

  return { canInstall, installed, promptInstall, isIOS: isIOS() };
}

function IOSInstructions({ onClose }) {
  const { t } = useLanguage();
  return (
    <motion.div className="install-ios" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <button type="button" className="install-ios__close" onClick={onClose} aria-label={t("storeDetails.close")}><X size={16} /></button>
      <p>{t("install.iosStep1")} <Share size={15} style={{ verticalAlign: "-3px" }} /></p>
      <p>{t("install.iosStep2")} <SquarePlus size={15} style={{ verticalAlign: "-3px" }} /> {t("install.iosStep2b")}</p>
    </motion.div>
  );
}

/** The dismissible banner — mount once near the app root. */
export function InstallBanner() {
  const { t } = useLanguage();
  const { canInstall, promptInstall, isIOS: ios } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } });
  const [showIos, setShowIos] = useState(false);

  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* best effort */ } };
  const onInstallClick = async () => {
    const outcome = await promptInstall();
    if (outcome === "ios") setShowIos(true);
    else dismiss();
  };

  if (!canInstall || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div className="install-banner" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}>
        {showIos ? (
          <IOSInstructions onClose={dismiss} />
        ) : (
          <>
            <BrandLogo size={30} />
            <div className="install-banner__text"><strong>{t("install.title")}</strong><span>{t("install.body")}</span></div>
            <button type="button" className="install-banner__install" onClick={onInstallClick}><Download size={15} /> {t("install.action")}</button>
            <button type="button" className="install-banner__dismiss" onClick={dismiss} aria-label={t("storeDetails.close")}><X size={16} /></button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/** Small persistent re-entry point once the banner has been dismissed — so the option isn't lost. */
export function InstallLauncher({ style }) {
  const { t } = useLanguage();
  const { canInstall, promptInstall, isIOS: ios } = useInstallPrompt();
  const [dismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } });
  const [showIos, setShowIos] = useState(false);
  if (!canInstall || !dismissed) return null;

  const onClick = async () => {
    const outcome = await promptInstall();
    if (outcome === "ios") setShowIos(true);
  };

  return (
    <>
      <button type="button" className="install-launcher" style={style} onClick={onClick} title={t("install.action")} aria-label={t("install.action")}>
        <Download size={15} /> <span>{t("install.action")}</span>
      </button>
      <AnimatePresence>{showIos && <div className="install-ios-wrap"><IOSInstructions onClose={() => setShowIos(false)} /></div>}</AnimatePresence>
    </>
  );
}
