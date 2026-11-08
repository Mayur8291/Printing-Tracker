/** Exact-manifest provider acceptance through the service-only rehearsal route.
 * The durable store authorizes each fixed phase before this module calls the
 * unchanged warehouse adapter. It never changes application business rows. */
import { uniwareCustomer, uniwarePayload } from "./warehouse-payload.ts";
import { warehouseAdapters } from "./warehouse.ts";
import type { Rpc } from "./handler.ts";
import {
  fields,
  object,
  type WarehouseAdapter,
  WarehouseError,
  type WarehouseIntent,
  type WarehouseResult,
} from "./warehouse-types.ts";

export const REHEARSAL_STEPS = [
  "preflight",
  "customer",
  "submit",
  "reconcile",
  "cancel_initial",
  "replace",
  "reconcile_replacement",
  "cancel_replacement",
  "cleanup_initial",
  "cleanup_replacement",
  "customer_disable",
] as const;
export type RehearsalStep = typeof REHEARSAL_STEPS[number];
export type RehearsalManifest = {
  run_id: string;
  project_ref: string;
  environment: "staging";
  provider: "unicommerce";
  tenant: string;
  generation: number;
  created_at: string;
  forward_expires_at: string;
  cleanup_expires_at: string;
  controlled_email: string;
  customer_id: number;
  order_id: number;
  source_capture_sha256: string;
  customer: { customer: Record<string, unknown> };
  initial: { saleOrder: Record<string, unknown> };
  replacement: { saleOrder: Record<string, unknown> };
};
export type RehearsalGrant = {
  state: "prepared";
  lease_token: string;
  manifest_json: string;
  manifest_sha256: string;
  attempted: boolean;
  current_generation: number;
  completed_steps: RehearsalStep[];
  attempted_steps: RehearsalStep[];
};
export type RehearsalReply = {
  state: "busy" | "done" | "retry" | "blocked";
  run_id: string;
  step: RehearsalStep;
  code?: string;
  error_code?: string;
};
export interface RehearsalStore {
  /** Commits the exclusive lease and attempted marker before returning. */
  prepare(
    id: string,
    step: RehearsalStep,
  ): Promise<RehearsalGrant | RehearsalReply>;
  /** Atomic lease checked receipt; an uncertain finish must never be retried
   * as a contradictory result. The next prepare reconciles the original phase. */
  finish(
    id: string,
    step: RehearsalStep,
    lease: string,
    result: WarehouseResult,
  ): Promise<RehearsalReply>;
}
export type RehearsalBinding = {
  enabled: boolean;
  projectRef: string;
  tenant: string;
};
export type RehearsalAdapterFactory = (
  observeRead: (dto: Record<string, unknown>) => void,
) => WarehouseAdapter;
const staging = "scvojtvgnkmbupvyslmb";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const cleanup = (step: RehearsalStep) =>
  step.startsWith("cleanup_") || step === "customer_disable";
function invalid(): never {
  throw new WarehouseError("REJECTED", "REHEARSAL_SCOPE_INVALID");
}
export async function rehearsalDigest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
const reserved = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 1900000000 &&
  n <= 1999999999;
function stepList(value: unknown): value is RehearsalStep[] {
  return Array.isArray(value) && value.length <= REHEARSAL_STEPS.length &&
    new Set(value).size === value.length &&
    value.every((x) => REHEARSAL_STEPS.includes(x));
}
function permitted(grant: RehearsalGrant, step: RehearsalStep) {
  const done = new Set(grant.completed_steps),
    tried = new Set(grant.attempted_steps);
  const requires: Partial<Record<RehearsalStep, RehearsalStep[]>> = {
    customer: ["preflight"],
    submit: ["preflight", "customer"],
    reconcile: ["submit"],
    cancel_initial: ["reconcile"],
    replace: ["cancel_initial"],
    reconcile_replacement: ["replace"],
    cancel_replacement: ["reconcile_replacement"],
    cleanup_initial: ["preflight"],
    cleanup_replacement: ["preflight"],
    customer_disable: ["customer"],
  };
  if ((requires[step] ?? []).some((x) => !done.has(x))) invalid();
  if (
    step === "cleanup_initial" && !tried.has("submit") ||
    step === "cleanup_replacement" && !tried.has("replace")
  ) invalid();
  if (
    step === "customer_disable" &&
    (tried.has("submit") && !done.has("cancel_initial") &&
        !done.has("cleanup_initial") ||
      tried.has("replace") && !done.has("cancel_replacement") &&
        !done.has("cleanup_replacement"))
  ) invalid();
}

