import { buildDashboardCsv } from "./dashboardCsv";
import { cantoRpc, getCantoClient, getCantoTarget } from "./target";
import { buildQuickFilterGroup } from "../scott/list/quickFilters";
import { resolveReportPeriodRange } from "../scott/data/reports/reportShared";

export const usesSupabaseDashboard = () =>
  getCantoTarget().source === "supabase";
const pendingReads = new Map();
let readGeneration = 0;
export async function dashboardRpc(action, args = {}) {
  const readOnly = ["query", "customer_options", "capabilities", "export_read"].includes(action);
  let key;
  try {
    if (readOnly) {
      const { data: { session } } = await getCantoClient().auth.getSession();
      if (!session) throw new Error("Your dashboard session has expired. Please sign in again.");
      key = JSON.stringify([getCantoTarget(), session.user.id, session.access_token, readGeneration, action, args]);
      // Coalesce simultaneous identical reads (including StrictMode mounts).
      // There is no settled-result cache, and writes invalidate pending sharing.
      if (pendingReads.has(key)) return await pendingReads.get(key);
    } else {
      readGeneration++;
      pendingReads.clear();
    }
    const request = cantoRpc("dashboard", { p_action: action, p_args: args });
    if (key) pendingReads.set(key, request);
    return await request;
  } catch (error) {
    if (["PGRST202", "PGRST106", "42883"].includes(error?.code)) {
      error.message =
        "Customers and Reports are not installed in this Supabase environment. Apply the dashboard migration before switching this workflow.";
    }
    throw error;
  } finally {
    if (key) pendingReads.delete(key);
    if (!readOnly) {
      readGeneration++;
      pendingReads.clear();
    }
  }
}

export function exclusiveDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))
    throw new Error("A complete report date range is required.");
  const value = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  )
    throw new Error("Invalid report date.");
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
export function dashboardPeriod(period, now = new Date()) {
  let from, before;
  if (period?.mode === "quarter") {
    const year = Number(period.year),
      quarter = Number(period.quarter);
    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 9999 ||
      ![1, 2, 3, 4].includes(quarter)
    )
      throw new Error("Choose a valid quarter.");
    from = new Date(Date.UTC(year, (quarter - 1) * 3, 1))
      .toISOString()
      .slice(0, 10);
    before = new Date(Date.UTC(year, quarter * 3, 1))
      .toISOString()
      .slice(0, 10);
  } else {
    const explicitDates =
      period?.mode === "date" ||
      (!period?.mode &&
        period &&
        ["start_date", "startDate", "start"].some((key) =>
          Object.hasOwn(period, key),
        ));
    const range = explicitDates
      ? {
          startDate: period.start_date ?? period.startDate ?? period.start,
          endDate: period.end_date ?? period.endDate ?? period.end,
        }
      : resolveReportPeriodRange(period);
    exclusiveDate(range.startDate); // Validate an incomplete picker value before any RPC.
    from = range.startDate;
    before = exclusiveDate(range.endDate);
  }
  // Shared domain reports accept past IST days only. Calendar pickers retain their
  // full month/year labels, while current periods are evaluated through today.
  const today = new Date(now.getTime() + 330 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const tomorrow = exclusiveDate(today);
  before = before > tomorrow ? tomorrow : before;
  if (from < "2000-01-01" || from >= before)
    throw new Error(
      "Choose a past reporting period with an end date on or after its start date (IST).",
    );
  return { from, before };
}
export function dashboardReportFilters(report, values = {}) {
  if (
    [
      "order_reports",
      "rmp_order_reports",
      "tailor_reports",
      "customers",
    ].includes(report)
  )
    return {};
  if (report === "customer_performance") {
    const a = dashboardPeriod(values.periodA),
      b = dashboardPeriod(values.periodB);
    return {
      ...a,
      from_b: b.from,
      before_b: b.before,
      history: values.orderHistoryFilter ?? "all",
    };
  }
  return {
    ...dashboardPeriod(values.period),
    domain: {
      status:
        values.reportType === "oos" ? "all" : (values.reportType ?? "all"),
    },
    oos: values.reportType === "oos",
    customer_ids: values.customerIds ?? [],
  };
}

