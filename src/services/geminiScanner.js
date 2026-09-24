// src/services/geminiScanner.js
// AI photo-scanning client helpers, backing two features:
//   - scanProductImage()  — ProductFormModal.jsx's "AI Snap & Fill"
//                            (one product package photo -> one item)
//   - scanReceiptImage()  — BulkImportModal.jsx's "Scan a Receipt"
//                            (one receipt photo -> many line items)
//
// SECURITY: this file never touches a Gemini API key. Both functions
// call their own Supabase Edge Function (supabase/functions/
// scan-product-image and scan-receipt-image respectively), which hold
// GEMINI_API_KEY as a server-side secret. See those functions' header
// comments for the full reasoning — short version: this app is a
// static Vite build on GitHub Pages, so any key used directly here
// would ship in plaintext inside the JS bundle. Nothing like that
// happens in this file.
//
// This module does two other jobs beyond the network calls:
//   1. Resizes the photo client-side before sending it anywhere. A
//      full-resolution phone photo can be several MB; downscaling cuts
//      that by 90%+, which matters for merchants on limited mobile data
//      plans and keeps the request fast. Receipts get a larger target
//      size than a single product photo (RECEIPT_MAX_DIMENSION vs
//      MAX_DIMENSION) — a receipt has much more small text spread over
//      a taller image, and compressing it as aggressively as a single
//      clean product photo would hurt legibility right where accuracy
//      already matters most.
//   2. Never trusts the model's output blindly — every category is
//      re-validated against this app's own CATEGORIES /
//      SERVICE_CATEGORIES list (constants/productCategories.js) before
//      anything reaches form state, via the shared normalizeCategory()
//      below.

import { supabase } from "../config/supabaseClient";
import { CATEGORIES, SERVICE_CATEGORIES } from "../constants/productCategories";

const MAX_DIMENSION = 1024;
const RECEIPT_MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.72;

/**
 * resizeImageFileToBase64
 * Downscales an image File to at most maxDimension on its longest edge,
 * re-encodes as JPEG, and returns raw base64 (no "data:...;base64," prefix
 * — Gemini's inlineData.data field expects the bare base64 payload).
 */
function resizeImageFileToBase64(file, maxDimension = MAX_DIMENSION) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
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
 * normalizeCategory
 * Shared by both scan results: matches a model-returned category
 * string case-insensitively against the app's real CATEGORIES list.
 * Anything that doesn't match becomes "Other" with the model's
 * original text preserved as a starting customCategory value, rather
 * than silently accepting an invalid category string. isService is
 * RE-DERIVED from the matched category rather than trusting any
 * is_service-shaped flag the model might also return — one source of
 * truth (SERVICE_CATEGORIES) instead of two systems that could disagree.
 */
function normalizeCategory(rawCategoryInput) {
  const rawCategory = typeof rawCategoryInput === "string" ? rawCategoryInput.trim() : "";
  const matchedCategory = CATEGORIES.find(
    (c) => c.toLowerCase() === rawCategory.toLowerCase()
  );
  const category = matchedCategory ?? "Other";
  const customCategory = matchedCategory ? "" : rawCategory;
  const isService = SERVICE_CATEGORIES.includes(category);
  return { category, customCategory, isService };
}

/**
 * normalizeScanResult
 * Takes whatever JSON the model returned for a single-product scan and
 * turns it into exactly the shape ProductFormModal expects:
 *   - estimatedPrice is only kept if it's a finite, non-negative number;
 *     anything else becomes null so the merchant fills it in themselves.
 */
