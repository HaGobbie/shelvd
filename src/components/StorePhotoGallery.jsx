// src/components/StorePhotoGallery.jsx
// A lazy-loaded thumbnail strip of "what the store looks like" photos
// (public.store_photos, sql/032) shown in the store details sheet. Only the
// thumbnails load up front (browser-native lazy loading); the full-size
// image is the same WebP file, fetched fresh only when a shopper taps it
// open in the lightbox — nothing extra is downloaded until then.
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Images } from "lucide-react";
import { fetchStorePhotos } from "../hooks/useStores";
import { useLanguage } from "../i18n/LanguageContext";

export default function StorePhotoGallery({ storeId }) {
  const { t } = useLanguage();
  const [photos, setPhotos] = useState([]);
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPhotos([]);
    if (storeId) fetchStorePhotos(storeId).then((p) => { if (!cancelled) setPhotos(p); });
    return () => { cancelled = true; };
  }, [storeId]);

  if (photos.length === 0) return null;

  const next = () => setOpenIndex((i) => (i + 1) % photos.length);
  const prev = () => setOpenIndex((i) => (i - 1 + photos.length) % photos.length);

  return (
    <div className="store-gallery">
      <h3 className="store-gallery__heading"><Images size={14} /> {t("photos.galleryTitle")}</h3>
      <div className="store-gallery__strip">
        {photos.map((p, i) => (
          <button key={p.id} type="button" className="store-gallery__thumb" onClick={() => setOpenIndex(i)} aria-label={t("photos.viewPhoto", i + 1)}>
            <img src={p.url} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>

      <AnimatePresence>
        {openIndex !== null && (
          <motion.div className="store-gallery__lightbox" role="dialog" aria-modal="true"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpenIndex(null)}>
            <button type="button" className="store-gallery__close" onClick={() => setOpenIndex(null)} aria-label={t("storeDetails.close")}><X size={22} /></button>
            {photos.length > 1 && (
              <button type="button" className="store-gallery__nav store-gallery__nav--prev" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label={t("photos.prev")}><ChevronLeft size={26} /></button>
            )}
            <img src={photos[openIndex].url} alt="" className="store-gallery__full" onClick={(e) => e.stopPropagation()} />
            {photos.length > 1 && (
              <button type="button" className="store-gallery__nav store-gallery__nav--next" onClick={(e) => { e.stopPropagation(); next(); }} aria-label={t("photos.next")}><ChevronRight size={26} /></button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
