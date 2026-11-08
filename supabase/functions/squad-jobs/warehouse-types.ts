export type WarehouseProvider = "dashboard" | "unicommerce";
export type WarehouseOperation =
  | "submit"
  | "amend"
  | "cancel"
  | "customer"
  | "inventory"
  | "reconcile"
  | "inspect";
export type WarehouseCode =
  | "CONFIRMED"
  | "OBSERVED"
  | "RETRY"
  | "RECONCILIATION_REQUIRED"
  | "REJECTED";
export interface WarehouseIntent {
  state: "prepared";
  provider: WarehouseProvider;
  operation: WarehouseOperation;
  purpose?: "amend" | "reconcile";
  intent_id: string;
  request_key: string;
  project_ref: string;
  environment: "staging" | "production";
  provider_order_id?: string | null;
  order_code?: string | null;
  facility_code: string;
  payload: Record<string, unknown>;
  attempted: boolean;
  customer_action?: "create" | "edit";
}
export interface WarehouseResult {
  code: WarehouseCode;
  error_code?: string;
  external_id?: string;
  external_code?: string;
  status?: string;
  customer_code?: string;
  proof?: Record<string, unknown>;
  inventory?: Array<
    { sku_code: string; available: number | null; known: boolean }
  >;
  retry_after_seconds?: number;
}
export class WarehouseError extends Error {
  proof?: Record<string, unknown>;
  constructor(
    readonly code: Exclude<WarehouseCode, "CONFIRMED" | "OBSERVED">,
    readonly error_code: string,
    readonly retryAfter?: number,
  ) {
    super(error_code);
  }
  result(): WarehouseResult {
    return {
      code: this.code,
      error_code: this.error_code,
      ...(this.retryAfter ? { retry_after_seconds: this.retryAfter } : {}),
      ...(this.proof ? { proof: this.proof } : {}),
    };
  }
}
export interface WarehouseAdapter {
  run(intent: WarehouseIntent, signal: AbortSignal): Promise<WarehouseResult>;
}
export interface WarehouseConfig {
  projectRef: string;
  environment: "staging" | "production";
  enabled: boolean;
  writesEnabled: boolean;
  facilities: string[];
}
export const WAREHOUSE_PROJECTS: Record<string, "staging" | "production"> = {
  scvojtvgnkmbupvyslmb: "staging",
  levwrmvqdntngeasrtnb: "production",
};
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  return value as Record<string, any>;
}
export function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) {
    throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
  }
}
export function text(value: unknown, max = 200): string {
  if (
    typeof value !== "string" || !value.length || value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
  return value;
}
export function identifier(value: unknown, max = 160): string {
  const v = text(value, max);
  if (!/^[a-zA-Z0-9_-]+$/.test(v)) {
    throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
  }
  return v;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" +
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    ).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
}
export function equal(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
export function finiteQuantity(value: unknown) {
  if (
    typeof value !== "number" || !Number.isFinite(value) ||
    Math.abs(value) > 1e12
  ) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  return value;
}
export function validateIntent(
  intent: WarehouseIntent,
  config: WarehouseConfig,
) {
  if (
    !config.enabled || !Object.hasOwn(WAREHOUSE_PROJECTS, config.projectRef) ||
    WAREHOUSE_PROJECTS[config.projectRef] !== config.environment ||
    intent.environment !== config.environment ||
    intent.project_ref !== config.projectRef
  ) throw new WarehouseError("REJECTED", "WAREHOUSE_NOT_CONFIGURED");
  if (
    ![
      "submit",
      "amend",
      "cancel",
      "customer",
      "inventory",
      "reconcile",
      "inspect",
    ].includes(intent.operation) || typeof intent.attempted !== "boolean" ||
    !config.facilities.includes(intent.facility_code)
  ) throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
  if (
    !config.writesEnabled &&
    !["inventory", "reconcile", "inspect"].includes(intent.operation)
  ) throw new WarehouseError("REJECTED", "WAREHOUSE_WRITES_DISABLED");
  identifier(intent.request_key, 160);
  if (intent.request_key.length < 8) {
    throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
  }
  if (
    new TextEncoder().encode(JSON.stringify(intent.payload)).length >
      2 * 1024 * 1024
  ) throw new WarehouseError("REJECTED", "WAREHOUSE_LIMIT");
  object(intent.payload);
}
export function requestedSkus(intent: WarehouseIntent) {
  fields(intent.payload, ["skus"]);
  const skus = intent.payload.skus;
  if (
    !Array.isArray(skus) || !skus.length || skus.length > 100 ||
    skus.some((x) =>
      typeof x !== "string" || !x.trim() || x.length > 200 ||
      /[,\u0000-\u001f]/.test(x)
    ) || new Set(skus).size !== skus.length
  ) throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
  return skus as string[];
}
