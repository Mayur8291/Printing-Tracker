/** Service-only connectivity rehearsal. This path can only authenticate and
 * read bounded inventory and an optional known order; it never invokes a business RPC or writes
 * provider state. It remains usable while the application is in mirror mode. */
import { warehouseAdapters, warehouseFacilities } from "./warehouse.ts";
import { WAREHOUSE_PROJECTS, WarehouseError } from "./warehouse-types.ts";
interface ReadCheckResult {
  state: "not_configured" | "verified" | "unconfirmed";
  provider: "unicommerce";
  writes: 0;
  environment?: "staging" | "production";
  configuration_source?: string;
  authentication_style?: string;
  facilities?: Array<{facility:string;code:string;error_code?:string;known_skus:number;requested_skus:number}>;
  requests?: Array<{stage:string;status?:number;failure?:string}>;
  order_read?: Record<string,unknown>;
}

export function warehouseReadCheck(
  get: (name: string) => string | undefined,
  request: typeof fetch = fetch,
) {
  return async (skus: string[], orderCode?: string): Promise<ReadCheckResult> => {
    if (!Array.isArray(skus) || !skus.length || skus.length > 5 ||
      new Set(skus).size !== skus.length || skus.some(x =>
        typeof x !== "string" || !x.trim() || x.length > 200 ||
        /[,\u0000-\u001f\u007f]/u.test(x))) {
      throw new Error("invalid_inventory_probe");
    }
    if (orderCode !== undefined && !/^[A-Za-z0-9_-]{1,160}$/.test(orderCode)) throw new Error("invalid_order_probe");
    const projectRef = get("SUPABASE_URL")?.match(
      /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/,
    )?.[1] ?? "";
    const environment = WAREHOUSE_PROJECTS[projectRef];
    if (get("SQUAD_WAREHOUSE_READ_CHECK_ENABLED") !== "true" ||
      !Object.hasOwn(WAREHOUSE_PROJECTS, projectRef) ||
      get("SQUAD_WAREHOUSE_ENVIRONMENT") !== environment) {
      return { state: "not_configured", provider: "unicommerce", writes: 0 };
    }
    const readOnly = (key: string) => key === "SQUAD_WAREHOUSE_ENABLED" ? "true"
      : key === "SQUAD_WAREHOUSE_WRITES_ENABLED" ? "false" : get(key);
    const requests: Array<{ stage: string; status?: number; failure?: string }> = [];
    const observedRequest: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const stage = path === "/oauth/token" ? "authentication"
        : path.endsWith("/saleorder/get") ? "order_read" : "inventory";
      try {
        const response = await request(input, init);
        requests.push({ stage, status: response.status });
        return response;
      } catch (error) {
        // Only fixed categories leave the server. Runtime errors can contain
        // request URLs or headers, so never return their message or stack.
        const message = error instanceof Error ? error.message : "";
        const failure = /dns|name resolution|resolve host/i.test(message) ? "dns"
          : /certificate|tls|ssl/i.test(message) ? "tls"
          : /redirect/i.test(message) ? "redirect"
          : /header|ByteString/i.test(message) ? "header"
          : /timeout|abort/i.test(message) ? "timeout" : "network";
        requests.push({ stage, failure });
        throw error;
      }
    };
    let orderShape: Record<string, unknown> | undefined;
    const adapter = warehouseAdapters(readOnly, observedRequest, dto => {
      const fieldNames = (fields: unknown) => Array.isArray(fields) ? fields.flatMap(x =>
        x && typeof x === "object" && ["Customer_Details", "PICKUPDATE", "Comment"].includes(x.name)
          ? [x.name] : []) : [];
      const items = Array.isArray(dto.saleOrderItems) ? dto.saleOrderItems : [];
      orderShape = {
        order_custom_fields_present: Array.isArray(dto.customFieldValues),
        order_field_names: fieldNames(dto.customFieldValues),
        item_count: items.length,
        items_with_custom_fields: items.filter(x => x && Array.isArray(x.customFieldValues)).length,
        items_with_comment_field: items.filter(x => x && fieldNames(x.customFieldValues).includes("Comment")).length,
      };
    }).unicommerce;
    const facilities = warehouseFacilities(readOnly);
    if (!adapter || !facilities.length) {
      return { state: "not_configured", provider: "unicommerce", writes: 0 };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    const checks = [];
    let orderRead: Record<string, unknown> | undefined;
    try {
      for (const facility of facilities) {
        try {
          const id = crypto.randomUUID();
          const result = await adapter.run({
            state: "prepared", provider: "unicommerce", operation: "inventory",
            intent_id: id, request_key: "read_check_" + id,
            project_ref: projectRef, environment, facility_code: facility,
            payload: { skus }, attempted: false,
          }, controller.signal);
          checks.push({
            facility, code: result.code,
            ...(result.error_code ? { error_code: result.error_code } : {}),
            known_skus: result.inventory?.filter(x => x.known).length ?? 0,
            requested_skus: skus.length,
          });
        } catch (error) {
          checks.push({
            facility, code: "UNCONFIRMED",
            known_skus: 0, requested_skus: skus.length,
            error_code: error instanceof WarehouseError
              ? error.error_code : "PROVIDER_UNAVAILABLE",
          });
        }
        if (controller.signal.aborted) break;
      }
      if (orderCode && !controller.signal.aborted) {
        try {
          const id = crypto.randomUUID();
          const result = await adapter.run({
            state: "prepared", provider: "unicommerce", operation: "inspect",
            intent_id: id, request_key: "read_check_" + id,
            project_ref: projectRef, environment, facility_code: facilities[0],
            provider_order_id: orderCode, order_code: orderCode,
            payload: {}, attempted: false,
          }, controller.signal);
          orderRead = { code: result.code, ...(result.error_code ? { error_code: result.error_code } : {}), shape: orderShape };
        } catch (error) {
          orderRead = { code: "UNCONFIRMED", error_code: error instanceof WarehouseError ? error.error_code : "PROVIDER_UNAVAILABLE", shape: orderShape };
        }
      }
    } finally { clearTimeout(timer); }
    return {
      state: checks.length === facilities.length &&
          checks.every(x => x.code === "CONFIRMED") &&
          (!orderCode || orderRead?.code === "OBSERVED") ? "verified" : "unconfirmed",
      environment, provider: "unicommerce",
      configuration_source: get("SQUAD_UNIWARE_CONFIG_SOURCE") ?? "dedicated",
      authentication_style: get("SQUAD_UNIWARE_AUTH_STYLE") ?? "headers",
      ...(orderCode ? { order_read: orderRead ?? { code: "UNCONFIRMED", error_code: "PROVIDER_DEADLINE" } } : {}),
      facilities: checks, requests, writes: 0,
    };
  };
}
