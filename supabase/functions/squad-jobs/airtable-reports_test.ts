import {
  airtableReportWorker,
  type ReportIntent,
  type ReportsConfig,
  reportsFromEnvironment,
  reportSpecs,
  reportsProvider,
} from "./airtable-reports.ts";
const assert = (value: unknown) => {
  if (!value) throw new Error("assertion failed");
};
const config: ReportsConfig = {
  environment: "staging",
  base: "app" + "A".repeat(14),
  token: "fixture-only",
  tables: {
    customer: "tbl" + "C".repeat(14),
    custom_order: "tbl" + "D".repeat(14),
    rmp_order: "tbl" + "R".repeat(14),
    tailor_pick: "tbl" + "T".repeat(14),
  },
};
const intent = (kind: ReportIntent["kind"] = "customer"): ReportIntent => ({
  state: "prepared",
  environment: "staging",
  kind,
  entity_id: "103",
  key: `staging:${kind}:103`,
  revision: "0:42",
  fields: Object.fromEntries(
    reportSpecs[kind].fields.map(
      (k) => [k, k === "Jobsheet Number" && kind === "tailor_pick" ? [] : null],
    ),
  ),
  ...(kind === "tailor_pick"
    ? { parent: { kind: "custom_order", key: "staging:custom_order:1001" } }
    : {}),
});
function schema() {
  return {
    tables: Object.entries(config.tables).map(([kind, id]) => ({
      id,
      fields: [
        { name: "Squad Key", type: "singleLineText" },
        { name: "Squad Revision", type: "singleLineText" },
        ...reportSpecs[kind as ReportIntent["kind"]].fields.map((name) => ({
          name,
          type: kind === "tailor_pick" && name === "Jobsheet Number"
            ? "multipleRecordLinks"
            : "singleLineText",
          options: { linkedTableId: config.tables.custom_order },
        })),
      ],
    })),
  };
}
function fixture(
  options: {
    loseWrite?: boolean;
    duplicate?: boolean;
    schemaBad?: boolean;
    responseBad?: boolean;
    status?: number;
    parentMissing?: boolean;
  } = {},
) {
  const calls: { url: string; method: string; body?: unknown }[] = [],
    records = new Map<string, Record<string, unknown>>();
  if (!options.parentMissing) {
    records.set("staging:custom_order:1001", {
      "Squad Key": "staging:custom_order:1001",
    });
  }
  let lost = false;
  const request: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    assert(u.origin === "https://api.airtable.com");
    assert(init?.redirect === "error");
    assert(
      new Headers(init?.headers).get("authorization") === "Bearer fixture-only",
    );
    calls.push({
      url: u.href,
      method: init?.method ?? "GET",
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (options.status) {
      return new Response("private provider detail", {
        status: options.status,
      });
    }
    if (u.pathname.includes("/meta/")) {
      const s = schema();
      if (options.schemaBad) s.tables[0].fields[0].type = "formula";
      return Response.json(s);
    }
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert(
        body.performUpsert.fieldsToMergeOn[0] === "Squad Key" &&
          body.typecast === false && body.records.length === 1 &&
          !body.records[0].id,
      );
      const fields = body.records[0].fields;
      records.set(fields["Squad Key"], fields);
      if (options.loseWrite && !lost) {
        lost = true;
        throw new Error("lost response with secret");
      }
      return Response.json({
        records: [{ id: "rec" + "A".repeat(14), fields }],
        createdRecords: ["rec" + "A".repeat(14)],
        updatedRecords: [],
        ...(options.responseBad
          ? { details: { message: "partialSuccess" } }
          : {}),
      });
    }
    const key =
        u.searchParams.get("filterByFormula")?.match(/='([^']+)'/)?.[1] ?? "",
      fields = records.get(key);
    return Response.json({
      records: fields
        ? [
          { id: "rec" + "A".repeat(14), fields },
          ...(options.duplicate
            ? [{ id: "rec" + "B".repeat(14), fields }]
            : []),
        ]
        : [],
    });
  };
  return { calls, records, provider: reportsProvider(config, request, 0) };
}
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof Error && e.message === code);
  }
}
Deno.test("report upsert uses exact configured destination, fixed key, full fields and readback proof", async () => {
  const f = fixture(), p = intent();
  p.fields.Name = "Customer";
  const r = await f.provider.write(p, AbortSignal.timeout(1000));
  assert(
    r.code === "CONFIRMED" && r.key === p.key && r.fields.Name === "Customer" &&
      f.calls.filter((x) => x.method === "PATCH").length === 1 &&
      f.calls.length === 4,
  );
});
Deno.test("identical repeated report is read-confirmed without another write", async () => {
  const f = fixture(), p = intent();
  await f.provider.write(p, AbortSignal.timeout(1000));
  await f.provider.write(p, AbortSignal.timeout(1000));
  assert(f.calls.filter((x) => x.method === "PATCH").length === 1);
});
Deno.test("lost accepted upsert response is adopted by exact lookup on retry", async () => {
  const f = fixture({ loseWrite: true }), p = intent();
  await rejects(
    () => f.provider.write(p, AbortSignal.timeout(1000)),
    "AIRTABLE_REPORT_UNCONFIRMED",
  );
  const r = await f.provider.write(p, AbortSignal.timeout(1000));
  assert(
    r.code === "CONFIRMED" &&
      f.calls.filter((x) => x.method === "PATCH").length === 1,
  );
});
Deno.test("unknown source fields, missing source fields, environment and key injection fail before network", async () => {
  for (
    const p of [
      { ...intent(), environment: "production" },
      { ...intent(), key: "staging:customer:1' OR 1" },
      { ...intent(), fields: { ...intent().fields, private_secret: "x" } },
      { ...intent(), fields: {} },
    ] as ReportIntent[]
  ) {
    const f = fixture();
    await rejects(
      () => f.provider.write(p, AbortSignal.timeout(1000)),
      "AIRTABLE_REPORT_INVALID",
    );
    assert(f.calls.length === 0);
  }
});
Deno.test("computed merge key is rejected by live metadata before data writes", async () => {
  const f = fixture({ schemaBad: true });
  await rejects(
    () => f.provider.write(intent(), AbortSignal.timeout(1000)),
    "AIRTABLE_REPORT_SCHEMA",
  );
  assert(f.calls.length === 1);
});
Deno.test("duplicate external key is never arbitrarily adopted", async () => {
  const f = fixture({ duplicate: true });
  const p = intent();
  f.records.set(p.key, { "Squad Key": p.key });
  await rejects(
    () => f.provider.write(p, AbortSignal.timeout(1000)),
    "AIRTABLE_REPORT_CONFLICT",
  );
  assert(f.calls.every((x) => x.method === "GET"));
});
Deno.test("partial provider success is not reported as confirmed", async () => {
  const f = fixture({ responseBad: true });
  await rejects(
    () => f.provider.write(intent(), AbortSignal.timeout(1000)),
    "AIRTABLE_REPORT_UNCONFIRMED",
  );
});
Deno.test("tailor pick resolves isolated parent key to linked record ID", async () => {
  const f = fixture(), p = intent("tailor_pick");
  const r = await f.provider.write(p, AbortSignal.timeout(1000));
  assert(r.parent_record_id === "rec" + "A".repeat(14));
  const body = f.calls.find((x) => x.method === "PATCH")!.body as {
    records: { fields: Record<string, unknown> }[];
  };
  assert(
    JSON.stringify(body.records[0].fields["Jobsheet Number"]) ===
      JSON.stringify([r.parent_record_id]),
  );
  assert(JSON.stringify(r.fields["Jobsheet Number"]) === "[]");
});
Deno.test("missing parent report is a retryable dependency and performs no create", async () => {
  const f = fixture({ parentMissing: true });
  await rejects(
    () => f.provider.write(intent("tailor_pick"), AbortSignal.timeout(1000)),
    "AIRTABLE_REPORT_DEPENDENCY",
  );
  assert(f.calls.every((x) => x.method === "GET"));
});
Deno.test("rate limit and auth failures expose only typed errors", async () => {
  for (
    const [status, code] of [
      [429, "AIRTABLE_RATE_LIMIT"],
      [401, "AIRTABLE_AUTH_UNAVAILABLE"],
      [500, "AIRTABLE_UNAVAILABLE"],
      [422, "AIRTABLE_REPORT_REJECTED"],
    ] as const
  ) {
    const f = fixture({ status });
    await rejects(
      () => f.provider.write(intent(), AbortSignal.timeout(1000)),
      code,
    );
  }
});
Deno.test("configuration stays disabled unless project, isolation and all tables match", () => {
  const valid: Record<string, string> = {
    SUPABASE_URL: "https://scvojtvgnkmbupvyslmb.supabase.co",
    SQUAD_AIRTABLE_REPORTS_ENVIRONMENT: "staging",
    SQUAD_AIRTABLE_REPORTS_ISOLATED_ENVIRONMENT: "staging",
    SQUAD_AIRTABLE_REPORTS_ENABLED: "true",
    SQUAD_AIRTABLE_REPORTS_BASE: config.base,
    SQUAD_AIRTABLE_REPORTS_TOKEN: config.token,
    SQUAD_AIRTABLE_REPORTS_CUSTOMER_TABLE: config.tables.customer,
    SQUAD_AIRTABLE_REPORTS_CUSTOM_TABLE: config.tables.custom_order,
    SQUAD_AIRTABLE_REPORTS_RMP_TABLE: config.tables.rmp_order,
    SQUAD_AIRTABLE_REPORTS_TAILOR_TABLE: config.tables.tailor_pick,
  };
  assert(reportsFromEnvironment((k) => valid[k]));
  for (
    const field of [
      "SUPABASE_URL",
      "SQUAD_AIRTABLE_REPORTS_ISOLATED_ENVIRONMENT",
      "SQUAD_AIRTABLE_REPORTS_TOKEN",
      "SQUAD_AIRTABLE_REPORTS_TAILOR_TABLE",
    ]
  ) assert(!reportsFromEnvironment((k) => k === field ? undefined : valid[k]));
  assert(
    !reportsFromEnvironment((k) =>
      k === "SQUAD_AIRTABLE_REPORTS_ENVIRONMENT" ? "production" : valid[k]
    ),
  );
});
const job = {
  id: "00000000-0000-4000-8000-000000000001",
  lease_token: "00000000-0000-4000-8000-000000000002",
};
Deno.test("report worker records explicit disabled provider failure without network", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  await airtableReportWorker(async (name, args) => {
    calls.push({ name, args });
    return name.endsWith("_prepare") ? intent() : { state: "dead" };
  })(job);
  assert(
    (calls[1].args.p_result as { error_code: string }).error_code ===
      "AIRTABLE_REPORT_NOT_CONFIGURED",
  );
});
Deno.test("report worker serializes typed successful evidence once", async () => {
  const calls: string[] = [], f = fixture();
  const r = await airtableReportWorker(async (name, args) => {
    calls.push(name);
    if (name.endsWith("_prepare")) return intent();
    assert((args.p_result as { code: string }).code === "CONFIRMED");
    return { state: "done" };
  }, f.provider)(job);
  assert(r.state === "done" && calls.length === 2);
});
Deno.test("report worker skips enumeration and never repeats HTTP after lost finish", async () => {
  let called = 0;
  const provider = {
    write: async () => {
      called++;
      return {
        code: "CONFIRMED" as const,
        key: "k",
        revision: "r",
        record_id: "rec" + "A".repeat(14),
        fields: {},
      };
    },
  };
  await airtableReportWorker(async () => ({ state: "pending" }), provider)(job);
  assert(called === 0);
  let finishes = 0;
  await rejects(() =>
    airtableReportWorker(async (name) => {
      if (name.endsWith("_prepare")) return intent();
      finishes++;
      throw new Error("lost finish");
    }, provider)(job), "lost finish");
  assert(called === 1 && finishes === 1);
});
Deno.test("bounded provider reads reject oversized bodies and abort stalled streams", async () => {
  const request: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(2097153));
        },
      }),
    );
  await rejects(
    () =>
      reportsProvider(config, request, 0).write(
        intent(),
        AbortSignal.timeout(1000),
      ),
    "AIRTABLE_RESPONSE_LIMIT",
  );
  const stall: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        cancel() {
          return new Promise(() => {});
        },
      }),
    );
  try {
    await reportsProvider(config, stall, 0).write(
      intent(),
      AbortSignal.timeout(5),
    );
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof DOMException && e.name === "TimeoutError");
  }
});
