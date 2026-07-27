const REQUIRED_HEADERS = ["sku code"];

const HEADER_ALIASES = {
  "sku code": ["sku code", "sku", "sku_code", "sku id"],
  "stock qty": ["stock qty", "stock", "stock quantity", "quantity", "on hand", "on_hand"],
  doc: ["doc", "days of cover", "days_of_cover"],
  reason: ["reason", "note", "notes", "comment"],
  "storage location": [
    "storage location",
    "storage_location",
    "bin location",
    "bin_location",
    "bin",
    "location",
    "shelf",
    "shelf location"
  ]
};

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object" && value.text != null) return String(value.text).trim();
  if (typeof value === "object" && value.result != null) return String(value.result).trim();
  return String(value).trim();
}

function parseOptionalNumber(value) {
  const text = cellText(value).replace(/,/g, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function headerMap(row) {
  const map = {};
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const key = cellText(cell.value).toLowerCase();
    if (!key) return;
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key)) {
        map[canonical] = col;
        return;
      }
    }
    map[key] = col;
  });
  return map;
}

function missingHeaders(map) {
  return REQUIRED_HEADERS.filter((h) => map[h] == null);
}

function rowFromSheet(row, columns) {
  const skuCode = cellText(row.getCell(columns["sku code"]).value);
  if (!skuCode) return null;

  return {
    skuCode,
    stockQty: columns["stock qty"] != null ? parseOptionalNumber(row.getCell(columns["stock qty"]).value) : null,
    doc: columns.doc != null ? parseOptionalNumber(row.getCell(columns.doc).value) : null,
    reason: columns.reason != null ? cellText(row.getCell(columns.reason).value) : "",
    storageLocation:
      columns["storage location"] != null ? cellText(row.getCell(columns["storage location"]).value) : ""
  };
}

/** Merge duplicate SKU rows — later row wins for each non-empty field. */
function mergeStockAdjustRow(existing, incoming) {
  return {
    skuCode: existing.skuCode,
    stockQty: incoming.stockQty != null ? incoming.stockQty : existing.stockQty,
    doc: incoming.doc != null ? incoming.doc : existing.doc,
    reason: incoming.reason || existing.reason,
    storageLocation: incoming.storageLocation || existing.storageLocation,
    mergedRowCount: (existing.mergedRowCount || 1) + 1
  };
}

/** @param {import("exceljs").Worksheet} sheet */
export function parseStockAdjustSheet(sheet) {
  const columns = headerMap(sheet.getRow(1));
  const missing = missingHeaders(columns);
  if (missing.length) {
    throw new Error(
      `Missing required column: ${missing.join(", ")}. Download the template — required: SKU Code; optional: Stock Qty, DOC, Storage Location, Reason.`
    );
  }

  const bySku = new Map();
  const parseMeta = {
    sheetRows: Math.max(0, sheet.rowCount - 1),
    blankSku: 0,
    emptyDataRows: 0,
    duplicateMerged: 0
  };

  for (let r = 2; r <= sheet.rowCount; r++) {
    const parsed = rowFromSheet(sheet.getRow(r), columns);
    if (!parsed) {
      parseMeta.blankSku++;
      continue;
    }
    if (parsed.stockQty == null && parsed.doc == null && !parsed.storageLocation) {
      parseMeta.emptyDataRows++;
      continue;
    }

    const key = parsed.skuCode.toLowerCase();
    const existing = bySku.get(key);
    if (existing) {
      parseMeta.duplicateMerged++;
      bySku.set(key, mergeStockAdjustRow(existing, parsed));
    } else {
      bySku.set(key, parsed);
    }
  }

  const records = [...bySku.values()];
  if (!records.length) {
    throw new Error("No adjustment rows found. Fill SKU Code and at least one of Stock Qty, DOC, or Storage Location.");
  }

  return { records, parseMeta };
}

export async function parseStockAdjustWorkbook(file) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("No worksheet found in the file.");
  return parseStockAdjustSheet(sheet);
}

import { facilityStockForSku, resolveFacilityCode } from "./inventoryFacilityUtils";

/**
 * @param {Array<{ id: string, _uuid?: string, stock?: number, totalStock?: number, wh?: string, doc?: number }>} skus
 * @param {ReturnType<typeof rowFromSheet>[]} records
 * @param {{ warehouseId: string, warehouses?: Array<{ id: string, facilityCode?: string }>, availabilityBySku?: object }} scope
 */
