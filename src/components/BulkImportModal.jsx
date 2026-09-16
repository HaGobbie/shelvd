// src/components/BulkImportModal.jsx
// Add many items at once — two entry paths, one shared review screen:
//   - "Scan a Receipt": photograph a wholesaler receipt, Gemini extracts
//     line items (see scanReceiptImage in geminiScanner.js and the
//     scan-receipt-image Edge Function). Targets the artifact a
//     micro-merchant actually has in hand after a restocking trip —
//     most don't have a CSV export from their supplier, but they do
//     have a printed receipt.
//   - "Upload a Spreadsheet": the original CSV path — accepts ANY CSV
//     export (Square, Shopify, plain Excel, etc.), no rigid template
//     required, via the smart column-guessing below.
// Both paths land in the exact same `reviewRows` state and the exact
// same review UI, so a receipt scan (noisier, since OCR-ish reading of
// a faded thermal receipt is a genuinely harder task than reading a CSV
// cell) gets the same safety net as a messy CSV: anything uncertain
// shows up as a flagged, editable card before it's ever saved.
//
// REVIEW STEP UX: this used to be a single nine-column spreadsheet-style
// table, edited inline. That's a real mismatch for a mobile-first app
// built around not asking non-technical owners to read spreadsheets —
// it was the most "corporate database tool"-looking screen in the whole
// app. Rebuilt as a card-based, flagged-first list instead:
//   - Rows that need attention (missing name, bad price, duplicate SKU,
//     or — for a receipt scan — the model's own low_confidence flag)
//     render as expanded, editable cards right at the top.
//   - Everything that already looks fine stays collapsed behind a single
//     "Show all N items" toggle, one compact line per item (tap a line
//     to expand it if something does need a tweak).
//
// STATUS AUTOMATION: the review table has no Status column — status is
// fully derived server-side from quantity vs low_stock_threshold (see
// 17_status_automation_and_search_price.sql), so a manually-picked
// status here would just get silently overwritten the instant the row
// is written. Low Stock Threshold is the real, meaningful per-row input.
//
// Security: store_id is injected client-side from the trusted `storeId`
// prop for every row, in bulkUpsertInventory() (useStores.js) — never
// taken from the CSV or a receipt scan.
//
// Requires: npm install papaparse