async function manifest(
  grant: RehearsalGrant,
  id: string,
  step: RehearsalStep,
  binding: RehearsalBinding,
  now: number,
): Promise<RehearsalManifest> {
  if (
    !uuid.test(grant.lease_token) || typeof grant.manifest_json !== "string" ||
    new TextEncoder().encode(grant.manifest_json).length > 65536 ||
    !sha.test(grant.manifest_sha256) ||
    await rehearsalDigest(grant.manifest_json) !== grant.manifest_sha256 ||
    typeof grant.attempted !== "boolean" ||
    !Number.isSafeInteger(grant.current_generation) ||
    grant.current_generation < 0 ||
    !stepList(grant.completed_steps) ||
    !stepList(grant.attempted_steps)
  ) invalid();
  let m: RehearsalManifest;
  try {
    m = object(JSON.parse(grant.manifest_json)) as RehearsalManifest;
  } catch {
    return invalid();
  }
  fields(m, [
    "run_id",
    "project_ref",
    "environment",
    "provider",
    "tenant",
    "generation",
    "created_at",
    "forward_expires_at",
    "cleanup_expires_at",
    "controlled_email",
    "customer_id",
    "order_id",
    "source_capture_sha256",
    "customer",
    "initial",
    "replacement",
  ]);
  const created = Date.parse(m.created_at),
    forward = Date.parse(m.forward_expires_at),
    until = Date.parse(m.cleanup_expires_at);
  if (
    m.run_id !== id || m.project_ref !== staging ||
    m.environment !== "staging" || m.provider !== "unicommerce" ||
    m.tenant !== binding.tenant ||
    !/^[a-z0-9][a-z0-9-]{1,62}$/.test(m.tenant) ||
    !Number.isSafeInteger(m.generation) || m.generation < 0 ||
    !cleanup(step) && m.generation !== grant.current_generation ||
    ![created, forward, until].every(Number.isFinite) || created > now ||
    forward <= created || forward - created > 30 * 60_000 || until < forward ||
    until - created > 24 * 60 * 60_000 ||
    now >= (cleanup(step) ? until : forward) ||
    !reserved(m.customer_id) || !reserved(m.order_id) ||
    m.customer_id === m.order_id ||
    !sha.test(m.source_capture_sha256) ||
    !/^squad-[a-z0-9-]+@mailinator\.com$/.test(m.controlled_email)
  ) invalid();
  fields(object(m.customer), ["customer"]);
  const customer = object(m.customer.customer);
  uniwareCustomer(customer);
  const customerCode = `S-${m.customer_id}`, party = `S-PC-${m.customer_id}`;
  if (customer.code !== customerCode || customer.enabled !== true) invalid();
  for (
    const c of [
      ...customer.partyContacts,
      customer.billingAddress,
      customer.shippingAddress,
    ]
  ) {
    if (object(c).email !== m.controlled_email || c.partyCode !== party) {
      invalid();
    }
  }
  for (
    const [key, code] of [["initial", `S-${m.order_id}`], [
      "replacement",
      `S-${m.order_id}-1`,
    ]] as const
  ) {
    fields(object(m[key]), ["saleOrder"]);
    const order = object(m[key].saleOrder);
    if (
      !Array.isArray(order.saleOrderItems) || order.saleOrderItems.length !== 1
    ) invalid();
    uniwarePayload(order);
    if (
      order.code !== code || order.displayOrderCode !== code ||
      order.customerCode !== customerCode ||
      order.notificationEmail !== m.controlled_email ||
      order.cashOnDelivery !== true || order.paymentInstrument !== "CASH" ||
      order.addresses.some((a: unknown) =>
        object(a).email !== m.controlled_email
      )
    ) invalid();
    const line = object(order.saleOrderItems[0]);
    if (
      line.facilityCode !== "WH1" || typeof line.code !== "string" ||
      !/^S-[A-Za-z0-9_-]{1,150}$/.test(line.code) ||
      typeof line.itemSku !== "string" || !line.itemSku ||
      line.itemSku.length > 200 || Number(line.totalPrice) <= 0 ||
      Number(line.totalPrice) > 1000 ||
      Number(line.sellingPrice) !== Number(line.totalPrice)
    ) invalid();
  }
  if (
    object((m.initial.saleOrder.saleOrderItems as unknown[])[0]).itemSku !==
      object((m.replacement.saleOrder.saleOrderItems as unknown[])[0]).itemSku
  ) invalid();
  permitted(grant, step);
  return m;
}
function intent(
  m: RehearsalManifest,
  step: RehearsalStep,
  grant: RehearsalGrant,
  operation: WarehouseIntent["operation"],
  replacement = false,
): WarehouseIntent {
  const order = replacement ? m.replacement : m.initial;
  return {
    state: "prepared",
    provider: "unicommerce",
    operation,
    intent_id: m.run_id,
    request_key: `rehearsal_${m.run_id}_${step}`,
    project_ref: staging,
    environment: "staging",
    facility_code: "WH1",
    provider_order_id: String(order.saleOrder.code),
    order_code: String(order.saleOrder.code),
    payload: operation === "submit" ? order : {},
    attempted: grant.attempted,
  };
}
async function execute(
  adapter: WarehouseAdapter,
  i: WarehouseIntent,
  signal: AbortSignal,
): Promise<WarehouseResult> {
  try {
    return await adapter.run(i, signal);
  } catch (error) {
    return error instanceof WarehouseError ? error.result() : {
      code: "RETRY",
      error_code: "PROVIDER_UNAVAILABLE",
      retry_after_seconds: 60,
    };
  }
}
const absence = (r: WarehouseResult) =>
  r.code === "RECONCILIATION_REQUIRED" &&
  r.error_code === "PROVIDER_ORDER_NOT_FOUND";