export function enrichStockAdjustRows(skus, records, scope = {}) {
  const { warehouseId, warehouses = [], availabilityBySku } = scope;
  if (!warehouseId) {
    return records.map((row) => ({ ...row, error: "Warehouse is required for bulk upload." }));
  }

  const warehouse = warehouses.find((w) => w.id === warehouseId);
  const facilityCode = resolveFacilityCode(warehouse);

  const byCode = new Map();
  for (const sku of skus) {
    byCode.set(String(sku.id).trim().toLowerCase(), sku);
  }

  return records.map((row) => {
    const sku = byCode.get(row.skuCode.trim().toLowerCase());
    if (!sku?._uuid) {
      return { ...row, error: `SKU not found: ${row.skuCode}` };
    }

    const fac = facilityStockForSku(availabilityBySku, sku.id, facilityCode);
    const currentStock = fac ? fac.onHand : 0;
    const targetStock = row.stockQty;
    const delta = targetStock != null ? targetStock - currentStock : 0;

    if (targetStock != null && targetStock < 0) {
      return { ...row, error: `Stock Qty cannot be negative for ${row.skuCode}` };
    }
    if (row.doc != null && row.doc < 0) {
      return { ...row, error: `DOC cannot be negative for ${row.skuCode}` };
    }
    if (targetStock == null && row.doc == null && !row.storageLocation) {
      return { ...row, error: `Nothing to update for ${row.skuCode}` };
    }
    if (targetStock != null && delta === 0 && row.doc == null && !row.storageLocation) {
      return { ...row, error: `No change for ${row.skuCode} (stock already ${currentStock} at this warehouse)` };
    }

    const currentBin = String(sku.bin ?? "").trim();
    const targetBin = String(row.storageLocation ?? "").trim();
    const willUpdateBin = Boolean(targetBin) && targetBin !== currentBin;

    if (targetStock == null && row.doc == null && row.storageLocation && !willUpdateBin) {
      return { ...row, error: `Storage location unchanged for ${row.skuCode}` };
    }

    return {
      ...row,
      _uuid: sku._uuid,
      wh: warehouseId,
      facilityCode,
      currentStock,
      currentDoc: sku.doc ?? null,
      currentBin,
      targetBin: targetBin || null,
      targetStock,
      delta,
      willAdjustStock: targetStock != null && delta !== 0,
      willUpdateDoc: row.doc != null,
      willUpdateBin
    };
  });
}

/** Summarize enriched rows for preview UI. */
export function summarizeStockAdjustPreview(enriched) {
  const valid = enriched.filter((r) => !r.error);
  const invalid = enriched.filter((r) => r.error);
  const stockCount = valid.filter((r) => r.willAdjustStock).length;
  const docOnlyCount = valid.filter((r) => !r.willAdjustStock && r.willUpdateDoc && !r.willUpdateBin).length;
  const storageOnlyCount = valid.filter((r) => !r.willAdjustStock && !r.willUpdateDoc && r.willUpdateBin).length;
  const metricsOnlyCount = valid.filter((r) => !r.willAdjustStock && (r.willUpdateDoc || r.willUpdateBin)).length;

  return {
    total: enriched.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    stockCount,
    docOnlyCount,
    storageOnlyCount,
    metricsOnlyCount,
    valid,
    invalid
  };
}

/** Download CSV of skipped rows with reasons (and merged-row note when present). */
export function downloadStockAdjustSkipReport(rows, warehouseName = "warehouse") {
  const skipped = rows.filter((r) => r.error);
  if (!skipped.length) return;

  const stamp = new Date().toISOString().slice(0, 10);
  const header = ["SKU Code", "Stock Qty", "DOC", "Storage Location", "Reason", "Skip reason", "Merged rows"];
  const escape = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    header.join(","),
    ...skipped.map((r) =>
      [
        r.skuCode,
        r.stockQty ?? "",
        r.doc ?? "",
        r.storageLocation ?? "",
        r.reason ?? "",
        r.error,
        r.mergedRowCount ?? 1
      ]
        .map(escape)
        .join(",")
    )
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-upload-skipped-${warehouseName.replace(/\s+/g, "-").toLowerCase()}-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadStockAdjustTemplate(warehouseName = "") {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Scott Dashboard";
  const sheet = workbook.addWorksheet("Stock Adjust");

  const headers = ["SKU Code", "Stock Qty", "DOC", "Storage Location", "Reason"];
  sheet.addRow(headers);
  sheet.addRow(["EXAMPLE-SKU-01", 100, 30, "A-12-03", "Cycle count"]);
  sheet.addRow(["EXAMPLE-SKU-02", 50, 14, "B-04-01", "Bulk upload"]);
  sheet.addRow([
    "",
    "",
    "",
    "",
    warehouseName
      ? `Upload applies to ${warehouseName} only. Stock Qty = on-hand at that warehouse. DRR is auto from orders. Duplicate SKUs are merged (last row wins).`
      : "Stock Qty = on-hand at the selected warehouse. DOC = days of cover. DRR is auto from orders. Duplicate SKUs are merged (last row wins)."
  ]);

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  sheet.columns = [{ width: 22 }, { width: 12 }, { width: 10 }, { width: 18 }, { width: 28 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "inventory-stock-adjust-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export const STOCK_ADJUST_BATCH_SIZE = 100;
