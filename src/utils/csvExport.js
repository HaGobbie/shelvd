// src/utils/csvExport.js
// CSV generation for the Owner Dashboard's report downloads, using
// papaparse's unparse() (object array -> CSV string) rather than
// building CSV text by hand — handles quoting/escaping correctly for
// values containing commas, quotes, or newlines (e.g. a product name or
// a free-text transaction note).

import Papa from "papaparse";

/**
 * downloadCSV
 * Triggers a browser download for a CSV string. No server round-trip —
 * the CSV is built entirely client-side from data already fetched.
 *
 * @param {string} filename
 * @param {string} csvString
 */
function downloadCSV(filename, csvString) {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * exportCurrentInventoryCSV
 * One row per product currently in the store, as returned by
 * useOwnerInventory() — no separate fetch needed, uses whatever's
 * already loaded on screen.
 *
 * @param {Array} inventory — from useOwnerInventory()
 * @param {string} storeName — used in the filename only
 */
export function exportCurrentInventoryCSV(inventory, storeName = "store") {
  const rows = inventory.map((p) => ({
    Name: p.name,
    Category: p.category,
    SKU: p.sku ?? "",
    Price: p.price,
    Quantity: p.quantity,
    Unit: p.unit,
    "Low Stock Threshold": p.lowStockThreshold,
    Status: p.status,
    Description: p.description ?? "",
  }));

  const csv = Papa.unparse(rows);
  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadCSV(`${slugify(storeName)}-inventory-${dateStamp}.csv`, csv);
}

/**
 * exportDailyTransactionsCSV
 * @param {Array} transactions — from fetchDailyTransactions()
 * @param {string} storeName
 */
export function exportDailyTransactionsCSV(transactions, storeName = "store") {
  const rows = transactions.map((t) => ({
    Time: new Date(t.createdAt).toLocaleTimeString(),
    Product: t.productName,
    Type: t.transactionType,
    "Quantity Changed": t.quantityChanged,
    Earnings: t.earnings,
    Notes: t.notes ?? "",
  }));

  const csv = Papa.unparse(rows);
  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadCSV(`${slugify(storeName)}-transactions-${dateStamp}.csv`, csv);
}

/**
 * exportMonthlyRevenueCSV
 * @param {Array} monthlyData — from fetchMonthlyRevenue()
 * @param {string} storeName
 */
export function exportMonthlyRevenueCSV(monthlyData, storeName = "store") {
  const rows = monthlyData.map((m) => ({
    Month: new Date(m.month).toLocaleDateString(undefined, { year: "numeric", month: "long" }),
    "Total Earnings": m.totalEarnings,
    "Units Sold": m.unitsSold,
  }));

  const csv = Papa.unparse(rows);
  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadCSV(`${slugify(storeName)}-monthly-revenue-${dateStamp}.csv`, csv);
}

/** Turns "Reyes General Merchandise" into "reyes-general-merchandise" for filenames. */
function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "store";
}