function ownedRead(
  r: WarehouseResult,
  m: RehearsalManifest,
  replacement: boolean,
) {
  const expected = (replacement ? m.replacement : m.initial).saleOrder;
  const item = object((expected.saleOrderItems as unknown[])[0]),
    proof = object(r.proof);
  if (
    r.code !== "OBSERVED" || r.external_code !== expected.code ||
    r.external_id !== expected.code ||
    proof.source !== "saleorder_get" || !Array.isArray(proof.items) ||
    proof.items.length !== 1
  ) invalid();
  const got = object(proof.items[0]);
  if (
    got.code !== item.code || got.sku_code !== item.itemSku ||
    got.facility_code !== "WH1" ||
    Number(got.total_price) !== Number(item.totalPrice) ||
    Number(got.selling_price) !== Number(item.sellingPrice)
  ) invalid();
  // Cancel only unfulfilled exact fixtures; never turn a shipping operation into
  // a test cleanup. Unknown provider item states require manual reconciliation.
  if (
    !["PENDING_VERIFICATION", "CREATED", "PROCESSING", "CANCELLED"].includes(
      r.status ?? "",
    ) ||
    ![
      "CREATED",
      "PENDING_VERIFICATION",
      "FULFILLABLE",
      "UNFULFILLABLE",
      "CANCELLED",
    ].includes(String(got.status))
  ) {
    throw new WarehouseError(
      "RECONCILIATION_REQUIRED",
      "REHEARSAL_ORDER_NOT_CANCELLABLE",
    );
  }
}
/** The unchanged adapter invokes its observer for every GET, including the
 * second lookup immediately before cancellation. Do not validate only the
 * orchestration lookup and allow a changed SKU/customer on that second read. */
