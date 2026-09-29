// src/utils/storeLogo.js
// Client for the upload-store-logo and upload-store-photo Edge Functions
// (see supabase/functions/*/index.ts for what they do + one-time setup).
import { supabase } from "../config/supabaseClient";
import { imageFileToWebp, blobToBase64 } from "./imageToWebp";

async function callFn(name, payload) {
  const { data, error } = await supabase.functions.invoke(name, { body: payload });
  if (error) {
    let code = "server_error";
    let detail = "";
    try {
      const body = await error.context?.json?.();
      if (body?.error) code = body.error;
      if (body?.detail) detail = body.detail;
    } catch { /* non-JSON error body (e.g. a network-level failure) — keep the generic code */ }
    const err = new Error(code);
    err.detail = detail;
    throw err;
  }
  return data;
}

/** Converts to WebP in the browser, then uploads. Resolves with the new public logo URL. */
export async function uploadStoreLogo(storeId, file) {
  const { blob } = await imageFileToWebp(file, { maxSize: 512, targetBytes: 100 * 1024 });
  const image = await blobToBase64(blob);
  const res = await callFn("upload-store-logo", { action: "upload", storeId, image });
  return res.logoUrl;
}
export async function removeStoreLogo(storeId) {
  await callFn("upload-store-logo", { action: "remove", storeId });
}
export async function diagnoseLogoUpload() {
  return callFn("upload-store-logo", { action: "diagnose" });
}

/** Store photos ("what the store looks like") — up to 6, see sql/032. */
export async function uploadStorePhoto(storeId, file) {
  const { blob } = await imageFileToWebp(file, { maxSize: 1280, targetBytes: 220 * 1024 });
  const image = await blobToBase64(blob);
  const res = await callFn("upload-store-photo", { action: "upload", storeId, image });
  return res.photo;
}
export async function removeStorePhoto(storeId, photoId) {
  await callFn("upload-store-photo", { action: "remove", storeId, photoId });
}
export async function diagnosePhotoUpload() {
  return callFn("upload-store-photo", { action: "diagnose" });
}
