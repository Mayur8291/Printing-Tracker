import { getMastersService } from "./masterConfigs";
import { getEffectiveScottApiBaseUrl } from "../scottRuntime";
import { loadZonePage } from "./zoneOptions";
import { getCantoTarget, cantoRpc } from "../../canto/target";

const cache = new Map();
const pending = new Map();
const CACHE_MS = 60_000;

// Only used when the current table is filtered or paginated. Cache by Scott environment
// and page; reopening the picker doesn't repeat requests, nor can targets share IDs.
export function loadScottZoneOptions({ page = 1, refresh = false } = {}) {
  if (getCantoTarget().source === "supabase") {
    return cantoRpc("masters", { resource: "zones", action: "list", payload: { page, items: 100 } }).then(result => ({
      options: result.data.map(row => ({ value: String(row.id), label: row.name || `Zone ${row.id}` })),
      nextPage: page < result.totalPages ? page + 1 : null
    }));
  }
  const key = `${getEffectiveScottApiBaseUrl()}:${page}`;
  const cached = cache.get(key);
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.result);
  if (pending.has(key)) return pending.get(key);
  const promise = loadZonePage((params) => getMastersService("rmp_price_types").listPage(params), { page })
    .then((result) => {
      cache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
