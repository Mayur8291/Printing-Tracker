import { warehouseReadCheck } from "./warehouse-check.ts";
import { warehouseAdapters } from "./warehouse.ts";
import { createHandler } from "./handler.ts";
const assert = (x: unknown) => { if (!x) throw new Error("assertion failed"); };
const values: Record<string, string> = {
  SUPABASE_URL: "https://scvojtvgnkmbupvyslmb.supabase.co",
  SQUAD_WAREHOUSE_ENVIRONMENT: "staging",
  SQUAD_UNIWARE_ENVIRONMENT: "staging",
  SQUAD_UNIWARE_CONFIG_SOURCE: "legacy_bridge",
  SQUAD_WAREHOUSE_READ_CHECK_ENABLED: "true",
  UNIWARE_BASE_URL: "https://existing-tenant.unicommerce.com/",
  UNIWARE_USERNAME: "fixture_user", UNIWARE_PASSWORD: "fixture_password",
  UNIWARE_FACILITY: "legacy_one_day",
};
function fixture(overrides: Record<string, string | undefined> = {}, fail = false) {
  const calls: string[] = [], env = { ...values, ...overrides };
  const check = warehouseReadCheck(k => env[k], async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert(url.hostname === "existing-tenant.unicommerce.com");
    if (url.pathname === "/oauth/token") {
      assert(new Headers(init?.headers).get("username") === "fixture_user");
      assert(!url.searchParams.has("password"));
      return new Response(JSON.stringify({ access_token: "fixture_token", expires_in: 3600 }));
    }
    assert(url.pathname === "/services/rest/v1/inventory/inventorySnapshot/get");
    assert(init?.method === "POST");
    if (fail) return new Response("provider details must not leak", { status: 429 });
    const body = JSON.parse(String(init?.body));
    assert(body.itemTypeSKUs.join() === "SKU-1,SKU-2");
    return new Response(JSON.stringify({ successful: true, inventorySnapshots: [{ itemTypeSKU: "SKU-1", inventory: 3 }] }));
  });
  return { check, calls, env };
}
Deno.test("existing Uniware secrets can verify inventory with worker and business writes disabled", async () => {
  const f = fixture(), result = await f.check(["SKU-1", "SKU-2"]);
  assert(result.state === "verified" && result.writes === 0);
  assert(result.facilities?.[0].known_skus === 1 && f.calls.length === 2);
  const text = JSON.stringify(result);
  for (const secret of ["fixture_user", "fixture_password", "fixture_token", "available", "existing-tenant"]) assert(!text.includes(secret));
  assert(!Object.keys(warehouseAdapters(k => f.env[k])).length);
});
Deno.test("Uniware probe checks each configured legacy facility with one cached token", async () => {
  const f = fixture({ SQUAD_WAREHOUSE_FACILITIES: "one_day,three_day" });
  const result = await f.check(["SKU-1", "SKU-2"]);
  assert(result.state === "verified" && result.facilities?.length === 2);
  assert(f.calls.filter(x => x === "/oauth/token").length === 1);
});
Deno.test("Uniware probe reports provider failure without raw body or secret disclosure", async () => {
  const f = fixture({}, true), result = await f.check(["SKU-1", "SKU-2"]);
  assert(result.state === "unconfirmed" && result.writes === 0);
  assert(!JSON.stringify(result).includes("provider details"));
  assert(result.requests?.[1].status === 429);
});
Deno.test("probe transport diagnostics use fixed categories and never return provider error text", async () => {
  const check = warehouseReadCheck(k => values[k], () => { throw new Error("dns error: sensitive-provider-host private-key"); });
  const result = await check(["SKU"]);
  assert(result.requests?.[0].stage === "authentication" && result.requests[0].failure === "dns");
  assert(!JSON.stringify(result).includes("sensitive-provider-host") && !JSON.stringify(result).includes("private-key"));
});
Deno.test("explicit legacy auth matches Rails query grant without leaking it into health evidence", async () => {
  let calls = 0;
  const config = { ...values, SQUAD_UNIWARE_AUTH_STYLE: "legacy_query" };
  const check = warehouseReadCheck(k => config[k as keyof typeof config], async (input, init) => {
    const url = new URL(String(input)); calls++;
    assert(init?.redirect === "error");
    if (url.pathname === "/oauth/token") {
      assert(url.searchParams.get("username") === "fixture_user" && url.searchParams.get("password") === "fixture_password");
      assert(!new Headers(init?.headers).has("password") && (init?.method ?? "GET") === "GET");
      return new Response(JSON.stringify({ access_token: "fixture_token", expires_in: 3600 }));
    }
    assert(url.pathname === "/services/rest/v1/inventory/inventorySnapshot/get");
    return new Response(JSON.stringify({ successful: true, inventorySnapshots: [] }));
  });
  const result = await check(["SKU"]);
  assert(result.state === "verified" && calls === 2);
  assert(!JSON.stringify(result).includes("fixture_password") && !JSON.stringify(result).includes("fixture_user"));
});
Deno.test("optional order probe only reads the fixed path and reports custom-field shape without customer data", async () => {
  const calls:string[]=[];
  const check=warehouseReadCheck(k=>values[k],async(input,init)=>{
    const path=new URL(String(input)).pathname;calls.push(path);
    let body:unknown;
    if(path==='/oauth/token')body={access_token:'fixture_token',expires_in:3600};
    else if(path.endsWith('/inventorySnapshot/get'))body={successful:true,inventorySnapshots:[]};
    else{
      assert(path==='/services/rest/v1/oms/saleorder/get');
      assert(JSON.parse(String(init?.body)).code==='S-100');
      body={successful:true,saleOrderDTO:{code:'S-100',status:'CREATED',customFieldValues:[{name:'Customer_Details',value:'private_customer'},{name:'PICKUPDATE',value:'private_date'},{name:'Comment',value:'private_comment'}],saleOrderItems:[{code:'S-100-1',itemSku:'SKU',facilityCode:'legacy_one_day',statusCode:'CREATED',totalPrice:10,sellingPrice:10,customFieldValues:[{name:'Comment',value:'private_piece'}]}]}};
    }
    return new Response(JSON.stringify(body));
  });
  const result=await check(['SKU'],'S-100');
  assert(result.state==='verified'&&result.order_read?.code==='OBSERVED');
  const shape=result.order_read?.shape as Record<string,unknown>;
  assert(shape.order_custom_fields_present===true&&shape.items_with_comment_field===1);
  assert(!JSON.stringify(result).includes('private_')&&!JSON.stringify(result).includes('S-100'));
  assert(calls.length===3&&result.requests?.[2].stage==='order_read');
});
Deno.test("Uniware probe enforces project and deployment bindings before HTTP", async () => {
  for (const env of [
    { SQUAD_WAREHOUSE_READ_CHECK_ENABLED: "false" },
    { SUPABASE_URL: "https://unknown.supabase.co" },
    { SQUAD_WAREHOUSE_ENVIRONMENT: "production" },
    { SQUAD_UNIWARE_ENVIRONMENT: "production" },
    { SQUAD_UNIWARE_CONFIG_SOURCE: "unknown" },
    { UNIWARE_PASSWORD: "" }, { UNIWARE_FACILITY: "" },
    { SQUAD_WAREHOUSE_FACILITIES: "one,one" },
  ]) {
    const f = fixture(env), result = await f.check(["SKU-1", "SKU-2"]);
    assert(result.state === "not_configured" && !f.calls.length);
  }
});
Deno.test("legacy tenant URLs cannot redirect credentials outside the fixed vendor host", async () => {
  for (const base of ["http://existing-tenant.unicommerce.com", "https://existing-tenant.unicommerce.com.evil.invalid", "https://existing-tenant.unicommerce.com/path", "https://user@existing-tenant.unicommerce.com", "https://existing-tenant.unicommerce.com:444", "https://existing-tenant.unicommerce.com?x=1"]) {
    const f = fixture({ UNIWARE_BASE_URL: base });
    assert((await f.check(["SKU-1", "SKU-2"])).state === "not_configured");
    assert(!f.calls.length);
  }
});
Deno.test("inventory check rejects oversized duplicate or invalid SKUs before HTTP", async () => {
  for (const skus of [[], ["SKU", "SKU"], ["a,b"], ["\n"], ["x".repeat(201)], ["1", "2", "3", "4", "5", "6"]]) {
    const f = fixture(); let rejected = false;
    try { await f.check(skus); } catch { rejected = true; }
    assert(rejected && !f.calls.length);
  }
});
Deno.test("warehouse-check route authenticates first and cannot trigger queue maintenance or RPCs", async () => {
  const secret = "test-only-worker-secret-1234567890123456";
  let checks = 0;
  const h = createHandler(secret, () => { throw new Error("unexpected RPC"); }, undefined, undefined, undefined, undefined, undefined, undefined, {
    heartbeat: () => { throw new Error("unexpected heartbeat"); },
    warehouseCheck: async skus => { checks++; assert(skus.join() === "SKU"); return { state: "verified", writes: 0 }; },
  });
  const request = (body: unknown, token = secret) => new Request("https://example.invalid/functions/v1/squad-jobs/warehouse-check", { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  assert((await h(request({ skus: ["SKU"] }, "wrong"))).status === 401 && !checks);
  for (const body of [{ skus: ["SKU"], operation: "submit" }, { skus: ["SKU"], facility: "arbitrary" }, { skus: ["SKU"], order_code:"../secret" }, { skus: ["SKU"], order_code:3 }, { skus: [] }, { skus: [1] }, { skus: ["SKU", "SKU"] }, { skus: ["x".repeat(5000)] }]) assert((await h(request(body))).status === 400 && !checks);
  assert((await h(request({ skus: ["SKU"] }))).status === 200 && Number(checks) === 1);
});
