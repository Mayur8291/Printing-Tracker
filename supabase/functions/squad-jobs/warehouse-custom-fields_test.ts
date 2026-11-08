import { unicommerceWarehouse } from "./warehouse-unicommerce.ts";
import { uniwarePayload } from "./warehouse-payload.ts";
import { WarehouseError, type WarehouseIntent } from "./warehouse-types.ts";
const id = "00000000-0000-4000-8000-000000000001";
const config = {
  projectRef: "scvojtvgnkmbupvyslmb",
  environment: "staging" as const,
  enabled: true,
  writesEnabled: true,
  facilities: ["ONE"],
  tenant: "isolated-test",
  username: "fixture_user",
  password: "fixture_password",
  clientId: "my-trusted-client",
  boundEnvironment: "staging" as const,
};
const address = {
  id: "1",
  name: "Customer",
  addressLine1: "One street",
  city: "City",
  state: "KA",
  country: "IN",
  pincode: "560001",
  phone: "9000000000",
  email: "fixture@example.invalid",
};
const saleOrder = {
  code: "S-1",
  displayOrderCode: "S-1",
  customerCode: "S-2",
  customerName: "Customer",
  channel: "Custom",
  cashOnDelivery: true,
  paymentInstrument: "CASH",
  addresses: [address],
  billingAddress: { referenceId: "1" },
  shippingAddress: { referenceId: "1" },
  totalCashOnDeliveryCharges: 0,
  customFieldValues: [{ name: "Customer_Details", value: "Company" }, {
    name: "PICKUPDATE",
    value: "03/12/26",
  }, { name: "Comment", value: "First, second" }],
  saleOrderItems: [{
    code: "S-1-1-1",
    itemSku: "SKU",
    shippingMethodCode: "STD",
    giftWrap: false,
    facilityCode: "ONE",
    totalPrice: 105,
    sellingPrice: 105,
    prepaidAmount: 0,
    discount: 0,
    shippingCharges: 0,
    customFieldValues: [{ name: "Comment", value: " : First" }],
  }],
};
const intent: WarehouseIntent = {
  state: "prepared",
  provider: "unicommerce",
  operation: "submit",
  intent_id: id,
  request_key: "warehouse_" + id,
  project_ref: config.projectRef,
  environment: "staging",
  facility_code: "ONE",
  order_code: "S-1",
  payload: { saleOrder },
  attempted: false,
};
function dto() {
  return {
    ...structuredClone(saleOrder),
    cod: true,
    status: "CREATED",
    updated: 1794132000000,
    saleOrderItems: saleOrder.saleOrderItems.map((x) => ({
      ...structuredClone(x),
      statusCode: "CREATED",
    })),
  };
}
function fixture(body: unknown, create = false) {
  const calls: { path: string; body: unknown }[] = [];
  let reads = 0;
  const adapter = unicommerceWarehouse(config, async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(
      JSON.stringify(
        path === "/oauth/token"
          ? {
            access_token: "fixture_access",
            refresh_token: "fixture_refresh",
            expires_in: 3600,
          }
          : path.endsWith("/saleorder/get")
          ? (create && reads++ === 0
            ? { successful: false, errors: [{ code: 40005 }] }
            : { successful: true, saleOrderDTO: body })
          : { successful: true },
      ),
    );
  });
  return {
    calls,
    run: (i = intent) => adapter.run(i, new AbortController().signal),
  };
}
function assert(v: unknown) {
  if (!v) throw new Error("assertion failed");
}
async function rejects(work: () => unknown | Promise<unknown>, code: string) {
  try {
    await work();
  } catch (e) {
    assert(e instanceof WarehouseError && e.error_code === code);
    return;
  }
  throw new Error("accepted invalid metadata");
}
Deno.test("Uniware matching order and piece metadata adopts without writing", async () => {
  const f = fixture(dto());
  const r = await f.run();
  assert(r.code === "CONFIRMED" && f.calls.length === 2);
  assert(f.calls.every((x) => !x.path.endsWith("/saleOrder/create")));
});
Deno.test("Uniware metadata subset permits provider extras and reordered expected names", async () => {
  const d = dto();
  d.customFieldValues.reverse();
  d.customFieldValues.push({ name: "ProviderInternal", value: "extra" });
  d.saleOrderItems[0].customFieldValues.push({
    name: "Extra",
    value: "provider",
  });
  assert((await fixture(d).run()).code === "CONFIRMED");
});
Deno.test("Uniware adoption rejects differing customer details pickup date and aggregate comment", async () => {
  for (let index = 0; index < 3; index++) {
    const d = dto();
    d.customFieldValues[index].value = "different";
    const f = fixture(d);
    await rejects(() => f.run(), "PROVIDER_CUSTOM_FIELDS_MISMATCH");
    assert(f.calls.length === 2);
  }
});
Deno.test("Uniware adoption rejects differing piece comment", async () => {
  const d = dto();
  d.saleOrderItems[0].customFieldValues[0].value = " : wrong";
  await rejects(() => fixture(d).run(), "PROVIDER_CUSTOM_FIELDS_MISMATCH");
});
Deno.test("Uniware adoption requires every expected field exactly once", async () => {
  for (const kind of ["absent", "missing", "duplicate", "null"]) {
    const d: any = dto();
    if (kind === "absent") delete d.customFieldValues;
    else if (kind === "missing") d.customFieldValues.pop();
    else if (kind === "duplicate") {
      d.customFieldValues.push({ ...d.customFieldValues[0] });
    } else d.customFieldValues[0].value = null;
    await rejects(
      () => fixture(d).run(),
      kind === "absent" || kind === "missing"
        ? "PROVIDER_CUSTOM_FIELDS_MISSING"
        : "PROVIDER_CUSTOM_FIELDS_MISMATCH",
    );
  }
  const d: any = dto();
  delete d.saleOrderItems[0].customFieldValues;
  await rejects(() => fixture(d).run(), "PROVIDER_CUSTOM_FIELDS_MISSING");
});
Deno.test("Uniware create verifies persisted metadata after one mutation and never fabricates success", async () => {
  const good = fixture(dto(), true);
  assert((await good.run()).code === "CONFIRMED");
  assert(
    good.calls.filter((x) => x.path.endsWith("/saleOrder/create")).length === 1,
  );
  const d = dto();
  d.customFieldValues[2].value = "lost comments";
  const bad = fixture(d, true);
  await rejects(() => bad.run(), "PROVIDER_CUSTOM_FIELDS_MISMATCH");
  assert(
    bad.calls.filter((x) => x.path.endsWith("/saleOrder/create")).length === 1,
  );
});
Deno.test("Uniware aggregate accepts actual50-line command bound with Unicode codepoint semantics", () => {
  const p = structuredClone(saleOrder);
  p.customFieldValues[2].value = Array(50).fill("x".repeat(4000)).join(", ");
  assert(p.customFieldValues[2].value.length === 200098);
  uniwarePayload(p);
  p.customFieldValues[2].value = "😀".repeat(200098);
  uniwarePayload(p);
  p.saleOrderItems[0].customFieldValues[0].value = "😀".repeat(350);
  uniwarePayload(p);
});
Deno.test("Uniware aggregate and piece overflow fail without silent truncation", async () => {
  const p = structuredClone(saleOrder);
  p.customFieldValues[2].value = "😀".repeat(200099);
  await rejects(() => uniwarePayload(p), "WAREHOUSE_CONTRACT_INVALID");
  p.customFieldValues[2].value = "valid";
  p.saleOrderItems[0].customFieldValues[0].value = "😀".repeat(351);
  await rejects(() => uniwarePayload(p), "WAREHOUSE_CONTRACT_INVALID");
});
Deno.test("Uniware overall2MiB bound still applies to individually valid piece comments", async () => {
  const p = structuredClone(saleOrder);
  p.saleOrderItems = Array.from(
    { length: 2000 },
    (_, i) => ({
      ...structuredClone(saleOrder.saleOrderItems[0]),
      code: "S-piece-" + i,
      customFieldValues: [{ name: "Comment", value: "😀".repeat(350) }],
    }),
  );
  const f = fixture({});
  await rejects(
    () => f.run({ ...intent, payload: { saleOrder: p } }),
    "WAREHOUSE_LIMIT",
  );
  assert(f.calls.length === 0);
});
