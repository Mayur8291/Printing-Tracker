const EXPECTED_HEADERS = ["sku", "size", "class name", "color", "brand", "category"];

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object" && value.text != null) return String(value.text).trim();
  return String(value).trim();
}

import { colorLabelToHex } from "./inventoryColorUtils";

function normalizeSize(size) {
  const s = cellText(size).toUpperCase();
  if (s === "2XL") return "XXL";
  if (s === "3XL") return "XXXL";
  return s || "OS";
}

function headerMap(row) {
  const map = {};
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const key = cellText(cell.value).toLowerCase();
    if (key) map[key] = col;
  });
  return map;
}

function missingHeaders(map) {
  return EXPECTED_HEADERS.filter((h) => map[h] == null);
}

export function apparelRecordFromImportRow(row, columns) {
  const skuCode = cellText(row.getCell(columns.sku).value);
  if (!skuCode) return null;

  const size = normalizeSize(row.getCell(columns.size).value);
  const className = cellText(row.getCell(columns["class name"]).value);
  const color = cellText(row.getCell(columns.color).value);
  const brand = cellText(row.getCell(columns.brand).value);
  const category = cellText(row.getCell(columns.category).value);

  return {
    id: skuCode,
    name: brand || className || skuCode,
    category: category || "Apparel",
    season: "",
    color: color || "—",
    hex: colorLabelToHex(color || className || skuCode),
    supplier: "",
    wh: "",
    totalStock: 0,
    reorder: 0,
    cost: 0,
    retail: 0,
    sizes: { [size]: 0 },
    className,
    brand,
    sizeLabel: cellText(row.getCell(columns.size).value)
  };
}

export async function parseApparelSkuWorkbook(file) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error("No worksheet found in the file.");
  }

  const columns = headerMap(sheet.getRow(1));
  const missing = missingHeaders(columns);
  if (missing.length) {
    throw new Error(
      `Missing columns: ${missing.join(", ")}. Expected: SKU, Size, Class Name, Color, Brand, Category.`
    );
  }

  const records = [];
  const seen = new Set();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const record = apparelRecordFromImportRow(sheet.getRow(r), columns);
    if (!record) continue;
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }

  if (!records.length) {
    throw new Error("No SKU rows found in the file.");
  }

  return records;
}

export async function downloadApparelSkuTemplate() {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Scott Dashboard";
  const sheet = workbook.addWorksheet("Apparel SKUs");

  const headers = ["SKU", "Size", "Class Name", "Color", "Brand", "Category"];
  sheet.addRow(headers);
  sheet.addRow(["EXAMPLE-SKU-01", "M", "Classic Tee", "Navy", "Scott", "T-Shirt"]);
  sheet.addRow(["EXAMPLE-SKU-02", "L", "Polo", "White", "Scott", "Polo"]);
  sheet.addRow([
    "",
    "",
    "",
    "",
    "",
    "Delete example rows before upload. SKU must be unique. Supplier is set later in the dashboard."
  ]);

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  sheet.columns = [
    { width: 22 },
    { width: 10 },
    { width: 24 },
    { width: 14 },
    { width: 18 },
    { width: 16 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "inventory-apparel-sku-import-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}
