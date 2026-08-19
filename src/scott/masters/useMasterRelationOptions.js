// Option lists for the relation `select` fields on a master's create/edit form.
//
// 20 of the 22 masters' forms point a `select` at another master (`optionsResource:
// 'rmp_skus'`, `'add_ons'`, …). The registry already knows how to read those masters, so the
// options are drained through the very same service the list uses — no new data layer.
//
// Loading is LAZY (first dialog open, never on mount): `rmp_prices` sources its picker from
// `rmp_skus`, whose drain is capped at 100 rows x 250 pages, and nobody should pay for that
// just by clicking through the left rail. Results are cached for the session — switching the
// Scott environment reloads the page (see `ScottEnvBadge`), which drops the cache with it.

import { useEffect, useMemo, useState } from "react";
import { getMasterConfig, getMastersService } from "@/scott/data/masterConfigs";
import { optionLabelForRow, relationResourcesFor } from "@/scott/masters/mastersDialogFields";
import { columnOptionResourcesFor } from "@/scott/masters/mastersListColumns";

/** resource key -> `[{ value, label }]`, for the life of the page. */
const optionsCache = new Map();
/** resource key -> in-flight promise, so two dialogs never drain the same master twice. */
const inflight = new Map();

function toOptions(masterKey, rows) {
  const idField = getMasterConfig(masterKey)?.idField || "id";
  const seen = new Set();
  const options = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = String(row?.[idField] ?? row?.id ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: optionLabelForRow(row, value) });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, "en"));
  return options;
}

/**
 * Drain one master and shape it as dropdown options. Cached; concurrent callers share.
 * @param {string} masterKey a key from `MASTER_CONFIGS`, e.g. `'add_ons'`.
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export function loadMasterOptions(masterKey) {
  const key = String(masterKey ?? "");
  if (optionsCache.has(key)) return Promise.resolve(optionsCache.get(key));

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    // `getMastersService` throws on an unknown key — let that reject and surface as a hint
    // on the field rather than taking the screen down.
    const rows = await getMastersService(key).listAll();
    const options = toOptions(key, rows);
    optionsCache.set(key, options);
    return options;
  })();

  inflight.set(key, promise);
  promise.catch(() => {}).then(() => inflight.delete(key));
  return promise;
}

/** Drop every cached option list (used by the smoke tests). */
export function clearMasterOptionsCache() {
  optionsCache.clear();
  inflight.clear();
}

/**
 * Option lists for every relation select on `config`.
 *
 * @param {object} config a master config.
 * @param {object} [args]
 * @param {boolean} [args.enabled=false] start loading — pass `true` once a dialog has opened.
 * @param {boolean} [args.includeMultiselect=false] also drain the masters behind the
 *   `multiselect` fields (dialog only — the bulk grid drops those columns).
 * @param {boolean} [args.includeColumns=false] also drain the masters a `relation` COLUMN
 *   needs to turn a stored id into a name (`mastersListColumns.js`). Unlike the field
 *   lists this one is wanted before any dialog opens — the table shows ids otherwise.
 * @returns {{
 *   optionsByResource: Record<string, {options: Array<{value:string,label:string}>, loading: boolean, error: string}>,
 *   version: number,
 *   loading: boolean
 * }} `version` bumps whenever a list settles; the dialog is keyed on it because
 *   `ScottEntityDialog` memoises its field list on a `key:type` signature and would
 *   otherwise keep rendering the empty dropdowns it mounted with.
 */
export function useMasterRelationOptions(
  config,
  { enabled = false, includeMultiselect = false, includeColumns = false } = {}
) {
  const resources = useMemo(() => {
    const fromFields = relationResourcesFor(config, { includeMultiselect });
    if (!includeColumns) return fromFields;
    const merged = [...fromFields];
    for (const resource of columnOptionResourcesFor(config)) {
      if (!merged.includes(resource)) merged.push(resource);
    }
    return merged;
  }, [config, includeMultiselect, includeColumns]);
  const signature = resources.join(",");

  const [optionsByResource, setOptionsByResource] = useState({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || resources.length === 0) return undefined;
    let cancelled = false;

    setOptionsByResource((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const resource of resources) {
        if (next[resource]) continue;
        next[resource] = { options: optionsCache.get(resource) ?? [], loading: !optionsCache.has(resource), error: "" };
        changed = true;
      }
      return changed ? next : prev;
    });

    for (const resource of resources) {
      if (optionsCache.has(resource)) continue;
      loadMasterOptions(resource)
        .then((options) => {
          if (cancelled) return;
          setOptionsByResource((prev) => ({ ...prev, [resource]: { options, loading: false, error: "" } }));
          setVersion((n) => n + 1);
        })
        .catch((err) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setOptionsByResource((prev) => ({ ...prev, [resource]: { options: [], loading: false, error: message } }));
          setVersion((n) => n + 1);
        });
    }

    return () => {
      cancelled = true;
    };
    // `signature` stands in for `resources`, which is rebuilt on every config swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);

  const loading = resources.some((resource) => optionsByResource[resource]?.loading === true);

  return { optionsByResource, version, loading };
}

export default useMasterRelationOptions;
