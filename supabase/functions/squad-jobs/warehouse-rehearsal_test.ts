import {
  type RehearsalAdapterFactory,
  type RehearsalBinding,
  rehearsalDigest,
  type RehearsalGrant,
  type RehearsalManifest,
  type RehearsalStep,
  type RehearsalStore,
  warehouseRehearsal,
  warehouseRehearsalFromEnvironment,
} from "./warehouse-rehearsal.ts";
import { unicommerceWarehouse } from "./warehouse-unicommerce.ts";
import { warehouseAdapters } from "./warehouse.ts";
import {
  type WarehouseAdapter,
  WarehouseError,
  type WarehouseIntent,
  type WarehouseResult,
} from "./warehouse-types.ts";
const assert = (v: unknown, msg = "assertion failed") => {
  if (!v) throw new Error(msg);
};
const id = "00000000-0000-4000-8000-000000000034",
  now = Date.parse("2026-11-08T12:00:00Z");
const email = "squad-warehouse-fixture@mailinator.com";
const binding: RehearsalBinding = {
  enabled: true,
  projectRef: "scvojtvgnkmbupvyslmb",
  tenant: "fixture-only",
};
function fixture(): RehearsalManifest {
  const address = {
    id: "1900000030",
    name: "Squad fixture",
    addressLine1: "Fixture street",
    city: "Bangalore",
    state: "KA",
    country: "IN",
    pincode: "560001",
    phone: "9000000000",
    email,
  };
  const ca = {
    addressLine1: address.addressLine1,
    city: address.city,
    stateCode: "KA",
    countryCode: "IN",
    partyCode: "S-PC-1900000001",
    addressType: "PRIMARY",
    pincode: address.pincode,
    phone: address.phone,
    email,
  };
  const initial = {
    saleOrder: {
      code: "S-1900000002",
      displayOrderCode: "S-1900000002",
      customerCode: "S-1900000001",
      customerName: "Squad fixture",
      channel: "Custom",
      notificationEmail: email,
      cashOnDelivery: true,
      paymentInstrument: "CASH",
      addresses: [address],
      billingAddress: { referenceId: address.id },
      shippingAddress: { referenceId: address.id },
      totalCashOnDeliveryCharges: 0,
      customFieldValues: [{ name: "PICKUPDATE", value: "12/11/26" }],
      saleOrderItems: [{
        code: "S-1900000002-1-1",
        itemSku: "FIXTURE-SKU",
        facilityCode: "WH1",
        shippingMethodCode: "STD",
        giftWrap: false,
        totalPrice: 100,
        sellingPrice: 100,
        prepaidAmount: 0,
        discount: 0,
        shippingCharges: 0,
        customFieldValues: [{ name: "Comment", value: "Fixture" }],
      }],
    },
  };
  const replacement = structuredClone(initial);
  replacement.saleOrder.code += "-1";
  replacement.saleOrder.displayOrderCode += "-1";
  replacement.saleOrder.saleOrderItems[0].code =
    "S-R00000000000040008000000000000034-1-1-1";
  return {
    run_id: id,
    project_ref: binding.projectRef,
    environment: "staging",
    provider: "unicommerce",
    tenant: binding.tenant,
    generation: 7,
    created_at: new Date(now - 60_000).toISOString(),
    forward_expires_at: new Date(now + 29 * 60_000).toISOString(),
    cleanup_expires_at: new Date(now + 23 * 60 * 60_000).toISOString(),
    customer_id: 1900000001,
    order_id: 1900000002,
    controlled_email: email,
    source_capture_sha256: "a".repeat(64),
    customer: {
      customer: {
        code: "S-1900000001",
        name: "Squad fixture",
        enabled: true,
        partyContacts: [{
          contactType: "PRIMARY",
          partyCode: ca.partyCode,
          name: "Squad fixture",
          phone: ca.phone,
          email,
        }],
        billingAddress: ca,
        shippingAddress: ca,
      },
    },
    initial,
    replacement,
  };
}
async function setup(
  options: {
    m?: RehearsalManifest;
    attempted?: boolean;
    done?: RehearsalStep[];
    tried?: RehearsalStep[];
    adapter?: WarehouseAdapter;
    adapterFactory?: RehearsalAdapterFactory;
    clock?: number;
    config?: Partial<RehearsalBinding>;
    deadline?: number;
  } = {},
) {
  const m = options.m ?? fixture(),
    raw = JSON.stringify(m),
    calls: WarehouseIntent[] = [],
    results: WarehouseResult[] = [],
    order: string[] = [];
  const grant: RehearsalGrant = {
    state: "prepared",
    lease_token: id,
    manifest_json: raw,
    manifest_sha256: await rehearsalDigest(raw),
    attempted: options.attempted ?? false,
    current_generation: 7,
    completed_steps: options.done ??
      [
        "preflight",
        "customer",
        "submit",
        "reconcile",
        "cancel_initial",
        "replace",
        "reconcile_replacement",
        "cancel_replacement",
      ],
    attempted_steps: options.tried ??
      [
        "preflight",
        "customer",
        "submit",
        "cancel_initial",
        "replace",
        "cancel_replacement",
      ],
  };
  const store: RehearsalStore = {
    prepare: async () => {
      order.push("prepare-committed");
      return grant;
    },
    finish: async (_, step, lease, result) => {
      assert(lease === id);
      order.push("finish");
      results.push(result);
      return {
        state: "done",
        run_id: id,
        step,
        code: result.code,
        error_code: result.error_code,
      };
    },
  };
  const adapter: WarehouseAdapter = {
    run: async (i, s) => {
      order.push("provider");
      calls.push(i);
      return options.adapter
        ? await options.adapter.run(i, s)
        : { code: "CONFIRMED" };
    },
  };
  return {
    m,
    grant,
    calls,
    results,
    order,
    store,
    run: warehouseRehearsal(
      store,
      options.adapterFactory ?? (() => adapter),
      { ...binding, ...options.config },
      () => options.clock ?? now,
      options.deadline,
    ),
  };
}
async function rejected(work: () => Promise<unknown>) {
  try {
    await work();
    throw new Error("unexpected success");
  } catch (e) {
    assert(e instanceof WarehouseError, String(e));
  }
}
function observed(m = fixture(), replacement = false): WarehouseResult {
  const o = (replacement ? m.replacement : m.initial).saleOrder,
    line = (o.saleOrderItems as Record<string, unknown>[])[0];
  return {
    code: "OBSERVED",
    external_id: String(o.code),
    external_code: String(o.code),
    status: "CREATED",
    proof: {
      source: "saleorder_get",
      items: [{
        code: line.code,
        sku_code: line.itemSku,
        facility_code: "WH1",
        status: "CREATED",
        total_price: "100",
        selling_price: "100",
      }],
    },
  };
}
const notFound: WarehouseResult = {
  code: "RECONCILIATION_REQUIRED",
  error_code: "PROVIDER_ORDER_NOT_FOUND",
};

