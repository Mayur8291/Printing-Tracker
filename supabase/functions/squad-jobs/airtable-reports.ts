import { abortable, readBounded } from "./airtable-provider.ts";
import { AirtableError, object, recordId } from "./airtable-mapping.ts";
import specsJson from "./airtable-reports-contracts.json" with { type: "json" };
import type { Rpc } from "./handler.ts";

export type ReportKind =
  | "customer"
  | "custom_order"
  | "rmp_order"
  | "tailor_pick";
export interface ReportIntent {
  state: "prepared";
  environment: "staging" | "production";
  kind: ReportKind;
  entity_id: string;
  key: string;
  revision: string;
  fields: Record<string, unknown>;
  parent?: { kind: "custom_order" | "rmp_order"; key: string } | null;
}
export interface ReportProof {
  code: "CONFIRMED";
  key: string;
  revision: string;
  record_id: string;
  fields: Record<string, unknown>;
  parent_record_id?: string;
}
export interface ReportsProvider {
  write(intent: ReportIntent, signal: AbortSignal): Promise<ReportProof>;
}
export interface ReportsConfig {
  environment: "staging" | "production";
  base: string;
  token: string;
  tables: Record<ReportKind, string>;
}
export const reportSpecs = specsJson as Record<
  ReportKind,
  { legacy_table: string; fields: string[] }
>;
const uuidLike = /^[a-f0-9-]{36}$/i;
const validKey = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(staging|production):(customer|custom_order|rmp_order|tailor_pick):[1-9][0-9]{0,18}$/
    .test(value);
