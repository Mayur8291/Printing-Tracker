import { excelCellString } from "./excelCellUtils";

const REQUIRED_HEADERS = ["sku code"];

const HEADER_ALIASES = {
  "sku code": ["sku code", "sku", "sku_code", "sku id"],
  "unit cost": ["unit cost", "unit_cost", "cost", "unit cost (₹)", "unit cost (inr)"],
  "sale price": ["sale price", "sale_price", "retail", "retail price", "retail_price", "sale price (₹)", "sale price (inr)"],
  "reorder point": ["reorder point", "reorder", "reorder_point", "reorder pt"],
  doc: ["doc", "days of cover", "days_of_cover"]
};

function parseOptionalNumber(cell) {
  const text = excelCellString(cell).replace(/,/g, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function headerMap(row) {
  const map = {};
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const key = excelCellString(cell).toLowerCase();
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
  const skuCode = excelCellString(row.getCell(columns["sku code"]));
  if (!skuCode) return null;

  return {
    skuCode,
    unitCost: columns["unit cost"] != null ? parseOptionalNumber(row.getCell(columns["unit cost"])) : null,
    salePrice: columns["sale price"] != null ? parseOptionalNumber(row.getCell(columns["sale price"])) : null,
    reorderPoint: columns["reorder point"] != null ? parseOptionalNumber(row.getCell(columns["reorder point"])) : null,
    doc: columns.doc != null ? parseOptionalNumber(row.getCell(columns.doc)) : null
  };
}

function mergeMetricsRow(existing, incoming) {
  return {
    skuCode: existing.skuCode,
    unitCost: incoming.unitCost != null ? incoming.unitCost : existing.unitCost,
    salePrice: incoming.salePrice != null ? incoming.salePrice : existing.salePrice,
    reorderPoint: incoming.reorderPoint != null ? incoming.reorderPoint : existing.reorderPoint,
    doc: incoming.doc != null ? incoming.doc : existing.doc,
    mergedRowCount: (existing.mergedRowCount || 1) + 1
  };
}

/** @param {import("exceljs").Worksheet} sheet */
export function parseSkuMetricsSheet(sheet) {
  const columns = headerMap(sheet.getRow(1));
  const missing = missingHeaders(columns);
  if (missing.length) {
    throw new Error(
      `Missing required column: ${missing.join(", ")}. Download the template — required: SKU Code; optional: Unit Cost, Sale Price, Reorder Point, DOC.`
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
    if (
      parsed.unitCost == null &&
      parsed.salePrice == null &&
      parsed.reorderPoint == null &&
      parsed.doc == null
    ) {
      parseMeta.emptyDataRows++;
      continue;
    }

    const key = parsed.skuCode.toLowerCase();
    const existing = bySku.get(key);
    if (existing) {
      parseMeta.duplicateMerged++;
      bySku.set(key, mergeMetricsRow(existing, parsed));
    } else {
      bySku.set(key, parsed);
    }
  }

  const records = [...bySku.values()];
  if (!records.length) {
    throw new Error(
      "No metric rows found. Fill SKU Code and at least one of Unit Cost, Sale Price, Reorder Point, or DOC."
    );
  }

  return { records, parseMeta };
}

export async function parseSkuMetricsWorkbook(file) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("No worksheet found in the file.");
  return parseSkuMetricsSheet(sheet);
}

function metricChanged(current, next) {
  if (next == null) return false;
  const cur = Number(current) || 0;
  const nxt = Number(next) || 0;
  return cur !== nxt;
}

/**
 * @param {Array<{ id: string, _uuid?: string, cost?: number, retail?: number, reorder?: number, doc?: number }>} skus
 * @param {ReturnType<typeof rowFromSheet>[]} records
 */
export function enrichSkuMetricsRows(skus, records) {
  const byCode = new Map();
  for (const sku of skus) {
    byCode.set(String(sku.id).trim().toLowerCase(), sku);
  }

  return records.map((row) => {
    const sku = byCode.get(row.skuCode.trim().toLowerCase());
    if (!sku?._uuid) {
      return { ...row, error: `SKU not found: ${row.skuCode}` };
    }

    for (const [label, val] of [
      ["Unit cost", row.unitCost],
      ["Sale price", row.salePrice],
      ["Reorder point", row.reorderPoint],
      ["DOC", row.doc]
    ]) {
      if (val != null && val < 0) {
        return { ...row, error: `${label} cannot be negative for ${row.skuCode}` };
      }
    }

    const willUpdateCost = row.unitCost != null && metricChanged(sku.cost, row.unitCost);
    const willUpdateRetail = row.salePrice != null && metricChanged(sku.retail, row.salePrice);
    const willUpdateReorder = row.reorderPoint != null && metricChanged(sku.reorder, row.reorderPoint);
    const willUpdateDoc = row.doc != null && metricChanged(sku.doc, row.doc);
    const hasUpdates = willUpdateCost || willUpdateRetail || willUpdateReorder || willUpdateDoc;

    if (!hasUpdates) {
      return { ...row, error: `No change for ${row.skuCode} (values already match)` };
    }

    return {
      ...row,
      _uuid: sku._uuid,
      currentCost: sku.cost ?? 0,
      currentRetail: sku.retail ?? 0,
      currentReorder: sku.reorder ?? 0,
      currentDoc: sku.doc ?? 0,
      willUpdateCost,
      willUpdateRetail,
      willUpdateReorder,
      willUpdateDoc,
      hasUpdates
    };
  });
}

export function summarizeSkuMetricsPreview(enriched) {
  const valid = enriched.filter((r) => !r.error);
  const invalid = enriched.filter((r) => r.error);

  return {
    total: enriched.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    costCount: valid.filter((r) => r.willUpdateCost).length,
    retailCount: valid.filter((r) => r.willUpdateRetail).length,
    reorderCount: valid.filter((r) => r.willUpdateReorder).length,
    docCount: valid.filter((r) => r.willUpdateDoc).length,
    valid,
    invalid
  };
}

export function downloadSkuMetricsSkipReport(rows) {
  const skipped = rows.filter((r) => r.error);
  if (!skipped.length) return;

  const stamp = new Date().toISOString().slice(0, 10);
  const header = [
    "SKU Code",
    "Unit Cost",
    "Sale Price",
    "Reorder Point",
    "DOC",
    "Skip reason",
    "Merged rows"
  ];
  const escape = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    header.join(","),
    ...skipped.map((r) =>
      [r.skuCode, r.unitCost ?? "", r.salePrice ?? "", r.reorderPoint ?? "", r.doc ?? "", r.error, r.mergedRowCount ?? 1]
        .map(escape)
        .join(",")
    )
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sku-pricing-upload-skipped-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadSkuMetricsTemplate() {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Scott Dashboard";
  const sheet = workbook.addWorksheet("SKU Pricing");

  const headers = ["SKU Code", "Unit Cost (₹)", "Sale Price (₹)", "Reorder Point", "DOC"];
  sheet.addRow(headers);
  sheet.addRow(["EXAMPLE-SKU-01", 250, 499, 20, 30]);
  sheet.addRow(["EXAMPLE-SKU-02", 180, "", 10, ""]);
  sheet.addRow([
    "",
    "",
    "",
    "",
    "Fill only columns you want to update. DRR stays auto from orders. Duplicate SKUs merged (last row wins)."
  ]);

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  sheet.columns = [{ width: 22 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "inventory-sku-pricing-import-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export const SKU_METRICS_BATCH_SIZE = 100;
