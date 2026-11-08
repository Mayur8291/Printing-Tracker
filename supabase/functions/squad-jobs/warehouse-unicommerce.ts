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
import { uniwareCustomer, uniwarePayload } from "./warehouse-payload.ts";
interface UniwareConfig extends WarehouseConfig {
  tenant: string;
  username: string;
  password: string;
  clientId: string;
  boundEnvironment: "staging" | "production";
  authStyle?: "headers" | "legacy_query";
}
const statuses = [
  "PENDING_VERIFICATION",
  "CREATED",
  "PROCESSING",
  "COMPLETE",
  "CANCELLED",
];
const errorCodes = (r: WarehouseResponse) =>
  Array.isArray(r.body.errors)
    ? r.body.errors.map((e: unknown) => object(e).code)
    : [];
function providerRejection(r: WarehouseResponse): WarehouseError {
  const error = new WarehouseError("REJECTED", "PROVIDER_REJECTED");
  // Provider descriptions/field values can contain names, emails, addresses or
  // credentials. Persist only bounded numeric diagnostics, never raw errors.
  const codes =
    (Array.isArray(r.body.errors) ? r.body.errors.slice(0, 100) : [])
      .flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }
        const code = (entry as Record<string, unknown>).code;
        return typeof code === "number" && Number.isSafeInteger(code) &&
            code >= 0 && code <= 999999
          ? [code]
          : [];
      });
  error.proof = {
    source: "provider_rejection",
    http_status: r.status,
    error_codes: [...new Set(codes)].slice(0, 10),
  };
  return error;
}
function numberText(v: unknown) {
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s) || Math.abs(Number(s)) > 1e12) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  const [i, f = ""] = s.split(".");
  return i.replace(/^(-?)0+(?=\d)/, "$1") +
    (f.replace(/0+$/, "") ? "." + f.replace(/0+$/, "") : "");
}
function projection(dto: Record<string, any>, intent: WarehouseIntent) {
  const code = identifier(dto.code);
  if (
    code !== (intent.provider_order_id ?? intent.order_code) ||
    !statuses.includes(dto.status) || !Array.isArray(dto.saleOrderItems) ||
    dto.saleOrderItems.length > 2000
  ) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_IDENTITY_MISMATCH",
    );
  }
  const lines = dto.saleOrderItems.map((row: unknown) => {
    const x = object(row);
    if (x.facilityCode !== intent.facility_code) {
      throw new WarehouseError(
        "RECONCILIATION_REQUIRED",
        "PROVIDER_FACILITY_MISMATCH",
      );
    }
    return {
      code: identifier(x.code),
      sku_code: text(x.itemSku),
      facility_code: text(x.facilityCode),
      status: text(x.statusCode, 60),
      total_price: numberText(x.totalPrice),
      selling_price: numberText(x.sellingPrice),
    };
  });
  if (
    new Set(lines.map((x) => x.code)).size !== lines.length ||
    dto.updated !== undefined &&
      (typeof dto.updated !== "number" || !Number.isSafeInteger(dto.updated) ||
        dto.updated < 0)
  ) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  return {
    external_id: code,
    external_code: code,
    status: dto.status as string,
    proof: {
      source: "saleorder_get",
      updated_at: dto.updated ?? null,
      items: lines,
    },
  };
}
// GET exposes order and item customFieldValues. Extra provider metadata is
// allowed, but each expected field must appear exactly once with its exact value.
function assertCustomFields(expected: unknown, actual: unknown): void {
  if (expected === undefined || Array.isArray(expected) && !expected.length) {
    return;
  }
  const mismatch = () => {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_CUSTOM_FIELDS_MISMATCH",
    );
  };
  const missing = () => {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_CUSTOM_FIELDS_MISSING",
    );
  };
  if (!Array.isArray(expected)) return mismatch();
  if (!Array.isArray(actual)) return missing();
  if (actual.length > 1000) return mismatch();
  for (const field of expected) {
    const want = object(field);
    const matches = actual.filter((row) =>
      row !== null && typeof row === "object" &&
      !Array.isArray(row) && row.name === want.name
    );
    if (!matches.length) return missing();
    if (matches.length !== 1 || matches[0].value !== want.value) {
      return mismatch();
    }
  }
}
function verifiedCreate(
  dto: Record<string, any>,
  payload: Record<string, unknown>,
  intent: WarehouseIntent,
) {
  const expected = object(payload.saleOrder),
    observed = projection(dto, { ...intent, provider_order_id: null });
  if (
    dto.customerCode !== expected.customerCode ||
    dto.displayOrderCode !== expected.displayOrderCode ||
    dto.cod !== expected.cashOnDelivery ||
    String(dto.channel).toUpperCase() !==
      String(expected.channel).toUpperCase() ||
    !Array.isArray(expected.saleOrderItems) ||
    expected.saleOrderItems.length !== dto.saleOrderItems.length
  ) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_ADOPTION_MISMATCH",
    );
  }
  assertCustomFields(expected.customFieldValues, dto.customFieldValues);
  for (const key of ["notificationEmail", "notificationMobile"]) {
    if (
      expected[key] !== undefined &&
      String(dto[key] ?? "") !== String(expected[key] ?? "")
    ) {
      throw new WarehouseError(
        "RECONCILIATION_REQUIRED",
        "PROVIDER_ADOPTION_MISMATCH",
      );
    }
  }
  for (const key of ["displayOrderDateTime", "fulfillmentTat"]) {
    if (
      expected[key] !== undefined &&
      (typeof dto[key] !== "number" ||
        Date.parse(String(expected[key])) !== dto[key])
    ) {
      throw new WarehouseError(
        "RECONCILIATION_REQUIRED",
        "PROVIDER_ADOPTION_MISMATCH",
      );
    }
  }
  const actual = new Map(
    dto.saleOrderItems.map((x: Record<string, any>) => [x.code, x]),
  );
  for (const raw of expected.saleOrderItems) {
    const line = object(raw),
      found = actual.get(line.code) as Record<string, any> | undefined;
    if (
      !found || found.itemSku !== line.itemSku ||
      found.facilityCode !== line.facilityCode ||
      numberText(found.totalPrice) !== numberText(line.totalPrice) ||
      numberText(found.sellingPrice) !== numberText(line.sellingPrice)
    ) {
      throw new WarehouseError(
        "RECONCILIATION_REQUIRED",
        "PROVIDER_ADOPTION_MISMATCH",
      );
    }
    assertCustomFields(line.customFieldValues, found.customFieldValues);
  }
  const addresses = expected.addresses;
  if (
    !Array.isArray(addresses) || !addresses.length ||
    !Array.isArray(dto.addresses)
  ) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_ADOPTION_MISMATCH",
    );
  }
  const keys = [
    "name",
    "addressLine1",
    "city",
    "state",
    "country",
    "pincode",
    "phone",
    "email",
  ];
  for (const raw of addresses) {
    const address = object(raw);
    if (
      !dto.addresses.some((candidate: unknown) => {
        const got = object(candidate);
        return keys.every((k) =>
          String(got[k] ?? "") === String(address[k] ?? "")
        );
      })
    ) {
      throw new WarehouseError(
        "RECONCILIATION_REQUIRED",
        "PROVIDER_ADOPTION_MISMATCH",
      );
    }
  }
  return observed;
}
function assertCreate(intent: WarehouseIntent) {
  fields(intent.payload, ["saleOrder"]);
  const p = object(intent.payload.saleOrder);
  if (
    p.code !== intent.order_code || p.displayOrderCode !== intent.order_code ||
    p.cashOnDelivery !== true || p.paymentInstrument !== "CASH" ||
    !Array.isArray(p.saleOrderItems) || p.saleOrderItems.length < 1 ||
    p.saleOrderItems.length > 2000
  ) throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
  uniwarePayload(p);
  identifier(p.code);
  identifier(p.customerCode);
  const seen = new Set<string>();
  for (const raw of p.saleOrderItems) {
    const line = object(raw), code = identifier(line.code);
    if (seen.has(code) || line.facilityCode !== intent.facility_code) {
      throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
    }
    seen.add(code);
    text(line.itemSku);
    numberText(line.totalPrice);
    numberText(line.sellingPrice);
  }
  return p;
}
export function unicommerceWarehouse(
  config: UniwareConfig,
  request: typeof fetch = fetch,
  observeRead?: (dto: Record<string, unknown>) => void,
): WarehouseAdapter {
  const base = /^[a-z0-9][a-z0-9-]{1,62}$/.test(config.tenant)
    ? `https://${config.tenant}.unicommerce.com`
    : "";
  const http = warehouseHttp(base, request);
  let cached: { access: string; refresh?: string; expires: number } | undefined;
  let obtaining: Promise<string> | undefined;
  async function token(signal: AbortSignal, force = false): Promise<string> {
    if (!force && cached && cached.expires > Date.now()) return cached.access;
    if (obtaining) return await obtaining;
    obtaining = (async () => {
      let r: WarehouseResponse | undefined;
      if (cached?.refresh) {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          refresh_token: cached.refresh,
        });
        r = await http(
          "/oauth/token?" + params,
          { headers: { "Content-Type": "application/json" } },
          signal,
          65536,
        );
        if (r.status === 400 || r.status === 401) r = undefined;
      }
      if (!r) {
        const params = new URLSearchParams({
          grant_type: "password",
          client_id: config.clientId,
        });
        if (config.authStyle === "legacy_query") {
          params.set("username", config.username);
          params.set("password", config.password);
        }
        r = await http(
          "/oauth/token?" + params,
          {
            headers: {
              "Content-Type": "application/json",
              ...(config.authStyle === "legacy_query" ? {} : {
                username: config.username,
                password: config.password,
              }),
            },
          },
          signal,
          65536,
        );
      }
      if (
        r.status !== 200 || typeof r.body.access_token !== "string" ||
        !r.body.access_token || r.body.access_token.length > 4096 ||
        typeof r.body.expires_in !== "number" || r.body.expires_in < 1
      ) throw new WarehouseError("RETRY", "PROVIDER_AUTH_UNAVAILABLE", 300);
      cached = {
        access: r.body.access_token,
        refresh: typeof r.body.refresh_token === "string" &&
            r.body.refresh_token.length <= 4096
          ? r.body.refresh_token
          : undefined,
        expires: Date.now() +
          Math.max(0, Math.min(r.body.expires_in, 86400) - 60) * 1000,
      };
      return cached.access;
    })();
    try {
      return await obtaining;
    } finally {
      obtaining = undefined;
    }
  }
  async function api(
    path: string,
    body: Record<string, unknown>,
    facility: string,
    signal: AbortSignal,
    readOnly = false,
    beforeWrite?: () => void,
  ) {
    const send = async (access: string) =>
      await http(path, {
        method: "POST",
        headers: {
          Authorization: "bearer " + access,
          "Content-Type": "application/json",
          Facility: facility,
        },
        body: JSON.stringify(body),
      }, signal);
    const access = await token(signal);
    if (!readOnly) beforeWrite?.();
    let r = await send(access);
    if (
      r.status === 401 || errorCodes(r).some((c) => [1, 2, 5, 401].includes(c))
    ) {
      const refreshed = await token(signal, true);
      if (readOnly) r = await send(refreshed);
      else throw new WarehouseError("RETRY", "PROVIDER_AUTH_UNAVAILABLE", 60);
    }
    return r;
  }
  function success(r: WarehouseResponse) {
    if (r.status !== 200) {
      try {
        responseFailure(r);
      } catch (error) {
        if (error instanceof WarehouseError && error.code === "REJECTED") {
          throw providerRejection(r);
        }
        throw error;
      }
    }
    if (r.body.successful !== true) {
      const codes = errorCodes(r);
      if (!codes.length || codes.some((c) => c === 0 || c === 40011)) {
        throw new WarehouseError("RETRY", "PROVIDER_UNAVAILABLE", 60);
      }
      throw providerRejection(r);
    }
  }
  async function get(
    intent: WarehouseIntent,
    signal: AbortSignal,
    code = String(intent.provider_order_id ?? intent.order_code),
  ) {
    identifier(code);
    const r = await api(
      "/services/rest/v1/oms/saleorder/get",
      {
        code,
        facilityCodes: [intent.facility_code],
        paymentDetailRequired: false,
      },
      intent.facility_code,
      signal,
      true,
    );
    if (
      r.status === 200 && r.body.successful === false &&
      errorCodes(r).length === 1 && errorCodes(r)[0] === 40005
    ) return null;
    success(r);
    const dto = object(r.body.saleOrderDTO);
    observeRead?.(dto);
    return dto;
  }
  return {
    async run(intent, signal) {
      let mutationStarted = false;
      const markMutationStarted = () => {
        mutationStarted = true;
      };
      try {
        validateIntent(intent, config);
        if (
          !base || config.boundEnvironment !== config.environment ||
          !config.username || !config.password || !config.clientId
        ) throw new WarehouseError("REJECTED", "WAREHOUSE_NOT_CONFIGURED");
        if (intent.operation === "inventory") {
          const skus = requestedSkus(intent);
          // Legacy inventory lookup is case-insensitive. Keep the requested
          // canonical code, and refuse ambiguous aliases before any HTTP call.
          const canonical = new Map(
            skus.map((sku) => [sku.toLowerCase(), sku]),
          );
          if (canonical.size !== skus.length) {
            throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
          }
          const r = await api(
            "/services/rest/v1/inventory/inventorySnapshot/get",
            { itemTypeSKUs: skus },
            intent.facility_code,
            signal,
            true,
          );
          success(r);
          if (
            !Array.isArray(r.body.inventorySnapshots) ||
            r.body.inventorySnapshots.length > skus.length
          ) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_RESPONSE_INVALID",
            );
          }
          const found = new Map<string, number>();
          for (const raw of r.body.inventorySnapshots) {
            const x = object(raw);
            const key = typeof x.itemTypeSKU === "string"
              ? canonical.get(x.itemTypeSKU.toLowerCase())
              : undefined;
            if (key === undefined || found.has(key)) {
              throw new WarehouseError(
                "RECONCILIATION_REQUIRED",
                "PROVIDER_RESPONSE_INVALID",
              );
            }
            found.set(key, finiteQuantity(x.inventory));
          }
          return {
            code: "CONFIRMED",
            inventory: skus.map((sku) => ({
              sku_code: sku,
              known: found.has(sku),
              available: found.get(sku) ?? null,
            })),
            proof: {
              facility_code: intent.facility_code,
              basis: "provider_available",
            },
          };
        }
        if (
          intent.operation === "inspect" || intent.operation === "reconcile"
        ) {
          const dto = await get(intent, signal);
          if (!dto) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_ORDER_NOT_FOUND",
            );
          }
          return { code: "OBSERVED", ...projection(dto, intent) };
        }
        if (intent.operation === "submit") {
          assertCreate(intent);
          const existing = await get(intent, signal, String(intent.order_code));
          if (existing) {
            const verified = verifiedCreate(existing, intent.payload, intent);
            return {
              code: "CONFIRMED",
              ...verified,
              proof: { ...verified.proof, source: "verified_order_lookup" },
            };
          }
          if (intent.attempted) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_CREATE_UNCERTAIN",
            );
          }
          const created = await api(
            "/services/rest/v1/oms/saleOrder/create",
            intent.payload,
            intent.facility_code,
            signal,
            false,
            markMutationStarted,
          );
          if (
            created.body.successful !== true &&
            errorCodes(created).includes(40001)
          ) {
            const dto = await get(intent, signal, String(intent.order_code));
            if (!dto) {
              throw new WarehouseError(
                "RECONCILIATION_REQUIRED",
                "PROVIDER_CREATE_UNCERTAIN",
              );
            }
            return {
              code: "CONFIRMED",
              ...verifiedCreate(dto, intent.payload, intent),
            };
          }
          success(created);
          const dto = await get(intent, signal, String(intent.order_code));
          if (!dto) {
            throw new WarehouseError(
              "RETRY",
              "PROVIDER_RESULT_UNCONFIRMED",
              30,
            );
          }
          return {
            code: "CONFIRMED",
            ...verifiedCreate(dto, intent.payload, intent),
          };
        }
        if (intent.operation === "cancel") {
          fields(intent.payload, [
            "saleOrderCode",
            "cancellationReason",
            "saleOrderItemCodes",
          ]);
          if (
            intent.payload.saleOrderCode !==
              (intent.provider_order_id ?? intent.order_code) ||
            !Array.isArray(intent.payload.saleOrderItemCodes) ||
            !intent.payload.saleOrderItemCodes.length ||
            intent.payload.saleOrderItemCodes.length > 2000
          ) throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
          text(intent.payload.cancellationReason, 500);
          const dto = await get(intent, signal);
          if (!dto) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_ORDER_NOT_FOUND",
            );
          }
          const before = projection(dto, intent),
            wanted = intent.payload.saleOrderItemCodes.map((x) =>
              identifier(x)
            );
          if (new Set(wanted).size !== wanted.length) {
            throw new WarehouseError(
              "REJECTED",
              "WAREHOUSE_CONTRACT_INVALID",
            );
          }
          const lines = before.proof.items;
          if (
            wanted.some((code) => !lines.some((line) => line.code === code))
          ) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_ADOPTION_MISMATCH",
            );
          }
          if (
            dto.status === "CANCELLED" ||
            wanted.every((code) =>
              lines.find((line) => line.code === code)!.status === "CANCELLED"
            )
          ) {
            return {
              code: "CONFIRMED",
              ...before,
              proof: { ...before.proof, cancelled_item_codes: wanted },
            };
          }
          if (intent.attempted) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_CANCEL_UNCERTAIN",
            );
          }
          const r = await api(
            "/services/rest/v1/oms/saleOrder/cancel",
            intent.payload,
            intent.facility_code,
            signal,
            false,
            markMutationStarted,
          );
          success(r);
          const after = await get(intent, signal);
          if (!after) {
            throw new WarehouseError(
              "RETRY",
              "PROVIDER_RESULT_UNCONFIRMED",
              30,
            );
          }
          const observed = projection(after, intent);
          if (
            !wanted.every((code) =>
              observed.proof.items.find((line) => line.code === code)
                ?.status ===
                "CANCELLED"
            ) && observed.status !== "CANCELLED"
          ) {
            throw new WarehouseError(
              "RETRY",
              "PROVIDER_RESULT_UNCONFIRMED",
              30,
            );
          }
          return {
            code: "CONFIRMED",
            ...observed,
            proof: { ...observed.proof, cancelled_item_codes: wanted },
          };
        }
        if (intent.operation === "customer") {
          fields(intent.payload, ["customer"]);
          const customer = object(intent.payload.customer);
          uniwareCustomer(customer);
          if (
            !["create", "edit"].includes(intent.customer_action ?? "")
          ) {
            throw new WarehouseError(
              "REJECTED",
              "WAREHOUSE_CONTRACT_INVALID",
            );
          }
          // No customer GET/adoption contract is published. Never create another
          // customer after an uncertain call or silently convert create into edit.
          if (intent.attempted) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_CUSTOMER_UNCERTAIN",
            );
          }
          const r = await api(
            "/services/rest/v1/oms/customer/" + intent.customer_action,
            intent.payload,
            intent.facility_code,
            signal,
            false,
            markMutationStarted,
          );
          success(r);
          const returned = object(r.body.customer);
          if (returned.code !== customer.code) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_IDENTITY_MISMATCH",
            );
          }
          if (typeof returned.enabled !== "boolean") {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_CUSTOMER_STATE_MISSING",
            );
          }
          if (returned.enabled !== customer.enabled) {
            throw new WarehouseError(
              "RECONCILIATION_REQUIRED",
              "PROVIDER_CUSTOMER_STATE_MISMATCH",
            );
          }
          return {
            code: "CONFIRMED",
            customer_code: customer.code,
            proof: {
              source: "customer_write_response",
              enabled: returned.enabled,
            },
          };
        }
        // Uniware amendments are separate persisted cancel/new-submit phases. A
        // single HTTP handler must never cancel then create an untracked replacement.
        throw new WarehouseError(
          "REJECTED",
          "UNIWARE_AMENDMENT_PHASE_REQUIRED",
        );
      } catch (error) {
        // Only this trusted negative proof permits SQL to reset attempted. A
        // previous attempt or any started write always retains uncertainty.
        if (
          error instanceof WarehouseError && error.code === "RETRY" &&
          !intent.attempted && !mutationStarted &&
          ["submit", "cancel", "customer"].includes(intent.operation)
        ) error.proof = { mutation_attempted: false };
        throw error;
      }
    },
  };
}
