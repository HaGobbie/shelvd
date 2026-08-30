// src/components/BulkImportModal.jsx
// Bulk merchandise import via CSV — accepts ANY CSV export (Square,
// Shopify, plain Excel, etc.), no rigid template required.
//
// STATUS AUTOMATION: the review table no longer has a Status column —
// status is fully derived server-side from quantity vs
// low_stock_threshold (see 17_status_automation_and_search_price.sql),
// so a manually-picked status here would just get silently overwritten
// the instant the row is written. Low Stock Threshold replaces it as
// the real, meaningful per-row input.
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
  parseThreshold,
} from "../utils/csvColumnMapping";
import { useLanguage } from "../i18n/LanguageContext";

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

function buildReviewRows(csvRows, mapping, t) {
  const headerFor = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (field) headerFor[field] = header;
  }

  return csvRows.map((raw) => {
    const name = (raw[headerFor.name] ?? "").toString().trim();
    const category = headerFor.category ? (raw[headerFor.category] ?? "").toString().trim() : "";
    const priceRaw = headerFor.price ? raw[headerFor.price] : "";
    const price = parsePrice(priceRaw);
    const quantity = headerFor.quantity ? parseQuantity(raw[headerFor.quantity]) : 0;
    const lowStockThreshold = headerFor.low_stock_threshold ? parseThreshold(raw[headerFor.low_stock_threshold]) : 5;
    const sku = headerFor.sku ? (raw[headerFor.sku] ?? "").toString().trim() : "";
    const description = headerFor.description ? (raw[headerFor.description] ?? "").toString().trim() : "";
    const unit = headerFor.unit ? (raw[headerFor.unit] ?? "").toString().trim() : "";

    const errors = [];
    if (!name) errors.push(t("owner.bulkImport.missingName"));
    if (price === null) errors.push(t("owner.bulkImport.invalidPrice", priceRaw ?? ""));

    return {
      id: nextRowId++,
      name,
      category: category || "Uncategorized",
      price: price ?? "",
      priceRaw,
      quantity,
      lowStockThreshold,
      sku,
      description,
      unit: unit || "piece",
      errors,
      excluded: false,
    };
  });
}

/**
 * @param {{ isOpen: boolean, onClose: Function, storeId: string, onImported?: Function }} props
 */
