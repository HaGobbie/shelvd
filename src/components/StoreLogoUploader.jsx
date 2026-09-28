// src/components/StoreLogoUploader.jsx
// Pick / replace / remove a store's logo. Saves immediately (it doesn't wait
// for the rest of the edit form's Save button). Used in the owner's Edit Store
// dialog and in the super-admin store drawer.
import React, { useRef, useState, useEffect } from "react";
import { ImagePlus, Trash2, Loader2, RefreshCw } from "lucide-react";
import StoreAvatar from "./StoreAvatar";
import { uploadStoreLogo, removeStoreLogo } from "../utils/storeLogo";
import { useLanguage } from "../i18n/LanguageContext";

export default function StoreLogoUploader({ storeId, storeName, logoUrl, onChanged }) {
  const { t } = useLanguage();
  const inputRef = useRef(null);
  const [current, setCurrent] = useState(logoUrl ?? null);
  const [busy, setBusy] = useState(null); // "upload" | "remove" | null
  const [error, setError] = useState("");

  useEffect(() => setCurrent(logoUrl ?? null), [logoUrl]);

  const errorText = (code) => {
    const known = ["not_image", "bad_image", "webp_unsupported", "too_large", "forbidden", "unauthorized"];
    return t(`logo.err.${known.includes(code) ? code : "generic"}`);
  };

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setBusy("upload");
    try {
      const url = await uploadStoreLogo(storeId, file);
      setCurrent(url);
      onChanged?.(url);
    } catch (err) {
      console.error("logo upload failed:", err);
      setError(errorText(err.message));
    } finally { setBusy(null); }
  };

  const onRemove = async () => {
    setError(""); setBusy("remove");
    try {
      await removeStoreLogo(storeId);
      setCurrent(null);
      onChanged?.(null);
    } catch (err) {
      console.error("logo remove failed:", err);
      setError(errorText(err.message));
    } finally { setBusy(null); }
  };

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
        {error && <p className="logo-up__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
