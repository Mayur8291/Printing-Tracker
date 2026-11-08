import { warehouseAdapters, warehouseWorker } from "./warehouse.ts";
import { dashboardWarehouse } from "./warehouse-dashboard.ts";
import { unicommerceWarehouse } from "./warehouse-unicommerce.ts";
import { warehouseHttp } from "./warehouse-http.ts";
import {
  equal,
  type WarehouseConfig,
  WarehouseError,
  type WarehouseIntent,
} from "./warehouse-types.ts";
const assert = (v: unknown, message = "assertion failed") => {
  if (!v) throw new Error(message);
};
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const signal = () => new AbortController().signal;
const id = "00000000-0000-4000-8000-000000000001",
  job = { id, lease_token: id };
const config: WarehouseConfig = {
  projectRef: "scvojtvgnkmbupvyslmb",
  environment: "staging",
  enabled: true,
  writesEnabled: true,
  facilities: ["one_day"],
};
const base: WarehouseIntent = {
  state: "prepared",
  provider: "dashboard",
  operation: "submit",
  intent_id: id,
  request_key: "warehouse_" + id,
  project_ref: config.projectRef,
  environment: "staging",
  facility_code: "one_day",
  order_code: "S-1",
  payload: {
    order_code: "S-1",
    facility_code: "one_day",
    items: [{
      item_code: "S-1-1",
      sku_code: "SKU",
      quantity: 2,
      unit_price: 125.50,
    }],
  },
  attempted: false,
};
const capabilities = {
  schema_version: 1,
  atomic_mutations_v1: true,
  order_edit_cas: true,
  durable_mutation_results: true,
};
const absent = { error: "MUTATION_NOT_FOUND" };
const order = {
  dashboard_order_id: id,
  order_code: "S-1",
  status: "PENDING",
  updated_at: "2026-11-08T10:00:00.000Z",
  items: [{ sku_code: "SKU", quantity: 2, dispatched_quantity: 0 }],
  due_on: null,
  shipping_address: null,
};
type Call = { url: string; init: RequestInit };
function dashboard(
  replies: Response[],
  override: Partial<WarehouseConfig> = {},
) {
  const calls: Call[] = [];
  const adapter = dashboardWarehouse({
    ...config,
    ...override,
    apiKey: "test_key_not_a_secret",
  }, async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies.shift();
    if (!r) throw new Error("unexpected provider request");
    return r;
  });
  return { adapter, calls };
}
async function fails(work: () => Promise<unknown>, code: string) {
  try {
    await work();
    throw new Error("accepted unexpectedly");
  } catch (e) {
    assert(
      e instanceof WarehouseError && e.error_code === code,
      `expected ${code}, got ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

Deno.test("warehouse configuration is fixed-host, environment-bound and disabled by default", () => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://" + config.projectRef + ".supabase.co",
    SQUAD_WAREHOUSE_ENABLED: "true",
    SQUAD_WAREHOUSE_ENVIRONMENT: "staging",
    SQUAD_WAREHOUSE_FACILITIES: "one_day",
    SQUAD_DASHBOARD_API_KEY: "fake",
  };
  assert(
    Object.keys(warehouseAdapters((k) => values[k])).join() === "dashboard",
  );
  for (
    const [key, value] of [
      ["SUPABASE_URL", "https://attacker.example"],
      ["SQUAD_WAREHOUSE_ENVIRONMENT", "production"],
      ["SQUAD_WAREHOUSE_ENABLED", "false"],
      ["SQUAD_WAREHOUSE_FACILITIES", "../private"],
    ]
  ) {
    assert(
      !Object.keys(warehouseAdapters((k) => k === key ? value : values[k]))
        .length,
    );
  }
  Object.assign(values, {
    SQUAD_UNIWARE_TENANT: "isolated-test",
    SQUAD_UNIWARE_USERNAME: "fixture",
    SQUAD_UNIWARE_PASSWORD: "fixture",
    SQUAD_UNIWARE_CLIENT_ID: "fixture",
  });
  assert(!warehouseAdapters((k) => values[k]).unicommerce);
  values.SQUAD_UNIWARE_ENVIRONMENT = "staging";
  assert(warehouseAdapters((k) => values[k]).unicommerce);
});
Deno.test("warehouse refuses foreign project, facility, disabled writes and unknown payload keys before HTTP", async () => {
  const f = dashboard([]);
  for (
    const intent of [{ ...base, project_ref: "levwrmvqdntngeasrtnb" }, {
      ...base,
      facility_code: "production",
    }, {
      ...base,
      payload: { ...base.payload, webhook_url: "https://attacker.example" },
    }, {
      ...base,
      payload: {
        ...base.payload,
        items: [{
          item_code: "A",
          sku_code: "SKU",
          quantity: -1,
          unit_price: 1,
        }],
      },
    }]
  ) {
    try {
      await f.adapter.run(intent, signal());
      throw new Error("accepted");
    } catch (e) {
      assert(e instanceof WarehouseError);
    }
  }
  await fails(
    () => dashboard([], { writesEnabled: false }).adapter.run(base, signal()),
    "WAREHOUSE_WRITES_DISABLED",
  );
  assert(!f.calls.length);
});
Deno.test("Dashboard create proves capabilities then looks up deterministic mutation before one POST", async () => {
  const f = dashboard([
      json(capabilities),
      json(absent, 404),
      json(order, 201),
    ]),
    r = await f.adapter.run(base, signal());
  assert(
    r.code === "CONFIRMED" && r.proof?.source === "atomic_mutation_response" &&
      f.calls.length === 3,
  );
  assert(
    f.calls[1].url.endsWith("/mutations/" + base.request_key) &&
      f.calls[2].init.method === "POST" &&
      new Headers(f.calls[2].init.headers).get("Idempotency-Key") ===
        base.request_key,
  );
  assert(
    f.calls.every((c) =>
      c.url.startsWith(
        "https://" + config.projectRef +
          ".supabase.co/functions/v1/dashboard-stock-api/",
      ) && c.init.redirect === "error"
    ),
  );
});
Deno.test("Dashboard lost response reconciles exact durable result without a second write", async () => {
  let writes = 0, lookups = 0;
  const calls: string[] = [];
  const adapter = dashboardWarehouse({
    ...config,
    apiKey: "test_key_not_a_secret",
  }, async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/capabilities")) return json(capabilities);
    if (String(url).includes("/mutations/")) {
      lookups++;
      return writes
        ? json({
          request_id: base.request_key,
          request: { action: "create", target: null, body: base.payload },
          response: { status: 201, body: order },
        })
        : json(absent, 404);
    }
    writes++;
    throw new Error("provider committed then response lost");
  });
  await fails(() => adapter.run(base, signal()), "PROVIDER_UNAVAILABLE");
  const r = await adapter.run({ ...base, attempted: true }, signal());
  assert(
    r.code === "CONFIRMED" && r.proof?.source === "durable_mutation_result" &&
      writes === 1 && lookups === 2,
  );
});
Deno.test("Dashboard durable result rejects different frozen payload, target or request key", async () => {
  for (
    const change of [
      {
        request: {
          action: "create",
          target: null,
          body: { ...base.payload, facility_code: "other" },
        },
      },
      { request: { action: "create", target: "other", body: base.payload } },
      { request_id: "other-key" },
    ]
  ) {
    const f = dashboard([
      json(capabilities),
      json({
        request_id: base.request_key,
        request: { action: "create", target: null, body: base.payload },
        response: { status: 201, body: order },
        ...change,
      }),
    ]);
    await fails(
      () => f.adapter.run(base, signal()),
      "PROVIDER_INTENT_CONFLICT",
    );
    assert(f.calls.length === 2);
  }
});
Deno.test("Dashboard missing atomic capabilities and unproven existing order fail closed", async () => {
  await fails(
    () =>
      dashboard([json({ ...capabilities, durable_mutation_results: false })])
        .adapter.run(base, signal()),
    "PROVIDER_ATOMIC_CONTRACT_REQUIRED",
  );
  const f = dashboard([
    json(capabilities),
    json(absent, 404),
    json({ error: "ORDER_EXISTS", details: { dashboard_order_id: id } }, 409),
  ]);
  await fails(
    () => f.adapter.run(base, signal()),
    "PROVIDER_ADOPTION_REQUIRED",
  );
  assert(f.calls.length === 3);
});
Deno.test("Dashboard inspect returns bounded CAS and unchanged item/address evidence", async () => {
  const address = {
      name: "Fixture",
      address_line1: "One street",
      city: "City",
    },
    f = dashboard([json({ ...order, shipping_address: address })]);
  const r = await f.adapter.run({
    ...base,
    operation: "inspect",
    purpose: "amend",
    provider_order_id: id,
    payload: {},
  }, signal());
  assert(
    r.code === "OBSERVED" && r.proof?.updated_at === order.updated_at &&
      equal(r.proof?.shipping_address, address) &&
      equal(r.proof?.items, order.items),
  );
});
Deno.test("Dashboard amend requires CAS and persists its exact edit body", async () => {
  const amendment = {
    ...base,
    operation: "amend" as const,
    provider_order_id: id,
    payload: { due_on: "2026-11-10T00:00:00Z" },
  };
  await fails(
    () => dashboard([]).adapter.run(amendment, signal()),
    "WAREHOUSE_CAS_REQUIRED",
  );
  const f = dashboard([json(capabilities), json(absent, 404), json(order)]),
    payload = { ...amendment.payload, expected_updated_at: order.updated_at };
  await f.adapter.run({ ...amendment, payload }, signal());
  assert(
    f.calls[2].init.method === "PATCH" &&
      equal(JSON.parse(String(f.calls[2].init.body)), payload),
  );
  const conflict = dashboard([
    json(capabilities),
    json(absent, 404),
    json({ error: "ORDER_VERSION_CONFLICT" }, 409),
  ]);
  await fails(
    () => conflict.adapter.run({ ...amendment, payload }, signal()),
    "PROVIDER_VERSION_CONFLICT",
  );
});
Deno.test("Dashboard cancellation uses idempotent DELETE with exact reason and no hidden body", async () => {
  const f = dashboard([
    json(capabilities),
    json(absent, 404),
    json({ ...order, status: "CANCELLED" }),
  ]);
  const r = await f.adapter.run({
    ...base,
    operation: "cancel",
    provider_order_id: id,
    payload: { reason: "customer cancellation" },
  }, signal());
  assert(
    r.status === "CANCELLED" && f.calls[2].init.method === "DELETE" &&
      f.calls[2].init.body === undefined &&
      new URL(f.calls[2].url).searchParams.get("reason") ===
        "customer cancellation",
  );
});
Deno.test("Dashboard inventory distinguishes missing SKU from confirmed zero stock", async () => {
  const f = dashboard([
      json({ snapshot: { "one_day:SKU": 0, "one_day:UNREQUESTED": 999 } }),
    ]),
    r = await f.adapter.run({
      ...base,
      operation: "inventory",
      payload: { skus: ["SKU", "UNKNOWN"] },
    }, signal());
  assert(
    equal(r.inventory, [{ sku_code: "SKU", known: true, available: 0 }, {
      sku_code: "UNKNOWN",
      known: false,
      available: null,
    }]),
  );
});
Deno.test("Dashboard customer remains an explicit inline-order operation without fictitious external customer API", async () => {
  const f = dashboard([]),
    r = await f.adapter.run(
      { ...base, operation: "customer", payload: {} },
      signal(),
    );
  assert(
    r.code === "CONFIRMED" && r.proof?.standalone_customer_api === false &&
      !r.customer_code && !f.calls.length,
  );
});
Deno.test("Dashboard retry-after and provider errors never expose response contents", async () => {
  const f = dashboard([
    json({ secret: "DO_NOT_LEAK" }, 429, { "retry-after": "123" }),
  ]);
  try {
    await f.adapter.run(base, signal());
    throw new Error("accepted");
  } catch (e) {
    assert(
      e instanceof WarehouseError && e.result().retry_after_seconds === 123 &&
        !JSON.stringify(e.result()).includes("DO_NOT_LEAK"),
    );
  }
});
Deno.test("Warehouse cooldown survives text, HTML and empty retryable responses", async () => {
  for (const status of [408, 429, 500, 503]) {
    for (const body of [null, "DO_NOT_LEAK", "<h1>Unavailable</h1>", "{"]) {
      const http = warehouseHttp(
        "https://example.invalid",
        async () =>
          new Response(body, { status, headers: { "retry-after": "900" } }),
      );
      try {
        await http("/orders", {}, signal());
        throw new Error("accepted");
      } catch (error) {
        assert(error instanceof WarehouseError);
        const result = (error as WarehouseError).result();
        assert(
          result.code === "RETRY" &&
            result.error_code === "PROVIDER_UNAVAILABLE" &&
            result.retry_after_seconds === 900 &&
            !JSON.stringify(result).includes("DO_NOT_LEAK"),
        );
      }
    }
  }
});
Deno.test("Warehouse retry delays accept bounded seconds and HTTP dates", async () => {
  const cases: Array<[string, number, number]> = [
    ["0", 5, 5],
    ["1", 5, 5],
    ["3600", 3600, 3600],
    ["999999999999999999999999", 3600, 3600],
    [new Date(Date.now() + 900000).toUTCString(), 899, 900],
    [new Date(Date.now() + 7200000).toUTCString(), 3600, 3600],
    ["Sun, 06 Nov 1994 08:49:37 GMT", 5, 5],
    ["Sunday, 06-Nov-94 08:49:37 GMT", 5, 5],
    ["Sun Nov  6 08:49:37 1994", 5, 5],
  ];
  for (const [retry, min, max] of cases) {
    const http = warehouseHttp(
      "https://example.invalid",
      async () =>
        new Response("Unavailable", {
          status: 503,
          headers: { "retry-after": retry },
        }),
    );
    try {
      await http("/orders", {}, signal());
      throw new Error("accepted");
    } catch (error) {
      assert(error instanceof WarehouseError);
      const delay = (error as WarehouseError).result().retry_after_seconds ?? 0;
      assert(delay >= min && delay <= max, "Incorrect bounded retry delay");
    }
  }
});
Deno.test("Warehouse missing or malformed retry headers use a 60 second fallback", async () => {
  for (
    const retry of [
      null,
      "",
      "-1",
      "1.5",
      "next Tuesday",
      "2026-11-08",
      "Sun, 99 Nov 2026 08:49:37 GMT",
      "9".repeat(129),
    ]
  ) {
    const http = warehouseHttp(
      "https://example.invalid",
      async () =>
        new Response(null, {
          status: 429,
          headers: retry === null ? {} : { "retry-after": retry },
        }),
    );
    try {
      await http("/orders", {}, signal());
      throw new Error("accepted");
    } catch (error) {
      assert(
        error instanceof WarehouseError &&
          error.result().retry_after_seconds === 60,
      );
    }
  }
});
Deno.test("Warehouse retry status cancels a stalled error stream without waiting for it", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => {}),
    cancel: () => {
      cancelled = true;
      return new Promise(() => {});
    },
  });
  const http = warehouseHttp(
    "https://example.invalid",
    async () =>
      new Response(body, { status: 503, headers: { "retry-after": "120" } }),
  );
  try {
    await http("/orders", {}, signal());
    throw new Error("accepted");
  } catch (error) {
    assert(
      error instanceof WarehouseError &&
        error.result().retry_after_seconds === 120 && cancelled,
    );
  }
});
Deno.test("Warehouse malformed successful responses still fail validation", async () => {
  const http = warehouseHttp(
    "https://example.invalid",
    async () =>
      new Response("not JSON", {
        status: 200,
        headers: { "retry-after": "900" },
      }),
  );
  try {
    await http("/orders", {}, signal());
    throw new Error("accepted");
  } catch (error) {
    assert(
      error instanceof WarehouseError &&
        error.result().error_code === "PROVIDER_RESPONSE_INVALID" &&
        error.result().retry_after_seconds === undefined,
    );
  }
});
Deno.test("Warehouse malformed or missing authorization bodies preserve the adapter cooldown", async () => {
  for (const status of [401, 403]) {
    for (const body of [null, "", "<h1>Unauthorized</h1>", "[]"]) {
      const f = dashboard([new Response(body, { status })]);
      try {
        await f.adapter.run(base, signal());
        throw new Error("accepted");
      } catch (error) {
        assert(
          error instanceof WarehouseError &&
            error.result().error_code === "PROVIDER_AUTH_UNAVAILABLE" &&
            error.result().retry_after_seconds === 300,
        );
      }
    }
  }
});
Deno.test("Dashboard inspect rejects wrong identity and unexpected response fields in address evidence", async () => {
  await fails(
    () =>
      dashboard([json({ ...order, order_code: "S-99" })]).adapter.run({
        ...base,
        operation: "inspect",
        provider_order_id: id,
        payload: {},
      }, signal()),
    "PROVIDER_IDENTITY_MISMATCH",
  );
  await fails(
    () =>
      dashboard([
        json({ ...order, shipping_address: { api_secret: "secret" } }),
      ]).adapter.run({
        ...base,
        operation: "inspect",
        provider_order_id: id,
        payload: {},
      }, signal()),
    "WAREHOUSE_CONTRACT_INVALID",
  );
});

const address = {
  id: 1,
  name: "Fixture",
  addressLine1: "One street",
  city: "City",
  state: "KA",
  country: "IN",
  pincode: "560001",
  phone: "9000000000",
  email: "test@example.invalid",
};
const saleOrder = {
  code: "S-1",
  displayOrderCode: "S-1",
  customerCode: "S-2",
  customerName: "Fixture",
  channel: "Custom",
  cashOnDelivery: true,
  paymentInstrument: "CASH",
  addresses: [address],
  billingAddress: { referenceId: 1 },
  shippingAddress: { referenceId: 1 },
  totalCashOnDeliveryCharges: 0,
  saleOrderItems: [{
    code: "S-1-1-1",
    itemSku: "SKU",
    shippingMethodCode: "STD",
    giftWrap: false,
    facilityCode: "one_day",
    totalPrice: 125.5,
    sellingPrice: 125.5,
    prepaidAmount: 0,
    discount: 0,
    shippingCharges: 0,
  }],
};
const uniIntent: WarehouseIntent = {
  ...base,
  provider: "unicommerce",
  payload: { saleOrder },
};
const dto = {
  ...saleOrder,
  cod: true,
  status: "CREATED",
  updated: 1794132000000,
  saleOrderItems: saleOrder.saleOrderItems.map((x) => ({
    ...x,
    statusCode: "CREATED",
  })),
};
const notFound = { successful: false, errors: [{ code: 40005 }] };
const auth = {
  access_token: "fixture_access",
  refresh_token: "fixture_refresh",
  expires_in: 3600,
};
const uniConfig = {
  ...config,
  tenant: "isolated-test",
  username: "fixture_user",
  password: "fixture_password",
  clientId: "my-trusted-client",
  boundEnvironment: "staging" as const,
};
function uni(replies: Response[], override: Partial<typeof uniConfig> = {}) {
  const calls: Call[] = [];
  const adapter = unicommerceWarehouse(
    { ...uniConfig, ...override },
    async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (new URL(String(url)).pathname === "/oauth/token") return json(auth);
      const r = replies.shift();
      if (!r) throw new Error("unexpected provider request");
      return r;
    },
  );
  return { adapter, calls };
}
const customerAddress = {
  addressLine1: "One street",
  city: "City",
  stateCode: "KA",
  countryCode: "IN",
  partyCode: "S-PC-2",
  addressType: "PRIMARY",
  pincode: "560001",
  phone: "9000000000",
  email: "test@example.invalid",
};
const customer = {
  code: "S-2",
  name: "Fixture",
  enabled: true,
  partyContacts: [{
    contactType: "PRIMARY",
    partyCode: "S-PC-2",
    name: "Fixture",
    email: "test@example.invalid",
    phone: "9000000000",
  }],
  billingAddress: customerAddress,
  shippingAddress: customerAddress,
};

Deno.test("Uniware first submit performs lookup, one create and verified read; credentials stay out of password URL", async () => {
  const f = uni([
      json(notFound),
      json({ successful: true }),
      json({ successful: true, saleOrderDTO: dto }),
    ]),
    r = await f.adapter.run(uniIntent, signal());
  assert(
    r.code === "CONFIRMED" && r.external_id === "S-1" && f.calls.length === 4,
  );
  const url = new URL(f.calls[0].url),
    headers = new Headers(f.calls[0].init.headers);
  assert(
    url.hostname === "isolated-test.unicommerce.com" &&
      !url.searchParams.has("username") && !url.searchParams.has("password") &&
      headers.get("username") === "fixture_user" &&
      headers.get("password") === "fixture_password",
  );
  assert(f.calls[2].url.endsWith("/saleOrder/create"));
});
Deno.test("Uniware proven existing order is adopted without create, with decimal-normalized prices", async () => {
  const existing = {
      ...dto,
      saleOrderItems: dto.saleOrderItems.map((x) => ({
        ...x,
        totalPrice: "125.5000",
        sellingPrice: "125.50",
      })),
    },
    f = uni([json({ successful: true, saleOrderDTO: existing })]);
  const r = await f.adapter.run({ ...uniIntent, attempted: true }, signal());
  assert(
    r.code === "CONFIRMED" && r.proof?.source === "verified_order_lookup" &&
      f.calls.length === 2,
  );
});
Deno.test("Uniware uncertain missing order never retries create blindly", async () => {
  const f = uni([json(notFound)]);
  await fails(
    () => f.adapter.run({ ...uniIntent, attempted: true }, signal()),
    "PROVIDER_CREATE_UNCERTAIN",
  );
  assert(!f.calls.some((c) => c.url.endsWith("/saleOrder/create")));
});
Deno.test("Uniware absent proof requires explicit 200/40005, not generic 404 or transient error", async () => {
  for (
    const response of [
      json(notFound, 503),
      json({ error: "not found" }, 404),
      json({ successful: false, errors: [{ code: 0 }] }),
    ]
  ) {
    const f = uni([response]);
    try {
      await f.adapter.run(uniIntent, signal());
      throw new Error("accepted");
    } catch (e) {
      assert(
        e instanceof WarehouseError &&
          !f.calls.some((c) => c.url.endsWith("/saleOrder/create")),
      );
    }
  }
});
Deno.test("Uniware existing order mismatch never adopts customer, facility, price, SKU or address drift", async () => {
  const variants = [{ ...dto, customerCode: "S-OTHER" }, {
    ...dto,
    saleOrderItems: dto.saleOrderItems.map((x) => ({
      ...x,
      facilityCode: "other",
    })),
  }, {
    ...dto,
    saleOrderItems: dto.saleOrderItems.map((x) => ({ ...x, totalPrice: 1 })),
  }, {
    ...dto,
    saleOrderItems: dto.saleOrderItems.map((x) => ({ ...x, itemSku: "OTHER" })),
  }, { ...dto, addresses: [{ ...address, addressLine1: "Other address" }] }];
  for (const changed of variants) {
    const f = uni([json({ successful: true, saleOrderDTO: changed })]);
    try {
      await f.adapter.run(uniIntent, signal());
      throw new Error("adopted");
    } catch (e) {
      assert(
        e instanceof WarehouseError && e.code === "RECONCILIATION_REQUIRED" &&
          f.calls.length === 2,
      );
    }
  }
});
Deno.test("Uniware adoption checks COD, displayed code and requested due time", async () => {
  const requested = { ...saleOrder, fulfillmentTat: "2026-11-10T00:00:00Z" };
  for (
    const changed of [{ ...dto, cod: false }, {
      ...dto,
      displayOrderCode: "OTHER",
    }, { ...dto, fulfillmentTat: Date.parse("2026-11-11T00:00:00Z") }]
  ) {
    const f = uni([json({ successful: true, saleOrderDTO: changed })]);
    await fails(
      () =>
        f.adapter.run(
          { ...uniIntent, payload: { saleOrder: requested } },
          signal(),
        ),
      "PROVIDER_ADOPTION_MISMATCH",
    );
  }
  const f = uni([
    json({
      successful: true,
      saleOrderDTO: {
        ...dto,
        fulfillmentTat: Date.parse(requested.fulfillmentTat),
      },
    }),
  ]);
  assert(
    (await f.adapter.run(
      { ...uniIntent, payload: { saleOrder: requested } },
      signal(),
    )).code === "CONFIRMED",
  );
});
Deno.test("Uniware duplicate-create response still requires exact proof lookup", async () => {
  const f = uni([
    json(notFound),
    json({ successful: false, errors: [{ code: 40001 }] }),
    json({ successful: true, saleOrderDTO: dto }),
  ]);
  assert((await f.adapter.run(uniIntent, signal())).code === "CONFIRMED");
  assert(
    f.calls.filter((c) => c.url.endsWith("/saleOrder/create")).length === 1,
  );
});
Deno.test("Uniware create response without observable result remains unconfirmed", async () => {
  const f = uni([json(notFound), json({ successful: true }), json(notFound)]);
  await fails(
    () => f.adapter.run(uniIntent, signal()),
    "PROVIDER_RESULT_UNCONFIRMED",
  );
});
Deno.test("Uniware validates facility and provider-native allowed fields before any network request", async () => {
  for (
    const changed of [
      { ...saleOrder, callbackUrl: "https://attacker.example" },
      {
        ...saleOrder,
        saleOrderItems: saleOrder.saleOrderItems.map((x) => ({
          ...x,
          facilityCode: "other",
        })),
      },
      { ...saleOrder, billingAddress: { referenceId: "other" } },
    ]
  ) {
    const f = uni([]);
    await fails(
      () =>
        f.adapter.run(
          { ...uniIntent, payload: { saleOrder: changed } },
          signal(),
        ),
      "WAREHOUSE_CONTRACT_INVALID",
    );
    assert(!f.calls.length);
  }
  const f = uni([], { tenant: "https://attacker.example" });
  await fails(
    () => f.adapter.run(uniIntent, signal()),
    "WAREHOUSE_NOT_CONFIGURED",
  );
  assert(!f.calls.length);
});
Deno.test("Uniware cancel observes before writing and confirms individual target items afterwards", async () => {
  const cancelled = {
      ...dto,
      status: "CANCELLED",
      saleOrderItems: dto.saleOrderItems.map((x) => ({
        ...x,
        statusCode: "CANCELLED",
      })),
    },
    f = uni([
      json({ successful: true, saleOrderDTO: dto }),
      json({ successful: true }),
      json({ successful: true, saleOrderDTO: cancelled }),
    ]);
  const r = await f.adapter.run({
    ...uniIntent,
    operation: "cancel",
    provider_order_id: "S-1",
    payload: {
      saleOrderCode: "S-1",
      cancellationReason: "Customer requested",
      saleOrderItemCodes: ["S-1-1-1"],
    },
  }, signal());
  assert(
    r.status === "CANCELLED" &&
      equal(r.proof?.cancelled_item_codes, ["S-1-1-1"]) &&
      f.calls[2].url.endsWith("/saleOrder/cancel"),
  );
});
Deno.test("Uniware uncertain cancellation reconciles cancelled status or stops without another cancellation", async () => {
  for (const cancelled of [false, true]) {
    const observed = { ...dto, status: cancelled ? "CANCELLED" : "CREATED" },
      f = uni([json({ successful: true, saleOrderDTO: observed })]),
      intent = {
        ...uniIntent,
        operation: "cancel" as const,
        attempted: true,
        payload: {
          saleOrderCode: "S-1",
          cancellationReason: "Customer requested",
          saleOrderItemCodes: ["S-1-1-1"],
        },
      };
    if (cancelled) {
      assert((await f.adapter.run(intent, signal())).code === "CONFIRMED");
    } else {await fails(() =>
        f.adapter.run(intent, signal()), "PROVIDER_CANCEL_UNCERTAIN");}
    assert(!f.calls.some((c) => c.url.endsWith("/saleOrder/cancel")));
  }
});
Deno.test("Uniware customer create/edit require confirmed response identity; uncertain work has no invented GET", async () => {
  for (const action of ["create", "edit"] as const) {
    const f = uni([json({ successful: true, customer: { code: "S-2", enabled: true } })]);
    const r = await f.adapter.run({
      ...uniIntent,
      operation: "customer",
      customer_action: action,
      payload: { customer },
    }, signal());
    assert(
      r.customer_code === "S-2" && r.proof?.enabled === true &&
        f.calls[1].url.endsWith("/customer/" + action),
    );
  }
  const uncertain = uni([]);
  await fails(
    () =>
      uncertain.adapter.run({
        ...uniIntent,
        operation: "customer",
        customer_action: "create",
        attempted: true,
        payload: { customer },
      }, signal()),
    "PROVIDER_CUSTOMER_UNCERTAIN",
  );
  assert(!uncertain.calls.length);
});
Deno.test("Uniware customer edit proves disabled state and rejects omitted or mismatched enabled", async () => {
  for (const actual of [undefined, true, false]) {
    const f = uni([json({ successful: true, customer: { code: "S-2", ...(actual === undefined ? {} : { enabled: actual }) } })]);
    const i: WarehouseIntent = { ...uniIntent, operation: "customer", customer_action: "edit", payload: { customer: { ...customer, enabled: false } } };
    if (actual === false) {
      const r = await f.adapter.run(i, signal());
      assert(r.code === "CONFIRMED" && r.proof?.enabled === false);
    } else await fails(() => f.adapter.run(i, signal()), actual === undefined ? "PROVIDER_CUSTOMER_STATE_MISSING" : "PROVIDER_CUSTOMER_STATE_MISMATCH");
    assert(f.calls.filter(c => c.url.endsWith("/customer/edit")).length === 1);
  }
});
Deno.test("Uniware customer payload cannot insert remote tenant URLs or API secrets", async () => {
  const f = uni([]);
  await fails(
    () =>
      f.adapter.run({
        ...uniIntent,
        operation: "customer",
        customer_action: "create",
        payload: {
          customer: {
            ...customer,
            uniwareAccessUrl: "https://attacker.example",
          },
        },
      }, signal()),
    "WAREHOUSE_CONTRACT_INVALID",
  );
  assert(!f.calls.length);
});
Deno.test("Uniware rejection retains only bounded numeric diagnostics without permitting mutation replay", async () => {
  for (const status of [200, 400, 422]) {
    const f = uni([json({
      successful: false,
      message: "secret fixture@example.com",
      errors: [
        { code: 10025, fieldName: "secret", description: "PII", errorParams: { password: "secret" } },
        { code: 10025 }, { code: "400" }, { code: -1 }, { code: 1.5 },
        { code: 9000000000 }, ...Array.from({ length: 20 }, (_, n) => ({ code: 1000 + n })),
      ],
    }, status)]);
    try {
      await f.adapter.run({ ...uniIntent, operation: "customer", customer_action: "create", payload: { customer } }, signal());
      throw new Error("accepted unexpectedly");
    } catch (error) {
      if (!(error instanceof WarehouseError)) throw error;
      const result = error.result();
      assert(result.code === "REJECTED" && result.error_code === "PROVIDER_REJECTED");
      assert(equal(result.proof, { source: "provider_rejection", http_status: status, error_codes: [10025, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008] }));
      assert(!JSON.stringify(result).includes("secret") && result.proof?.mutation_attempted !== false);
    }
    assert(f.calls.filter(c => c.url.endsWith("/customer/create")).length === 1);
    const before = f.calls.length;
    await fails(() => f.adapter.run({ ...uniIntent, operation: "customer", customer_action: "create", attempted: true, payload: { customer } }, signal()), "PROVIDER_CUSTOMER_UNCERTAIN");
    assert(f.calls.length === before);
  }
});
Deno.test("Uniware uncoded HTTP rejection stays diagnosable while transient failure stays uncertain", async () => {
  for (const [status, body] of [[400, {}], [200, { successful: false, errors: [{ code: 0 }] }], [503, {}]] as const) {
    const f = uni([json(body, status)]);
    try {
      await f.adapter.run({ ...uniIntent, operation: "customer", customer_action: "create", payload: { customer } }, signal());
      throw new Error("accepted unexpectedly");
    } catch (error) {
      if (!(error instanceof WarehouseError)) throw error;
      const result = error.result();
      if (status === 400) assert(equal(result.proof, { source: "provider_rejection", http_status: 400, error_codes: [] }));
      else assert(result.code === "RETRY" && result.proof === undefined);
    }
    assert(f.calls.filter(c => c.url.endsWith("/customer/create")).length === 1);
  }
});
Deno.test("Uniware amendments must be persisted cancellation/create phases", async () => {
  const f = uni([]);
  await fails(
    () => f.adapter.run({ ...uniIntent, operation: "amend" }, signal()),
    "UNIWARE_AMENDMENT_PHASE_REQUIRED",
  );
  assert(!f.calls.length);
});
Deno.test("Uniware inventory preserves unknown SKUs and rejects unrequested inventory rows", async () => {
  const intent = {
      ...uniIntent,
      operation: "inventory" as const,
      payload: { skus: ["SKU", "UNKNOWN"] },
    },
    f = uni([
      json({
        successful: true,
        inventorySnapshots: [{ itemTypeSKU: "SKU", inventory: 0 }],
      }),
    ]);
  const r = await f.adapter.run(intent, signal());
  assert(
    equal(r.inventory, [{ sku_code: "SKU", known: true, available: 0 }, {
      sku_code: "UNKNOWN",
      known: false,
      available: null,
    }]),
  );
  await fails(
    () =>
      uni([
        json({
          successful: true,
          inventorySnapshots: [{ itemTypeSKU: "OTHER", inventory: 1 }],
        }),
      ]).adapter.run(intent, signal()),
    "PROVIDER_RESPONSE_INVALID",
  );
});
Deno.test("Uniware token acquisition is single-flight and refresh retries read-only requests once", async () => {
  let authCount = 0, readCount = 0;
  const authUrls: string[] = [];
  const adapter = unicommerceWarehouse(uniConfig, async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/oauth/token") {
      authCount++;
      authUrls.push(String(url));
      return json({ ...auth, access_token: "token" + authCount });
    }
    readCount++;
    return readCount === 1 ? json({}, 401) : json({
      successful: true,
      inventorySnapshots: [{ itemTypeSKU: "SKU", inventory: 2 }],
    });
  });
  const intent = {
    ...uniIntent,
    operation: "inventory" as const,
    payload: { skus: ["SKU"] },
  };
  const result = await adapter.run(intent, signal());
  assert(
    result.inventory?.[0].available === 2 && authCount === 2 &&
      readCount === 2 && authUrls[1].includes("grant_type=refresh_token"),
  );
  let tokens = 0;
  const concurrent = unicommerceWarehouse(uniConfig, async (url) => {
    if (new URL(String(url)).pathname === "/oauth/token") {
      tokens++;
      await Promise.resolve();
      return json(auth);
    }
    return json({ successful: true, inventorySnapshots: [] });
  });
  await Promise.all([
    concurrent.run(intent, signal()),
    concurrent.run(intent, signal()),
  ]);
  assert(tokens === 1);
});
Deno.test("Uniware unauthorized write refreshes credentials without repeating the uncertain mutation", async () => {
  for (const body of ["{}", "Unauthorized", null]) {
    let authCount = 0, writes = 0;
    const adapter = unicommerceWarehouse(uniConfig, async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/oauth/token") {
        authCount++;
        return json(auth);
      }
      if (path.endsWith("/saleorder/get")) return json(notFound);
      writes++;
      return new Response(body, { status: 401 });
    });
    try {
      await adapter.run(uniIntent, signal());
      throw new Error("accepted");
    } catch (error) {
      assert(
        error instanceof WarehouseError &&
          error.result().error_code === "PROVIDER_AUTH_UNAVAILABLE" &&
          error.result().proof?.mutation_attempted !== false,
      );
    }
    assert(writes === 1 && authCount === 2);
  }
});
Deno.test("Uniware non-JSON401 preserves read refresh and rejected-refresh password fallback", async () => {
  let authCount = 0, reads = 0;
  const adapter = unicommerceWarehouse(uniConfig, async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/oauth/token") {
      authCount++;
      return parsed.searchParams.get("grant_type") === "refresh_token"
        ? new Response("Unauthorized", { status: 401 })
        : json(auth);
    }
    reads++;
    return reads === 1 ? new Response(null, { status: 401 }) : json({
      successful: true,
      inventorySnapshots: [{ itemTypeSKU: "SKU", inventory: 2 }],
    });
  });
  const result = await adapter.run({
    ...uniIntent,
    operation: "inventory",
    payload: { skus: ["SKU"] },
  }, signal());
  assert(
    result.inventory?.[0].available === 2 && reads === 2 && authCount === 3,
  );
});
Deno.test("warehouse HTTP refuses redirects, limits body bytes and redacts malformed responses", async () => {
  await fails(
    () =>
      warehouseHttp(
        "https://example",
        async () => json({ large: "x".repeat(100) }),
      )("/fixed", {}, signal(), 20),
    "PROVIDER_RESPONSE_LIMIT",
  );
  await fails(
    () =>
      warehouseHttp(
        "https://example",
        async () => new Response("secret invalid JSON"),
      )("/fixed", {}, signal()),
    "PROVIDER_RESPONSE_INVALID",
  );
  await fails(
    () =>
      warehouseHttp("https://example", async () => json({}))(
        "//attacker",
        {},
        signal(),
      ),
    "WAREHOUSE_CONTRACT_INVALID",
  );
});
Deno.test("warehouse HTTP total deadline interrupts a stalled body even if cancellation stalls", async () => {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 5);
  try {
    await fails(
      () =>
        warehouseHttp("https://example", async () =>
          new Response(
            new ReadableStream({
              pull() {
                return new Promise(() => {});
              },
              cancel() {
                return new Promise(() => {});
              },
            }),
          ))("/fixed", {}, controller.signal),
      "PROVIDER_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timer);
  }
});
Deno.test("warehouse worker prepares once, finishes typed evidence and skips terminal work", async () => {
  const calls: any[] = [];
  const rpc = async (name: string, args: any) => {
    calls.push({ name, args });
    return name.endsWith("prepare") ? base : { id, state: "done" };
  };
  const r = await warehouseWorker(rpc, {
    dashboard: { run: async () => ({ code: "CONFIRMED", external_id: id }) },
  })(job);
  assert(
    r.state === "done" && calls.length === 2 &&
      calls[1].args.p_result.external_id === id,
  );
  let touched = false;
  const terminal = await warehouseWorker(async () => ({ id, state: "dead" }), {
    dashboard: {
      run: async () => {
        touched = true;
        return { code: "CONFIRMED" };
      },
    },
  })(job);
  assert(terminal.state === "dead" && !touched);
});
Deno.test("warehouse worker never overwrites an uncertain finish with another failure finish", async () => {
  let calls = 0;
  try {
    await warehouseWorker(async () => {
      calls++;
      if (calls === 1) return base;
      throw new Error("lost finish response");
    }, { dashboard: { run: async () => ({ code: "CONFIRMED" }) } })(job);
    throw new Error("accepted");
  } catch (e) {
    assert(
      e instanceof Error && e.message === "lost finish response" && calls === 2,
    );
  }
});
Deno.test("warehouse worker caps provider work by one overall deadline and records only retry code", async () => {
  let result: any;
  const http = warehouseHttp(
    "https://example",
    async () => await new Promise<Response>(() => {}),
  );
  const worker = warehouseWorker(async (name, args) => {
    if (name.endsWith("prepare")) return base;
    result = args.p_result;
    return { id, state: "pending" };
  }, {
    dashboard: {
      run: async (_intent, s) => {
        await http("/fixed", {}, s);
        return { code: "CONFIRMED" };
      },
    },
  }, 5);
  const r = await worker(job);
  assert(
    r.state === "pending" && result.code === "RETRY" &&
      result.error_code === "PROVIDER_UNAVAILABLE",
  );
});
Deno.test("warehouse worker records configured unavailable provider without any outbound call", async () => {
  let result: any;
  await warehouseWorker(async (name, args) => {
    if (name.endsWith("prepare")) return base;
    result = args.p_result;
    return { id, state: "dead" };
  }, {})(job);
  assert(
    result.code === "REJECTED" &&
      result.error_code === "WAREHOUSE_NOT_CONFIGURED",
  );
});
Deno.test("Uniware maximum 2000-piece order proves every line within the bounded response contract", async () => {
  const lines = Array.from(
    { length: 2000 },
    (_, i) => ({ ...saleOrder.saleOrderItems[0], code: "S-" + i + "-1-1" }),
  );
  const payload = { saleOrder: { ...saleOrder, saleOrderItems: lines } };
  const f = uni([
    json({
      successful: true,
      saleOrderDTO: {
        ...dto,
        saleOrderItems: lines.map((x) => ({ ...x, statusCode: "CREATED" })),
      },
    }),
  ]);
  const started = performance.now(),
    result = await f.adapter.run(
      { ...uniIntent, payload, attempted: true },
      signal(),
    );
  assert(
    result.code === "CONFIRMED" &&
      (result.proof?.items as unknown[]).length === 2000,
  );
  console.log(
    JSON.stringify({
      fixture: "uniware_max_2000_pieces",
      provider_requests: f.calls.length,
      local_ms: Math.round((performance.now() - started) * 100) / 100,
      hosted_requests: 0,
    }),
  );
  const over = uni([]);
  await fails(
    () =>
      over.adapter.run({
        ...uniIntent,
        payload: {
          saleOrder: {
            ...saleOrder,
            saleOrderItems: [...lines, { ...lines[0], code: "overflow" }],
          },
        },
      }, signal()),
    "WAREHOUSE_CONTRACT_INVALID",
  );
  assert(!over.calls.length);
});
Deno.test("Dashboard maximum 250-line request remains bounded and rejects the 251st line", async () => {
  const lines = Array.from(
    { length: 250 },
    (_, i) => ({
      item_code: "S-" + i,
      sku_code: "SKU-" + i,
      quantity: 1,
      unit_price: 100,
    }),
  );
  const f = dashboard([
    json(capabilities),
    json(absent, 404),
    json(order, 201),
  ]);
  assert(
    (await f.adapter.run({
      ...base,
      payload: { ...base.payload, items: lines },
    }, signal())).code === "CONFIRMED",
  );
  const over = dashboard([]);
  await fails(
    () =>
      over.adapter.run({
        ...base,
        payload: {
          ...base.payload,
          items: [...lines, { ...lines[0], item_code: "overflow" }],
        },
      }, signal()),
    "WAREHOUSE_CONTRACT_INVALID",
  );
  assert(!over.calls.length);
});
Deno.test("Uniware negative attempt proof covers preflight failures only, never a started write or previous attempt", async () => {
  for (const previous of [false, true]) {
    const f = uni([json({}, 503)]);
    try {
      await f.adapter.run({ ...uniIntent, attempted: previous }, signal());
      throw new Error("accepted");
    } catch (e) {
      assert(
        e instanceof WarehouseError &&
          (previous
            ? e.result().proof === undefined
            : e.result().proof?.mutation_attempted === false),
      );
    }
  }
  const f = uni([json(notFound), json({}, 503)]);
  try {
    await f.adapter.run(uniIntent, signal());
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof WarehouseError && e.result().proof === undefined);
  }
  const authFailure = unicommerceWarehouse(
    uniConfig,
    async () => json({}, 503),
  );
  try {
    await authFailure.run(uniIntent, signal());
    throw new Error("accepted");
  } catch (e) {
    assert(
      e instanceof WarehouseError &&
        e.result().proof?.mutation_attempted === false,
    );
  }
});