export default function BulkImportModal({ isOpen, onClose, storeId, onImported }) {
  const { t } = useLanguage();
  const [step, setStep] = useState("upload");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [reviewRows, setReviewRows] = useState([]);
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
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
          setParseError(t("owner.bulkImport.invalidFile"));
          return;
        }
        setCsvHeaders(headers);
        setCsvRows(results.data);
        setColumnMapping(guessColumnMapping(headers));
        setStep("mapping");
      },
      error: (err) => {
        setParseError(t("owner.bulkImport.readError", err.message));
      },
    });
  }, [t]);

  const handleFileInputChange = (e) => handleFile(e.target.files?.[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  };

  const requiredFieldsMapped = TARGET_FIELDS
    .filter((f) => f.required)
    .every((f) => Object.values(columnMapping).includes(f.key));

  const proceedToReview = () => {
    const rows = buildReviewRows(csvRows, columnMapping, t);
    setReviewRows(rows);
    setStep("review");
  };

  const flaggedCount = reviewRows.filter((r) => r.errors.length > 0 && !r.excluded).length;
  const includedCount = reviewRows.filter((r) => !r.excluded).length;
  const readyCount = reviewRows.filter((r) => !r.excluded && r.errors.length === 0).length;

  const updateRow = (id, patch) => {
    setReviewRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...patch };
        const errors = [];
        if (!updated.name?.trim()) errors.push(t("owner.bulkImport.missingName"));
        const priceNum = parsePrice(updated.price);
        if (priceNum === null) errors.push(t("owner.bulkImport.invalidPrice", updated.price));
        return { ...updated, errors };
      })
    );
  };

  const excludeAllFlagged = () => {
    setReviewRows((prev) =>
      prev.map((r) => (r.errors.length > 0 ? { ...r, excluded: true } : r))
    );
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);

    const validRows = reviewRows
      .filter((r) => !r.excluded && r.errors.length === 0)
      .map((r) => ({
        name: r.name.trim(),
        category: r.category.trim() || "Uncategorized",
        price: parsePrice(r.price),
        quantity: parseQuantity(r.quantity),
        lowStockThreshold: parseThreshold(r.lowStockThreshold),
        sku: r.sku?.trim() || null,
        description: r.description?.trim() || null,
        unit: r.unit?.trim() || "piece",
      }));

    const { data, error } = await bulkUpsertInventory(storeId, validRows, { overwrite });

    if (error) {
      console.error("Bulk import failed:", error);
      setImportResult({ error: error.message || t("owner.bulkImport.importFailed") });
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
        aria-label={t("owner.bulkImport.title")}
      >
        <div className="sheet-handle" aria-hidden="true" />

        <div className="sheet-header">
          <div className="sheet-header__info">
            <h2 className="sheet-header__name">{t("owner.bulkImport.title")}</h2>
            <span className="sheet-header__type">
              {step === "upload" && t("owner.bulkImport.subtitleUpload")}
              {step === "mapping" && t("owner.bulkImport.subtitleMapping")}
              {step === "review" && t("owner.bulkImport.subtitleReview")}
              {step === "done" && t("owner.bulkImport.subtitleDone")}
            </span>
          </div>
          <button className="sheet-close-btn" onClick={handleClose} aria-label={t("owner.bulkImport.close")} type="button">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="sheet-inventory" style={{ padding: "16px 20px 24px", flex: 1, overflowY: "auto" }}>

          {step === "upload" && (
            <div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                style={{
                  border: "2px dashed var(--color-border)",
                  borderRadius: 12,
                  padding: "48px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  color: "var(--color-text-secondary)",
                }}
              >
                <UploadCloud size={36} style={{ opacity: 0.5, marginBottom: 12 }} />
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{t("owner.bulkImport.uploadPrompt")}</p>
                <p style={{ fontSize: 13 }}>{t("owner.bulkImport.uploadHint")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileInputChange}
                  style={{ display: "none" }}
                />
              </div>
              {parseError && <p className="pform__error" style={{ marginTop: 12 }}>⚠️ {parseError}</p>}
            </div>
          )}

          {step === "mapping" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "var(--color-text-secondary)" }}>
                <FileSpreadsheet size={16} />
                <span>{fileName} — {t("owner.bulkImport.rowsFound", csvRows.length)}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "8px 12px", alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
                  {t("owner.bulkImport.yourColumn")}
                </div>
                <div />
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
                  {t("owner.bulkImport.mapsTo")}
                </div>

                {csvHeaders.map((header) => {
                  const exampleRow = csvRows.find((r) => (r[header] ?? "").toString().trim() !== "");
                  const example = exampleRow ? exampleRow[header] : "";
                  return (
                    <React.Fragment key={header}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{header}</div>
                        {example && (
                          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
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
                        <option value="">{t("owner.bulkImport.ignoreColumn")}</option>
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
                  ⚠️ {t("owner.bulkImport.mappingRequired")}
                </p>
              )}
            </div>
          )}

          {step === "review" && (
            <div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>
                  {t("owner.bulkImport.rowsReady", readyCount, reviewRows.length)}
                </span>
                {flaggedCount > 0 && (
                  <span style={{ color: "var(--color-out)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle size={14} /> {t("owner.bulkImport.needAttention", flaggedCount)}
                  </span>
                )}
                {flaggedCount > 0 && (
                  <button
                    type="button"
                    onClick={excludeAllFlagged}
                    style={{ fontSize: 13, textDecoration: "underline", color: "var(--color-text-muted)" }}
                  >
                    {t("owner.bulkImport.excludeFlagged")}
                  </button>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                      <th style={{ padding: 6 }}></th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colName")}</th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colCategory")}</th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colSku")}</th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colPrice")}</th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colQuantity")}</th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colThreshold")}</th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colUnit")}</th>
                      <th style={{ padding: 6 }}>{t("owner.bulkImport.colDescription")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.map((row) => (
                      <tr
                        key={row.id}
                        style={{
                          borderBottom: "1px solid var(--color-border-light, #eee)",
                          opacity: row.excluded ? 0.4 : 1,
                          background: row.errors.length > 0 && !row.excluded ? "var(--color-out-bg)" : "transparent",
                        }}
                      >
                        <td style={{ padding: 6 }}>
                          <input
                            type="checkbox"
                            checked={!row.excluded}
                            onChange={(e) => updateRow(row.id, { excluded: !e.target.checked })}
                            title={row.excluded ? t("owner.bulkImport.excludedTitle") : t("owner.bulkImport.includedTitle")}
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
                            placeholder={t("owner.bulkImport.optional")}
                            onChange={(e) => updateRow(row.id, { sku: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: 6, minWidth: 100 }}>
                          <input
                            className="pform__input"
                            style={{
                              padding: "4px 8px",
                              fontSize: 13,
                              borderColor: row.errors.some((e) => e.toLowerCase().includes("price")) ? "var(--color-out)" : undefined,
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
                            type="number"
                            min="0"
                            step="1"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.lowStockThreshold}
                            disabled={row.excluded}
                            onChange={(e) => updateRow(row.id, { lowStockThreshold: e.target.value })}
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
                        <td style={{ padding: 6, minWidth: 160 }}>
                          <input
                            className="pform__input"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            value={row.description}
                            disabled={row.excluded}
                            placeholder={t("owner.bulkImport.optional")}
                            onChange={(e) => updateRow(row.id, { description: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 20, padding: 16, background: "var(--color-surface-3)", borderRadius: 10 }}>
                <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                  {t("owner.bulkImport.conflictPrompt")}
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
                  <input type="radio" checked={!overwrite} onChange={() => setOverwrite(false)} />
                  {t("owner.bulkImport.skipOption")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="radio" checked={overwrite} onChange={() => setOverwrite(true)} />
                  {t("owner.bulkImport.overwriteOption")}
                </label>
              </div>

              {importResult?.error && (
                <p className="pform__error" style={{ marginTop: 16 }}>⚠️ {importResult.error}</p>
              )}
            </div>
          )}

          {step === "done" && importResult && !importResult.error && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <CheckCircle2 size={48} style={{ color: "var(--color-available)", marginBottom: 16 }} />
              <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                {t("owner.bulkImport.imported", importResult.insertedCount)}
              </p>
              {importResult.skippedCount > 0 && (
                <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
                  {t("owner.bulkImport.skipped", importResult.skippedCount)}
                </p>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 20px calc(16px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          {step === "mapping" && (
            <>
              <button type="button" className="regform__nav-back" onClick={() => setStep("upload")}>
                <ArrowLeft size={16} /> {t("owner.bulkImport.back")}
              </button>
              <button type="button" className="regform__nav-next" onClick={proceedToReview} disabled={!requiredFieldsMapped}>
                {t("owner.bulkImport.continueBtn")} <ArrowRight size={16} />
              </button>
            </>
          )}
          {step === "review" && (
            <>
              <button type="button" className="regform__nav-back" onClick={() => setStep("mapping")}>
                <ArrowLeft size={16} /> {t("owner.bulkImport.back")}
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
                    {t("owner.bulkImport.importing")}
                  </>
                ) : (
                  <>{t("owner.bulkImport.importN", readyCount)}</>
                )}
              </button>
            </>
          )}
          {step === "done" && (
            <button type="button" className="regform__nav-submit" onClick={handleClose} style={{ marginLeft: "auto" }}>
              {t("owner.bulkImport.done")}
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