function normalizeScanResult(raw) {
  const rawName = typeof raw?.name === "string" ? raw.name.trim() : "";
  const { category, customCategory, isService } = normalizeCategory(raw?.category);

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
 * normalizeReceiptItem
 * Same idea as normalizeScanResult, for one line item out of a receipt
 * scan's array. Quantity defaults to 1 (never 0 or negative) since a
 * line item with no sane quantity reading still needs SOME starting
 * value the owner can correct in review, rather than crashing the whole
 * receipt's import. lowConfidence carries the model's own uncertainty
 * flag through untouched — BulkImportModal turns it into a validation
 * error so the row lands in the flagged-for-review section.
 */
function normalizeReceiptItem(raw) {
  const rawName = typeof raw?.name === "string" ? raw.name.trim() : "";
  const { category, isService } = normalizeCategory(raw?.category);

  const rawUnit = typeof raw?.unit === "string" ? raw.unit.trim() : "";
  const unit = rawUnit || "piece";

  const rawQty = raw?.quantity;
  const quantity = typeof rawQty === "number" && Number.isFinite(rawQty) && rawQty > 0
    ? Math.round(rawQty)
    : 1;

  const rawPrice = raw?.unit_price;
  const price = typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice >= 0
    ? rawPrice
    : null;

  return {
    name: rawName.slice(0, 80),
    category,
    unit: unit.slice(0, 20),
    quantity,
    price,
    isService,
    lowConfidence: raw?.low_confidence === true,
  };
}

/**
 * extractFunctionErrorMessage
 * supabase.functions.invoke() collapses every failure mode — a genuine
 * network problem, the function not being deployed (404), CORS being
 * misconfigured, or the function running fine but reporting something
 * specific (like a missing GEMINI_API_KEY secret) — into the same
 * generic `error` object, with the function's own actual JSON response
 * body sitting unread in `error.context` (a raw Response). Both scan
 * functions used to just show one fixed "couldn't reach the scanner"
 * message regardless of which of those it actually was, which made a
 * real, fixable server-side problem (e.g. the Edge Function never being
 * deployed, or its secret never being set) look identical to a flaky
 * connection — impossible to tell apart from the error alone. This
 * reads the real body when there is one, so the thrown error (and the
 * console log) says what actually happened instead of guessing.
 */
async function extractFunctionErrorMessage(error, fallback) {
  try {
    if (error?.context && typeof error.context.json === "function") {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
  } catch {
    // context wasn't JSON (e.g. a plain 404/502 from infrastructure
    // rather than our own function code) — fall through to the
    // client-library's own message, which is still more specific than
    // nothing.
  }
  return error?.message || fallback;
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
    const detail = await extractFunctionErrorMessage(
      error,
      "Couldn't reach the photo scanner. Please try again or enter details manually."
    );
    console.error("scan-product-image invoke failed:", detail, error);
    throw new Error(detail);
  }
  if (!data?.result) {
    console.error("scan-product-image returned no result:", data);
    throw new Error(data?.error || "Scan didn't return a result. Please try again.");
  }

  return normalizeScanResult(data.result);
}

/**
 * scanReceiptImage
 * @param {File} file — a receipt/invoice photo from an <input
 *   type="file" accept="image/*" capture="environment"> element.
 * @returns {Promise<Array<{name, category, unit, quantity, price, isService, lowConfidence}>>}
 *   An empty array means the model didn't find anything that looked
 *   like a line item — treat that as "couldn't read this receipt", not
 *   as "zero items purchased".
 * @throws {Error} with a message safe to show directly to the merchant.
 */
export async function scanReceiptImage(file) {
  if (!file || !file.type?.startsWith("image/")) {
    throw new Error("Please choose a photo to scan.");
  }

  const { base64, mimeType } = await resizeImageFileToBase64(file, RECEIPT_MAX_DIMENSION);

  const { data, error } = await supabase.functions.invoke("scan-receipt-image", {
    body: { image: base64, mimeType },
  });

  if (error) {
    const detail = await extractFunctionErrorMessage(
      error,
      "Couldn't reach the receipt scanner. Please try again or add items manually."
    );
    console.error("scan-receipt-image invoke failed:", detail, error);
    throw new Error(detail);
  }
  if (!data?.items) {
    console.error("scan-receipt-image returned no items:", data);
    throw new Error(data?.error || "Scan didn't return a result. Please try again.");
  }

  return data.items.map(normalizeReceiptItem);
}
