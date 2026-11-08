import { unicommerceWarehouse } from "./warehouse-unicommerce.ts";
import {
  equal,
  WarehouseError,
  type WarehouseIntent,
} from "./warehouse-types.ts";
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
const id = "00000000-0000-4000-8000-000000000001";
const intent: WarehouseIntent = {
  state: "prepared",
  provider: "unicommerce",
  operation: "inventory",
  intent_id: id,
  request_key: "warehouse_" + id,
  project_ref: config.projectRef,
  environment: "staging",
  facility_code: "ONE",
  payload: { skus: ["Sku A", "SKU B"] },
  attempted: false,
};
function fixture(rows: unknown[]) {
  const calls: { url: string; body: unknown }[] = [];
  const adapter = unicommerceWarehouse(config, async (url, init) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(
      JSON.stringify(
        new URL(String(url)).pathname === "/oauth/token"
          ? {
            access_token: "fixture_access",
            refresh_token: "fixture_refresh",
            expires_in: 3600,
          }
          : { successful: true, inventorySnapshots: rows },
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
async function rejects(f: () => Promise<unknown>, code: string) {
  try {
    await f();
  } catch (e) {
    assert(e instanceof WarehouseError && e.error_code === code);
    return;
  }
  throw new Error("unexpectedly accepted ambiguous inventory");
}
Deno.test("Uniware case-insensitive inventory preserves canonical requested SKU and quantity", async () => {
  const f = fixture([{ itemTypeSKU: "sku a", inventory: 3.25 }, {
    itemTypeSKU: "sku b",
    inventory: 0,
  }]);
  const r = await f.run();
  assert(
    equal(r.inventory, [{ sku_code: "Sku A", known: true, available: 3.25 }, {
      sku_code: "SKU B",
      known: true,
      available: 0,
    }]),
  );
  assert(equal(f.calls[1].body, { itemTypeSKUs: ["Sku A", "SKU B"] }));
});
Deno.test("Uniware omitted case-mapped inventory remains unknown", async () => {
  const r = await fixture([{ itemTypeSKU: "SKU A", inventory: 4 }]).run();
  assert(
    equal(r.inventory, [{ sku_code: "Sku A", known: true, available: 4 }, {
      sku_code: "SKU B",
      known: false,
      available: null,
    }]),
  );
});
Deno.test("Uniware ambiguous requested case aliases fail before provider HTTP", async () => {
  const f = fixture([]);
  await rejects(
    () => f.run({ ...intent, payload: { skus: ["Sku A", "SKU A"] } }),
    "WAREHOUSE_CONTRACT_INVALID",
  );
  assert(f.calls.length === 0);
});
Deno.test("Uniware duplicate provider aliases cannot overwrite stock", async () => {
  await rejects(
    () =>
      fixture([{ itemTypeSKU: "sku a", inventory: 1 }, {
        itemTypeSKU: "SKU A",
        inventory: 99,
      }]).run(),
    "PROVIDER_RESPONSE_INVALID",
  );
});
Deno.test("Uniware unrequested SKU and malformed identity remain rejected", async () => {
  for (const code of ["unknown", null, 12, " Sku A"]) {
    await rejects(
      () => fixture([{ itemTypeSKU: code, inventory: 1 }]).run(),
      "PROVIDER_RESPONSE_INVALID",
    );
  }
});
