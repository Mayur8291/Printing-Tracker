// Scott masters registry — the single import point for every master config.
//
//   masterConfigs.core.js  §1–§14  (brands … Scott promotional banners)
//   masterConfigs.rmp.js   §15–§22 (the 8 `rmp_*` resources)
//
// Both files are read defensively: either may export its configs as an array, as an
// object keyed by config key, as a default export, or as loose named exports — the
// resolver below accepts all four so the two halves can evolve independently.
//
// Usage:
//   import { getMasterConfig, getMastersService, MASTER_NAV } from '@/scott/data/masterConfigs';
//   const service = getMastersService('colors');   // memoized per key
//   const { data } = await service.listPage({ page: 1, pageSize: 20, search: 'red' });
//
// Settings (§23) is not a master: it is a single toggle, see ../scottSettingsService.js.

import { createMastersService } from "./mastersService";
import * as coreModule from "./masterConfigs.core";
import * as rmpModule from "./masterConfigs.rmp";
import { MASTER_GROUPS } from "./masterConfigs.core";

export { MASTER_GROUPS };

/** Nav order for the left rail. Unknown groups are appended in first-seen order. */
export const MASTER_GROUP_ORDER = Object.freeze([
  MASTER_GROUPS.CATALOGUE,
  MASTER_GROUPS.ASSETS,
  MASTER_GROUPS.PRICING,
  MASTER_GROUPS.PROMOTIONS,
  MASTER_GROUPS.RMP
]);

// ---------------------------------------------------------------------------
// Module -> config list
// ---------------------------------------------------------------------------

function isConfig(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.resource === "string" &&
      typeof value.key === "string"
  );
}

/** Pull configs out of an array, an object of configs, or a module namespace. */
function toConfigList(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    const list = value.filter(isConfig);
    return list.length > 0 ? list : null;
  }
  const list = Object.values(value).filter(isConfig);
  return list.length > 0 ? list : null;
}

function readModuleConfigs(mod, ...preferredKeys) {
  for (const key of preferredKeys) {
    const list = toConfigList(mod?.[key]);
    if (list) return list;
  }
  // `export default [...]`, then any loose named config exports.
  return toConfigList(mod?.default) ?? toConfigList(mod) ?? [];
}

/**
 * Compatibility alias: the config files describe their drain overrides as
 * `fetchAll: {pageSize, maxPages, concurrency, …}` (what `mastersService` reads),
 * while `useScottList` looks for `fetchAllOptions`. Publish both from the registry so
 * neither side has to know about the other. Configs without an override are passed
 * through untouched, so identity is preserved for all but rmp_skus / rmp_prices.
 */
function withFetchAllAlias(config) {
  if (config.fetchAllOptions || !config.fetchAll) return config;

  const { pageSize, maxPages, concurrency } = config.fetchAll;
  const options = {};
  if (pageSize !== undefined) options.pageSize = pageSize;
  if (maxPages !== undefined) options.maxPages = maxPages;
  if (concurrency !== undefined) options.concurrency = concurrency;
  if (Object.keys(options).length === 0) return config;

  return { ...config, fetchAllOptions: options };
}

const CORE_CONFIG_LIST = readModuleConfigs(coreModule, "CORE_MASTER_CONFIGS").map(withFetchAllAlias);
const RMP_CONFIG_LIST = readModuleConfigs(rmpModule, "RMP_MASTER_CONFIGS").map(withFetchAllAlias);

// ---------------------------------------------------------------------------
// Merged registry
// ---------------------------------------------------------------------------

/** Every master config, core first then RMP — this is the nav order. */
export const MASTER_CONFIG_LIST = Object.freeze([...CORE_CONFIG_LIST, ...RMP_CONFIG_LIST]);

/** Every master config keyed by `key`. */
export const MASTER_CONFIGS = Object.freeze(
  MASTER_CONFIG_LIST.reduce((registry, config) => {
    if (registry[config.key]) {
      console.warn(`[scott] duplicate master config key "${config.key}" — keeping the first one`);
      return registry;
    }
    registry[config.key] = config;
    return registry;
  }, {})
);

/** Keys in nav order. */
export const MASTER_KEYS = Object.freeze(MASTER_CONFIG_LIST.map((config) => config.key));

/**
 * @param {string} key e.g. 'colors', 'rmp_prices'
 * @returns {object|undefined} the config, or undefined when the key is unknown
 */
export function getMasterConfig(key) {
  return MASTER_CONFIGS[String(key ?? "")];
}

/** Same, but throws instead of returning undefined — handy at call sites that cannot recover. */
export function requireMasterConfig(key) {
  const config = getMasterConfig(key);
  if (!config) throw new Error(`Unknown Scott master "${String(key ?? "")}"`);
  return config;
}

// ---------------------------------------------------------------------------
// Grouped nav
// ---------------------------------------------------------------------------

/**
 * Left-rail structure: `[{ group, items: [{ key, label, resource, group }] }]`.
 * Groups follow MASTER_GROUP_ORDER; anything unrecognised is appended in the order
 * it first appears, so a new group in either config file still shows up.
 */
export const MASTER_NAV = Object.freeze(
  (() => {
    const byGroup = new Map();
    for (const config of MASTER_CONFIG_LIST) {
      const group = config.group ?? "Other";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push({
        key: config.key,
        label: config.label,
        resource: config.resource,
        group
      });
    }

    const ordered = [];
    for (const group of MASTER_GROUP_ORDER) {
      if (byGroup.has(group)) {
        ordered.push({ group, items: Object.freeze(byGroup.get(group)) });
        byGroup.delete(group);
      }
    }
    for (const [group, items] of byGroup) {
      ordered.push({ group, items: Object.freeze(items) });
    }
    return ordered;
  })()
);

/** @returns {{group: string, items: {key:string,label:string,resource:string,group:string}[]}[]} */
export function getMasterNav() {
  return MASTER_NAV;
}

/** Configs belonging to one nav group, in nav order. */
export function getMasterConfigsByGroup(group) {
  return MASTER_CONFIG_LIST.filter((config) => (config.group ?? "Other") === group);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const serviceCache = new Map();

/**
 * The CRUD service for one master, built on first use and cached afterwards.
 * @param {string} key
 * @returns {ReturnType<typeof createMastersService>}
 */
export function getMastersService(key) {
  const id = String(key ?? "");
  const cached = serviceCache.get(id);
  if (cached) return cached;

  const service = createMastersService(requireMasterConfig(id));
  serviceCache.set(id, service);
  return service;
}

/** Build (and cache) services for every master at once. */
export function getAllMastersServices() {
  const services = {};
  for (const key of MASTER_KEYS) services[key] = getMastersService(key);
  return services;
}

export default MASTER_CONFIGS;
