function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsvRows(rows, filename) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const EXPORT_HEADERS = [
  "SKU Code",
  "Kind",
  "Name",
  "Color",
  "Stock Qty",
  "Unit",
  "Unit Cost",
  "Retail Price",
  "Reorder Point",
  "DOC",
  "DRR",
  "Supplier",
  "Warehouse",
  "Bin Location",
  "Parent Style",
  "Tags",
  "Class Name",
  "Brand",
  "Category"
];

function skuExportRow(sku, supplierMap, warehouseMap) {
  const stock = Number(sku.stock ?? sku.totalStock ?? 0);
  return [
    sku.id,
    sku.kind ?? "",
    sku.name ?? "",
    sku.color ?? "",
    stock,
    sku.unit ?? "",
    Number(sku.cost ?? 0),
    sku.retail ?? "",
    Number(sku.reorder ?? 0),
    sku.doc ?? "",
    sku.drr ?? "",
    supplierMap.get(sku.supplier)?.name ?? sku.supplier ?? "",
    warehouseMap.get(sku.wh)?.name ?? sku.wh ?? "",
    sku.bin ?? "",
    sku.parentStyleCode ?? "",
    Array.isArray(sku.tags) ? sku.tags.join("; ") : "",
    sku.className ?? "",
    sku.brand ?? "",
    sku.category ?? sku.type ?? sku.composition ?? ""
  ];
}

/** Download SKUs as CSV (UTF-8 with BOM for Excel). */
export function exportSkusCsv({ skus, suppliers = [], warehouses = [], filename = "inventory-skus.csv" }) {
  if (!skus?.length) {
    window.alert("No SKUs to export.");
    return false;
  }
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
  const rows = [EXPORT_HEADERS, ...skus.map((sku) => skuExportRow(sku, supplierMap, warehouseMap))];
  downloadCsvRows(rows, filename);
  return true;
}

/** Fetch every SKU from Supabase then export (overview / full dump). */
export async function exportAllSkusCsv({ suppliers = [], warehouses = [] } = {}) {
  const { fetchInventorySkuRowsAll, rowToSku } = await import("./inventoryDbUtils");
  const rawRows = await fetchInventorySkuRowsAll();
  const skus = rawRows.map(rowToSku).filter(Boolean);
  const stamp = new Date().toISOString().slice(0, 10);
  return exportSkusCsv({
    skus,
    suppliers,
    warehouses,
    filename: `inventory-skus_${stamp}.csv`
  });
}

export function exportSkuFilename(kind) {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = String(kind ?? "all").replace(/s$/, "");
  return `inventory-${slug}_${stamp}.csv`;
}
