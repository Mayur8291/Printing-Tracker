// Table columns for a master list, with relation ids resolved to names.
//
// `ScottTable` renders `relation` / `relation-list` columns from either an embedded
// `{id, name}` object or a bare id looked up in `column.options` (see `relationLabel`).
// Ten masters take the second route — they store only the FK:
//
//   sc_sizes.size_group_id → size_types          asset_infos.add_on_id → add_ons
//   base_product_asset_infos ×4 → base_products / add_ons / parts / asset_infos
//   promotional_banners ×3 → rmp_categories / rmp_classes / rmp_brands
//
// Those columns already name their source in `optionsResource`; this module collects the
// resources so the screen can drain them through `useMasterRelationOptions` (cached, one
// request per master per session) and then injects the resulting `{value, label}` list onto
// the column. Columns whose value is an embedded object need nothing and are left alone.

import { colorsDisplayText, relationDisplayText } from "@/scott/list/filterEngine";

/** Column types whose value may be a bare id needing a name lookup. */
const LOOKUP_COLUMN_TYPES = new Set(["relation", "relation-list"]);

/** Column types whose raw cell is an object / array — never what the user sees. */
const PROJECTED_COLUMN_TYPES = new Set(["relation", "relation-list", "colors"]);

/**
 * Masters whose option lists this config's COLUMNS need (never its fields).
 * @param {object} config
 * @returns {string[]} resource keys, de-duplicated, in column order.
 */
export function columnOptionResourcesFor(config) {
  const seen = [];
  for (const column of config?.columns ?? []) {
    if (!column?.key || !LOOKUP_COLUMN_TYPES.has(column.type)) continue;
    if (Array.isArray(column.options) && column.options.length > 0) continue;
    const resource = column.optionsResource;
    if (typeof resource === "string" && resource && !seen.includes(resource)) seen.push(resource);
  }
  return seen;
}

/**
 * `config.columns` with relation options filled in AND a display projection (`getSortValue`)
 * on every `relation` / `relation-list` / `colors` column. Returns the SAME array when a
 * config has none of those, so the common case adds no re-render churn.
 *
 * @param {object} config
 * @param {Record<string, {options?: Array<{value: string, label: string}>}>} [optionsByResource]
 * @returns {Array<object>}
 */
export function decorateMasterColumns(config, optionsByResource = {}) {
  const columns = config?.columns ?? [];

  let changed = false;
  const out = columns.map((column) => {
    if (!column?.key || !PROJECTED_COLUMN_TYPES.has(column.type)) return column;

    let next = column;
    if (LOOKUP_COLUMN_TYPES.has(column.type) && !(Array.isArray(column.options) && column.options.length > 0)) {
      const entry = optionsByResource?.[column.optionsResource];
      const options = Array.isArray(entry?.options) ? entry.options : [];
      if (options.length > 0) next = { ...column, options };
    }

    // SORT on the rendered text, like the filter does (`filterEngine.filterColumnValueGetter`).
    // Without this `tableSort` compares `[object Object]` / the bare FK id and a "sort by
    // Category" is either a no-op or an ordering by internal id.
    if (typeof next.getSortValue !== "function") {
      const resolved = next;
      // `format` first, like the cell renderer and the filter getter — a relation column
      // keyed on the FK resolves its display value through it.
      const project = (row) => {
        const raw = row?.[column.key];
        return typeof resolved.format === "function" ? resolved.format(raw, row) : raw;
      };
      next =
        column.type === "colors"
          ? { ...resolved, getSortValue: (row) => colorsDisplayText(project(row)) }
          : { ...resolved, getSortValue: (row) => relationDisplayText(resolved, project(row)) };
    }

    if (next !== column) changed = true;
    return next;
  });

  return changed ? out : columns;
}

export default decorateMasterColumns;
