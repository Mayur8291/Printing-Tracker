// CSV export for a master list — the same house pattern the reports and the customer
// directory use (`createCSVContent` + `downloadCsv` + `csvTimestamp`, masters spec §0.6:
// "CSV export via resolveMasterListExportRows + exportToCSV").
//
// WHICH ROWS: the FILTERED + SORTED set, never a single server page. `useScottList` switches
// to 'full' mode the moment any filter or sort is on and exposes that set as `processedRows`;
// in plain 'server' mode only ONE page is in memory, so the export goes back to the wire and
// fetches the rest before writing (see `resolveMasterExportRows`). The old behaviour — write
// `list.rows` — handed the user a 20-row file for a 20,000-row master and reported "Exported
// 20 records" as a success.
//
// WHICH COLUMNS: exactly the table's, in table order, so the file matches what the user sees.
// The relation/colors/image cell types are flattened to text here — a CSV cannot hold a
// swatch — reusing `relationLabel` so an id column exports the same name the table shows.

import { createCSVContent, csvTimestamp, downloadCsv } from "@/scott/bulk/csvImportService";
import { fetchAllScottPages } from "@/scott/scottPagination";
import { imageListUrls, readScottCellValue, relationLabel } from "@/scott/ui/ScottTable";

/**
 * Plain text for one cell.
 * @param {object} column
 * @param {object} row
 * @returns {string}
 */
export function masterCsvCell(column, row) {
  if (!column?.key) return "";
  const raw = readScottCellValue(row, column.key);
  const value = typeof column.format === "function" ? column.format(raw, row) : raw;

  switch (column.type) {
    case "relation":
      return relationLabel(column, value);

    case "relation-list": {
      const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
      return list.map((item) => relationLabel(column, item)).filter(Boolean).join(", ");
    }

    case "colors":
      return (Array.isArray(value) ? value : [])
        .map((entry) => {
          const name = String(entry?.name ?? "").trim();
          const hex = String(entry?.hex_code ?? "").trim();
          return name && hex ? `${name} (${hex})` : name || hex;
        })
        .filter(Boolean)
        .join(", ");

    case "image-list":
      return imageListUrls(column, row).join(" ");

    case "boolean":
      if (value === null || value === undefined || value === "") return "";
      return value === true || value === "true" || value === 1 || value === "1" ? "Yes" : "No";

    default:
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return relationLabel(column, value);
      return String(value);
  }
}

/**
 * The rows a master CSV must cover — NEVER just the visible page.
 *
 * Mirrors `resolveCustomerExportRows` (and upstream `exportUtils.ts`, which has no
 * "current page" branch at all):
 *
 *   full mode (any filter / quick filter / sort)  the in-memory filtered + sorted set;
 *   server mode + a search term                   every page of THAT search, so the file
 *                                                 matches the query on screen;
 *   server mode, no search                        the whole master (`service.listAll`).
 *
 * The wire filters ("Show inactive", rmp_prices' `rmp_sku_id`) ride along in both server-mode
 * branches, exactly as they do on the list itself.
 *
 * Truncation is not swallowed: `onTruncated` is forwarded into the drain so the caller can
 * warn that the file stops at the safety cap.
 *
 * @param {object} args
 * @param {string} [args.mode] `list.mode` — "full" or "server".
 * @param {object[]} [args.processedRows] `list.processedRows` (full mode only).
 * @param {string} [args.search] `list.debouncedSearch`.
 * @param {object} args.service the master's service (`listPage` / `listAll`).
 * @param {object} [args.listFilters] the wire filters the list is currently running with.
 * @param {object} [args.fetchAllOptions] `config.fetchAllOptions` — per-entity drain sizing.
 * @param {(meta: object) => void} [args.onTruncated]
 * @param {object} [deps] test seams: `{ drain }`.
 * @returns {Promise<object[]>}
 */
export async function resolveMasterExportRows(
  { mode, processedRows = [], search = "", service, listFilters = {}, fetchAllOptions, onTruncated } = {},
  deps = {}
) {
  if (mode === "full") return Array.isArray(processedRows) ? processedRows : [];

  const drain = deps.drain ?? fetchAllScottPages;
  const term = String(search ?? "").trim();

  if (term) {
    // `listAll` never carries `search`, so the searched export has to drain the pages itself.
    const rows = await drain(
      (pp) => service.listPage({ page: pp.page, items: pp.items, search: term, ...listFilters }),
      { ...(fetchAllOptions ?? {}), onTruncated }
    );
    return Array.isArray(rows) ? rows : [];
  }

  const rows = await service.listAll(listFilters, { onTruncated });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Build + download one master CSV.
 *
 * @param {object} args
 * @param {object} args.config the master config (its `columns` and `key` are used).
 * @param {object[]} args.rows already-resolved rows (see `resolveMasterExportRows`).
 * @param {Array<object>} [args.columns] overrides `config.columns` (the decorated set).
 * @returns {number} rows written.
 */
export function exportMasterCsv({ config, rows, columns }) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = (Array.isArray(columns) && columns.length > 0 ? columns : config?.columns ?? []).filter(
    (column) => column?.key
  );

  const content = createCSVContent(
    cols.map((column) => String(column.header ?? column.key)),
    list.map((row) => cols.map((column) => masterCsvCell(column, row)))
  );

  const name = String(config?.key || config?.resource || "master").toLowerCase();
  downloadCsv(`scott-${name}-${csvTimestamp()}.csv`, content);
  return list.length;
}

export default exportMasterCsv;
