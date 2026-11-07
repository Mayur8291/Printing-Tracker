// CSV export for every report.
//
// The registry's `export` block ({ entityName, headers, fieldMap, filename }) is the only
// input: `buildReportCsv` turns it into text (reproducing the upstream quoting quirk) and
// the browser downloads it. `fieldMap` is sometimes a function and sometimes an object,
// because some services close over per-tab state (`overviewExportFieldMap(reportType)`) and
// others are static — both shapes are accepted here so no call site has to care.

import { buildReportCsv, generateExportFilename } from "@/scott/data/reports/reportShared";

/** Trigger a browser download for a text payload. Mirrors `src/dealerReportExport.js`. */
export function downloadTextFile(text, filename, mime = "text/csv;charset=utf-8;") {
  if (typeof document === "undefined") return;
  const blob = new Blob(["﻿", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** `fieldMap` may be the map itself or a factory; `args` is forwarded to the factory. */
export function resolveExportFieldMap(fieldMap, ...args) {
  if (typeof fieldMap === "function") return fieldMap(...args) ?? {};
  return fieldMap ?? {};
}

/**
 * Build + download one report CSV.
 *
 * @param {object} args
 * @param {object} args.exportConfig registry `export` block.
 * @param {object[]} args.rows rows to write — the FILTERED/SORTED set, never one page.
 * @param {unknown[]} [args.fieldMapArgs] extra args for a `fieldMap` factory.
 * @returns {number} how many rows were written.
 */
export function exportReportCsv({ exportConfig, rows, fieldMapArgs = [] }) {
  const list = Array.isArray(rows) ? rows : [];
  const headers = exportConfig?.headers ?? [];
  const fieldMap = resolveExportFieldMap(exportConfig?.fieldMap, ...fieldMapArgs);

  const csv = buildReportCsv({ headers: [...headers], rows: list, fieldMap });
  const filename =
    typeof exportConfig?.filename === "function"
      ? exportConfig.filename()
      : generateExportFilename(exportConfig?.entityName ?? "report");

  downloadTextFile(csv, filename);
  return list.length;
}

export default exportReportCsv;
