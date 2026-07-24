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

/** @param {import("exceljs").Worksheet} sheet */
export function parseStockAdjustSheet(sheet) {
  const columns = headerMap(sheet.getRow(1));
  const missing = missingHeaders(columns);
  if (missing.length) {
    throw new Error(
      `Missing required column: ${missing.join(", ")}. Download the template — required: SKU Code; optional: Stock Qty, DOC, Storage Location, Reason.`
    );
  }

  const records = [];
  const seen = new Set();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const parsed = rowFromSheet(sheet.getRow(r), columns);
    if (!parsed) continue;
    const key = parsed.skuCode.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (parsed.stockQty == null && parsed.doc == null && !parsed.storageLocation) continue;
    records.push(parsed);
  }

  if (!records.length) {
    throw new Error("No adjustment rows found. Fill SKU Code and at least one of Stock Qty, DOC, or Storage Location.");
  }

  return records;
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
      ? `Upload applies to ${warehouseName} only. Stock Qty = on-hand at that warehouse. DRR is auto from orders.`
      : "Stock Qty = on-hand at the selected warehouse. DOC = days of cover. DRR is auto from orders."
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
