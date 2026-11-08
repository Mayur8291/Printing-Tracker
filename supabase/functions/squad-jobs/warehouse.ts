/** Warehouse effects are authorized and frozen by Postgres before HTTP. The
 * worker returns typed evidence; only the finish RPC changes business state. */
import type { Rpc } from "./handler.ts";
import { dashboardWarehouse } from "./warehouse-dashboard.ts";
import { unicommerceWarehouse } from "./warehouse-unicommerce.ts";
import {
  WAREHOUSE_PROJECTS,
  type WarehouseAdapter,
  WarehouseError,
  type WarehouseIntent,
  type WarehouseProvider,
  type WarehouseResult,
} from "./warehouse-types.ts";
type Job = { id: string; lease_token: string };
type JobResult = { id: string; state: string; error_code?: string };
export function warehouseWorker(
  rpc: Rpc,
  adapters: Partial<Record<WarehouseProvider, WarehouseAdapter>>,
  deadlineMs = 35000,
) {
  return async (job: Job): Promise<JobResult> => {
    const args = { p_id: job.id, p_lease_token: job.lease_token };
    const prepared = await rpc("squad_warehouse_prepare", args) as
      | WarehouseIntent
      | JobResult;
    if (prepared.state !== "prepared") return prepared as JobResult;
    const intent = prepared as WarehouseIntent,
      controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("provider_deadline")),
      Math.min(35000, Math.max(1, deadlineMs)),
    );
    let result: WarehouseResult;
    try {
      const adapter = Object.hasOwn(adapters, intent.provider)
        ? adapters[intent.provider]
        : undefined;
      if (!adapter) {
        throw new WarehouseError("REJECTED", "WAREHOUSE_NOT_CONFIGURED");
      }
      result = await adapter.run(intent, controller.signal);
    } catch (error) {
      result = error instanceof WarehouseError ? error.result() : {
        code: "RETRY",
        error_code: "PROVIDER_UNAVAILABLE",
        retry_after_seconds: 60,
      };
    } finally {
      clearTimeout(timer);
    }
    // Never catch a lost finish response and issue a second, contradictory finish.
    // The lease recovers and provider reconciliation precedes the next write.
    return await rpc("squad_warehouse_finish", {
      ...args,
      p_result: result,
    }) as JobResult;
  };
}
/** Deployment-only configuration. The DB cannot choose a host, tenant or key.
 * The environment binding identifies this deployment; it does not claim that
 * the legacy Uniware tenant is isolated. Business writes still require the
 * separate worker flag and the database's verified ownership gates. */
export function warehouseFacilities(get: (name: string) => string | undefined) {
  const raw = get("SQUAD_WAREHOUSE_FACILITIES") ??
    (get("SQUAD_UNIWARE_CONFIG_SOURCE") === "legacy_bridge"
      ? get("UNIWARE_FACILITY") : undefined) ?? "";
  const facilities = raw.split(",").map(x => x.trim()).filter(Boolean);
  return facilities.length && facilities.length <= 10 &&
    new Set(facilities).size === facilities.length &&
    facilities.every(x => /^[A-Za-z0-9_-]{1,100}$/.test(x)) ? facilities : [];
}
function legacyTenant(base: string | undefined) {
  // Never send credentials to a configured arbitrary URL, subdomain suffix,
  // redirect, embedded userinfo, nonstandard port, or path.
  return base?.match(/^https:\/\/([a-z0-9][a-z0-9-]{0,61}[a-z0-9]|[a-z0-9])\.unicommerce\.com\/?$/)?.[1];
}
export function warehouseAdapters(
  get: (name: string) => string | undefined,
  request: typeof fetch = fetch,
  observeUniwareRead?: (dto: Record<string, unknown>) => void,
): Partial<Record<WarehouseProvider, WarehouseAdapter>> {
  const projectRef =
    get("SUPABASE_URL")?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)
      ?.[1] ?? "";
  const environment = get("SQUAD_WAREHOUSE_ENVIRONMENT");
  if (
    get("SQUAD_WAREHOUSE_ENABLED") !== "true" ||
    !Object.hasOwn(WAREHOUSE_PROJECTS, projectRef) ||
    WAREHOUSE_PROJECTS[projectRef] !== environment
  ) return {};
  const facilities = warehouseFacilities(get);
  if (!facilities.length) return {};
  const config = {
    projectRef,
    environment: environment as "staging" | "production",
    enabled: true,
    writesEnabled: get("SQUAD_WAREHOUSE_WRITES_ENABLED") === "true",
    facilities,
  };
  const adapters: Partial<Record<WarehouseProvider, WarehouseAdapter>> = {},
    apiKey = get("SQUAD_DASHBOARD_API_KEY");
  if (apiKey) {
    adapters.dashboard = dashboardWarehouse({ ...config, apiKey }, request);
  }
  const source = get("SQUAD_UNIWARE_CONFIG_SOURCE") ?? "dedicated";
  if (!["dedicated", "legacy_bridge"].includes(source)) return adapters;
  const legacy = source === "legacy_bridge";
  const authStyle = get("SQUAD_UNIWARE_AUTH_STYLE") ?? "headers";
  if (authStyle !== "headers" && authStyle !== "legacy_query") return adapters;
  const tenant = legacy ? legacyTenant(get("UNIWARE_BASE_URL")) : get("SQUAD_UNIWARE_TENANT"),
    username = get(legacy ? "UNIWARE_USERNAME" : "SQUAD_UNIWARE_USERNAME"),
    password = get(legacy ? "UNIWARE_PASSWORD" : "SQUAD_UNIWARE_PASSWORD"),
    clientId = legacy ? "my-trusted-client" : get("SQUAD_UNIWARE_CLIENT_ID");
  if (
    tenant && username && password && clientId &&
    get("SQUAD_UNIWARE_ENVIRONMENT") === environment
  ) {
    adapters.unicommerce = unicommerceWarehouse({
      ...config,
      tenant,
      username,
      password,
      clientId,
      authStyle,
      boundEnvironment: environment as "staging" | "production",
    }, request, observeUniwareRead);
  }
  return adapters;
}