Deno.test("rehearsal refuses disabled, production and unknown steps before store or provider", async () => {
  for (
    const config of [{ enabled: false }, { projectRef: "levwrmvqdntngeasrtnb" }]
  ) {
    const f = await setup({ config });
    await rejected(() => f.run(id, "submit"));
    assert(f.order.length === 0);
  }
  const f = await setup();
  await rejected(() => f.run(id, "anything" as RehearsalStep));
  assert(f.order.length === 0);
});
Deno.test("rehearsal rejects changed manifest bytes, hash, unknown fields and arbitrary hosts before HTTP", async () => {
  for (
    const mutate of [(f: Awaited<ReturnType<typeof setup>>) => {
      f.grant.manifest_json += " ";
    }, (f: Awaited<ReturnType<typeof setup>>) => {
      f.grant.manifest_sha256 = "f".repeat(64);
    }]
  ) {
    const f = await setup();
    mutate(f);
    await rejected(() => f.run(id, "submit"));
    assert(!f.calls.length && !f.results.length);
  }
  for (
    const field of [{ tenant: "attacker.example" }, {
      arbitrary_url: "https://example.test",
    }, { run_id: "00000000-0000-4000-8000-000000000035" }]
  ) {
    const f = await setup({ m: { ...fixture(), ...field } });
    await rejected(() => f.run(id, "submit"));
    assert(!f.calls.length);
  }
});
Deno.test("rehearsal rejects expired forward and changed generation, retains only bounded exact cleanup", async () => {
  const m = fixture();
  m.generation = 6;
  m.forward_expires_at = new Date(now - 1).toISOString();
  const f = await setup({ m, adapter: { run: async () => notFound } });
  await rejected(() => f.run(id, "submit"));
  await f.run(id, "cleanup_initial");
  assert(f.results[0].error_code === "REHEARSAL_CLEANUP_NOT_FOUND");
  const expired = await setup({ m, clock: Date.parse(m.cleanup_expires_at) });
  await rejected(() => expired.run(id, "cleanup_initial"));
});
Deno.test("rehearsal rejects unreserved and historical identities, multiple pieces, foreign email and facility", async () => {
  const mutations: ((m: RehearsalManifest) => void)[] = [(m) => {
    m.order_id = 10;
  }, (m) => {
    m.initial.saleOrder.code = "P-1900000002";
  }, (m) => {
    (m.initial.saleOrder.saleOrderItems as unknown[]).push(
      structuredClone((m.initial.saleOrder.saleOrderItems as unknown[])[0]),
    );
  }, (m) => {
    (m.replacement.saleOrder.saleOrderItems as Record<string, unknown>[])[0]
      .facilityCode = "WH2";
  }, (m) => {
    (m.customer.customer.partyContacts as Record<string, unknown>[])[0].email =
      "real@example.com";
  }, (m) => {
    (m.initial.saleOrder.addresses as Record<string, unknown>[])[0].email =
      "real@example.com";
  }];
  for (const mutate of mutations) {
    const m = fixture();
    mutate(m);
    const f = await setup({ m });
    await rejected(() => f.run(id, "submit"));
    assert(!f.calls.length);
  }
});
Deno.test("rehearsal requires durable phase prerequisites and rejects unattempted emergency targets", async () => {
  const f = await setup({ done: [], tried: [] });
  for (
    const s of [
      "submit",
      "replace",
      "cleanup_initial",
      "customer_disable",
    ] as const
  ) await rejected(() => f.run(id, s));
  assert(!f.calls.length);
});
Deno.test("rehearsal preflight reads both fixed codes and refuses any existing order", async () => {
  const f = await setup({
    done: [],
    tried: [],
    adapter: { run: async () => notFound },
  });
  await f.run(id, "preflight");
  assert(
    f.calls.length === 2 && f.calls.every((x) => x.operation === "inspect"),
  );
  assert(f.results[0].proof?.source === "exact_codes_absent");
  const collision = await setup({ adapter: { run: async () => observed() } });
  await collision.run(id, "preflight");
  assert(
    collision.calls.length === 1 &&
      collision.results[0].error_code === "REHEARSAL_CODE_ALREADY_EXISTS",
  );
});
Deno.test("rehearsal durable attempted marker precedes provider and exact captured payload is reused", async () => {
  const f = await setup();
  await f.run(id, "submit");
  assert(f.order.join() === "prepare-committed,provider,finish");
  assert(JSON.stringify(f.calls[0].payload) === JSON.stringify(f.m.initial));
});
Deno.test("rehearsal uncertain customer create and disable never call provider", async () => {
  for (const step of ["customer", "customer_disable"] as const) {
    const f = await setup({ attempted: true });
    await f.run(id, step);
    assert(
      !f.calls.length &&
        f.results[0].error_code === "PROVIDER_CUSTOMER_UNCERTAIN",
    );
  }
});
Deno.test("rehearsal disable changes only enabled flag and requires all attempted orders cleaned", async () => {
  const f = await setup();
  await f.run(id, "customer_disable");
  assert(f.calls[0].customer_action === "edit");
  assert(
    JSON.stringify(f.calls[0].payload) ===
      JSON.stringify({
        customer: { ...f.m.customer.customer, enabled: false },
      }),
  );
  const open = await setup({ done: ["preflight", "customer", "submit"] });
  await rejected(() => open.run(id, "customer_disable"));
  assert(!open.calls.length);
});
Deno.test("rehearsal cleanup checks exact sole item SKU facility prices before any cancel", async () => {
  for (
    const field of [{ sku_code: "OTHER" }, { facility_code: "WH2" }, {
      selling_price: "1",
    }, { code: "P-1" }]
  ) {
    const r = observed();
    Object.assign((r.proof!.items as Record<string, unknown>[])[0], field);
    const f = await setup({ adapter: { run: async () => r } });
    await f.run(id, "cleanup_initial");
    assert(
      f.calls.length === 1 && f.calls[0].operation === "inspect" &&
        f.results[0].code === "REJECTED",
    );
  }
});
Deno.test("rehearsal cleanup refuses shipped and completed results", async () => {
  for (const terminal of ["COMPLETE", "DISPATCHED"]) {
    const r = observed();
    if (terminal === "COMPLETE") r.status = terminal;
    else (r.proof!.items as Record<string, unknown>[])[0].status = terminal;
    const f = await setup({ adapter: { run: async () => r } });
    await f.run(id, "cleanup_initial");
    assert(
      f.calls.length === 1 &&
        f.results[0].error_code === "REHEARSAL_ORDER_NOT_CANCELLABLE",
    );
  }
});
Deno.test("rehearsal uncertain cancellation preserves prior attempted on the real cancel adapter", async () => {
  const f = await setup({
    attempted: true,
    adapter: {
      run: async (i) =>
        i.operation === "inspect" ? observed() : {
          code: "RECONCILIATION_REQUIRED",
          error_code: "PROVIDER_CANCEL_UNCERTAIN",
        },
    },
  });
  await f.run(id, "cleanup_initial");
  assert(
    f.calls.length === 2 && f.calls[1].attempted &&
      f.calls[1].operation === "cancel",
  );
});
Deno.test("rehearsal lost finish is not followed by another finish or provider mutation", async () => {
  const f = await setup();
  let finishes = 0;
  f.store.finish = async () => {
    finishes++;
    throw new Error("lost finish");
  };
  try {
    await f.run(id, "submit");
    throw new Error("unexpected success");
  } catch (e) {
    assert((e as Error).message === "lost finish");
  }
  assert(finishes === 1 && f.calls.length === 1);
});
Deno.test("rehearsal shares one overall abort deadline for all adapter requests", async () => {
  const f = await setup({
    deadline: 5,
    adapter: {
      run: (_, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          })
        ),
    },
  });
  await f.run(id, "submit");
  assert(f.results[0].error_code === "PROVIDER_UNAVAILABLE");
});
Deno.test("rehearsal carries trusted negative-attempt proof unchanged for durable retry decision", async () => {
  const f = await setup({
    adapter: {
      run: async () => {
        const e = new WarehouseError("RETRY", "PROVIDER_AUTH_UNAVAILABLE", 300);
        e.proof = { mutation_attempted: false };
        throw e;
      },
    },
  });
  await f.run(id, "submit");
  assert(
    f.results[0].proof?.mutation_attempted === false &&
      f.results[0].retry_after_seconds === 300,
  );
});
Deno.test("real Uniware adapter rejects lost metadata then exact emergency cleanup cancels that fixture", async () => {
  const m = fixture(),
    requests: string[] = [],
    dto = {
      ...m.initial.saleOrder,
      cod: true,
      status: "CREATED",
      customFieldValues: [],
      saleOrderItems:
        (m.initial.saleOrder.saleOrderItems as Record<string, unknown>[]).map(
          (x) => ({ ...x, statusCode: "CREATED" }),
        ),
    };
  const replies = [
    { successful: false, errors: [{ code: 40005 }] },
    { successful: true },
    { successful: true, saleOrderDTO: dto },
    { successful: true, saleOrderDTO: dto },
    { successful: true, saleOrderDTO: dto },
    { successful: true },
    {
      successful: true,
      saleOrderDTO: {
        ...dto,
        status: "CANCELLED",
        saleOrderItems: dto.saleOrderItems.map((x) => ({
          ...x,
          statusCode: "CANCELLED",
        })),
      },
    },
  ];
  const adapterFactory: RehearsalAdapterFactory = (observer) =>
    unicommerceWarehouse({
      projectRef: binding.projectRef,
      environment: "staging",
      enabled: true,
      writesEnabled: true,
      facilities: ["WH1", "WH2"],
      tenant: binding.tenant,
      username: "fixture",
      password: "fixture",
      clientId: "fixture",
      boundEnvironment: "staging",
    }, async (url) => {
      const path = new URL(String(url)).pathname;
      requests.push(path);
      const body = path === "/oauth/token"
        ? { access_token: "fixture", expires_in: 3600 }
        : replies.shift();
      assert(body, "unexpected provider call");
      return new Response(JSON.stringify(body), { status: 200 });
    }, observer);
  const f = await setup({ m, adapterFactory });
  await f.run(id, "submit");
  assert(f.results[0].error_code === "PROVIDER_CUSTOM_FIELDS_MISSING");
  await f.run(id, "cleanup_initial");
  assert(
    f.results[1].code === "CONFIRMED" && f.results[1].status === "CANCELLED",
  );
  assert(
    requests.filter((x) => x.endsWith("/create")).length === 1 &&
      requests.filter((x) => x.endsWith("/cancel")).length === 1 &&
      replies.length === 0,
  );
});

