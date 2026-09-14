// src/services/geminiScanner.js
// "AI Snap & Fill" client helper for ProductFormModal.jsx.
//
// SECURITY: this file never touches a Gemini API key. It calls our own
// Supabase Edge Function (supabase/functions/scan-product-image), which
// holds GEMINI_API_KEY as a server-side secret. See that function's
// header comment for the full reasoning — short version: this app is a
// static Vite build on GitHub Pages, so any key used directly here would
// ship in plaintext inside the JS bundle. Nothing like that happens in
// this file.
//
// This module does two other jobs beyond the network call:
//   1. Resizes the photo client-side before sending it anywhere — a
//      full-resolution phone photo can be several MB; downscaling to
//      ~1024px on the long edge cuts that by 90%+, which matters for
//      merchants on limited mobile data plans and keeps the request fast.
//   2. Never trusts the model's output blindly — `category` and
//      `is_service` are re-validated/re-derived against this app's own
//      CATEGORIES / SERVICE_CATEGORIES list (imported from
//      ProductFormModal.jsx) before anything reaches form state.

import { supabase } from "../config/supabaseClient";
import { CATEGORIES, SERVICE_CATEGORIES } from "../constants/productCategories";

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.72;

/**
 * resizeImageFileToBase64
 * Downscales an image File to at most MAX_DIMENSION on its longest edge,
 * re-encodes as JPEG, and returns raw base64 (no "data:...;base64," prefix
 * — Gemini's inlineData.data field expects the bare base64 payload).
 */
function resizeImageFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas is not supported on this device."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const base64 = dataUrl.split(",")[1] ?? "";
      if (!base64) {
        reject(new Error("Couldn't read that photo."));
        return;
      }
      resolve({ base64, mimeType: "image/jpeg" });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read that photo."));
    };

    img.src = objectUrl;
  });
}

/**
 * normalizeScanResult
 * Takes whatever JSON the model returned and turns it into exactly the
 * shape ProductFormModal expects, never trusting the raw values as-is:
 *   - category is matched case-insensitively against the app's real
 *     CATEGORIES list; anything that doesn't match becomes "Other" with
 *     the model's original text preserved as a starting customCategory
 *     value, rather than silently accepting an invalid category string.
 *   - isService is RE-DERIVED from the matched category rather than
 *     trusting the model's own is_service flag — keeps a single source
 *     of truth (SERVICE_CATEGORIES) instead of two systems that could
 *     disagree with each other.
 *   - estimatedPrice is only kept if it's a finite, non-negative number;
 *     anything else becomes null so the merchant fills it in themselves.
 */
function normalizeScanResult(raw) {
  const rawName = typeof raw?.name === "string" ? raw.name.trim() : "";
  const rawCategory = typeof raw?.category === "string" ? raw.category.trim() : "";

  const matchedCategory = CATEGORIES.find(
    (c) => c.toLowerCase() === rawCategory.toLowerCase()
  );
  const category = matchedCategory ?? "Other";
  const customCategory = matchedCategory ? "" : rawCategory;

  const isService = SERVICE_CATEGORIES.includes(category);

  const rawUnit = typeof raw?.unit === "string" ? raw.unit.trim() : "";
  const unit = rawUnit || "piece";

  const rawPrice = raw?.estimated_price;
  const estimatedPrice =
    typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice >= 0
      ? rawPrice
      : null;

  return {
    name: rawName.slice(0, 80),
    category,
    customCategory,
    unit: unit.slice(0, 20),
    estimatedPrice,
    isService,
  };
}

/**
 * scanProductImage
 * @param {File} file — an image File straight from an <input type="file"
 *   accept="image/*" capture="environment"> element.
 * @returns {Promise<{name, category, customCategory, unit, estimatedPrice, isService}>}
 * @throws {Error} with a message safe to show directly to the merchant.
 */
export async function scanProductImage(file) {
  if (!file || !file.type?.startsWith("image/")) {
    throw new Error("Please choose a photo to scan.");
  }

  const { base64, mimeType } = await resizeImageFileToBase64(file);

  const { data, error } = await supabase.functions.invoke("scan-product-image", {
    body: { image: base64, mimeType },
  });

  if (error) {
    console.error("scan-product-image invoke failed:", error);
    throw new Error("Couldn't reach the photo scanner. Please try again or enter details manually.");
  }
  if (!data?.result) {
    console.error("scan-product-image returned no result:", data);
    throw new Error(data?.error || "Scan didn't return a result. Please try again.");
  }

  return normalizeScanResult(data.result);
}
