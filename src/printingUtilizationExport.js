import {
  formatPrintingMetres,
  formatPrintingUtilizationDate,
  formatPcsFused
} from "./printingUtilizationUtils";

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

export async function exportPrintingUtilizationExcel(entries) {
  if (!entries?.length) {
    throw new Error("No utilization entries to export.");
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Scott Dashboard";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Printing utilization");
  const header = ["Date", "Number of metre printed", "Number of pcs fused"];
  sheet.addRow(header);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  const sorted = [...entries].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const row of sorted) {
    sheet.addRow([
      formatPrintingUtilizationDate(row.created_at),
      Number(row.printing_metres) || 0,
      Number(row.pcs_fused) || 0
    ]);
  }

  sheet.columns = [{ width: 28 }, { width: 24 }, { width: 22 }];
  sheet.getColumn(2).numFmt = "#,##0.##";
  sheet.getColumn(2).alignment = { horizontal: "right" };
  sheet.getColumn(3).numFmt = "#,##0";
  sheet.getColumn(3).alignment = { horizontal: "right" };

  const stamp = new Date().toISOString().slice(0, 10);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(buffer, `printing-utilization_${stamp}.xlsx`);

  return {
    rowCount: entries.length,
    totalMetres: formatPrintingMetres(
      entries.reduce((sum, row) => sum + (Number(row.printing_metres) || 0), 0)
    ),
    totalPcs: formatPcsFused(entries.reduce((sum, row) => sum + (Number(row.pcs_fused) || 0), 0))
  };
}