Deno.test("rehearsal read-only cancellation failure retains first mutation opportunity only", async () => {
  for (const attempted of [false, true]) {
    const f = await setup({
      attempted,
      adapter: {
        run: async () => ({
          code: "RETRY",
          error_code: "PROVIDER_UNAVAILABLE",
        }),
      },
    });
    await f.run(id, "cleanup_initial");
    assert(
      f.calls.length === 1 &&
        f.results[0].proof?.mutation_attempted ===
          (attempted ? undefined : false),
    );
  }
});

Deno.test("rehearsal observer rejects changed identity on the adapter's pre-cancel second GET", async () => {
  const m = fixture(),
    requests: string[] = [],
    dto = {
      ...m.initial.saleOrder,
      cod: true,
      status: "CREATED",
      saleOrderItems:
        (m.initial.saleOrder.saleOrderItems as Record<string, unknown>[]).map(
          (x) => ({ ...x, statusCode: "CREATED" }),
        ),
    };
  const changed = {
    ...dto,
    saleOrderItems: dto.saleOrderItems.map((x) => ({
      ...x,
      itemSku: "FOREIGN-SKU",
    })),
  };
  const replies = [dto, changed];
  const adapterFactory: RehearsalAdapterFactory = (observer) =>
    unicommerceWarehouse({
      projectRef: binding.projectRef,
      environment: "staging",
      enabled: true,
      writesEnabled: true,
      facilities: ["WH1"],
      tenant: binding.tenant,
      username: "fixture",
      password: "fixture",
      clientId: "fixture",
      boundEnvironment: "staging",
    }, async (url) => {
      const path = new URL(String(url)).pathname;
      requests.push(path);
      const body = path === "/oauth/token"
        ? { access_token: "fixture", expires_in: 3600 }
        : { successful: true, saleOrderDTO: replies.shift() };
      return new Response(JSON.stringify(body), { status: 200 });
    }, observer);
  const f = await setup({ adapterFactory });
  await f.run(id, "cleanup_initial");
  assert(
    f.results[0].error_code === "REHEARSAL_SCOPE_INVALID" &&
      replies.length === 0,
  );
  assert(!requests.some((x) => x.endsWith("/cancel")));
});

