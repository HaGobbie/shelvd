// src/utils/csvColumnMapping.js
//
// Smart-guess algorithm for mapping arbitrary CSV headers (from Square,
// Shopify, a plain Excel export, etc.) onto our fixed inventory fields.
// Deliberately a plain synonym dictionary + normalized string matching —
// not a fuzzy/ML matcher — so behavior is predictable and easy to extend
// by just adding a string to a list, rather than debugging a similarity
// threshold. See BulkImportModal.jsx for the confirmation UI this feeds.
//
// STATUS REMOVED FROM MAPPABLE FIELDS: as of this round, `status` is
// fully derived server-side from quantity vs low_stock_threshold (see
// 17_status_automation_and_search_price.sql) — there's no longer a
// meaningful "map a CSV column to status" step, since whatever a CSV's
// text status column said gets overwritten by the trigger the moment the
// row is written anyway. quantity/low_stock_threshold are the two real
// inputs now.

export const TARGET_FIELDS = [
  { key: "name",        label: "Product Name", required: true },
  { key: "price",       label: "Price",        required: true },
  { key: "category",    label: "Category",     required: false },
  { key: "quantity",    label: "Quantity",     required: false },
  { key: "low_stock_threshold", label: "Low Stock Alert Threshold", required: false },
  { key: "sku",         label: "SKU / Barcode", required: false },
  { key: "description", label: "Description",  required: false },
  { key: "unit",        label: "Unit (kg, pack, piece, etc.)", required: false },
];

const FIELD_SYNONYMS = {
  name: [
    "name", "product name", "item name", "item title", "product",
    "title", "item", "product title", "listing title", "product listing",
    "goods name", "merchandise name", "sku name", "variation name",
  ],
  price: [
    "price", "cost", "msrp", "retail price", "selling price",
    "unit price", "amount", "price php", "srp", "sale price",
    "selling price (php)", "unit price (php)", "list price", "regular price",
    "current price", "shop price", "item price",
  ],
  category: [
    "category", "type", "product type", "department", "collection",
    "product category", "group", "category name", "product group",
    "classification", "subcategory", "sub-category", "tags",
  ],
  quantity: [
    "quantity", "qty", "stock", "stock qty", "stock quantity",
    "units", "on hand", "inventory count", "count", "available qty",
    "available stock", "current stock", "stock on hand", "stock level",
    "inventory", "in stock", "quantity available", "available",
    "total stock", "stock count",
  ],
  low_stock_threshold: [
    "low stock threshold", "threshold", "alert level", "low stock alert",
    "alert tier", "reorder point", "reorder level", "reorder threshold",
    "min stock", "minimum stock", "low stock level", "safety stock",
    "reorder qty", "restock level", "min qty", "minimum quantity",
  ],
  sku: [
    // Deliberately specific, real barcode/SKU terms only — NOT generic
    // "id"/"internal id"/"index", which are common in exported catalogs
    // but refer to a merchant's own arbitrary sequential numbering, not
    // a portable identifier. Auto-mapping those would create false
    // uniqueness collisions/non-collisions across separate uploads.
    "sku", "barcode", "ean", "upc", "gtin", "product code", "item code",
    "variation sku", "seller sku", "product sku", "sku id", "item sku",
    "product id number", "isbn", "asin",
  ],
  description: [
    "description", "details", "notes", "product description",
    "item description", "summary", "long description", "short description",
    "product details", "about", "remarks",
  ],
  unit: [
    "unit", "uom", "unit of measure", "measure", "packaging",
    "unit type", "sold by", "pack size", "package unit", "measurement unit",
  ],
};

/**
 * findDuplicateSkus
 * Returns a Set of normalized (trimmed, lowercased) SKU values that
 * appear on more than one row in this batch. Blank SKUs are ignored —
 * "no SKU" isn't a collision, and most CSVs will have many blank ones.
 *
 * This catches what the database's unique index alone cannot: two rows
 * in the SAME upload sharing a SKU only ever collide against each other
 * inside this one batch, never against anything already in the
 * database, so a plain cross-import uniqueness check never sees them
 * both at once — the first row inserts fine, and the second one's
 * failure (or silent overwrite, depending on the Overwrite toggle)
 * happens invisibly at import time with no clear indication which two
 * rows caused it. Checking within the batch up front, before import,
 * surfaces it as a normal reviewable error instead.
 *
 * @param {Array<{sku?: string}>} rows
 * @returns {Set<string>} normalized SKU values that collide
 */
export function findDuplicateSkus(rows) {
  const seen = new Map(); // normalized sku -> count
  for (const row of rows) {
    const sku = (row.sku ?? "").toString().trim().toLowerCase();
    if (!sku) continue;
    seen.set(sku, (seen.get(sku) ?? 0) + 1);
  }
  const duplicates = new Set();
  for (const [sku, count] of seen) {
    if (count > 1) duplicates.add(sku);
  }
  return duplicates;
}

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
 * in priority order — name/price first since they're required, then the
 * two status-driving fields, then the rest).
 *
 * @param {string[]} headers
 * @returns {Record<string, string|null>}
 */
export function guessColumnMapping(headers) {
  const mapping = {};
  const usedFields = new Set();
  const priorityOrder = ["name", "price", "sku", "quantity", "low_stock_threshold", "category", "unit", "description"];

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
 * parseThreshold
 * Same shape as parseQuantity, but defaults to 5 (not 0) — the same
 * default as the DB column. An unset threshold should mean "use the
 * standard alert level", not "never warn about low stock at all" (which
 * is what defaulting to 0 would effectively mean, since quantity <= 0 is
 * already the separate 'out' case).
 *
 * @param {string|number} raw
 * @returns {number} always a valid non-negative integer, defaults to 5
 */
export function parseThreshold(raw) {
  if (raw === null || raw === undefined) return 5;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 5;

  const cleaned = String(raw).replace(/,/g, "").trim();
  if (cleaned === "") return 5;

  const num = Number(cleaned);
  if (Number.isNaN(num) || num < 0) return 5;
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