function readGuard(m: RehearsalManifest, step: RehearsalStep) {
  return (dto: Record<string, unknown>) => {
    if (
      ![
        "cancel_initial",
        "cancel_replacement",
        "cleanup_initial",
        "cleanup_replacement",
      ].includes(step)
    ) return;
    const replacement = step.endsWith("replacement"),
      expected = (replacement ? m.replacement : m.initial).saleOrder;
    if (
      dto.customerCode !== expected.customerCode ||
      dto.displayOrderCode !== expected.displayOrderCode ||
      dto.notificationEmail !== m.controlled_email || dto.cod !== true ||
      String(dto.channel).toLowerCase() !== "custom" ||
      !Array.isArray(dto.saleOrderItems) || !Array.isArray(dto.addresses)
    ) invalid();
    for (const raw of expected.addresses as unknown[]) {
      const want = object(raw);
      if (
        !dto.addresses.some((raw) => {
          const got = object(raw);
          return [
            "name",
            "addressLine1",
            "city",
            "state",
            "country",
            "pincode",
            "phone",
            "email",
          ].every((k) => String(got[k] ?? "") === String(want[k] ?? ""));
        })
      ) invalid();
    }
    ownedRead(
      {
        code: "OBSERVED",
        external_id: String(dto.code),
        external_code: String(dto.code),
        status: String(dto.status),
        proof: {
          source: "saleorder_get",
          items: dto.saleOrderItems.map((raw) => {
            const item = object(raw);
            return {
              code: item.code,
              sku_code: item.itemSku,
              facility_code: item.facilityCode,
              status: item.statusCode,
              total_price: item.totalPrice,
              selling_price: item.sellingPrice,
            };
          }),
        },
      },
      m,
      replacement,
    );
  };
}
async function perform(
  adapter: WarehouseAdapter,
  m: RehearsalManifest,
  step: RehearsalStep,
  g: RehearsalGrant,
  signal: AbortSignal,
): Promise<WarehouseResult> {
  if (step === "preflight") {
    for (const replacement of [false, true]) {
      const r = await execute(
        adapter,
        intent(m, step, g, "inspect", replacement),
        signal,
      );
      if (!absence(r)) {
        return r.code === "OBSERVED"
          ? { code: "REJECTED", error_code: "REHEARSAL_CODE_ALREADY_EXISTS" }
          : r;
      }
    }
    return {
      code: "CONFIRMED",
      proof: {
        source: "exact_codes_absent",
        codes: [m.initial.saleOrder.code, m.replacement.saleOrder.code],
      },
    };
  }
  if (step === "customer" || step === "customer_disable") {
    // Customer endpoints have no read/adoption contract. A durable uncertain
    // prior call cannot safely be replayed, including an emergency disable.
    if (g.attempted) {
      return {
        code: "RECONCILIATION_REQUIRED",
        error_code: "PROVIDER_CUSTOMER_UNCERTAIN",
      };
    }
    const i = intent(m, step, g, "customer");
    i.customer_action = step === "customer" ? "create" : "edit";
    i.payload = {
      customer: { ...m.customer.customer, enabled: step === "customer" },
    };
    return await execute(adapter, i, signal);
  }
  const replacement = [
    "replace",
    "reconcile_replacement",
    "cancel_replacement",
    "cleanup_replacement",
  ].includes(step);
  if (step === "submit" || step === "replace") {
    return await execute(
      adapter,
      intent(m, step, g, "submit", replacement),
      signal,
    );
  }
  const observed = await execute(
    adapter,
    intent(m, step, g, "inspect", replacement),
    signal,
  );
  if (step === "reconcile" || step === "reconcile_replacement") {
    if (observed.code === "OBSERVED") ownedRead(observed, m, replacement);
    return observed;
  }
  if (absence(observed) && cleanup(step)) {
    return {
      code: "RECONCILIATION_REQUIRED",
      error_code: "REHEARSAL_CLEANUP_NOT_FOUND",
    };
  }
  if (observed.code !== "OBSERVED") {
    // This phase has issued only the read, so its first-attempt RETRY can safely
    // retain the right to make one future cancellation. A prior uncertain
    // cancellation always retains attempted=true.
    if (observed.code === "RETRY" && !g.attempted) {
      return {
        ...observed,
        proof: { ...observed.proof, mutation_attempted: false },
      };
    }
    return observed;
  }
  ownedRead(observed, m, replacement);
  const i = intent(m, step, g, "cancel", replacement),
    order = (replacement ? m.replacement : m.initial).saleOrder;
  i.payload = {
    saleOrderCode: order.code,
    cancellationReason: "Controlled Squad provider rehearsal cleanup",
    saleOrderItemCodes: [object((order.saleOrderItems as unknown[])[0]).code],
  };
  return await execute(adapter, i, signal);
}
export function warehouseRehearsal(
  store: RehearsalStore,
  adapterFactory: RehearsalAdapterFactory,
  binding: RehearsalBinding,
  now: () => number = Date.now,
  deadlineMs = 35000,
) {
  return async (id: string, step: RehearsalStep): Promise<RehearsalReply> => {
    if (
      !binding.enabled || binding.projectRef !== staging || !uuid.test(id) ||
      !REHEARSAL_STEPS.includes(step)
    ) invalid();
    const grant = await store.prepare(id, step);
    if (grant.state !== "prepared") return reply(grant, id, step);
    // A corrupt/foreign manifest must not reach the provider or be blessed by a
    // finish receipt. The durable lease expires for operator investigation.
    const m = await manifest(grant, id, step, binding, now());
    const controller = new AbortController(),
      timer = setTimeout(
        () => controller.abort(new Error("rehearsal_deadline")),
        Math.max(1, Math.min(35000, deadlineMs)),
      );
    let result: WarehouseResult;
    try {
      const adapter = adapterFactory(readGuard(m, step));
      result = await perform(adapter, m, step, grant, controller.signal);
    } catch (error) {
      result = error instanceof WarehouseError ? error.result() : {
        code: "RETRY",
        error_code: "PROVIDER_UNAVAILABLE",
        retry_after_seconds: 60,
      };
    } finally {
      clearTimeout(timer);
    }
    return reply(
      await store.finish(id, step, grant.lease_token, result),
      id,
      step,
    );
  };
}
/** Only a validated SQL grant creates this request-local enabled/write adapter.
 * The normal adapter and both deployment enable/write flags remain unchanged. */
