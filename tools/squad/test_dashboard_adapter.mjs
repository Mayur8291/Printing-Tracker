import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";
const root = path.resolve("apps/admin/src");
const calls = [];
let target = { source: "supabase", environment: "staging" },
  session = { user: { id: "staff-a" }, access_token: "session-a" },
  respond;
globalThis.__dashboardTest = {
  target: () => target,
  client: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
  rpc: async (name, args) => {
    calls.push({ name, args });
    return respond(name, args);
  },
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const compiled = await build({
  stdin: {
    contents: `export * from './canto/dashboardService';export * from './canto/dashboardCsv';export {serverSortForColumns} from './scott/list/tableSort';export * from './scott/data/customersService';export * from './scott/reports/reportRequests';export {REPORTS} from './scott/reports/reportsCatalog';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: { "@": root },
  define: { "import.meta.env": "{}" },
  plugins: [
    {
      name: "transport",
      setup(b) {
        b.onResolve({ filter: /(^|\/)target$/ }, () => ({
          path: "target",
          namespace: "stub",
        }));
        b.onResolve({ filter: /supabaseClient$/ }, () => ({
          path: "supabase",
          namespace: "stub",
        }));
        b.onResolve({ filter: /masterConfigs$/ }, () => ({
          path: "masters",
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
          contents:
            path === "target"
              ? `export const getCantoTarget=()=>globalThis.__dashboardTest.target();export const getCantoClient=()=>globalThis.__dashboardTest.client();export const cantoRpc=(...args)=>globalThis.__dashboardTest.rpc(...args);`
              : path === "supabase"
                ? `export const supabase={functions:{invoke:async()=>{throw new Error('SCOTT_PROXY_CALLED')}}};`
                : `export const getMastersService=()=>{throw new Error('LEGACY_MASTERS_CALLED')};`,
          loader: "js",
        }));
      },
    },
  ],
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const response = (
  data = [],
  total = data.length,
  revision = "0:1",
  page = 1,
) => ({
  data,
  totalCount: total,
  totalPages: Math.max(1, Math.ceil(total / 500)),
  page,
  revision,
});
function reset() {
  calls.length = 0;
  storage.clear();
  target = { source: "supabase", environment: "staging" };
  session = { user: { id: "staff-a" }, access_token: "session-a" };
  respond = async () => response();
}
test("all seven reports and every RMP tab route directly to dashboard RPC", async () => {
  reset();
  for (const key of [
    "order_reports",
    "rmp_order_reports",
    "tailor_reports",
    "order_tracking",
    "rmp_sales",
    "total_inventory",
    "customer_performance",
  ])
    for (const tab of key === "rmp_sales"
      ? ["overview", "brand", "class", "coordinator"]
      : [""]) {
      const request = api.buildReportRequest({
        report: { key },
        tab: { key: tab },
        values: {
          period: { mode: "month", year: 2026, month: 10 },
          periodA: { mode: "month", year: 2026, month: 9 },
          periodB: { mode: "month", year: 2026, month: 10 },
        },
      });
      assert.equal(request.serverQuery, true);
      await request.fetchPage();
      assert.equal(calls.at(-1).name, "dashboard");
      assert.equal(calls.at(-1).args.p_args.report, key);
    }
});
test("page continuation carries a revision and never caches another principal", async () => {
  reset();
  respond = async () => response([{ id: "1" }], 2, "7:9");
  const request = api.createDashboardQuery("customers");
  await request.fetchPage({ page: 1 });
  await request.fetchPage({ page: 2 });
  assert.equal(calls.at(-1).args.p_args.query.revision, "7:9");
  session = { user: { id: "staff-b" }, access_token: "session-b" };
  await request.fetchPage({ page: 2 });
  assert.equal(calls.at(-1).args.p_args.query.revision, undefined);
});
test("search, numeric sorting, AND/OR and quick filters reach the server", async () => {
  reset();
  const filters = {
    logic: "or",
    conditions: [{ field: "quantity", operator: "gt", value: 5 }],
  };
  await api.createDashboardQuery("rmp_order_reports").fetchPage({
    search: "shirt",
    filters,
    quickFilters: { order_status: "COMPLETED" },
    sort: { key: "quantity", direction: "desc", numeric: true },
  });
  const query = calls.at(-1).args.p_args.query;
  assert.equal(query.search, "shirt");
  assert.deepEqual(query.filters, filters);
  assert.equal(query.quick.conditions[0].operator, "is_any_of");
  assert.equal(query.sort.numeric, true);
});
test("errors propagate without fallback, and expired sessions make no RPC", async () => {
  reset();
  respond = async () => {
    throw Object.assign(new Error("changed"), { code: "PT409" });
  };
  await assert.rejects(api.createDashboardQuery("customers").fetchPage(), {
    code: "PT409",
  });
  assert.equal(calls.length, 1);
  session = null;
  await assert.rejects(
    api.createDashboardQuery("customers").fetchPage(),
    /expired/,
  );
  assert.equal(calls.length, 1);
});
test("customer saves preserve versions, clears, addresses and retry identity", async () => {
  reset();
  const values = {
    gst: "",
    price_type_id: null,
    addresses: [{ id: "7", city: { name: "Delhi" } }],
  };
  respond = async () => ({ id: "103" });
  await api.updateCustomer({
    id: "103",
    updates: values,
    version: "4:6",
    key: "command",
  });
  assert.deepEqual(calls[0].args.p_args, {
    id: "103",
    values,
    version: "4:6",
    key: "command",
  });
  assert.equal(calls[0].args.p_action, "customer_save");
  await assert.rejects(
    api.updateCustomer({ id: "103", updates: values }),
    /version is missing/,
  );
});
test("by-code validates the environment prefix", async () => {
  reset();
  respond = async () => ({ id: "103", customer_code: "S-103" });
  assert.equal(await api.getCustomerByCode("P-103"), null);
  assert.equal((await api.getCustomerByCode("S-103")).id, "103");
  assert.equal(await api.getCustomerByCode("103"), null);
});
test("interactive drains fail on overflow or missing pages instead of truncating", async () => {
  reset();
  respond = async () => response([], 10001);
  await assert.rejects(
    api.createDashboardQuery("customers").fetchAll(),
    /background export/,
  );
  respond = async () => response([{ id: "1" }], 501);
  await assert.rejects(
    api.createDashboardQuery("customers").fetchAll(),
    /changed during loading/,
  );
});
test("periods keep leap days, arbitrary comparison and quarter boundaries", () => {
  assert.deepEqual(
    api.dashboardPeriod(
      { mode: "quarter", year: 2026, quarter: 4 },
      new Date("2027-01-01T00:00:00Z"),
    ),
    { from: "2026-10-01", before: "2027-01-01" },
  );
  assert.deepEqual(
    api.dashboardPeriod({ mode: "month", year: 2024, month: 2 }),
    { from: "2024-02-01", before: "2024-03-01" },
  );
  assert.throws(() => api.exclusiveDate("2026-02-30"), /Invalid/);
  const f = api.dashboardReportFilters("customer_performance", {
    periodA: { mode: "year", year: 2023 },
    periodB: { mode: "month", year: 2026, month: 7 },
  });
  assert.equal(f.from, "2023-01-01");
  assert.equal(f.before_b, "2026-08-01");
});
test("summaries distinguish unknown and zero and preserve decimal text", () => {
  assert.equal(
    api.dashboardSummary("total_inventory", "", {
      count: 3,
      sums: { inventory: null },
    }).totalUnits,
    null,
  );
  assert.equal(
    api.dashboardSummary("order_reports", "", {
      count: 2,
      sums: { total_amount: "9007199254740993.37" },
    }).totalAmount,
    "9007199254740993.37",
  );
  assert.equal(
    api.dashboardSummary("order_reports", "", { count: 0, sums: {} })
      .totalAmount,
    "0",
  );
});
test("native CSV preserves money, quotes, multiline text and neutralizes spreadsheet formulas", () => {
  const csv = api.buildDashboardCsv(
    [
      { label: "Amount", keys: ["amount"], format: "currency" },
      { label: "Name", keys: ["name"] },
    ],
    [
      { amount: "9007199254740993.37", name: "=SUM(1,2)" },
      { amount: "-2.50", name: 'A "quote"\nsecond line' },
    ],
  );
  assert.match(csv, /9007199254740993\.37/);
  assert.match(csv, /'=SUM/);
  assert.match(csv, /"A ""quote""\nsecond line"/);
  assert.match(csv, /"-2.50"/);
});
test("enum lookup does not reset the list pagination watermark", async () => {
  reset();
  respond = async () => ({
    ...response([], 0, "7:8"),
    options: { status: ["active"] },
  });
  const query = api.createDashboardQuery("customers");
  await query.fetchPage();
  await query.fetchOptions(["status"]);
  await query.fetchPage({ page: 2 });
  assert.equal(calls.at(-1).args.p_args.query.revision, "7:8");
});
test("expired exports discard the persisted job so the next attempt can restart", async () => {
  reset();
  respond = async (name, { p_action }) => {
    if (p_action === "query") return response([], 10001);
    if (p_action === "export_request") return { id: "expired" };
    throw Object.assign(new Error("expired"), { code: "55000" });
  };
  await assert.rejects(api.createDashboardQuery("customers").exportRows(), {
    code: "55000",
  });
  assert.equal(storage.size, 0);
});
test("large CSV is built per batch and retains every row and exact money", async () => {
  reset();
  const size = 10001;
  respond = async (name, { p_action, p_args }) => {
    if (p_action === "query") return response([], size);
    if (p_action === "export_request") return { id: "snapshot" };
    const page = p_args.page ?? 0;
    return {
      state: "completed",
      totalCount: size,
      totalPages: 21,
      data: page
        ? Array.from(
            { length: Math.min(500, size - (page - 1) * 500) },
            (_, i) => ({
              id: String((page - 1) * 500 + i + 1),
              amount: "9007199254740993.37",
            }),
          )
        : [],
    };
  };
  const { blob, count } = await api
    .createDashboardQuery("rmp_order_reports")
    .exportCsv([
      { label: "ID", key: "id" },
      { label: "Amount", key: "amount", format: "currency" },
    ]);
  const csv = await blob.text();
  assert.equal(count, size);
  assert.equal(csv.split("\r\n").length, size + 1);
  assert.match(csv, /"10001","9007199254740993.37"$/);
  assert.equal(storage.size, 0);
});
test("CSV keeps hidden registry export columns instead of dropping them", () => {
  const columns = api.dashboardExportColumns(
    [{ label: "Customer", keys: ["customer_name"] }],
    ["Customer", "Customer Code", "Amount"],
  );
  assert.equal(
    api.buildDashboardCsv(columns, [
      { customer_name: "Example", customer_code: "S-7", total_amount: "1.20" },
    ]),
    '"Customer","Customer Code","Amount"\r\n"Example","S-7","1.20"',
  );
});

const contract = api.REPORTS.flatMap((report) =>
  (report.tabs?.length ? report.tabs : [report]).map((tab) => {
    const values = Object.fromEntries(
      (report.filters ?? []).map((f) => [
        f.key,
        typeof f.default === "function" ? f.default() : f.default,
      ]),
    );
    const columns =
      typeof tab.buildColumns === "function"
        ? tab.buildColumns(values)
        : (tab.columns ?? report.columns);
    const exportBase = tab.export ?? report.export,
      exp = exportBase?.build
        ? { ...exportBase, ...exportBase.build(values) }
        : exportBase;
    return {
      report: report.key,
      tab: tab === report ? "" : tab.key,
      summaryFields: [
        ...((tab.stats ?? report.stats)?.tiles ?? []).map((tile) => tile.key),
        ...(report.key === "rmp_sales" && tab.key === "overview"
          ? ["customerTypeBreakdown"]
          : []),
      ],
      columns: columns.map((c) => ({
        label: c.label,
        key: c.keys?.[0] ?? c.key,
        format: c.format ?? c.type ?? "text",
      })),
      exportColumns: api
        .dashboardExportColumns(columns, exp.headers)
        .map((c) => ({
          label: c.label,
          key: c.keys?.[0] ?? c.key,
          format: c.format ?? c.type ?? "text",
        })),
    };
  }),
);
test("every native report/export column has an explicit field mapping", () => {
  for (const report of contract)
    for (const column of [...report.columns, ...report.exportColumns])
      assert.ok(column.key, `${report.report}: ${column.label}`);
});
if (process.env.DASHBOARD_CONTRACT_PATH)
  fs.writeFileSync(
    process.env.DASHBOARD_CONTRACT_PATH,
    JSON.stringify(contract, null, 2) + "\n",
  );

test("multi-page reads stop when the source or login changes", async () => {
  for (const change of [
    () => {
      target = { source: "legacy", environment: "staging" };
    },
    () => {
      session = { user: { id: "other-admin" }, access_token: "other-session" };
    },
  ]) {
    reset();
    respond = async () => {
      change();
      return response([{ id: "1" }], 501);
    };
    await assert.rejects(
      api.createDashboardQuery("customers").fetchAll(),
      /source or login changed/,
    );
    assert.equal(calls.length, 1);
  }
});
test("a changed login cannot finish a background export download", async () => {
  reset();
  respond = async (_name, { p_action, p_args }) => {
    if (p_action === "query") return response([], 10001);
    if (p_action === "export_request") return { id: "job" };
    if (p_args.page)
      session = { user: { id: "other-admin" }, access_token: "other-session" };
    return {
      state: "completed",
      totalCount: 10001,
      totalPages: 21,
      data: p_args.page ? [{ id: "1" }] : [],
    };
  };
  await assert.rejects(
    api
      .createDashboardQuery("customers")
      .exportCsv([{ key: "id", label: "ID" }]),
    /source or login changed/,
  );
});
test("missing dashboard installation has a clear error and no legacy fallback", async () => {
  reset();
  respond = async () => {
    throw Object.assign(new Error("not found"), { code: "PGRST202" });
  };
  await assert.rejects(
    api.createDashboardQuery("customers").fetchPage(),
    (error) =>
      error.code === "PGRST202" && error.message.includes("not installed"),
  );
  assert.equal(calls.length, 1);
});

test("server sorting uses projected fields for duplicate headers and numeric growth", () => {
  assert.deepEqual(
    api.serverSortForColumns({ key: "order_number__2", direction: "desc" }, [
      {
        key: "order_number__2",
        serverSortKey: "order_number",
        sortType: "string",
      },
    ]),
    { key: "order_number", direction: "desc", numeric: false },
  );
  assert.deepEqual(
    api.serverSortForColumns({ key: "qtyChangePct", direction: "asc" }, [
      { key: "qtyChangePct", sortType: "number" },
    ]),
    { key: "qtyChangePct", direction: "asc", numeric: true },
  );
  assert.equal(api.serverSortForColumns({ key: null }, []), undefined);
});

test("changing period mode ignores dates retained by the picker", () => {
  const retained = {
    startDate: "2025-11-08",
    endDate: "2026-11-08",
    year: 2026,
    month: 10,
  };
  assert.deepEqual(
    api.dashboardPeriod(
      { ...retained, mode: "year" },
      new Date("2027-01-01T00:00:00Z"),
    ),
    {
      from: "2026-01-01",
      before: "2027-01-01",
    },
  );
  assert.deepEqual(api.dashboardPeriod({ ...retained, mode: "month" }), {
    from: "2026-10-01",
    before: "2026-11-01",
  });
  assert.deepEqual(api.dashboardPeriod({ ...retained, mode: "date" }), {
    from: "2025-11-08",
    before: "2026-11-09",
  });
});

test("all visible summary tiles and customer-type cards have native mappings", () => {
  const groups = [
    { type: "Retail", qty: "12", amount: "9007199254740993.37" },
    { type: "Unknown", qty: null, amount: null },
  ];
  for (const descriptor of contract) {
    const summary = api.dashboardSummary(descriptor.report, descriptor.tab, {
      count: 1,
      sums: {},
      customerTypeBreakdown: groups,
    });
    for (const key of descriptor.summaryFields)
      assert(
        Object.hasOwn(summary, key),
        `${descriptor.report}/${descriptor.tab}: ${key}`,
      );
  }
  assert.deepEqual(
    api.dashboardSummary("rmp_sales", "overview", {
      count: 2,
      sums: {},
      customerTypeBreakdown: groups,
    }).customerTypeBreakdown,
    groups,
  );
});

test("current calendar periods stop at the IST day boundary", () => {
  const now = new Date("2026-11-08T18:45:00Z");
  assert.deepEqual(api.dashboardPeriod({ mode: "year", year: 2026 }, now), {
    from: "2026-01-01",
    before: "2026-11-10",
  });
  assert.deepEqual(
    api.dashboardPeriod({ mode: "month", year: 2026, month: 11 }, now),
    { from: "2026-11-01", before: "2026-11-10" },
  );
  assert.deepEqual(
    api.dashboardPeriod({ mode: "quarter", year: 2026, quarter: 4 }, now),
    { from: "2026-10-01", before: "2026-11-10" },
  );
  assert.throws(
    () => api.dashboardPeriod({ mode: "year", year: 2027 }, now),
    /past reporting period/,
  );
});
test("incomplete report dates become inline request errors without an RPC", async () => {
  reset();
  const query = api.buildReportRequest({
    report: { key: "order_tracking" },
    values: { period: { mode: "date", startDate: "", endDate: "2026-11-08" } },
  });
  assert.equal(query.serverQuery, true);
  await assert.rejects(query.fetchPage(), /date range/);
  assert.equal(calls.length, 0);
});

test("simultaneous identical reads share one request without retaining settled data", async () => {
  reset();
  let finish;
  respond = () => new Promise(resolve => { finish = resolve; });
  const a = api.dashboardRpc("query", { report: "customers" });
  const b = api.dashboardRpc("query", { report: "customers" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  finish(response());
  await Promise.all([a, b]);
  respond = async () => response();
  await api.dashboardRpc("query", { report: "customers" });
  assert.equal(calls.length, 2);
});
test("pending reads do not cross login, target, or a customer mutation", async () => {
  reset();
  const finishes = [];
  respond = (name, args) => args.p_action === "query"
    ? new Promise(resolve => finishes.push(resolve)) : response();
  const reads = [api.dashboardRpc("query", { report: "customers" })];
  await new Promise(resolve => setImmediate(resolve));
  session = { user: { id: "staff-b" }, access_token: "session-b" };
  reads.push(api.dashboardRpc("query", { report: "customers" }));
  await new Promise(resolve => setImmediate(resolve));
  target = { source: "supabase", environment: "production" };
  reads.push(api.dashboardRpc("query", { report: "customers" }));
  await new Promise(resolve => setImmediate(resolve));
  await api.dashboardRpc("customer_save", { id: "1" });
  reads.push(api.dashboardRpc("query", { report: "customers" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finishes.length, 4);
  for (const finish of finishes) finish(response());
  await Promise.all(reads);
});
test("a failed shared read can be retried immediately", async () => {
  reset();
  respond = async () => { throw new Error("unavailable"); };
  await Promise.all([
    assert.rejects(api.dashboardRpc("query", { report: "customers" }), /unavailable/),
    assert.rejects(api.dashboardRpc("query", { report: "customers" }), /unavailable/),
  ]);
  assert.equal(calls.length, 1);
  respond = async () => response();
  await api.dashboardRpc("query", { report: "customers" });
  assert.equal(calls.length, 2);
});
