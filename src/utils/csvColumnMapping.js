// src/utils/csvColumnMapping.js
//
// Smart-guess algorithm for mapping arbitrary CSV headers (from Square,
// Shopify, a plain Excel export, etc.) onto our fixed inventory fields.
// Deliberately a plain synonym dictionary + normalized string matching —
// not a fuzzy/ML matcher — so behavior is predictable and easy to extend
// by just adding a string to a list, rather than debugging a similarity
// threshold. See BulkImportModal.jsx for the confirmation UI this feeds.

export const TARGET_FIELDS = [
  { key: "name",        label: "Product Name", required: true },
  { key: "price",       label: "Price",        required: true },
  { key: "category",    label: "Category",     required: false },
  { key: "status",      label: "Stock Status", required: false },
  { key: "quantity",    label: "Quantity",     required: false },
  { key: "sku",         label: "SKU / Barcode", required: false },
  { key: "description", label: "Description",  required: false },
  { key: "unit",        label: "Unit (kg, pack, piece, etc.)", required: false },
];

const FIELD_SYNONYMS = {
  name: [
    "name", "product name", "item name", "item title", "product",
    "title", "item", "product title",
  ],
  price: [
    "price", "cost", "msrp", "retail price", "selling price",
    "unit price", "amount", "price php", "srp",
  ],
  category: [
    "category", "type", "product type", "department", "collection",
    "product category", "group",
  ],
  status: [
    "status", "stock status", "availability", "stock", "in stock",
    "inventory status",
  ],
  quantity: [
    "quantity", "qty", "stock", "stock qty", "stock quantity",
    "units", "on hand", "inventory count", "count", "available qty",
  ],
  sku: [
    // Deliberately specific, real barcode/SKU terms only — NOT generic
    // "id"/"internal id"/"index", which are common in exported catalogs
    // but refer to a merchant's own arbitrary sequential numbering, not
    // a portable identifier. Auto-mapping those would create false
    // uniqueness collisions/non-collisions across separate uploads.
    "sku", "barcode", "ean", "upc", "gtin", "product code", "item code",
  ],
  description: [
    "description", "details", "notes", "product description",
    "item description", "summary",
  ],
  unit: [
    "unit", "uom", "unit of measure", "measure", "packaging",
  ],
};

/** Lowercase, strip punctuation, collapse whitespace — for comparison only. */
export function normalizeHeader(header) {
  return String(header ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * guessColumnMapping
 * Given the raw CSV header strings, returns { [csvHeader]: targetFieldKey | null }.
 * Each target field is assigned to at most ONE csv header (first match wins,
 * in priority order name -> price -> category -> status, since name/price
 * are the two required fields and worth getting right first).
 *
 * @param {string[]} headers
 * @returns {Record<string, string|null>}
 */
export function guessColumnMapping(headers) {
  const mapping = {};
  const usedFields = new Set();
  const priorityOrder = ["name", "price", "sku", "quantity", "category", "status", "unit", "description"];

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    let matchedField = null;

    for (const field of priorityOrder) {
      if (usedFields.has(field)) continue;
      const synonyms = FIELD_SYNONYMS[field];
      const isMatch = synonyms.some(
        (syn) => normalized === syn || normalized.includes(syn) || syn.includes(normalized)
      );
      if (isMatch) {
        matchedField = field;
        break;
      }
    }

    if (matchedField) usedFields.add(matchedField);
    mapping[header] = matchedField;
  }

  return mapping;
}

/**
 * parseQuantity
 * Strips commas/whitespace and parses a non-negative integer. Unlike
 * parsePrice, this is intentionally forgiving — quantity is optional
 * data, not a blocking requirement, so an unparseable value defaults to
 * 0 rather than flagging the whole row as invalid. Fractional input
 * (e.g. "2.5") is floored, since `quantity` is an integer column.
 *
 * @param {string|number} raw
 * @returns {number} always a valid non-negative integer, defaults to 0
 */
export function parseQuantity(raw) {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;

  const cleaned = String(raw).replace(/,/g, "").trim();
  if (cleaned === "") return 0;

  const num = Number(cleaned);
  if (Number.isNaN(num) || num < 0) return 0;
  return Math.floor(num);
}

/**
 * parsePrice
 * Strips currency symbols/commas/whitespace and parses a float. Returns
 * null (not 0!) for anything that isn't a valid non-negative number, so
 * callers can distinguish "genuinely zero" from "couldn't parse this" —
 * e.g. "Call for price" must NOT silently become 0.
 *
 * @param {string|number} raw
 * @returns {number|null}
 */
export function parsePrice(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;

  const cleaned = String(raw)
    .replace(/[₱$,]/g, "")
    .trim();

  if (cleaned === "") return null;

  const num = Number(cleaned);
  if (Number.isNaN(num) || num < 0) return null;
  return num;
}

/**
 * parseStatus
 * Maps common free-text stock status phrases onto our stock_status enum.
 * Defaults to "available" for anything unrecognized (including a blank
 * value) — a missing status is far less consequential than a missing
 * price, so this doesn't need the same strict flag-and-block treatment.
 *
 * @param {string} raw
 * @returns {"available"|"low"|"out"}
 */
export function parseStatus(raw) {
  const normalized = normalizeHeader(raw);
  if (!normalized) return "available";

  if (/(out of stock|out|unavailable|no stock|0 stock|sold out)/.test(normalized)) {
    return "out";
  }
  if (/(low|limited|running low|few left|almost out)/.test(normalized)) {
    return "low";
  }
  return "available";
}