export function warehouseRehearsalFromEnvironment(
  rpc: Rpc,
  get: (name: string) => string | undefined,
  request: typeof fetch = fetch,
) {
  const projectRef =
    get("SUPABASE_URL")?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)
      ?.[1] ?? "";
  const source = get("SQUAD_UNIWARE_CONFIG_SOURCE") ?? "dedicated";
  const tenant = source === "legacy_bridge"
    ? get("UNIWARE_BASE_URL")?.match(
      /^https:\/\/([a-z0-9][a-z0-9-]{0,61}[a-z0-9]|[a-z0-9])\.unicommerce\.com\/?$/,
    )?.[1] ?? ""
    : source === "dedicated"
    ? get("SQUAD_UNIWARE_TENANT") ?? ""
    : "";
  const binding: RehearsalBinding = {
    projectRef,
    tenant,
    enabled: projectRef === staging &&
      get("SQUAD_WAREHOUSE_ENVIRONMENT") === "staging" &&
      get("SQUAD_UNIWARE_ENVIRONMENT") === "staging",
  };
  const store: RehearsalStore = {
    prepare: async (id, step) =>
      await rpc("squad_warehouse_rehearsal_prepare", {
        p_id: id,
        p_step: step,
      }) as RehearsalGrant | RehearsalReply,
    finish: async (id, step, lease, result) =>
      await rpc("squad_warehouse_rehearsal_finish", {
        p_id: id,
        p_step: step,
        p_lease_token: lease,
        p_result: result,
      }) as RehearsalReply,
  };
  return warehouseRehearsal(store, (observer) => {
    const adapters = warehouseAdapters(
      (name) =>
        name === "SQUAD_WAREHOUSE_ENABLED" ||
          name === "SQUAD_WAREHOUSE_WRITES_ENABLED"
          ? "true"
          : get(name),
      request,
      observer,
    );
    if (!adapters.unicommerce) {
      throw new WarehouseError("REJECTED", "WAREHOUSE_NOT_CONFIGURED");
    }
    return adapters.unicommerce;
  }, binding);
}
function reply(
  value: RehearsalReply,
  id: string,
  step: RehearsalStep,
): RehearsalReply {
  if (
    value.run_id !== id || value.step !== step ||
    !["busy", "done", "retry", "blocked"].includes(value.state) ||
    [value.code, value.error_code].some((x) =>
      x !== undefined &&
      (typeof x !== "string" || !/^[A-Z0-9_]{1,100}$/.test(x))
    )
  ) invalid();
  return {
    run_id: id,
    step,
    state: value.state,
    ...(value.code ? { code: value.code } : {}),
    ...(value.error_code ? { error_code: value.error_code } : {}),
  };
}
