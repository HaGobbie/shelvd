// src/components/BulkImportModal.jsx
// Bulk merchandise import via CSV — accepts ANY CSV export (Square,
// Shopify, plain Excel, etc.), no rigid template required.
//
// Flow: upload -> map columns (smart-guessed, user-confirmed) ->
//       review & fix flagged rows (esp. missing/invalid prices) ->
//       import (atomic upsert, Overwrite vs Skip toggle for duplicates).
//
// Security: store_id is injected client-side from the trusted `storeId`
// prop for every row, in bulkUpsertInventory() (useStores.js) — never
// taken from the CSV, even if a column happened to be named that.
//
// Requires: npm install papaparse

import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Papa from "papaparse";
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { bulkUpsertInventory } from "../hooks/useStores";
import {
  TARGET_FIELDS,
  guessColumnMapping,
  parsePrice,
  parseQuantity,
  parseStatus,
} from "../utils/csvColumnMapping";

// ─── Animation (matches the rest of the app's sheet/modal language) ─────────
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};
const sheetVariants = {
  hidden: { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", damping: 28, stiffness: 300, mass: 0.9 } },
  exit: { y: "100%", opacity: 0, transition: { type: "tween", ease: "easeIn", duration: 0.2 } },
};

let nextRowId = 1;

/**
 * Turns raw CSV rows (array of {header: value} objects) + a confirmed
 * column mapping into validated review rows.
 */
function buildReviewRows(csvRows, mapping) {
  // Invert mapping: targetField -> csvHeader
  const headerFor = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (field) headerFor[field] = header;
  }

  return csvRows.map((raw) => {
    const name = (raw[headerFor.name] ?? "").toString().trim();
    const category = headerFor.category ? (raw[headerFor.category] ?? "").toString().trim() : "";
    const priceRaw = headerFor.price ? raw[headerFor.price] : "";
    const price = parsePrice(priceRaw);
    const status = headerFor.status ? parseStatus(raw[headerFor.status]) : "available";
    const quantity = headerFor.quantity ? parseQuantity(raw[headerFor.quantity]) : 0;
    const sku = headerFor.sku ? (raw[headerFor.sku] ?? "").toString().trim() : "";
    const description = headerFor.description ? (raw[headerFor.description] ?? "").toString().trim() : "";
    const unit = headerFor.unit ? (raw[headerFor.unit] ?? "").toString().trim() : "";

    const errors = [];
    if (!name) errors.push("Missing product name");
    if (price === null) errors.push(`Invalid or missing price ("${priceRaw ?? ""}")`);

    return {
      id: nextRowId++,
      name,
      category: category || "Uncategorized",
      price: price ?? "", // "" so the input renders empty rather than "null"
      priceRaw,
      status,
      quantity,
      sku,
      description,
      unit: unit || "piece",
      errors,
      excluded: false,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ isOpen: boolean, onClose: Function, storeId: string, onImported?: Function }} props
 */
export default function BulkImportModal({ isOpen, onClose, storeId, onImported }) {
  const [step, setStep] = useState("upload");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [reviewRows, setReviewRows] = useState([]);
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { insertedCount, skippedCount } | { error }
  const fileInputRef = useRef(null);

  const resetAll = useCallback(() => {
    setStep("upload");
    setFileName("");
    setParseError("");
    setCsvHeaders([]);
    setCsvRows([]);
    setColumnMapping({});
    setReviewRows([]);
    setOverwrite(false);
    setImporting(false);
    setImportResult(null);
  }, []);

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // ── Step 1: Upload ────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file) return;
    setParseError("");
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        if (headers.length === 0 || results.data.length === 0) {
          setParseError("This file doesn't look like a valid CSV, or it's empty.");
          return;
        }
        setCsvHeaders(headers);
        setCsvRows(results.data);
        setColumnMapping(guessColumnMapping(headers));
        setStep("mapping");
      },
      error: (err) => {
        setParseError(`Couldn't read this file: ${err.message}`);
      },
    });
  }, []);

  const handleFileInputChange = (e) => handleFile(e.target.files?.[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  };

  // ── Step 2: Mapping ───────────────────────────────────────────────────────
  const requiredFieldsMapped = TARGET_FIELDS
    .filter((f) => f.required)
    .every((f) => Object.values(columnMapping).includes(f.key));

  const proceedToReview = () => {
    const rows = buildReviewRows(csvRows, columnMapping);
    setReviewRows(rows);
    setStep("review");
  };

  // ── Step 3: Review ────────────────────────────────────────────────────────
  const flaggedCount = reviewRows.filter((r) => r.errors.length > 0 && !r.excluded).length;
  const includedCount = reviewRows.filter((r) => !r.excluded).length;
  const readyCount = reviewRows.filter((r) => !r.excluded && r.errors.length === 0).length;

  const updateRow = (id, patch) => {
    setReviewRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...patch };
        const errors = [];
        if (!updated.name?.trim()) errors.push("Missing product name");
        const priceNum = parsePrice(updated.price);
        if (priceNum === null) errors.push(`Invalid or missing price ("${updated.price}")`);
        return { ...updated, errors };
      })
    );
  };

  const excludeAllFlagged = () => {
    setReviewRows((prev) =>
      prev.map((r) => (r.errors.length > 0 ? { ...r, excluded: true } : r))
    );
  };

  // ── Step 4: Import ────────────────────────────────────────────────────────
  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);

    const validRows = reviewRows
      .filter((r) => !r.excluded && r.errors.length === 0)
      .map((r) => ({
        name: r.name.trim(),
        category: r.category.trim() || "Uncategorized",
        price: parsePrice(r.price),
        status: r.status,
        quantity: parseQuantity(r.quantity),
        sku: r.sku?.trim() || null,
        description: r.description?.trim() || null,
        unit: r.unit?.trim() || "piece",
      }));

    const { data, error } = await bulkUpsertInventory(storeId, validRows, { overwrite });

    if (error) {
      console.error("Bulk import failed:", error);
      setImportResult({ error: error.message || "Import failed. Please try again." });
      setImporting(false);
      return;
    }

    setImportResult({
      insertedCount: data?.length ?? 0,
      skippedCount: overwrite ? 0 : validRows.length - (data?.length ?? 0),
    });
    setImporting(false);
    setStep("done");
    onImported?.();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="sheet-overlay"
        style={{ zIndex: 1200 }}
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={handleClose}
        aria-hidden="true"
      />
      <motion.div
        className="sheet-panel"
        style={{ zIndex: 1201, maxHeight: "94dvh", display: "flex", flexDirection: "column" }}
        variants={sheetVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-label="Bulk import products from CSV"
      >
        <div className="sheet-handle" aria-hidden="true" />

        {/* Header */}
        <div className="sheet-header">
          <div className="sheet-header__info">
            <h2 className="sheet-header__name">Bulk Import Products</h2>
            <span className="sheet-header__type">
              {step === "upload" && "Upload any CSV export — Square, Shopify, Excel, anything."}
              {step === "mapping" && "Confirm which columns map to which fields."}
              {step === "review" && "Fix or exclude any flagged rows before importing."}
              {step === "done" && "Import complete."}
            </span>
          </div>
          <button className="sheet-close-btn" onClick={handleClose} aria-label="Close" type="button">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="sheet-inventory" style={{ padding: "16px 20px 24px", flex: 1, overflowY: "auto" }}>

          {/* Step 1: Upload */}
          {step === "upload" && (
            <div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                style={{
                  border: "2px dashed var(--color-border, #ccc)",
                  borderRadius: 12,
                  padding: "48px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  color: "var(--color-text-secondary, #666)",
                }}
              >
                <UploadCloud size={36} style={{ opacity: 0.5, marginBottom: 12 }} />
                <p style={{ fontWeight: 600, marginBottom: 4 }}>
                  Click to choose a CSV file, or drag one here
                </p>
                <p style={{ fontSize: 13 }}>
                  Any column headers are fine — you'll match them up next.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileInputChange}
                  style={{ display: "none" }}
                />
              </div>
              {parseError && (
                <p className="pform__error" style={{ marginTop: 12 }}>
                  ⚠️ {parseError}
                </p>
              )}
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === "mapping" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "var(--color-text-secondary, #666)" }}>
                <FileSpreadsheet size={16} />
                <span>{fileName} — {csvRows.length} row{csvRows.length !== 1 ? "s" : ""} found</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "8px 12px", alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted, #999)", textTransform: "uppercase" }}>
                  Your CSV column
                </div>
                <div />
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted, #999)", textTransform: "uppercase" }}>
                  Maps to
                </div>

                {csvHeaders.map((header) => {
                  const exampleRow = csvRows.find((r) => (r[header] ?? "").toString().trim() !== "");
                  const example = exampleRow ? exampleRow[header] : "";
                  return (
                    <React.Fragment key={header}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{header}</div>
                        {example && (
                          <div style={{ fontSize: 12, color: "var(--color-text-muted, #999)" }}>
                            e.g. "{String(example).slice(0, 40)}"
                          </div>
                        )}
                      </div>
                      <ArrowRight size={14} style={{ opacity: 0.4 }} />
                      <select
                        className="pform__select"
                        value={columnMapping[header] ?? ""}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({ ...prev, [header]: e.target.value || null }))
                        }
                      >
                        <option value="">— Ignore this column —</option>
                        {TARGET_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}{f.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </React.Fragment>
                  );
                })}
              </div>

              {!requiredFieldsMapped && (
                <p className="pform__error" style={{ marginTop: 16 }}>
                  ⚠️ Please map a column to both <strong>Product Name</strong> and <strong>Price</strong> — both are required.
                </p>
              )}
            </div>
          )}

          {/* Step 3: Review */}
          {step === "review" && (
            <div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>
                  {readyCount} of {reviewRows.length} rows ready to import
                </span>
                {flaggedCount > 0 && (
                  <span style={{ color: "#E74C3C", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle size={14} /> {flaggedCount} need attention
                  </span>
                )}
                {flaggedCount > 0 && (
                  <button
                    type="button"
                    onClick={excludeAllFlagged}
                    style={{ fontSize: 13, textDecoration: "underline", color: "var(--color-text-muted, #666)" }}
                  >
                    Exclude all flagged rows
                  </button>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border, #ddd)" }}>
                      <th style={{ padding: 6 }}></th>
                      <th style={{ padding: 6 }}>Name</th>
                      <th style={{ padding: 6 }}>Category</th>
                      <th style={{ padding: 6 }}>SKU</th>
                      <th style={{ padding: 6 }}>Price</th>
                      <th style={{ padding: 6 }}>Quantity</th>
                      <th style={{ padding: 6 }}>Unit</th>
                      <th style={{ padding: 6 }}>Status</th>
                      <th style={{ padding: 6 }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.map((row) => (
                      <tr
                        key={row.id}
                        style={{
                          borderBottom: "1px solid var(--color-border-light, #eee)",
                          opacity: row.excluded ? 0.4 : 1,
                          background: row.errors.length > 0 && !row.excluded ? "rgba(231,76,60,0.06)" : "transparent",
                        }}
                      >
                        <td style={{ padding: 6 }}>
                          <input
                            type="checkbox"
                            checked={!row.excluded}
                            onChange={(e) => updateRow(row.id, { excluded: !e.target.checked })}
                            title={row.excluded ? "Excluded — click to include" : "Included — click to exclude"}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 160 }}>
                          <input
                            className="pform__input"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.name}
                            disabled={row.excluded}
                            onChange={(e) => updateRow(row.id, { name: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 120 }}>
                          <input
                            className="pform__input"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.category}
                            disabled={row.excluded}
                            onChange={(e) => updateRow(row.id, { category: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 130 }}>
                          <input
                            className="pform__input"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.sku}
                            disabled={row.excluded}
                            placeholder="optional"
                            onChange={(e) => updateRow(row.id, { sku: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 100 }}>
                          <input
                            className="pform__input"
                            style={{
                              padding: "4px 8px",
                              fontSize: 13,
                              borderColor: row.errors.some((e) => e.includes("price")) ? "#E74C3C" : undefined,
                            }}
                            value={row.price}
                            disabled={row.excluded}
                            placeholder="0.00"
                            onChange={(e) => updateRow(row.id, { price: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 90 }}>
                          <input
                            className="pform__input"
                            type="number"
                            min="0"
                            step="1"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.quantity}
                            disabled={row.excluded}
                            onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 90 }}>
                          <input
                            className="pform__input"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.unit}
                            disabled={row.excluded}
                            placeholder="piece"
                            onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 110 }}>
                          <select
                            className="pform__select"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.status}
                            disabled={row.excluded}
                            onChange={(e) => updateRow(row.id, { status: e.target.value })}
                          >
                            <option value="available">Available</option>
                            <option value="low">Low Stock</option>
                            <option value="out">Out of Stock</option>
                          </select>
                        </td>
                        <td style={{ padding: 6, minWidth: 160 }}>
                          <input
                            className="pform__input"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.description}
                            disabled={row.excluded}
                            placeholder="optional"
                            onChange={(e) => updateRow(row.id, { description: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Overwrite vs Skip toggle */}
              <div style={{ marginTop: 20, padding: 16, background: "var(--color-surface-alt, #f7f7f7)", borderRadius: 10 }}>
                <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                  If a product with the same name already exists in this store:
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
                  <input type="radio" checked={!overwrite} onChange={() => setOverwrite(false)} />
                  Skip it — keep the existing product as-is
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="radio" checked={overwrite} onChange={() => setOverwrite(true)} />
                  Overwrite it — replace with the imported data
                </label>
              </div>

              {importResult?.error && (
                <p className="pform__error" style={{ marginTop: 16 }}>
                  ⚠️ {importResult.error}
                </p>
              )}
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && importResult && !importResult.error && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <CheckCircle2 size={48} style={{ color: "#2ECC71", marginBottom: 16 }} />
              <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                Imported {importResult.insertedCount} product{importResult.insertedCount !== 1 ? "s" : ""}
              </p>
              {importResult.skippedCount > 0 && (
                <p style={{ color: "var(--color-text-secondary, #666)", fontSize: 14 }}>
                  Skipped {importResult.skippedCount} that already existed
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer nav — fixed at bottom */}
        <div style={{ padding: "12px 20px calc(16px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          {step === "mapping" && (
            <>
              <button type="button" className="regform__nav-back" onClick={() => setStep("upload")}>
                <ArrowLeft size={16} /> Back
              </button>
              <button type="button" className="regform__nav-next" onClick={proceedToReview} disabled={!requiredFieldsMapped}>
                Continue <ArrowRight size={16} />
              </button>
            </>
          )}
          {step === "review" && (
            <>
              <button type="button" className="regform__nav-back" onClick={() => setStep("mapping")}>
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                className="regform__nav-submit"
                onClick={handleImport}
                disabled={importing || includedCount === 0 || flaggedCount > 0}
              >
                {importing ? (
                  <>
                    <span className="map-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: "#fff" }} />
                    Importing…
                  </>
                ) : (
                  <>Import {readyCount} Product{readyCount !== 1 ? "s" : ""}</>
                )}
              </button>
            </>
          )}
          {step === "done" && (
            <button type="button" className="regform__nav-submit" onClick={handleClose} style={{ marginLeft: "auto" }}>
              Done
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
