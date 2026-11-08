import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
assert.equal(config.url, "https://scvojtvgnkmbupvyslmb.supabase.co");
const clients = {},
  sessions = {},
  checks = [],
  timings = [],
  commandTimings = [];
const recordCheck = (message) => {
  checks.push(message);
  console.error(JSON.stringify({ check: message }));
};
const rpc = async (client, action, args = {}) => {
  const started = performance.now();
  const r = await client
    .schema("canto_api")
    .rpc("dashboard", { p_action: action, p_args: args });
  if (r.error) throw Object.assign(new Error(r.error.message), r.error);
  if (["customer_save", "customer_archive"].includes(action))
    commandTimings.push({
      action,
      ms: Math.round(performance.now() - started),
    });
  return r.data;
};
for (const actor of config.actors) {
  const c = createClient(config.url, config.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await c.auth.signInWithPassword({
    email: actor.email,
    password: actor.password,
  });
  assert.ifError(r.error);
  clients[actor.role] = c;
  sessions[actor.role] = r.data.session;
}
for (const role of ["staff", "squad"])
  await assert.rejects(rpc(clients[role], "capabilities"));
await assert.rejects(
  rpc(createClient(config.url, config.anon), "capabilities"),
);
recordCheck("real GoTrue admin, staff, Squad and anonymous authorization");
assert.equal(
  (await rpc(clients.admin, "capabilities")).atomicCustomerSave,
  true,
);
const reportCases = [
  ["customers", ""],
  ["order_reports", ""],
  ["rmp_order_reports", ""],
  ["tailor_reports", ""],
  ["order_tracking", ""],
  ["rmp_sales", "overview"],
  ["rmp_sales", "brand"],
  ["rmp_sales", "class"],
  ["rmp_sales", "coordinator"],
  ["customer_performance", ""],
  ["total_inventory", ""],
];
const filtersFor = (report) =>
  [
    "customers",
    "order_reports",
    "rmp_order_reports",
    "tailor_reports",
  ].includes(report)
    ? {}
    : {
        from: "2026-01-01",
        before: "2026-11-09",
        from_b: "2025-01-01",
        before_b: "2025-11-09",
      };
if (config.rpcProbe) {
  const results = [];
  for (let round = 0; round < 3; round++) {
    for (const report of ["rmp_order_reports", "customer_performance"]) {
      const started = performance.now();
      try {
        const data = await rpc(clients.admin, "query", {
          report,
          filters: filtersFor(report),
          query: {
            page: 1,
            items: 500,
            search: "impossible-dashboard-fixture-search",
            quick: { logic: "and", conditions: [] },
            option_fields: [],
          },
        });
        results.push({
          report,
          round,
          ms: Math.round(performance.now() - started),
          count: data.totalCount,
        });
      } catch (error) {
        results.push({
          report,
          round,
          ms: Math.round(performance.now() - started),
          error: error.message,
          code: error.code,
        });
      }
      console.error(JSON.stringify(results.at(-1)));
    }
  }
  for (const client of Object.values(clients)) await client.auth.signOut();
  console.log(JSON.stringify({ checks, results, probeOnly: true }));
  process.exit(0);
}
// Deployed verification uses 55 warm requests; retain all samples so a single
// network fluctuation cannot dominate the percentile of a 22-request smoke run.
for (let round = 0; round < (config.uiUrl ? 6 : 3); round++)
  for (const [report, tab] of reportCases) {
    const t = performance.now();
    const r = await rpc(clients.admin, "query", {
      report,
      tab,
      filters: filtersFor(report),
      query: { items: 20 },
    });
    const ms = performance.now() - t;
    timings.push({ report, tab, round, ms: Math.round(ms) });
    assert(r.data.length <= 20);
    assert.equal(r.totalCount, r.summary.count);
    if (report === "rmp_sales" && tab === "overview")
      assert(Array.isArray(r.summary.customerTypeBreakdown));
  }
const warm = timings
  .filter((x) => x.round > 0)
  .map((x) => x.ms)
  .sort((a, b) => a - b);
const p95 = warm[Math.ceil(warm.length * 0.95) - 1];
recordCheck("all report HTTP contracts");
console.error(JSON.stringify({ stage: "http", p95, timings }));
await Promise.all(
  Array.from({ length: 4 }, () =>
    rpc(clients.admin, "query", { report: "customers", query: { items: 20 } }),
  ),
);
recordCheck("four simultaneous authenticated queries");
const browser = await puppeteer.launch({
  headless: true,
  args: ["--enable-precise-memory-info"],
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
let blocked = [],
  errors = [],
  requests = [],
  screens = [],
  failedResponses = [],
  page,
  failNextQuery = false,
  stage = "initial";
const expectedFailures = new WeakSet();
const requestStarts = new WeakMap();
try {
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    requestStarts.set(r, performance.now());
    const u = r.url();
    if (
      failNextQuery &&
      u.includes("/rpc/dashboard") &&
      JSON.parse(r.postData() || "{}").p_action === "query" &&
      JSON.parse(r.postData() || "{}").p_args?.query?.page === 1
    ) {
      expectedFailures.add(r);
      r.respond({
        status: 503,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          message: "Acceptance injected unavailable",
          code: "503",
        }),
      });
      return;
    }
    if (
      new URL(u).hostname === "leaderboard.sagarfab.com" ||
      u.includes("levwrmvqdntngeasrtnb") ||
      u.includes("/functions/v1/scott-dashboard-masters") ||
      /^https?:\/\/(64\.227\.|139\.59\.|.*scottone)/i.test(u)
    ) {
      blocked.push(u.split("?")[0]);
      r.abort();
    } else {
      if (u.includes("/rpc/dashboard")) requests.push(r.postData());
      r.continue();
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (
      r.url().includes("/rpc/dashboard") &&
      r.status() >= 400 &&
      !expectedFailures.has(r.request())
    )
      failedResponses.push({
        status: r.status(),
        ms: Math.round(performance.now() - requestStarts.get(r.request())),
        request: JSON.parse(r.request().postData() || "{}"),
      });
  });
  await page.evaluateOnNewDocument(
    ({ session }) => {
      localStorage.setItem(
        "sb-scvojtvgnkmbupvyslmb-auth-token",
        JSON.stringify(session),
      );
      localStorage.setItem("scott-dashboard-env-override", "staging");
      localStorage.setItem(
        "canto:admin-target:v1",
        JSON.stringify({ source: "supabase", environment: "production" }),
      );
      if (!sessionStorage.getItem("printing-tracker-dashboard-tab"))
        sessionStorage.setItem(
          "printing-tracker-dashboard-tab",
          "scott_customers",
        );
    },
    { session: sessions.admin },
  );
  await page.goto(config.uiUrl || "http://127.0.0.1:5173", {
    waitUntil: "networkidle2",
  });
  const loaded = () =>
    page.waitForFunction(
      () =>
        document.querySelectorAll("tbody tr").length > 0 &&
        !document.querySelector("tbody .animate-pulse"),
      { timeout: 45000 },
    );
  await loaded();
  assert(
    await page.evaluate(() => document.body.innerText.includes("Customers")),
  );
  recordCheck(
    "Customers renders with shared session and stale target resolves staging",
  );
  const clickText = async (text, scope = "button") => {
    await page.waitForFunction(
      (text, scope) =>
        [...document.querySelectorAll(scope)].some((element) => {
          const copy = element.cloneNode(true);
          copy
            .querySelectorAll('[aria-hidden="true"]')
            .forEach((node) => node.remove());
          return copy.textContent.trim() === text;
        }),
      {},
      text,
      scope,
    );
    await page.evaluate(
      (text, scope) =>
        [...document.querySelectorAll(scope)]
          .find((element) => {
            const copy = element.cloneNode(true);
            copy
              .querySelectorAll('[aria-hidden="true"]')
              .forEach((node) => node.remove());
            return copy.textContent.trim() === text;
          })
          .click(),
      text,
      scope,
    );
  };
  const create = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => /^(Add|New|Create)/.test(b.innerText))
      .map((b) => b.innerText),
  );
  assert(create.length, "No customer create affordance");
  await clickText(create[0]);
  await page.waitForSelector("#scott-customer-company_name");
  for (const [key, value] of Object.entries({
    company_name: config.label + " Browser",
    contact_person: "Dashboard Acceptance",
    email: config.label.toLowerCase() + "-customer@example.invalid",
    phone: "9876543210",
    city_name: "Pune",
    postal_code: "411001",
    address: "Acceptance fixture road",
  }))
    await page.type("#scott-customer-" + key, value);
  await page.click("#scott-customer-state_name");
  await clickText("Maharashtra", '[role="option"]');
  await page.waitForSelector('[role="option"]', { hidden: true });
  const validity = await page.$$eval(
    "[role=dialog] input, [role=dialog] textarea, [role=dialog] select",
    (els) =>
      els.map((e) => ({
        id: e.id,
        value: e.value,
        disabled: e.disabled,
        valid: e.validity.valid,
        message: e.validationMessage,
      })),
  );
  assert(
    validity.every((e) => e.valid),
    JSON.stringify(validity),
  );
  const submit = await page.$('[role="dialog"] button[type="submit"]');
  assert(submit);
  await submit.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await submit.click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
    timeout: 30000,
  });
  await loaded();
  const own = await rpc(clients.admin, "query", {
    report: "customers",
    query: { search: config.label, items: 20 },
  });
  assert.equal(own.totalCount, 1);
  let customer = own.data[0];
  assert.equal(customer.addresses.length, 1);
  assert.equal(customer.account_sync.state, "pending");
  recordCheck(
    "browser customer create, address persistence and pending account work",
  );
  // The same real service used by the form: atomic multi-address edit and stable retry.
  let values = {
    company_name: config.label + " Updated",
    addresses: [
      ...customer.addresses,
      {
        address: "Secondary road",
        city: { name: "Pune" },
        state: { name: "Maharashtra" },
        postal_code: "411002",
        is_primary: false,
      },
    ],
  };
  const key = crypto.randomUUID();
  const before = customer.version;
  customer = await rpc(clients.admin, "customer_save", {
    id: customer.id,
    version: before,
    values,
    key,
  });
  assert.equal(customer.addresses.length, 2);
  assert.deepEqual(
    await rpc(clients.admin, "customer_save", {
      id: customer.id,
      version: before,
      values,
      key,
    }),
    customer,
  );
  await assert.rejects(
    rpc(clients.admin, "customer_save", {
      id: customer.id,
      version: before,
      values: { company_name: "stale" },
      key: crypto.randomUUID(),
    }),
    (e) => e.code === "PT409",
  );
  recordCheck(
    "hosted atomic edit, two addresses, idempotent retry and stale conflict",
  );
  const fill = async (selector, value) => {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(selector, value);
  };
  const search = async (value, id = "customers-search") => {
    const response = page.waitForResponse(
      (r) => {
        if (!r.url().includes("/rpc/dashboard")) return false;
        const body = JSON.parse(r.request().postData() || "{}");
        return (
          body.p_action === "query" && body.p_args?.query?.search === value
        );
      },
      { timeout: 45000 },
    );
    response.catch(() => {}); // Preserve a selector failure instead of a late unhandled timeout.
    await fill(`[id="${id}"]`, value);
    await response;
    await loaded();
  };
  await search(config.label);
  await page.waitForFunction(
    (label) => document.querySelector("tbody")?.innerText.includes(label),
    {},
    config.label,
  );
  await clickText("Edit", "tbody button");
  await page.waitForSelector("#scott-customer-company_name");
  await fill("#scott-customer-company_name", config.label + " UI edited");
  await page.click("#scott-customer-status");
  await clickText("Inactive", '[role="option"]');
  await page.waitForSelector('[role="option"]', { hidden: true });
  await page.$eval('[role="dialog"] button[type="submit"]', (e) =>
    e.scrollIntoView({ block: "center" }),
  );
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForSelector('[role="dialog"]', {
    hidden: true,
    timeout: 30000,
  });
  await loaded();
  customer = (
    await rpc(clients.admin, "query", {
      report: "customers",
      query: { search: config.label, items: 20 },
    })
  ).data[0];
  assert.equal(customer.company_name, config.label + " UI edited");
  assert.equal(customer.status, "inactive");
  assert.equal(customer.addresses.length, 2);
  recordCheck(
    "browser search, edit and status change preserve secondary address",
  );
  if (config.uiUrl) {
    await page.evaluate(() => {
      window.dashboardDownload = null;
      const original = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        window.dashboardDownload = blob;
        return original.call(this, blob);
      };
    });
    await clickText("Export");
    await page.waitForFunction(() => window.dashboardDownload instanceof Blob);
    const csv = await page.evaluate(() => window.dashboardDownload.text());
    assert(csv.includes(config.label + " UI edited"));
    recordCheck("deployed customer CSV contains the edited fixture row");
  }
  for (const [report, tab] of reportCases.filter((x) => x[0] !== "customers")) {
    await page.evaluate(
      ({ report, tab }) => {
        sessionStorage.setItem(
          "printing-tracker-dashboard-tab",
          "scott_reports",
        );
        localStorage.setItem("scott.reports.selectedReport", report);
        if (tab)
          localStorage.setItem("scott.reports.selectedTab." + report, tab);
      },
      { report, tab },
    );
    stage = `${report}/${tab}: load`;
    await page.reload({ waitUntil: "networkidle2" });
    await loaded();
    assert(
      !(await page.evaluate(() =>
        document.body.innerText.includes("Could not load"),
      )),
    );
    if (report === "rmp_sales" && tab === "overview")
      assert(
        await page.evaluate(() =>
          document.body.innerText.includes("Customer Type Sales"),
        ),
      );
    if (report === "order_tracking") {
      stage = "order_tracking: report type";
      const queryResponse = (predicate) => {
        const pending = page.waitForResponse(
          (r) => {
            if (!r.url().includes("/rpc/dashboard")) return false;
            const body = JSON.parse(r.request().postData() || "{}");
            return body.p_action === "query" && predicate(body.p_args);
          },
          { timeout: 45000 },
        );
        pending.catch(() => {});
        return pending;
      };
      let response = queryResponse(
        (args) => args.filters?.domain?.status === "all",
      );
      await page.click("#order_tracking-main-reportType");
      await clickText("All", '[role="option"]');
      await page.waitForSelector('[role="option"]', { hidden: true });
      assert.equal((await response).status(), 200);
      await loaded();
      stage = "order_tracking: year period";
      response = queryResponse(
        (args) =>
          args.filters?.from === "2026-01-01" &&
          args.filters?.before ===
            new Date(Date.now() + 330 * 60 * 1000 + 86400000)
              .toISOString()
              .slice(0, 10),
      );
      await page.click("#order_tracking-main-period-mode");
      await clickText("Year", '[role="option"]');
      await page.waitForSelector('[role="option"]', { hidden: true });
      assert((await (await response).json()).totalCount > 0);
      await loaded();
      stage = "order_tracking: sort";
      response = queryResponse(
        (args) =>
          args.query?.sort?.key === "order_number" &&
          args.query.sort.direction === "asc",
      );
      await clickText("Order Number", "thead th");
      assert.equal((await response).status(), 200);
      await loaded();
      recordCheck(
        "browser report status/date controls and duplicate-header sorting reach correct server fields",
      );
    }
    screens.push({
      report,
      tab,
      rows: await page.$$eval("tbody tr", (rows) => rows.length),
    });
    if (
      ["order_reports", "rmp_order_reports", "tailor_reports"].includes(report)
    ) {
      const detail = page.waitForResponse((r) => {
        if (!r.url().includes("/rpc/dashboard")) return false;
        const body = JSON.parse(r.request().postData() || "{}");
        return body.p_action === "query" && Boolean(body.p_args?.filters?.id);
      });
      await clickText("View", "tbody button");
      assert.equal((await detail).status(), 200);
      await page.waitForSelector('[role="dialog"] dl');
      assert(await page.$$eval('[role="dialog"] dd', (els) => els.length > 0));
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"]', { hidden: true });
    }
    stage = `${report}/${tab}: search`;
    await search(
      "impossible-dashboard-fixture-search",
      `${report}:${tab || "-"}-search`,
    );
    assert(
      await page.evaluate(() =>
        document.querySelector("tbody")?.innerText.includes("No rows"),
      ),
    );
    const exported = await page.evaluate(() => {
      window.dashboardDownload = null;
      const original = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        window.dashboardDownload = blob;
        return original.call(this, blob);
      };
      return true;
    });
    assert(exported);
    stage = `${report}/${tab}: CSV`;
    await clickText("Export");
    await page.waitForFunction(() => window.dashboardDownload instanceof Blob, {
      timeout: 45000,
    });
    const downloaded = await page.evaluate(async () => ({
      size: window.dashboardDownload.size,
      text: await window.dashboardDownload.text(),
    }));
    assert(downloaded.size > 0);
    assert(downloaded.text.trim().length > 0);
    screens.at(-1).emptySearchAndCsv = true;
    console.error(JSON.stringify({ screen: screens.at(-1) }));
  }
  recordCheck(
    "all seven report screens, RMP Sales tabs, details, search and CSV buttons work with Scott blocked",
  );
  await page.evaluate(() => {
    sessionStorage.setItem("printing-tracker-dashboard-tab", "scott_customers");
  });
  await page.reload({ waitUntil: "networkidle2" });
  await loaded();
  await clickText("Performance");
  await loaded();
  recordCheck("Customers Performance reuses native reports and KPIs");
  stage = "injected failure and Retry";
  // Keep the outage active across React StrictMode's cancelled first request.
  // Restore transport only after the user-visible error has been observed.
  failNextQuery = true;
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() =>
    document.body.innerText.includes("Acceptance injected unavailable"),
  );
  failNextQuery = false;
  const recovered = page.waitForResponse((response) => {
    if (!response.url().includes("/rpc/dashboard") || response.status() !== 200)
      return false;
    const payload = JSON.parse(response.request().postData() || "{}");
    return payload.p_action === "query" && payload.p_args?.query?.page === 1;
  });
  recovered.catch(() => {});
  await clickText("Retry");
  await recovered;
  await loaded();
  // The prior failure toast may remain briefly; the list's error/Retry panel
  // must disappear after a successful request and actual rows must return.
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Retry",
      ) && document.querySelectorAll("tbody tr td").length > 1,
  );
  recordCheck(
    "visible transient failure recovers through Retry with no legacy fallback",
  );
  let exportEvidence;
  if (!config.uiUrl) {
    // Module-level CSV/memory checks run on Vite; deployed builds exercise the
    // actual Export buttons above and reuse the same independently tested adapter.
    const csv = await page.evaluate(async () => {
      const { createDashboardQuery } = await import(
        "/src/canto/dashboardService.js"
      );
      const q = createDashboardQuery("rmp_order_reports");
      const b = await q.exportCsv(
        [
          { key: "id", header: "ID" },
          { key: "total_amount", header: "Amount" },
        ],
        { search: "impossible-dashboard-fixture-search" },
      );
      return await b.blob.text();
    });
    assert(csv.includes("ID"));
    recordCheck("browser CSV adapter completes with no Scott transport");
    assert.deepEqual(blocked, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
    recordCheck(
      "zero Scott/proxy/production attempts and zero browser exceptions",
    );
    // Immutable >10k export uses the real deployed Edge worker; batches remain bounded.
    const request = {
      report: "order_tracking",
      filters: filtersFor("order_tracking"),
      query: {},
    };
    const exportKey = crypto.randomUUID();
    const exp = await rpc(clients.admin, "export_request", {
      request,
      key: exportKey,
    });
    assert.deepEqual(
      await rpc(clients.admin, "export_request", { request, key: exportKey }),
      exp,
    );
    let status = await rpc(clients.admin, "export_read", { id: exp.id });
    assert(status.totalCount > 10000);
    const started = performance.now();
    for (let i = 0; status.state !== "completed" && i < 100; i++) {
      const r = await fetch(config.url + "/functions/v1/squad-jobs/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.worker_secret,
        },
        body: '{"limit":5}',
      });
      assert.equal(r.status, 200);
      const work = await r.json();
      assert(
        work.results.every((x) => ["pending", "done"].includes(x.state)),
        JSON.stringify(work),
      );
      status = await rpc(clients.admin, "export_read", { id: exp.id });
      assert(!["dead", "failed"].includes(status.state));
    }
    assert.equal(status.state, "completed");
    let count = 0,
      ids = new Set();
    for (let p = 1; p <= status.totalPages; p++) {
      const batch = await rpc(clients.admin, "export_read", {
        id: exp.id,
        page: p,
      });
      assert(batch.data.length <= 500);
      count += batch.data.length;
      for (const row of batch.data) ids.add(row.id);
    }
    assert.equal(count, status.totalCount);
    assert.equal(ids.size, count);
    recordCheck(
      "large immutable export through hosted Edge worker, exact count, bounded chunks and no duplicates",
    );
    exportEvidence = {
      rows: count,
      batchSize: 500,
      elapsedMs: Math.round(performance.now() - started),
    };
    const cdp = await page.createCDPSession();
    await cdp.send("HeapProfiler.collectGarbage");
    const browserExport = await page.evaluate(
      async ({ id, key, filters, userId }) => {
        const { createDashboardQuery } = await import(
          "/src/canto/dashboardService.js"
        );
        const request = {
          report: "order_tracking",
          tab: "",
          filters,
          query: { quick: { logic: "and", conditions: [] } },
        };
        const storageKey = `canto:dashboard-export:v1:staging:${userId}:${JSON.stringify(request)}`;
        localStorage.setItem(storageKey, JSON.stringify({ id, key }));
        const start = performance.memory.usedJSHeapSize;
        let peak = start;
        const result = await createDashboardQuery(
          "order_tracking",
          "",
          filters,
        ).exportCsv(
          [
            { key: "id", header: "ID" },
            { key: "total_amount", header: "Amount", format: "currency" },
          ],
          {},
          () => {
            peak = Math.max(peak, performance.memory.usedJSHeapSize);
          },
        );
        const text = await result.blob.text();
        return {
          count: result.count,
          bytes: result.blob.size,
          lines: text.split("\r\n").length,
          heapGrowthBytes: peak - start,
          resumeCleared: localStorage.getItem(storageKey) === null,
        };
      },
      {
        id: exp.id,
        key: exportKey,
        filters: request.filters,
        userId: sessions.admin.user.id,
      },
    );
    assert.equal(browserExport.count, count);
    assert.equal(browserExport.lines, count + 1);
    assert(browserExport.resumeCleared);
    assert(browserExport.heapGrowthBytes < 64 * 1024 * 1024);
    exportEvidence.browser = browserExport;
    recordCheck(
      "large browser CSV resumes completed export with bounded memory and exact row count",
    );
  } else {
    assert.deepEqual(blocked, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
    recordCheck(
      "deployed build: all report CSV buttons, zero Scott/proxy/production attempts and zero browser errors",
    );
  }
  const archiveKey = crypto.randomUUID();
  const archived = await rpc(clients.admin, "customer_archive", {
    id: customer.id,
    version: customer.version,
    key: archiveKey,
  });
  assert.deepEqual(
    await rpc(clients.admin, "customer_archive", {
      id: customer.id,
      version: customer.version,
      key: archiveKey,
    }),
    archived,
  );
  recordCheck("hosted customer archive retries safely");
  const token = sessions.admin.access_token;
  await clients.admin.auth.signOut();
  const revoked = await fetch(config.url + "/rest/v1/rpc/dashboard", {
    method: "POST",
    headers: {
      apikey: config.anon,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "Content-Profile": "canto_api",
    },
    body: '{"p_action":"capabilities"}',
  });
  assert([401, 403].includes(revoked.status));
  recordCheck("revoked real session denied before JWT expiry");
  assert(p95 <= 2000, `HTTP p95 ${p95}ms exceeds 2s`);
  recordCheck("hosted warm first-page p95 <= 2s");
  console.log(
    JSON.stringify({
      checks,
      timings,
      httpWarmP95Ms: p95,
      commandTimings,
      screens,
      export: exportEvidence,
      deploymentUi: config.uiUrl || null,
      blockedRequests: blocked.length,
      browserErrors: errors,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      checks,
      stage,
      failedResponses,
      screens,
      error: { message: error.message, stack: error.stack },
      lastQueries: requests.slice(-4).map((value) => JSON.parse(value)),
      errors,
      dialog: await page
        ?.$eval("[role=dialog]", (e) => e.innerText)
        .catch(() => null),
    }),
  );
  throw error;
} finally {
  await browser.close();
  for (const c of Object.values(clients))
    await c.auth.signOut().catch(() => {});
}