import React, { useState, useCallback, useRef, useMemo } from "react";
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
  Pencil,
  ChevronDown,
  Camera,
} from "lucide-react";
import { scanReceiptImage } from "../services/geminiScanner";
import { bulkUpsertInventory } from "../hooks/useStores";
import {
  TARGET_FIELDS,
  guessColumnMapping,
  parsePrice,
  parseQuantity,
  parseThreshold,
  findDuplicateSkus,
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
 * buildReviewRowsFromReceiptItems
 * Same output shape as buildReviewRows (id, name, category, price,
 * quantity, ...) so ReviewItemCard and every flagging/count helper
 * below work identically regardless of which entry path produced the
 * rows. A receipt item's own low_confidence flag becomes a normal
 * validation error — that's what puts it in the flagged section
 * alongside a missing name or a bad price, without needing any
 * separate "this came from AI" concept anywhere else in this file.
 */
function buildReviewRowsFromReceiptItems(items, t) {
  return items.map((item) => {
    const errors = [];
    if (!item.name) errors.push(t("owner.bulkImport.missingName"));
    if (item.price === null) errors.push(t("owner.bulkImport.invalidPrice", ""));
    if (item.lowConfidence) errors.push(t("owner.bulkImport.lowConfidence"));

    return {
      id: nextRowId++,
      name: item.name,
      category: item.category || "Uncategorized",
      price: item.price ?? "",
      priceRaw: item.price ?? "",
      quantity: item.quantity,
      lowStockThreshold: 5,
      sku: "",
      description: "",
      unit: item.unit || "piece",
      errors,
      excluded: false,
    };
  });
}

/**
 * ReviewItemCard
 * Compact, one-line summary by default for a row that already looks
 * fine (tap it to expand into an editable card). Rows that need
 * attention always render in the expanded, editable form directly —
 * there's nothing to collapse when something actually needs fixing.
 */
function ReviewItemCard({ row, dupSku, flagged, expanded, onToggleExpand, onChange, onToggleExcluded, t }) {
  if (!flagged && !expanded) {
    return (
      <div
        className="bulkreview__row-compact"
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        style={{ opacity: row.excluded ? 0.45 : 1 }}
      >
        <input
          type="checkbox"
          checked={!row.excluded}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleExcluded(!e.target.checked)}
        />
        <div className="bulkreview__row-compact-info">
          <span className="bulkreview__row-compact-name">{row.name}</span>
          <span className="bulkreview__row-compact-meta">
            {row.category} · ₱{row.price} · {row.quantity} {row.unit}
          </span>
        </div>
        <Pencil size={14} style={{ opacity: 0.4, flexShrink: 0 }} />
      </div>
    );
  }

  return (
    <div className={`bulkreview__card ${flagged ? "bulkreview__card--flagged" : ""}`}>
      <div className="bulkreview__card-header">
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!row.excluded}
            onChange={(e) => onToggleExcluded(!e.target.checked)}
          />
          {flagged && (
            <span className="bulkreview__flag-badge">
              <AlertTriangle size={12} /> {t("owner.bulkImport.needsAttentionBadge")}
            </span>
          )}
        </label>
        {!flagged && (
          <button type="button" className="bulkreview__collapse-link" onClick={onToggleExpand}>
            {t("owner.bulkImport.collapseDone")}
          </button>
        )}
      </div>

      {row.errors.length > 0 && (
        <p className="bulkreview__error-line">⚠️ {row.errors.join(" ")}</p>
      )}
      {dupSku && <p className="bulkreview__error-line">⚠️ {t("owner.bulkImport.duplicateSku")}</p>}

      <div className="pform__field">
        <label className="pform__label">{t("owner.bulkImport.colName")}</label>
        <input
          className="pform__input"
          value={row.name}
          disabled={row.excluded}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div className="pform__field" style={{ flex: 1 }}>
          <label className="pform__label">{t("owner.bulkImport.colCategory")}</label>
          <input
            className="pform__input"
            value={row.category}
            disabled={row.excluded}
            onChange={(e) => onChange({ category: e.target.value })}
          />
        </div>
        <div className="pform__field" style={{ flex: 1 }}>
          <label className="pform__label">{t("owner.bulkImport.colPrice")}</label>
          <input
            className="pform__input"
            style={{ borderColor: row.errors.some((e) => e.toLowerCase().includes("price")) ? "var(--color-out)" : undefined }}
            value={row.price}
            disabled={row.excluded}
            placeholder="0.00"
            onChange={(e) => onChange({ price: e.target.value })}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div className="pform__field" style={{ flex: 1 }}>
          <label className="pform__label">{t("owner.bulkImport.colQuantity")}</label>
          <input
            className="pform__input"
            type="number" min="0" step="1"
            value={row.quantity}
            disabled={row.excluded}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </div>
        <div className="pform__field" style={{ flex: 1 }}>
          <label className="pform__label">{t("owner.bulkImport.colUnit")}</label>
          <input
            className="pform__input"
            value={row.unit}
            disabled={row.excluded}
            placeholder="piece"
            onChange={(e) => onChange({ unit: e.target.value })}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div className="pform__field" style={{ flex: 1 }}>
          <label className="pform__label">{t("owner.bulkImport.colSku")}</label>
          <input
            className="pform__input"
            style={{ borderColor: dupSku ? "var(--color-out)" : undefined }}
            value={row.sku}
            disabled={row.excluded}
            placeholder={t("owner.bulkImport.optional")}
            onChange={(e) => onChange({ sku: e.target.value })}
          />
        </div>
        <div className="pform__field" style={{ flex: 1 }}>
          <label className="pform__label">{t("owner.bulkImport.colThreshold")}</label>
          <input
            className="pform__input"
            type="number" min="0" step="1"
            value={row.lowStockThreshold}
            disabled={row.excluded}
            onChange={(e) => onChange({ lowStockThreshold: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{ isOpen: boolean, onClose: Function, storeId: string, onImported?: Function }} props
 */
export default function BulkImportModal({ isOpen, onClose, storeId, onImported }) {
  const { t } = useLanguage();
  const [step, setStep] = useState("choose");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [reviewRows, setReviewRows] = useState([]);
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showAllReady, setShowAllReady] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  // Which entry path produced the current reviewRows — "csv" or
  // "receipt" — so the review step's Back button returns to the right
  // place (the mapping screen only exists for the CSV path).
  const [source, setSource] = useState(null);
  const [receiptScanning, setReceiptScanning] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const fileInputRef = useRef(null);
  const receiptFileInputRef = useRef(null);

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resetAll = useCallback(() => {
    setStep("choose");
    setFileName("");
    setParseError("");
    setCsvHeaders([]);
    setCsvRows([]);
    setColumnMapping({});
    setReviewRows([]);
    setOverwrite(false);
    setImporting(false);
    setImportResult(null);
    setShowAllReady(false);
    setExpandedIds(new Set());
    setSource(null);
    setReceiptScanning(false);
    setReceiptError("");
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
    setSource("csv");
    setStep("review");
  };

  /**
   * handleReceiptFile — the "Scan a Receipt" path. Goes straight from
   * photo to the review screen, skipping the column-mapping step
   * entirely — there's no concept of "mapping columns" for an AI-read
   * item list, only reviewing what came out of it. Any error here
   * (network failure, unreadable photo, zero items found) surfaces on
   * the "choose" screen so the owner can just try again or switch to
   * the CSV path instead, rather than getting stuck on a dead-end step.
   */
  const handleReceiptFile = async (file) => {
    if (!file) return;
    setReceiptError("");
    setReceiptScanning(true);
    try {
      const items = await scanReceiptImage(file);
      if (items.length === 0) {
        setReceiptError(t("owner.bulkImport.receiptEmpty"));
        return;
      }
      const rows = buildReviewRowsFromReceiptItems(items, t);
      setReviewRows(rows);
      setSource("receipt");
      setStep("review");
    } catch (err) {
      console.error("Receipt scan failed:", err);
      setReceiptError(err.message || t("owner.bulkImport.receiptFailed"));
    } finally {
      setReceiptScanning(false);
    }
  };

  const handleReceiptFileInputChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    handleReceiptFile(file);
  };

  // Recomputed from the WHOLE batch every time reviewRows changes —
  // duplicate SKUs are a cross-row condition, not something a single
  // row's own validation can catch. A plain per-row check (like the
  // missing-name/invalid-price checks in updateRow below) would only
  // ever see one row at a time and could never notice that row 3 and
  // row 47 share the same SKU.
  const duplicateSkus = useMemo(() => findDuplicateSkus(reviewRows), [reviewRows]);

  const rowHasDuplicateSku = useCallback(
    (row) => {
      const sku = (row.sku ?? "").toString().trim().toLowerCase();
      return Boolean(sku) && duplicateSkus.has(sku);
    },
    [duplicateSkus]
  );

  const isRowFlagged = useCallback(
    (row) => row.errors.length > 0 || rowHasDuplicateSku(row),
    [rowHasDuplicateSku]
  );

  const flaggedCount = reviewRows.filter((r) => isRowFlagged(r) && !r.excluded).length;
  const includedCount = reviewRows.filter((r) => !r.excluded).length;
  const readyCount = reviewRows.filter((r) => !r.excluded && !isRowFlagged(r)).length;

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
      prev.map((r) => (isRowFlagged(r) ? { ...r, excluded: true } : r))
    );
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);

    const validRows = reviewRows
      .filter((r) => !r.excluded && !isRowFlagged(r))
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
              {step === "choose" && t("owner.bulkImport.subtitleChoose")}
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

          {step === "choose" && (
            <div>
              <input
                ref={receiptFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={handleReceiptFileInputChange}
              />

              <button
                type="button"
                className="bulkchoose__option"
                disabled={receiptScanning}
                onClick={() => receiptFileInputRef.current?.click()}
              >
                {receiptScanning ? (
                  <span className="map-loading-spinner" style={{ width: 22, height: 22, borderWidth: 2.5 }} />
                ) : (
                  <Camera size={22} />
                )}
                <span className="bulkchoose__option-text">
                  <span className="bulkchoose__option-title">
                    {receiptScanning ? t("owner.bulkImport.scanningReceipt") : t("owner.bulkImport.optionReceiptTitle")}
                  </span>
                  {!receiptScanning && (
                    <span className="bulkchoose__option-desc">{t("owner.bulkImport.optionReceiptDesc")}</span>
                  )}
                </span>
              </button>

              {receiptError && (
                <p className="pform__error" style={{ marginTop: -4, marginBottom: 12 }}>⚠️ {receiptError}</p>
              )}

              <button
                type="button"
                className="bulkchoose__option"
                disabled={receiptScanning}
                onClick={() => setStep("upload")}
              >
                <FileSpreadsheet size={22} />
                <span className="bulkchoose__option-text">
                  <span className="bulkchoose__option-title">{t("owner.bulkImport.optionFileTitle")}</span>
                  <span className="bulkchoose__option-desc">{t("owner.bulkImport.optionFileDesc")}</span>
                </span>
              </button>
            </div>
          )}

          {step === "upload" && (
            <div>
              <button type="button" className="bulkreview__collapse-link" style={{ marginBottom: 12, padding: 0 }} onClick={() => setStep("choose")}>
                <ArrowLeft size={13} style={{ display: "inline", marginRight: 4 }} /> {t("owner.bulkImport.back")}
              </button>
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
              <p className="bulkreview__summary">
                {t("owner.bulkImport.itemsFound", reviewRows.length)}
              </p>

              {flaggedCount > 0 && (
                <div className="bulkreview__section">
                  <div className="bulkreview__section-header" style={{ color: "var(--color-out)" }}>
                    <AlertTriangle size={14} /> {t("owner.bulkImport.needAttention", flaggedCount)}
                    <button type="button" className="bulkreview__skip-all-link" onClick={excludeAllFlagged}>
                      {t("owner.bulkImport.excludeFlagged")}
                    </button>
                  </div>
                  {reviewRows.filter((r) => isRowFlagged(r)).map((row) => (
                    <ReviewItemCard
                      key={row.id}
                      row={row}
                      flagged
                      expanded
                      dupSku={rowHasDuplicateSku(row)}
                      onChange={(patch) => updateRow(row.id, patch)}
                      onToggleExcluded={(included) => updateRow(row.id, { excluded: !included })}
                      t={t}
                    />
                  ))}
                </div>
              )}

              {readyCount > 0 && (
                <div className="bulkreview__section">
                  {!showAllReady ? (
                    <button type="button" className="bulkreview__show-all-btn" onClick={() => setShowAllReady(true)}>
                      {t("owner.bulkImport.showAllReady", readyCount)} <ChevronDown size={15} />
                    </button>
                  ) : (
                    <>
                      <div className="bulkreview__section-header">{t("owner.bulkImport.looksGood")}</div>
                      {reviewRows.filter((r) => !isRowFlagged(r)).map((row) => (
                        <ReviewItemCard
                          key={row.id}
                          row={row}
                          flagged={false}
                          expanded={expandedIds.has(row.id)}
                          dupSku={rowHasDuplicateSku(row)}
                          onToggleExpand={() => toggleExpanded(row.id)}
                          onChange={(patch) => updateRow(row.id, patch)}
                          onToggleExcluded={(included) => updateRow(row.id, { excluded: !included })}
                          t={t}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}

              {duplicateSkus.size > 0 && (
                <p className="pform__error" style={{ marginTop: 12 }}>
                  <AlertTriangle size={14} style={{ display: "inline", marginRight: 4 }} />
                  {t("owner.bulkImport.duplicateSkuWarning", duplicateSkus.size)}
                </p>
              )}

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
              <button type="button" className="regform__nav-back" onClick={() => setStep(source === "receipt" ? "choose" : "mapping")}>
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


