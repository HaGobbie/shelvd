// src/components/StoreLogoUploader.jsx
// Pick / replace / remove a store's logo. Saves immediately.
//
// If an upload fails, "Check what's wrong" calls the Edge Function's
// read-only diagnose action (githubStorage.ts) and shows exactly which
// setup step is missing — no Supabase log access needed to self-fix.
import React, { useRef, useState, useEffect } from "react";
import { ImagePlus, Trash2, Loader2, RefreshCw, Stethoscope, CheckCircle2, XCircle } from "lucide-react";
import StoreAvatar from "./StoreAvatar";
import { uploadStoreLogo, removeStoreLogo, diagnoseLogoUpload } from "../utils/storeLogo";
import { useLanguage } from "../i18n/LanguageContext";

const KNOWN_ERRORS = ["not_image", "bad_image", "webp_unsupported", "not_webp", "client_encode_mismatch", "too_large", "forbidden", "unauthorized"];

export default function StoreLogoUploader({ storeId, storeName, logoUrl, onChanged }) {
  const { t } = useLanguage();
  const inputRef = useRef(null);
  const [current, setCurrent] = useState(logoUrl ?? null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null); // { code, detail }
  const [diagnosis, setDiagnosis] = useState(null); // { ok, steps } | "checking"

  useEffect(() => setCurrent(logoUrl ?? null), [logoUrl]);

  const errorText = (code) => t(`logo.err.${KNOWN_ERRORS.includes(code) ? code : "generic"}`);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null); setDiagnosis(null); setBusy("upload");
    try {
      const url = await uploadStoreLogo(storeId, file);
      setCurrent(url);
      onChanged?.(url);
    } catch (err) {
      console.error("logo upload failed:", err.message, err.detail);
      setError({ code: err.message, detail: err.detail });
    } finally { setBusy(null); }
  };

  const onRemove = async () => {
    setError(null); setDiagnosis(null); setBusy("remove");
    try {
      await removeStoreLogo(storeId);
      setCurrent(null);
      onChanged?.(null);
    } catch (err) {
      console.error("logo remove failed:", err.message);
      setError({ code: err.message });
    } finally { setBusy(null); }
  };

  const runDiagnose = async () => {
    setDiagnosis("checking");
    try {
      setDiagnosis(await diagnoseLogoUpload(storeId));
    } catch {
      setDiagnosis({ ok: false, steps: [] });
    }
  };

  // Show "Check what's wrong" for anything that ISN'T a client-side picture
  // problem — i.e. any failure that could plausibly be a setup/connectivity
  // issue, including error codes we don't specifically recognize (see the
  // "unreachable" case in utils/storeLogo.js).
  const CLIENT_SIDE_ONLY = ["not_image", "bad_image", "webp_unsupported", "too_large"];
  const showDiagnoseLink = error && !CLIENT_SIDE_ONLY.includes(error.code);

  return (
    <div className="logo-up">
      <div className="logo-up__preview">
        {busy ? <span className="logo-up__busy"><Loader2 size={22} className="regform__spin" /></span> : null}
        <StoreAvatar name={storeName} logoUrl={current} size={76} radius={20} />
      </div>
      <div className="logo-up__body">
        <strong>{t("logo.title")}</strong>
        <p>{current ? t("logo.hasLogo") : t("logo.noLogo")}</p>
        <div className="logo-up__actions">
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
          <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => inputRef.current?.click()}>
            {current ? <RefreshCw size={15} /> : <ImagePlus size={15} />} {current ? t("logo.replace") : t("logo.upload")}
          </button>
          {current && (
            <button type="button" className="btn btn--danger" disabled={!!busy} onClick={onRemove}>
              <Trash2 size={15} /> {t("logo.remove")}
            </button>
          )}
        </div>
        {error && (
          <div className="logo-up__error-box">
            <p className="logo-up__error" role="alert">{errorText(error.code)}</p>
            {/* Always show the literal code (+ detail if the server sent
                one), even for errors we don't have specific wording for —
                translating everything into a friendly bucket kept hiding
                the one piece of information actually needed to track this
                down. */}
            <p className="logo-up__error-detail">Error code: {error.code || "(none)"}{error.detail ? ` — ${error.detail}` : ""}</p>
            {showDiagnoseLink && (
              <button type="button" className="logo-up__diagnose-link" onClick={runDiagnose}>
                <Stethoscope size={13} /> {t("logo.diagnose")}
              </button>
            )}
          </div>
        )}
        {diagnosis === "checking" && <p className="panel-card__muted">{t("logo.diagnosing")}</p>}
        {diagnosis && diagnosis !== "checking" && (
          <ul className="logo-up__diag">
            {(diagnosis.steps ?? []).map((s) => (
              <li key={s.step} className={s.ok ? "is-ok" : "is-bad"}>
                {s.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {s.detail}
              </li>
            ))}
            {!diagnosis.steps?.length && <li className="is-bad"><XCircle size={14} /> {t("logo.diagnoseUnreachable")}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
