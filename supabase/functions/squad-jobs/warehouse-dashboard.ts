import {
  equal,
  fields,
  finiteQuantity,
  identifier,
  object,
  requestedSkus,
  text,
  validateIntent,
  type WarehouseAdapter,
  type WarehouseConfig,
  WarehouseError,
  type WarehouseIntent,
  type WarehouseResult,
} from "./warehouse-types.ts";
import {
  responseFailure,
  warehouseHttp,
  type WarehouseResponse,
} from "./warehouse-http.ts";
import { dashboardAddress, dashboardPayload } from "./warehouse-payload.ts";
const statuses = ["PENDING", "PROCESSING", "COMPLETE", "CANCELLED", "FAILED"];
function projection(body: Record<string, any>, intent: WarehouseIntent) {
  const external = identifier(body.dashboard_order_id, 80);
  if (
    intent.provider_order_id && external !== intent.provider_order_id ||
    intent.order_code && body.order_code !== intent.order_code ||
    !statuses.includes(body.status)
  ) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_IDENTITY_MISMATCH",
    );
  }
  return {
    external_id: external,
    external_code: text(body.order_code),
    status: body.status as string,
  };
}
function mutation(intent: WarehouseIntent) {
  const p = intent.payload;
  if (intent.operation === "submit") {
    fields(p, [
      "order_code",
      "facility_code",
      "due_on",
      "customer",
      "shipping_address",
      "payment",
      "comment",
      "items",
    ]);
    dashboardPayload(p, true);
    if (
      p.order_code !== intent.order_code ||
      p.facility_code !== intent.facility_code
    ) throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
    return {
      action: "create",
      target: null,
      body: p,
      method: "POST",
      path: "/api/v1/orders",
    };
  }
  const id = identifier(intent.provider_order_id, 80);
  if (intent.operation === "amend") {
    fields(p, [
      "due_on",
      "customer",
      "shipping_address",
      "comment",
      "items",
      "expected_updated_at",
    ]);
    if (
      typeof p.expected_updated_at !== "string" ||
      !Number.isFinite(Date.parse(p.expected_updated_at))
    ) throw new WarehouseError("REJECTED", "WAREHOUSE_CAS_REQUIRED");
    dashboardPayload(p, false);
    return {
      action: "edit",
      target: id,
      body: p,
      method: "PATCH",
      path: "/api/v1/orders/" + id,
    };
  }
  if (intent.operation === "cancel") {
    fields(p, ["reason"]);
    text(p.reason, 500);
    return {
      action: "cancel",
      target: id,
      body: p,
      method: "DELETE",
      path: "/api/v1/orders/" + id + "?reason=" +
        encodeURIComponent(String(p.reason)),
    };
  }
  throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
}
export function dashboardWarehouse(
  config: WarehouseConfig & { apiKey: string },
  request: typeof fetch = fetch,
): WarehouseAdapter {
  const http = warehouseHttp(
      `https://${config.projectRef}.supabase.co/functions/v1/dashboard-stock-api`,
      request,
    ),
    headers = {
      Authorization: "Bearer " + config.apiKey,
      "Content-Type": "application/json",
    };
  let capableUntil = 0;
  async function capable(signal: AbortSignal) {
    if (capableUntil > Date.now()) return;
    const r = await http("/api/v1/capabilities", { headers }, signal);
    if (r.status !== 200) responseFailure(r);
    if (
      r.body.schema_version !== 1 || r.body.atomic_mutations_v1 !== true ||
      r.body.order_edit_cas !== true || r.body.durable_mutation_results !== true
    ) throw new WarehouseError("REJECTED", "PROVIDER_ATOMIC_CONTRACT_REQUIRED");
    capableUntil = Date.now() + 60000;
  }
  function result(
    r: WarehouseResponse,
    intent: WarehouseIntent,
    reconciled: boolean,
  ): WarehouseResult {
    if (r.status >= 200 && r.status < 300) {
      return {
        code: "CONFIRMED",
        ...projection(r.body, intent),
        proof: {
          source: reconciled
            ? "durable_mutation_result"
            : "atomic_mutation_response",
          request_key: intent.request_key,
          ...(typeof r.body.updated_at === "string"
            ? { updated_at: r.body.updated_at }
            : {}),
        },
      };
    }
    if (r.status === 409) {
      const error = r.body.error;
      throw new WarehouseError(
        "RECONCILIATION_REQUIRED",
        error === "ORDER_EXISTS"
          ? "PROVIDER_ADOPTION_REQUIRED"
          : error === "IDEMPOTENCY_CONFLICT"
          ? "PROVIDER_INTENT_CONFLICT"
          : error === "ORDER_VERSION_CONFLICT"
          ? "PROVIDER_VERSION_CONFLICT"
          : "PROVIDER_ORDER_CONFLICT",
      );
    }
    responseFailure(r);
  }
  return {
    async run(intent, signal) {
      validateIntent(intent, config);
      if (
        !config.apiKey || config.apiKey.length < 16
      ) throw new WarehouseError("REJECTED", "WAREHOUSE_NOT_CONFIGURED");
      if (intent.operation === "customer") {
        return {
          code: "CONFIRMED",
          proof: {
            mode: "inline_order_customer",
            standalone_customer_api: false,
          },
        };
      }
      if (intent.operation === "inventory") {
        const skus = requestedSkus(intent),
          query = new URLSearchParams({
            facility: intent.facility_code,
            skus: skus.join(","),
          }),
          r = await http(
            "/api/v1/stock/snapshot?" + query,
            { headers },
            signal,
          );
        if (r.status !== 200) responseFailure(r);
        const snapshot = object(r.body.snapshot);
        const inventory = skus.map((sku) => {
          const key = intent.facility_code + ":" + sku;
          return {
            sku_code: sku,
            known: Object.hasOwn(snapshot, key),
            available: Object.hasOwn(snapshot, key)
              ? finiteQuantity(snapshot[key])
              : null,
          };
        });
        return {
          code: "CONFIRMED",
          inventory,
          proof: {
            facility_code: intent.facility_code,
            basis: "provider_available",
          },
        };
      }
      if (intent.operation === "inspect" || intent.operation === "reconcile") {
        const id = identifier(intent.provider_order_id, 80),
          r = await http("/api/v1/orders/" + id, { headers }, signal);
        if (r.status !== 200) responseFailure(r);
        const p = projection(r.body, intent);
        if (
          !Array.isArray(r.body.items) || r.body.items.length > 250 ||
          typeof r.body.updated_at !== "string" ||
          !Number.isFinite(Date.parse(r.body.updated_at))
        ) {
          throw new WarehouseError(
            "RECONCILIATION_REQUIRED",
            "PROVIDER_RESPONSE_INVALID",
          );
        }
        const items = r.body.items.map((x: unknown) => {
          const v = object(x);
          return {
            sku_code: text(v.sku_code),
            quantity: finiteQuantity(v.quantity),
            dispatched_quantity: finiteQuantity(v.dispatched_quantity),
          };
        });
        const due = r.body.due_on ?? null;
        if (
          due !== null &&
          (typeof due !== "string" || !Number.isFinite(Date.parse(due)))
        ) {
          throw new WarehouseError(
            "RECONCILIATION_REQUIRED",
            "PROVIDER_RESPONSE_INVALID",
          );
        }
        return {
          code: "OBSERVED",
          ...p,
          proof: {
            updated_at: r.body.updated_at,
            items,
            due_on: due,
            shipping_address: r.body.shipping_address === null ||
                r.body.shipping_address === undefined
              ? null
              : dashboardAddress(r.body.shipping_address),
          },
        };
      }
      const m = mutation(intent);
      if (
        new TextEncoder().encode(JSON.stringify(m.body)).length > 262144
      ) throw new WarehouseError("REJECTED", "WAREHOUSE_LIMIT");
      await capable(signal);
      // This read precedes EVERY mutation attempt, including first delivery. Only
      // an exact persisted action/target/body proves which external effect occurred.
      const prior = await http(
        "/api/v1/mutations/" + identifier(intent.request_key),
        { headers },
        signal,
      );
      if (prior.status === 200) {
        if (
          prior.body.request_id !== intent.request_key ||
          !equal(prior.body.request, {
            action: m.action,
            target: m.target,
            body: m.body,
          })
        ) {
          throw new WarehouseError(
            "RECONCILIATION_REQUIRED",
            "PROVIDER_INTENT_CONFLICT",
          );
        }
        const saved = object(prior.body.response);
        if (!Number.isInteger(saved.status)) {
          throw new WarehouseError(
            "RECONCILIATION_REQUIRED",
            "PROVIDER_RESPONSE_INVALID",
          );
        }
        return result(
          { status: saved.status, body: object(saved.body) },
          intent,
          true,
        );
      }
      if (
        prior.status !== 404 || prior.body.error !== "MUTATION_NOT_FOUND"
      ) responseFailure(prior);
      const r = await http(m.path, {
        method: m.method,
        headers: { ...headers, "Idempotency-Key": intent.request_key },
        ...(m.method === "DELETE" ? {} : { body: JSON.stringify(m.body) }),
      }, signal);
      return result(r, intent, false);
    },
  };
}