Deno.test("rehearsal absent read after uncertain create never marks cleanup complete", async () => {
  const f = await setup({ adapter: { run: async () => notFound } });
  await f.run(id, "cleanup_initial");
  assert(
    f.results[0].code === "RECONCILIATION_REQUIRED" &&
      f.results[0].error_code === "REHEARSAL_CLEANUP_NOT_FOUND",
  );
  assert(f.calls.length === 1 && f.calls[0].operation === "inspect");
});

Deno.test("rehearsal terminal and finish replies expose only scoped sanitized fields", async () => {
  const f = await setup();
  f.store.prepare = async () => ({
    state: "done",
    run_id: id,
    step: "submit",
    code: "CONFIRMED",
    secret: "never-return",
  } as never);
  const result = await f.run(id, "submit");
  assert(!JSON.stringify(result).includes("never-return") && !f.calls.length);
  f.store.prepare = async () => ({
    state: "done",
    run_id: id,
    step: "replace",
  });
  await rejected(() => f.run(id, "submit"));
});

Deno.test("rehearsal environment bridge creates its write adapter only after a validated durable capability", async () => {
  const f = await setup(), m = fixture(), clock = Date.now();
  m.created_at = new Date(clock - 1000).toISOString();
  m.forward_expires_at = new Date(clock + 60_000).toISOString();
  m.cleanup_expires_at = new Date(clock + 120_000).toISOString();
  f.grant.manifest_json = JSON.stringify(m);
  f.grant.manifest_sha256 = await rehearsalDigest(f.grant.manifest_json);
  const env: Record<string, string> = {
    SUPABASE_URL: `https://${binding.projectRef}.supabase.co`,
    SQUAD_WAREHOUSE_ENABLED: "false",
    SQUAD_WAREHOUSE_ENVIRONMENT: "staging",
    SQUAD_UNIWARE_ENVIRONMENT: "staging",
    SQUAD_WAREHOUSE_WRITES_ENABLED: "false",
    SQUAD_WAREHOUSE_FACILITIES: "WH1,WH2",
    SQUAD_UNIWARE_CONFIG_SOURCE: "legacy_bridge",
    UNIWARE_BASE_URL: `https://${binding.tenant}.unicommerce.com`,
    UNIWARE_USERNAME: "fixture",
    UNIWARE_PASSWORD: "fixture",
  };
  assert(!warehouseAdapters((key) => env[key]).unicommerce);
  const calls: string[] = [];
  let denied = false;
  const run = warehouseRehearsalFromEnvironment(
    async (name, args) => {
      calls.push(name);
      if (name.endsWith("prepare")) {
        if (denied) throw new Error("SQL capability unavailable");
        return f.grant;
      }
      return {
        run_id: id,
        step: args.p_step,
        state: "done",
        code: (args.p_result as WarehouseResult).code,
      };
    },
    (key) => env[key],
    async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      return new Response(
        JSON.stringify(
          path === "/oauth/token"
            ? { access_token: "fixture", expires_in: 3600 }
            : {
              successful: true,
              customer: { code: `S-${m.customer_id}`, enabled: true },
            },
        ),
        { status: 200 },
      );
    },
  );
  const result = await run(id, "customer");
  assert(
    result.code === "CONFIRMED" &&
      calls[0] === "squad_warehouse_rehearsal_prepare" &&
      calls.includes("/services/rest/v1/oms/customer/create"),
  );
  assert(
    env.SQUAD_WAREHOUSE_ENABLED === "false" &&
      env.SQUAD_WAREHOUSE_WRITES_ENABLED === "false" &&
      !warehouseAdapters((key) => env[key]).unicommerce,
  );
  delete env.SQUAD_WAREHOUSE_ENABLED;
  calls.length = 0;
  assert((await run(id, "customer")).code === "CONFIRMED");
  assert(!warehouseAdapters((key) => env[key]).unicommerce);
  calls.length = 0;
  denied = true;
  try {
    await run(id, "customer");
    throw new Error("unexpected success");
  } catch (error) {
    assert((error as Error).message === "SQL capability unavailable");
  }
  assert(calls.length === 1 && calls[0].endsWith("prepare"));
  denied = false;
  calls.length = 0;
  f.grant.manifest_sha256 = "b".repeat(64);
  await rejected(() => run(id, "customer"));
  assert(calls.length === 1 && calls[0].endsWith("prepare"));
});

