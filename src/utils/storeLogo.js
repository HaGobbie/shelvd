// src/utils/storeLogo.js
// Client for the upload-store-logo Edge Function (see
// supabase/functions/upload-store-logo/index.ts for what it does + setup).
import { supabase } from "../config/supabaseClient";
import { imageFileToWebp, blobToBase64 } from "./imageToWebp";

async function callFn(payload) {
  const { data, error } = await supabase.functions.invoke("upload-store-logo", { body: payload });
  if (error) {
    // supabase-js hides the JSON body of non-2xx responses inside error.context
    let code = "server_error";
    try { code = (await error.context?.json?.())?.error ?? code; } catch { /* ignore */ }
    throw new Error(code);
  }
  return data;
}

/** Converts to WebP in the browser, then uploads. Resolves with the new public logo URL. */
export async function uploadStoreLogo(storeId, file) {
  const { blob } = await imageFileToWebp(file);
  const image = await blobToBase64(blob);
  const res = await callFn({ action: "upload", storeId, image });
  return res.logoUrl;
}

export async function removeStoreLogo(storeId) {
  await callFn({ action: "remove", storeId });
}
