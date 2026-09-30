// src/components/StorePhotoManager.jsx
// Owner-facing "what does your store look like" gallery — up to 6 photos,
// shown to shoppers in StoreDetails. Same WebP-in-the-browser pipeline as
// the logo, capped at a larger 1280px/~220KB since these are viewed full-size.
import React, { useRef, useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Loader2, ImageOff, Stethoscope, CheckCircle2, XCircle } from "lucide-react";
import { fetchStorePhotos } from "../hooks/useStores";
import { uploadStorePhoto, removeStorePhoto, diagnosePhotoUpload } from "../utils/storeLogo";
import { useLanguage } from "../i18n/LanguageContext";

const MAX_PHOTOS = 6;
const KNOWN_ERRORS = ["not_image", "bad_image", "webp_unsupported", "not_webp", "client_encode_mismatch", "too_large", "too_many_photos", "forbidden"];
const CLIENT_SIDE_ONLY = ["not_image", "bad_image", "webp_unsupported", "too_large", "too_many_photos"];

export default function StorePhotoManager({ storeId }) {
  const { t } = useLanguage();
  const inputRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState(null);
  const [diagnosis, setDiagnosis] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPhotos(await fetchStorePhotos(storeId));
    setLoading(false);
  }, [storeId]);
  useEffect(() => { if (storeId) load(); }, [storeId, load]);

  const errorText = (code) => t(`photos.err.${KNOWN_ERRORS.includes(code) ? code : "generic"}`);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null); setDiagnosis(null); setUploading(true);
    try {
      const photo = await uploadStorePhoto(storeId, file);
      setPhotos((prev) => [...prev, photo]);
    } catch (err) {
      setError({ code: err.message, detail: err.detail });
    } finally { setUploading(false); }
  };

  const runDiagnose = async () => {
    setDiagnosis("checking");
    try { setDiagnosis(await diagnosePhotoUpload(storeId)); }
    catch { setDiagnosis({ ok: false, steps: [] }); }
  };

  const onRemove = async (photoId) => {
    setError(null); setRemovingId(photoId);
    try {
      await removeStorePhoto(storeId, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      setError({ code: err.message, detail: err.detail });
    } finally { setRemovingId(null); }
  };

  const atMax = photos.length >= MAX_PHOTOS;

  return (
    <div className="photo-mgr">
      <div className="photo-mgr__head">
        <strong>{t("photos.title")}</strong>
        <span>{t("photos.count", photos.length, MAX_PHOTOS)}</span>
      </div>
      <p className="photo-mgr__hint">{t("photos.hint")}</p>

      {loading ? (
        <div className="photo-mgr__loading"><Loader2 size={20} className="regform__spin" /></div>
      ) : (
        <div className="photo-mgr__grid">
          {photos.map((p) => (
            <div key={p.id} className="photo-mgr__tile">
              <img src={p.url} alt="" loading="lazy" />
              <button type="button" className="photo-mgr__remove" disabled={removingId === p.id}
                onClick={() => onRemove(p.id)} aria-label={t("photos.remove")}>
                {removingId === p.id ? <Loader2 size={14} className="regform__spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
          {!atMax && (
            <button type="button" className="photo-mgr__add" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploading ? <Loader2 size={20} className="regform__spin" /> : <Plus size={22} />}
              <span>{t("photos.add")}</span>
            </button>
          )}
          {photos.length === 0 && !uploading && (
            <div className="photo-mgr__empty-note"><ImageOff size={14} /> {t("photos.none")}</div>
          )}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      {error && (
        <div className="logo-up__error-box">
          <p className="logo-up__error" role="alert">{errorText(error.code)}</p>
          <p className="logo-up__error-detail">Error code: {error.code || "(none)"}{error.detail ? ` — ${error.detail}` : ""}</p>
          {!CLIENT_SIDE_ONLY.includes(error.code) && (
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
  );
}