Deno.test("rehearsal local adapter enable cannot bypass staging deployment bindings", async () => {
  for (
    const change of [
      { SUPABASE_URL: "https://levwrmvqdntngeasrtnb.supabase.co" },
      { SQUAD_WAREHOUSE_ENVIRONMENT: "production" },
      { SQUAD_UNIWARE_ENVIRONMENT: "production" },
      { SQUAD_WAREHOUSE_ENVIRONMENT: undefined },
    ]
  ) {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: `https://${binding.projectRef}.supabase.co`,
      SQUAD_WAREHOUSE_ENABLED: "false",
      SQUAD_WAREHOUSE_WRITES_ENABLED: "false",
      SQUAD_WAREHOUSE_ENVIRONMENT: "staging",
      SQUAD_UNIWARE_ENVIRONMENT: "staging",
      SQUAD_UNIWARE_TENANT: binding.tenant,
      ...change,
    };
    let calls = 0;
    const run = warehouseRehearsalFromEnvironment(
      async () => {
        calls++;
        throw new Error("unexpected RPC");
      },
      (key) => env[key],
      async () => {
        calls++;
        throw new Error("unexpected HTTP");
      },
    );
    await rejected(() => run(id, "customer"));
    assert(calls === 0);
  }
});

Deno.test("rehearsal current-generation proof must be a safe server integer", async () => {
  for (const current of [undefined, NaN, -1, "7"]) {
    const f = await setup();
    f.grant.current_generation = current as number;
    await rejected(() => f.run(id, "submit"));
    assert(!f.calls.length);
  }
});

Deno.test("rehearsal permits one shared SKU only and bounds each piece to a positive INR1000 value", async () => {
  for (
    const patch of [
      { itemSku: "OTHER-SKU" },
      { totalPrice: 0, sellingPrice: 0 },
      { totalPrice: 1001, sellingPrice: 1001 },
      { totalPrice: 100, sellingPrice: 99 },
    ]
  ) {
    const m = fixture();
    Object.assign(
      (m.replacement.saleOrder.saleOrderItems as Record<string, unknown>[])[0],
      patch,
    );
    const f = await setup({ m });
    await rejected(() => f.run(id, "submit"));
    assert(!f.calls.length);
  }
});