// No row cache: each request checks the current authenticated session and revision.
// A query owns only its pagination watermark. A different principal starts afresh.
export function createDashboardQuery(report, tab = "", filters = {}) {
  let watermark,
    signature,
    sequence = 0;
  async function fetchPage({
    page = 1,
    items = 20,
    search = "",
    filters: advanced,
    quickFilters,
    sort,
    option_fields = [],
  } = {}) {
    const {
      data: { session },
    } = await getCantoClient().auth.getSession();
    if (!session)
      throw new Error(
        "Your dashboard session has expired. Please sign in again.",
      );
    const query = {
      page,
      items,
      search,
      filters: advanced,
      quick: buildQuickFilterGroup(quickFilters),
      sort,
      option_fields,
    };
    const nextSignature = JSON.stringify([
      getCantoTarget(),
      session.user.id,
      session.access_token,
      filters,
      { ...query, page: 0, option_fields: [] },
    ]);
    if (signature !== nextSignature || page === 1) {
      watermark = undefined;
      signature = nextSignature;
    }
    if (watermark) query.revision = watermark;
    const requestSequence = ++sequence;
    const result = await dashboardRpc("query", { report, tab, filters, query });
    if (requestSequence === sequence) watermark = result.revision;
    return result;
  }
  // Multi-request reads belong to one target and login. Never finish a CSV after
  // an account/source switch, even if both databases happen to share a revision.
  async function readContext() {
    const {
      data: { session },
    } = await getCantoClient().auth.getSession();
    if (!session)
      throw new Error(
        "Your dashboard session has expired. Please sign in again.",
      );
    return JSON.stringify([
      getCantoTarget(),
      session.user.id,
      session.access_token,
    ]);
  }
  async function beginRead() {
    const context = await readContext();
    return async () => {
      if (context !== (await readContext()))
        throw new Error(
          "The source or login changed during export. Refresh and retry.",
        );
    };
  }
  async function fetchAll(query = {}) {
    const assertContext = await beginRead();
    const first = await fetchPage({ ...query, page: 1, items: 500 });
    await assertContext();
    if (first.totalCount > 10000)
      throw new Error(
        "This result needs a background export. Narrow the filters for an interactive list.",
      );
    const rows = [...first.data];
    for (let page = 2; page <= first.totalPages; page++) {
      await assertContext();
      const next = await dashboardRpc("query", {
        report,
        tab,
        filters,
        query: {
          search: query.search,
          filters: query.filters,
          sort: query.sort,
          page,
          items: 500,
          revision: first.revision,
          quick: buildQuickFilterGroup(query.quickFilters),
        },
      });
      await assertContext();
      rows.push(...next.data);
    }
    if (rows.length !== first.totalCount)
      throw new Error("The result changed during loading. Refresh and retry.");
    return rows;
  }
  async function exportRows(query = {}, onProgress = () => {}, onBatch) {
    const assertContext = await beginRead();
    const first = await fetchPage({ ...query, page: 1, items: 500 });
    await assertContext();
    if (first.totalCount <= 10000) {
      const rows = await fetchAll(query);
      await assertContext();
      if (onBatch) {
        await onBatch(rows);
        return rows.length;
      }
      return rows;
    }
    const {
      data: { session },
    } = await getCantoClient().auth.getSession();
    if (!session) throw new Error("Sign in again to export.");
    const request = {
      report,
      tab,
      filters,
      query: { ...query, quick: buildQuickFilterGroup(query.quickFilters) },
    };
    delete request.query.quickFilters;
    delete request.query.page;
    delete request.query.items;
    const storageKey = `canto:dashboard-export:v1:${getCantoTarget().environment}:${session.user.id}:${JSON.stringify(request)}`;
    let pending;
    try {
      pending = JSON.parse(localStorage.getItem(storageKey));
    } catch {
      /* new request */
    }
    if (!pending) {
      pending = { key: crypto.randomUUID() };
      localStorage.setItem(storageKey, JSON.stringify(pending));
    }
    if (!pending.id) {
      let created;
      try {
        await assertContext();
        created = await dashboardRpc("export_request", {
          request,
          key: pending.key,
        });
      } catch (error) {
        if (["55000", "P0002"].includes(error.code))
          localStorage.removeItem(storageKey);
        throw error;
      }
      await assertContext();
      pending.id = created.id;
      localStorage.setItem(storageKey, JSON.stringify(pending));
    }
    onProgress(
      "Preparing a background export. You can return later and press Export to resume.",
    );
    const readExport = async (args) => {
      try {
        await assertContext();
        const result = await dashboardRpc("export_read", args);
        await assertContext();
        return result;
      } catch (error) {
        if (["55000", "P0002"].includes(error.code))
          localStorage.removeItem(storageKey);
        throw error;
      }
    };
    let status;
    for (let attempt = 0; attempt < 60; attempt++) {
      status = await readExport({ id: pending.id });
      if (status.state === "completed") break;
      if (["dead", "failed", "cancelled"].includes(status.state)) {
        localStorage.removeItem(storageKey);
        throw new Error(
          `Export failed (${status.errorCode ?? status.state}). Refresh the report and export again.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (status.state !== "completed")
      throw new Error(
        "Your export is still queued. Press Export again later to resume.",
      );
    const rows = [];
    let downloaded = 0;
    for (let page = 1; page <= status.totalPages; page++) {
      const batch = await readExport({ id: pending.id, page });
      downloaded += batch.data.length;
      if (onBatch) await onBatch(batch.data);
      else rows.push(...batch.data);
      onProgress(
        `Downloading export: ${downloaded.toLocaleString()} of ${status.totalCount.toLocaleString()} rows.`,
      );
    }
    if (downloaded !== status.totalCount)
      throw new Error("Export row count mismatch. Retry the download.");
    localStorage.removeItem(storageKey);
    return onBatch ? downloaded : rows;
  }
  async function exportCsv(columns, query, onProgress) {
    const parts = [buildDashboardCsv(columns, [])];
    const count = await exportRows(query, onProgress, (batch) => {
      if (batch.length)
        parts.push("\r\n", buildDashboardCsv(columns, batch, false));
    });
    return { count, blob: new Blob(parts, { type: "text/csv;charset=utf-8" }) };
  }
  return {
    serverQuery: true,
    serverPaged: true,
    exportRows,
    exportCsv,
    cacheKey: `supabase:${getCantoTarget().environment}:${report}:${tab}:${JSON.stringify(filters)}`,
    apiFilters: filters,
    fetchPage,
    fetchAll,
    // Enum loading must not reset or race the visible list's revision watermark.
    fetchOptions: async (fields) =>
      (
        await dashboardRpc("query", {
          report,
          tab,
          filters,
          query: { items: 1, option_fields: fields },
        })
      ).options,
    fetchById: async (id) => {
      const result = await dashboardRpc("query", {
        report,
        tab,
        filters: { ...filters, id },
        query: { items: 1 },
      });
      return result.data[0] ?? null;
    },
  };
}

export function dashboardSummary(report, tab, summary) {
  if (!summary) return null;
  const sums = summary.sums ?? {},
    count = summary.count;
  const sum = (key) =>
    sums[key] === undefined ? (count === 0 ? "0" : null) : sums[key];
  const percent = (a, b) =>
    a == null || b == null || Number(b) === 0
      ? "—"
      : `${((Number(a) / Number(b)) * 100).toFixed(1)}%`;
  const growth = (a, b) =>
    a == null || b == null || Number(a) === 0
      ? "—"
      : `${(((Number(b) - Number(a)) / Number(a)) * 100).toFixed(1)}%`;
  if (report === "customer_performance")
    return {
      customerCount: count,
      qtyA: sum("qtyA"),
      qtyB: sum("qtyB"),
      valueA: sum("valueA"),
      valueB: sum("valueB"),
      qtyGrowth: growth(sum("qtyA"), sum("qtyB")),
      valueGrowth: growth(sum("valueA"), sum("valueB")),
    };
  if (report === "total_inventory")
    return {
      totalCount: count,
      totalUnits: sum("inventory"),
      outOfStockCount: summary.outOfStockCount,
      salesLoss: null,
    };
  if (report === "rmp_sales") {
    const breakdown = tab && tab !== "overview";
    return {
      customerTypeBreakdown: summary.customerTypeBreakdown,
      totalOrders: count,
      totalCount: count,
      totalUnits: sum("total_qty"),
      salesValue: sum("total_amount"),
      itemQty: sum("item_qty"),
      orderedQty: sum("ordered_qty"),
      orderValue: sum("order_value"),
      entityCount: count,
      coordinatorCount: count,
      fillRate: percent(
        sum(breakdown ? "closed_ordered_qty" : "closed_qty"),
        sum(breakdown ? "item_qty" : "total_qty"),
      ),
    };
  }
  return {
    totalCount: count,
    totalAmount: sum("total_amount"),
    totalItems: sum("total_quantity"),
    totalValue: sum("total_amount"),
    totalQuantity: sum("quantity"),
  };
}

export async function saveDashboardCustomer({
  id = null,
  values,
  version = null,
  key = crypto.randomUUID(),
}) {
  if (id && !version)
    throw new Error(
      "Reload this customer before saving; its version is missing.",
    );
  return dashboardRpc("customer_save", { id, values, version, key });
}
export async function archiveDashboardCustomer(
  customer,
  key = crypto.randomUUID(),
) {
  if (!customer?.version)
    throw new Error(
      "Reload this customer before deleting; its version is missing.",
    );
  return dashboardRpc("customer_archive", {
    id: customer.id,
    version: customer.version,
    key,
  });
}