function validate(intent: ReportIntent, environment: string) {
  if (
    intent.environment !== environment ||
    !Object.hasOwn(reportSpecs, intent.kind) ||
    !/^[1-9][0-9]{0,18}$/.test(intent.entity_id) ||
    intent.key !== `${environment}:${intent.kind}:${intent.entity_id}` ||
    !/^[0-9]+:[0-9]+$/.test(intent.revision)
  ) throw new AirtableError("AIRTABLE_REPORT_INVALID");
  const fields = object(intent.fields), names = reportSpecs[intent.kind].fields;
  if (
    Object.keys(fields).length !== names.length ||
    names.some((name) => !Object.hasOwn(fields, name)) ||
    JSON.stringify(fields).length > 131072
  ) throw new AirtableError("AIRTABLE_REPORT_INVALID");
  for (const [key, value] of Object.entries(fields)) {
    if (
      intent.kind === "tailor_pick" && key === "Jobsheet Number" &&
      Array.isArray(value) && value.length === 0
    ) continue;
    if (
      value !== null &&
      (typeof value !== "string" && typeof value !== "number" ||
        typeof value === "number" &&
          (!Number.isFinite(value) ||
            Math.abs(value) > Number.MAX_SAFE_INTEGER) ||
        typeof value === "string" &&
          (value.length > 20000 || /[\u0000\u0008\u000b\u000c]/.test(value)))
    ) throw new AirtableError("AIRTABLE_REPORT_INVALID");
  }
  if (intent.kind === "tailor_pick") {
    if (
      !intent.parent ||
      !["custom_order", "rmp_order"].includes(intent.parent.kind) ||
      !validKey(intent.parent.key) ||
      !intent.parent.key.startsWith(`${environment}:${intent.parent.kind}:`)
    ) throw new AirtableError("AIRTABLE_REPORT_INVALID");
  } else if (intent.parent) throw new AirtableError("AIRTABLE_REPORT_INVALID");
}
function equivalent(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  return Object.entries(expected).every(([key, value]) => {
    const got = actual[key];
    if (
      value === null || value === "" ||
      Array.isArray(value) && value.length === 0
    ) {
      return got === undefined || got === null || got === "" ||
        Array.isArray(got) && got.length === 0;
    }
    if (Array.isArray(value)) {
      return Array.isArray(got) &&
        JSON.stringify(got) === JSON.stringify(value);
    }
    return value === got;
  });
}
export function reportsProvider(
  config: ReportsConfig,
  request: typeof fetch = fetch,
  spacingMs = 250,
): ReportsProvider {
  if (
    !/^app[A-Za-z0-9]{14}$/.test(config.base) || !config.token ||
    config.token.length > 4096 || /[\r\n]/.test(config.token) ||
    !["staging", "production"].includes(config.environment) ||
    Object.keys(config.tables).length !== 4 ||
    Object.values(config.tables).some((id) =>
      !/^tbl[A-Za-z0-9]{14}$/.test(id)
    ) || new Set(Object.values(config.tables)).size !== 4
  ) throw new AirtableError("AIRTABLE_REPORT_NOT_CONFIGURED");
  let next = 0, tail: Promise<unknown> = Promise.resolve();
  let schema: Record<string, Record<string, unknown>> | undefined,
    schemaUntil = 0;
  async function api(path: string, signal: AbortSignal, body?: unknown) {
    let release = () => {};
    const before = tail;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await abortable(before, signal);
      await abortable(
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, next - Date.now()));
        }),
        signal,
      );
      next = Date.now() + Math.max(0, spacingMs);
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
      const payload = body === undefined ? undefined : JSON.stringify(body);
      if (payload && new TextEncoder().encode(payload).length > 262144) {
        throw new AirtableError("AIRTABLE_REPORT_LIMIT");
      }
      const response = await abortable(
        request(`https://api.airtable.com/v0/${path}`, {
          method: body === undefined ? "GET" : "PATCH",
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: payload,
          redirect: "error",
          signal: bounded,
        }),
        bounded,
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new AirtableError(
          response.status === 429
            ? "AIRTABLE_RATE_LIMIT"
            : response.status === 401 || response.status === 403
            ? "AIRTABLE_AUTH_UNAVAILABLE"
            : response.status >= 500 || response.status === 408
            ? "AIRTABLE_UNAVAILABLE"
            : "AIRTABLE_REPORT_REJECTED",
          response.status === 429 ? 30 : 60,
        );
      }
      const raw = await readBounded(response, 2097152, bounded);
      try {
        return object(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        );
      } catch {
        throw new AirtableError("AIRTABLE_RESPONSE_INVALID");
      }
    } finally {
      clearTimeout(timer);
      release();
    }
  }
  async function verifySchema(intent: ReportIntent, signal: AbortSignal) {
    if (!schema || schemaUntil <= Date.now()) {
      const response = await api(`meta/bases/${config.base}/tables`, signal);
      if (!Array.isArray(response.tables) || response.tables.length > 1000) {
        throw new AirtableError("AIRTABLE_REPORT_SCHEMA");
      }
      schema = {};
      for (const value of response.tables) {
        const table = object(value);
        if (
          typeof table.id === "string" &&
          Object.values(config.tables).includes(table.id)
        ) schema[table.id] = table;
      }
      schemaUntil = Date.now() + 60000;
    }
    const table = schema[config.tables[intent.kind]];
    if (!table || !Array.isArray(table.fields)) {
      throw new AirtableError("AIRTABLE_REPORT_SCHEMA");
    }
    const fields = table.fields.map(object),
      key = fields.find((field) => field.name === "Squad Key"),
      revision = fields.find((field) => field.name === "Squad Revision");
    if (
      key?.type !== "singleLineText" || revision?.type !== "singleLineText" ||
      reportSpecs[intent.kind].fields.some((name) =>
        !fields.some((field) => field.name === name)
      )
    ) throw new AirtableError("AIRTABLE_REPORT_SCHEMA");
    if (intent.parent) {
      const link = fields.find((field) => field.name === "Jobsheet Number");
      if (
        link?.type !== "multipleRecordLinks" ||
        object(link.options).linkedTableId !== config.tables[intent.parent.kind]
      ) throw new AirtableError("AIRTABLE_REPORT_SCHEMA");
    }
  }
  async function lookup(kind: ReportKind, key: string, signal: AbortSignal) {
    if (!validKey(key)) throw new AirtableError("AIRTABLE_REPORT_INVALID");
    const query = new URLSearchParams({
      filterByFormula: `{Squad Key}='${key}'`,
      maxRecords: "2",
      pageSize: "2",
    });
    const result = await api(
      `${config.base}/${config.tables[kind]}?${query}`,
      signal,
    );
    if (
      !Array.isArray(result.records) || result.records.length > 1 ||
      result.offset
    ) throw new AirtableError("AIRTABLE_REPORT_CONFLICT");
    if (result.records.length === 0) return null;
    const record = object(result.records[0]), fields = object(record.fields);
    if (!recordId(record.id) || fields["Squad Key"] !== key) {
      throw new AirtableError("AIRTABLE_REPORT_CONFLICT");
    }
    return { id: record.id, fields };
  }
  return {
    async write(intent, signal) {
      validate(intent, config.environment);
      await verifySchema(intent, signal);
      const fields: Record<string, unknown> = {
        ...intent.fields,
        "Squad Key": intent.key,
        "Squad Revision": intent.revision,
      };
      let parentId: string | undefined;
      if (intent.parent) {
        const parent = await lookup(
          intent.parent.kind,
          intent.parent.key,
          signal,
        );
        if (!parent) throw new AirtableError("AIRTABLE_REPORT_DEPENDENCY", 60);
        parentId = parent.id;
        fields["Jobsheet Number"] = [parentId];
      }
      // Read before retry: an exact confirmed record needs no further mutation.
      const previous = await lookup(intent.kind, intent.key, signal);
      if (!previous || !equivalent(fields, previous.fields)) {
        let response: Record<string, unknown>;
        try {
          response = await api(
            `${config.base}/${config.tables[intent.kind]}`,
            signal,
            {
              performUpsert: { fieldsToMergeOn: ["Squad Key"] },
              records: [{ fields }],
              typecast: false,
            },
          );
        } catch (error) {
          if (
            error instanceof AirtableError &&
            [
              "AIRTABLE_REPORT_REJECTED",
              "AIRTABLE_AUTH_UNAVAILABLE",
              "AIRTABLE_RATE_LIMIT",
            ].includes(error.code)
          ) throw error;
          throw new AirtableError("AIRTABLE_REPORT_UNCONFIRMED", 60);
        }
        if (
          response.details || !Array.isArray(response.records) ||
          response.records.length !== 1 ||
          !Array.isArray(response.createdRecords) ||
          !Array.isArray(response.updatedRecords)
        ) throw new AirtableError("AIRTABLE_REPORT_UNCONFIRMED", 60);
        try {
          const row = object(response.records[0]);
          if (!recordId(row.id) || !equivalent(fields, object(row.fields))) {
            throw new Error("unconfirmed");
          }
        } catch {
          throw new AirtableError("AIRTABLE_REPORT_UNCONFIRMED", 60);
        }
      }
      let verified;
      try {
        verified = await lookup(intent.kind, intent.key, signal);
      } catch (error) {
        if (
          error instanceof AirtableError &&
          error.code === "AIRTABLE_REPORT_CONFLICT"
        ) throw error;
        throw new AirtableError("AIRTABLE_REPORT_UNCONFIRMED", 60);
      }
      if (
        !verified || !equivalent(fields, verified.fields)
      ) throw new AirtableError("AIRTABLE_REPORT_UNCONFIRMED", 60);
      return {
        code: "CONFIRMED",
        key: intent.key,
        revision: intent.revision,
        record_id: verified.id,
        fields: intent.fields,
        ...(parentId ? { parent_record_id: parentId } : {}),
      };
    },
  };
}
export function reportsFromEnvironment(
  get: (name: string) => string | undefined,
  request: typeof fetch = fetch,
): ReportsProvider | undefined {
  const ref = get("SUPABASE_URL")?.match(
      /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/,
    )?.[1],
    environment = get("SQUAD_AIRTABLE_REPORTS_ENVIRONMENT");
  if (
    get("SQUAD_AIRTABLE_REPORTS_ENABLED") !== "true" || !ref ||
    ({
        scvojtvgnkmbupvyslmb: "staging",
        levwrmvqdntngeasrtnb: "production",
      } as Record<string, string>)[ref] !== environment ||
    get("SQUAD_AIRTABLE_REPORTS_ISOLATED_ENVIRONMENT") !== environment
  ) return undefined;
  try {
    return reportsProvider({
      environment: environment as ReportsConfig["environment"],
      base: get("SQUAD_AIRTABLE_REPORTS_BASE") ?? "",
      token: get("SQUAD_AIRTABLE_REPORTS_TOKEN") ?? "",
      tables: {
        customer: get("SQUAD_AIRTABLE_REPORTS_CUSTOMER_TABLE") ?? "",
        custom_order: get("SQUAD_AIRTABLE_REPORTS_CUSTOM_TABLE") ?? "",
        rmp_order: get("SQUAD_AIRTABLE_REPORTS_RMP_TABLE") ?? "",
        tailor_pick: get("SQUAD_AIRTABLE_REPORTS_TAILOR_TABLE") ?? "",
      },
    }, request);
  } catch {
    return undefined;
  }
}
export function airtableReportWorker(rpc: Rpc, provider?: ReportsProvider) {
  return async (job: { id: string; lease_token: string }) => {
    if (!uuidLike.test(job.id) || !uuidLike.test(job.lease_token)) {
      throw new Error("invalid_report_job");
    }
    const args = { p_id: job.id, p_lease_token: job.lease_token },
      prepared = await rpc("squad_airtable_report_prepare", args) as
        & ReportIntent
        & { state: string };
    if (prepared.state !== "prepared") {
      return { id: job.id, state: prepared.state };
    }
    let result: ReportProof | Record<string, unknown>;
    try {
      if (!provider) throw new AirtableError("AIRTABLE_REPORT_NOT_CONFIGURED");
      const signal = AbortSignal.timeout(35000);
      result = await abortable(provider.write(prepared, signal), signal);
    } catch (error) {
      const e = error instanceof AirtableError
        ? error
        : new AirtableError("AIRTABLE_UNAVAILABLE", 60);
      const retry = [
        "AIRTABLE_RATE_LIMIT",
        "AIRTABLE_UNAVAILABLE",
        "AIRTABLE_AUTH_UNAVAILABLE",
        "AIRTABLE_REPORT_DEPENDENCY",
        "AIRTABLE_REPORT_UNCONFIRMED",
      ].includes(e.code);
      result = {
        code: retry
          ? "RETRY"
          : e.code === "AIRTABLE_REPORT_CONFLICT"
          ? "RECONCILIATION_REQUIRED"
          : "REJECTED",
        error_code: e.code,
        retry_after: e.retryAfter ?? 0,
      };
    }
    return await rpc("squad_airtable_report_finish", {
      ...args,
      p_result: result,
    }) as { id: string; state: string; error_code?: string };
  };
}
