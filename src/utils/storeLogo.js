// src/utils/storeLogo.js
// Client for the upload-store-logo and upload-store-photo Edge Functions
// (see supabase/functions/*/index.ts for what they do + one-time setup).
import { supabase } from "../config/supabaseClient";
import { imageFileToWebp, blobToBase64 } from "./imageToWebp";

/**
 * Everything below is wrapped in one try/catch on purpose. If the function
 * isn't deployed yet, or the project ref is wrong, or CORS blocks the
 * request, supabase-js's `invoke()` doesn't necessarily resolve with a tidy
 * `{ error }` — it can throw/reject instead, with a raw browser message like
 * "Failed to fetch". Un-caught, that message reached the UI as a mystery
 * error with no "Check what's wrong" option (the exact bug reported: the
 * button only appeared for errors the function itself returned as JSON).
 * Now ANY failure — JSON error response or a raw network/deploy-level
 * exception — is normalized into the same { message, detail } shape, so the
 * uploader can always offer the diagnose button.
 */
function taggedError(code, detail) {
  const err = new Error(code);
  err.detail = detail ?? "";
  err.isTagged = true; // marks "we deliberately built this", vs. a raw exception below
  return err;
}

async function callFn(name, payload) {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body: payload });
    if (!error) return data;

    let code = "server_error";
    let detail = "";
    try {
      const body = await error.context?.json?.();
      if (body?.error) code = body.error;
      if (body?.detail) detail = body.detail;
    } catch {
      // The error response wasn't JSON (e.g. Supabase's own gateway 404
      // "function not found" page) — keep the raw error text as detail.
      detail = error.message ?? "";
    }
    throw taggedError(code, detail);
  } catch (e) {
    if (e?.isTagged) throw e;
    // invoke() itself threw/rejected — no JSON body to read at all. This is
    // the case the original bug fell into: a raw "Failed to fetch"-style
    // message with no error code, so no "Check what's wrong" button ever
    // showed. "unreachable" is deliberately NOT in the known-error-text list
    // in StoreLogoUploader/StorePhotoManager, so it always gets the generic
    // message PLUS the diagnose button (which itself catches this same
    // failure mode and reports "function may not be deployed").
    throw taggedError("unreachable", e?.message ?? String(e));
  }
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
