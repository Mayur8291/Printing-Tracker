import { drrOfSku, formatUniDrrWithUnit, soldOfSku } from "./uniwareDrrUtils";

function onHand(r) {
  return (Number(r.qty) || 0) + (Number(r.qty_blocked) || 0) + (Number(r.qty_putaway) || 0);
}

function formatWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function downloadBlob(buffer, filename) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * One sheet, same columns / values / order as the Inventory mirror table
 * (including Sold + DRR for the on-screen period). Does not write Inventory on-hand.
 */
export async function exportUniwareMirrorExcel({ rows, drrBySku = {} }) {
  const view = Array.isArray(rows) ? rows : [];
  if (!view.length) {
    throw new Error("No rows on screen to export. Change filters or Sync inventory first.");
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Scott Dashboard";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Inventory mirror");
  sheet.addRow([
    "SKU",
    "Facility",
    "Available",
    "Blocked",
    "Open sale",
    "Putaway",
    "On hand",
    "Sold",
    "DRR (pcs/day)",
    "Synced"
  ]);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  for (const row of view) {
    sheet.addRow([
      row.sku_code ?? "",
      row.facility_code ?? "",
      Number(row.qty) || 0,
      Number(row.qty_blocked) || 0,
      Number(row.qty_open_sale) || 0,
      Number(row.qty_putaway) || 0,
      onHand(row),
      soldOfSku(drrBySku, row.sku_code),
      formatUniDrrWithUnit(drrOfSku(drrBySku, row.sku_code)),
      formatWhen(row.synced_at)
    ]);
  }

  sheet.columns = [
    { width: 28 },
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 22 }
  ];
  for (let c = 3; c <= 8; c += 1) {
    sheet.getColumn(c).numFmt = "0";
    sheet.getColumn(c).alignment = { horizontal: "right" };
  }
  sheet.getColumn(9).alignment = { horizontal: "right" };

  const stamp = new Date().toISOString().slice(0, 10);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(buffer, `uniware-inventory-mirror_${stamp}.xlsx`);
  return { rowCount: view.length };
}
