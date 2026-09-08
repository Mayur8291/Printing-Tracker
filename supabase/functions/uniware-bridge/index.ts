// Uniware (Unicommerce) bridge. Staging deploy only unless user asks for prod.
// Secrets: UNIWARE_BASE_URL, UNIWARE_USERNAME, UNIWARE_PASSWORD, UNIWARE_FACILITY
// Deploy: npx supabase functions deploy uniware-bridge  (linked to staging)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callerIsAdmin, corsHeaders, createServiceClient, jsonResponse } from "../_shared/passwordReset.ts";

type Action = "sync_inventory" | "sync_orders" | "adjust" | "status";

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const client = createServiceClient();
  const { data: { user }, error } = await client.auth.getUser(jwt);
  if (error || !user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const admin = await callerIsAdmin(client, user.id, user.email ?? "");
  if (!admin.isAdmin) throw Object.assign(new Error("Forbidden: admin only"), { status: 403 });
  return { client, user };
}

function uniwareConfig() {
  const base = (Deno.env.get("UNIWARE_BASE_URL") ?? "").replace(/\/$/, "");
  const username = Deno.env.get("UNIWARE_USERNAME") ?? "";
  const password = Deno.env.get("UNIWARE_PASSWORD") ?? "";
  const facility = Deno.env.get("UNIWARE_FACILITY") ?? "";
  return { base, username, password, facility, ready: Boolean(base && username && password) };
}

async function uniwareToken(cfg: ReturnType<typeof uniwareConfig>): Promise<string> {
  const url =
    `${cfg.base}/oauth/token?grant_type=password&client_id=my-trusted-client` +
    `&username=${encodeURIComponent(cfg.username)}&password=${encodeURIComponent(cfg.password)}`;
  const res = await fetch(url, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  const token = body.access_token || body.accessToken;
  if (!res.ok || !token) {
    throw new Error(`Uniware login failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return String(token);
}

async function uniwarePost(
  cfg: ReturnType<typeof uniwareConfig>,
  token: string,
  path: string,
  payload: unknown,
  facility?: string
) {
  const res = await fetch(`${cfg.base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      Facility: facility !== undefined ? String(facility) : (cfg.facility || "")
    },
    body: JSON.stringify(payload ?? {})
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.successful === false) {
    throw new Error(`Uniware ${path} failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

function errToMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    try {
      return JSON.stringify(e).slice(0, 400);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}

/** Uniware search often returns created as epoch ms, not ISO. */
function toOrderDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length >= 13 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function asText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") return null;
  return String(value);
}

function lineQty(item: Record<string, unknown>): number {
  // Uniware saleOrderItems are usually 1 row = 1 pc (no quantity field).
  // Only trust an explicit quantity on the item itself — never package summaries.
  const raw = item.quantity ?? item.qty;
  if (raw == null || raw === "") return 1;
  const q = Number(raw);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function itemSku(row: Record<string, unknown>): string {
  const nested = row.item && typeof row.item === "object" ? (row.item as Record<string, unknown>) : {};
  return String(
    row.itemSku ||
      row.itemSKU ||
      row.sellerSkuCode ||
      row.skuCode ||
      row.itemTypeSKU ||
      nested.itemSku ||
      nested.skuCode ||
      ""
  ).trim();
}

function collectSaleOrderItemRows(so: Record<string, unknown>): Record<string, unknown>[] {
  // saleOrderItems is Uniware's exact item list (1 row per piece). Package `items`
  // is a SKU summary and would double-count if merged.
  if (Array.isArray(so.saleOrderItems) && so.saleOrderItems.length) {
    return so.saleOrderItems as Record<string, unknown>[];
  }
  return [];
}

function extractSaleOrderItems(
  got: Record<string, unknown>,
  fallback: { uni_code: string; order_date: string | null; channel: string | null }
) {
  const so = (got.saleOrderDTO || got.saleOrder || got) as Record<string, unknown>;
  const raw = collectSaleOrderItemRows(so);
  const orderDate =
    toOrderDate(so.displayOrderDateTime ?? so.created) || fallback.order_date;
  const channel = asText(so.channel) || fallback.channel;
  return raw
    .map((row, idx) => {
      const sku = itemSku(row);
      if (!sku) return null;
      return {
        uni_code: fallback.uni_code,
        line_code: String(row.code || row.id || `${sku}-${idx}`),
        sku_code: sku,
        qty: lineQty(row),
        order_date: orderDate,
        channel,
        facility_code: asText(row.facilityCode) || asText(so.facilityCode) || null,
        status: asText(row.statusCode || row.status)
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
}

async function fetchPagedTexts(
  client: ReturnType<typeof createServiceClient>,
  table: string,
  column: string
): Promise<string[]> {
  const page = 1000;
  const values: string[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await client.from(table).select(column).range(from, from + page - 1);
    if (error) throw error;
    const chunk = data ?? [];
    for (const row of chunk) {
      const v = String((row as Record<string, unknown>)[column] || "").trim();
      if (v) values.push(v);
    }
    if (chunk.length < page) break;
  }
  return values;
}

async function listAllUniwareSkus(
  cfg: ReturnType<typeof uniwareConfig>,
  token: string,
  deadline: number,
  startAt: number,
  extra: Record<string, unknown> = {}
): Promise<{ rows: { sku_code: string; name: string | null }[]; nextStart: number; complete: boolean }> {
  const pageSize = 50;
  const rows: { sku_code: string; name: string | null }[] = [];
  let start = Math.max(0, startAt);
  let complete = false;
  for (let guard = 0; guard < 400; guard += 1) {
    if (Date.now() > deadline) break;
    const search = await uniwarePost(cfg, token, "/services/rest/v1/product/itemType/search", {
      ...extra,
      searchOptions: { displayLength: pageSize, displayStart: start, getCount: start === 0 }
    });
    const els = Array.isArray(search.elements) ? search.elements : [];
    for (const el of els) {
      const rec = el as { skuCode?: string; sku?: string; name?: string };
      const sku = String(rec.skuCode || rec.sku || "").trim();
      if (sku) rows.push({ sku_code: sku, name: rec.name ? String(rec.name) : null });
    }
    start += els.length;
    if (els.length < pageSize) {
      complete = true;
      break;
    }
  }
  return { rows, nextStart: start, complete };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

type SnapshotRow = Record<string, unknown>;

function snapshotList(body: Record<string, unknown>): SnapshotRow[] {
  const rows = body.inventorySnapshots ?? body.inventorySnapshotDTOs;
  return Array.isArray(rows) ? (rows as SnapshotRow[]) : [];
}

function mapSnapshotRow(r: SnapshotRow, facility: string, now: string) {
  const sku = String(r.itemSKU || r.skuCode || r.itemTypeSKU || "").trim();
  return {
    facility_code: facility,
    sku_code: sku,
    inventory_type: "GOOD_INVENTORY",
    qty: Number(r.inventory || r.quantity || 0),
    qty_blocked: Number(r.inventoryBlocked || 0),
    qty_open_sale: Number(r.openSale || 0),
    qty_putaway: Number(r.putawayPending || 0),
    synced_at: now
  };
}

async function listFacilityCodes(
  cfg: ReturnType<typeof uniwareConfig>,
  token: string
): Promise<string[]> {
  try {
    const search = await uniwarePost(cfg, token, "/services/rest/v1/facility/search", {
      facilityStatus: "ALL",
      fromDate: "2010-01-01T00:00:00.000Z",
      toDate: new Date().toISOString(),
      dateType: "CREATED"
    });
    const parties = Array.isArray(search.parties) ? search.parties : [];
    const codes = parties
      .map((p: { facilityCode?: string; code?: string }) =>
        String(p.facilityCode || p.code || "").trim()
      )
      .filter(Boolean);
    if (codes.length) return [...new Set(codes)];
  } catch (e) {
    console.warn("facility/search failed", e);
  }
  return [cfg.facility || "scottinternational"];
}

async function snapshotFacility(
  cfg: ReturnType<typeof uniwareConfig>,
  token: string,
  facility: string,
  skuCodes: string[]
): Promise<SnapshotRow[]> {
  const bySku = new Map<string, SnapshotRow>();
  const merge = (rows: SnapshotRow[]) => {
    for (const row of rows) {
      const sku = String(row.itemSKU || row.skuCode || row.itemTypeSKU || "").trim();
      if (sku) bySku.set(sku, row);
    }
  };

  merge(
    snapshotList(
      await uniwarePost(
        cfg,
        token,
        "/services/rest/v1/inventory/inventorySnapshot/get",
        { updatedSinceInMinutes: 1440 },
        facility
      )
    )
  );

  const chunkSize = 2000;
  for (let i = 0; i < skuCodes.length; i += chunkSize) {
    const chunk = skuCodes.slice(i, i + chunkSize);
    merge(
      snapshotList(
        await uniwarePost(
          cfg,
          token,
          "/services/rest/v1/inventory/inventorySnapshot/get",
          { itemTypeSKUs: chunk },
          facility
        )
      )
    );
  }
  return [...bySku.values()];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { client, user } = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status") as Action;
    const cfg = uniwareConfig();

    if (action === "status") {
      return jsonResponse({
        ok: true,
        configured: cfg.ready,
        facility: cfg.facility || null,
        baseHost: cfg.base ? new URL(cfg.base).host : null
      });
    }

    if (!cfg.ready) {
      return jsonResponse({
        error:
          "Uniware secrets not set on this project. Add UNIWARE_BASE_URL, UNIWARE_USERNAME, UNIWARE_PASSWORD, UNIWARE_FACILITY (staging edge secrets) then retry."
      }, 400);
    }

    if (action === "sync_inventory") {
      const { data: logId, error: logErr } = await client.rpc("uni_begin_sync", { p_feed: "inventory" });
      if (logErr) throw logErr;
      try {
        const token = await uniwareToken(cfg);
        const facilities = await listFacilityCodes(cfg, token);
        const [{ data: settingsRow }, platformSkus, storedCatalog] = await Promise.all([
          client.from("uni_settings").select("catalog_search_start, catalog_complete").eq("id", 1).maybeSingle(),
          fetchPagedTexts(client, "inventory_skus", "sku_code"),
          fetchPagedTexts(client, "uni_item_sku", "sku_code")
        ]);
        const facilityErrors: string[] = [];
        let catalogThisRun = 0;
        let catalogComplete = Boolean(settingsRow?.catalog_complete);
        let catalogStart = Number(settingsRow?.catalog_search_start) || 0;
        try {
          const listed = catalogComplete
            ? await listAllUniwareSkus(cfg, token, Date.now() + 25_000, 0, { updatedSinceInHour: 48 })
            : await listAllUniwareSkus(cfg, token, Date.now() + 50_000, catalogStart);
          catalogThisRun = listed.rows.length;
          if (listed.rows.length) {
            const nowIso = new Date().toISOString();
            const skuUpserts = listed.rows.map((r) => ({ ...r, synced_at: nowIso }));
            for (let i = 0; i < skuUpserts.length; i += 500) {
              const { error } = await client.from("uni_item_sku").upsert(skuUpserts.slice(i, i + 500));
              if (error) throw error;
            }
          }
          catalogStart = listed.complete ? 0 : listed.nextStart;
          catalogComplete = catalogComplete || listed.complete;
          await client
            .from("uni_settings")
            .update({ catalog_search_start: catalogStart, catalog_complete: catalogComplete })
            .eq("id", 1);
        } catch (e) {
          facilityErrors.push(`itemType/search: ${errToMessage(e).slice(0, 180)}`);
        }
        const freshCatalog = await fetchPagedTexts(client, "uni_item_sku", "sku_code");
        const skuCodes = [...new Set([...platformSkus, ...storedCatalog, ...freshCatalog])];
        const now = new Date().toISOString();
        const upserts: ReturnType<typeof mapSnapshotRow>[] = [];

        for (const facility of facilities) {
          try {
            const rows = await snapshotFacility(cfg, token, facility, skuCodes);
            for (const row of rows) {
              const mapped = mapSnapshotRow(row, facility, now);
              if (mapped.sku_code) upserts.push(mapped);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            facilityErrors.push(`${facility}: ${msg.slice(0, 180)}`);
          }
        }

        const chunk = 500;
        for (let i = 0; i < upserts.length; i += chunk) {
          const { error } = await client.from("uni_inventory_mirror").upsert(upserts.slice(i, i + chunk));
          if (error) throw error;
        }

        await client.rpc("uni_finish_sync", {
          p_log_id: logId,
          p_ok: facilityErrors.length < facilities.length,
          p_rows: upserts.length,
          p_error: facilityErrors.length ? facilityErrors.join(" | ").slice(0, 500) : null
        });
        return jsonResponse({
          ok: true,
          rows: upserts.length,
          facilities: facilities.length,
          catalogSkus: skuCodes.length,
          catalogThisRun,
          catalogComplete,
          catalogTruncated: !catalogComplete,
          facilityErrors,
          feed: "inventory"
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await client.rpc("uni_finish_sync", { p_log_id: logId, p_ok: false, p_rows: 0, p_error: msg });
        throw e;
      }
    }

    if (action === "sync_orders") {
      const { data: logId, error: logErr } = await client.rpc("uni_begin_sync", { p_feed: "sale_orders" });
      if (logErr) throw logErr;
      try {
        const token = await uniwareToken(cfg);
        const days = Math.min(Math.max(Number(body.days) || 30, 1), 366);
        const now = new Date();
        const deadline = Date.now() + 110_000;
        const fromDay = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const byCode = new Map<string, Record<string, unknown>>();

        const { count: haveInWindow } = await client
          .from("uni_sale_order")
          .select("uni_code", { count: "exact", head: true })
          .gte("order_date", fromDay);
        // Headers already exist (30k+). Do not re-walk a year every click — that ate the
        // deadline and left uni_sale_order_line empty, so every DRR was 0.
        const headerDays = (haveInWindow || 0) > 100 ? Math.min(days, 3) : days;

        const collectRange = async (fromDate: string, toDate: string, extra: Record<string, unknown>) => {
          const pageSize = 50;
          for (let start = 0; start < 1500; start += pageSize) {
            if (Date.now() > deadline - 70_000) break;
            const search = await uniwarePost(cfg, token, "/services/rest/v1/oms/saleOrder/search", {
              fromDate,
              toDate,
              dateType: "CREATED",
              searchOptions: { displayLength: pageSize, displayStart: start, getCount: start === 0 },
              ...extra
            });
            const els = Array.isArray(search.elements) ? search.elements : [];
            for (const el of els) {
              const code = String((el as { code?: string }).code || "").trim();
              if (code) byCode.set(code, el as Record<string, unknown>);
            }
            if (els.length < pageSize) break;
          }
        };

        const windowMs = Math.min(headerDays, 3) * 24 * 60 * 60 * 1000;
        for (let end = now.getTime(); end > now.getTime() - headerDays * 24 * 60 * 60 * 1000; end -= windowMs) {
          if (Date.now() > deadline - 70_000) break;
          const startMs = Math.max(now.getTime() - headerDays * 24 * 60 * 60 * 1000, end - windowMs);
          await collectRange(new Date(startMs).toISOString(), new Date(end).toISOString(), {});
          if (Date.now() <= deadline - 70_000) {
            await collectRange(new Date(startMs).toISOString(), new Date(end).toISOString(), { channel: "CUSTOM" });
          }
          if (Date.now() <= deadline - 70_000) {
            // Search docs default cashOnDelivery=true; extra prepaid pass so we do not miss sales.
            await collectRange(new Date(startMs).toISOString(), new Date(end).toISOString(), {
              cashOnDelivery: false
            });
          }
        }

        const nowIso = now.toISOString();
        const upserts = [...byCode.values()].map((el) => {
          const created = el.displayOrderDateTime ?? el.created;
          return {
            uni_code: String(el.code),
            channel: asText(el.channel) || asText(el.source),
            status: asText(el.status),
            facility_code: asText(el.facilityCode) || cfg.facility || null,
            customer_name: asText(el.customerName) || asText(el.notificationEmail),
            display_order_code: asText(el.displayOrderCode) || String(el.code),
            order_date: toOrderDate(created),
            payload: {
              code: el.code,
              displayOrderCode: el.displayOrderCode,
              channel: el.channel,
              status: el.status,
              facilityCode: el.facilityCode,
              created,
              customerName: el.customerName
            },
            synced_at: nowIso
          };
        });

        const chunk = 200;
        for (let i = 0; i < upserts.length; i += chunk) {
          const { error } = await client.from("uni_sale_order").upsert(upserts.slice(i, i + chunk));
          if (error) throw error;
        }

        const { data: missing, error: missingErr } = await client.rpc("uni_orders_missing_lines", {
          p_from: fromDay,
          p_limit: 500
        });
        if (missingErr) throw missingErr;
        const needLines = (missing ?? []) as { uni_code: string; order_date: string | null; channel: string | null }[];
        const lineRows: ReturnType<typeof extractSaleOrderItems> = [];
        const checked: string[] = [];
        let getErrors = 0;
        let firstGetError = "";
        await mapPool(needLines, 8, async (order) => {
          if (Date.now() > deadline) return;
          try {
            // Uniware get is lowercase saleorder; search is camelCase saleOrder.
            const got = (await uniwarePost(
              cfg,
              token,
              "/services/rest/v1/oms/saleorder/get",
              { code: order.uni_code },
              ""
            )) as Record<string, unknown>;
            lineRows.push(
              ...extractSaleOrderItems(got as Record<string, unknown>, {
                uni_code: order.uni_code,
                order_date: order.order_date,
                channel: order.channel
              })
            );
            checked.push(order.uni_code);
          } catch (e) {
            getErrors += 1;
            if (!firstGetError) firstGetError = errToMessage(e).slice(0, 220);
          }
        });
        for (let i = 0; i < checked.length; i += 200) {
          const { error } = await client
            .from("uni_sale_order_line")
            .delete()
            .in("uni_code", checked.slice(i, i + 200));
          if (error) throw error;
        }
        for (let i = 0; i < lineRows.length; i += 400) {
          const { error } = await client.from("uni_sale_order_line").upsert(lineRows.slice(i, i + 400));
          if (error) throw error;
        }
        for (let i = 0; i < checked.length; i += 200) {
          const { error } = await client
            .from("uni_sale_order")
            .update({ lines_checked_at: nowIso })
            .in("uni_code", checked.slice(i, i + 200));
          if (error) throw error;
        }

        const { count: stillMissing } = await client
          .from("uni_sale_order")
          .select("uni_code", { count: "exact", head: true })
          .gte("order_date", fromDay)
          .is("lines_checked_at", null);

        const b2b = upserts.filter((r) => String(r.channel || "").toUpperCase() === "CUSTOM").length;
        await client.rpc("uni_finish_sync", {
          p_log_id: logId,
          p_ok: getErrors === 0 || lineRows.length > 0,
          p_rows: lineRows.length,
          p_error: lineRows.length ? null : firstGetError || null
        });
        return jsonResponse({
          ok: true,
          rows: upserts.length,
          lines: lineRows.length,
          lineOrders: checked.length,
          pendingLineOrders: stillMissing ?? 0,
          getErrors,
          firstGetError: firstGetError || null,
          b2b,
          ecom: upserts.length - b2b,
          days,
          headerDays,
          feed: "sale_orders"
        });
      } catch (e) {
        const msg = errToMessage(e);
        await client.rpc("uni_finish_sync", { p_log_id: logId, p_ok: false, p_rows: 0, p_error: msg });
        throw new Error(msg);
      }
    }

    if (action === "adjust") {
      const transferId = String(body.transferId || "");
      const skuCode = String(body.skuCode || "");
      const qty = Number(body.qty);
      const adjustmentType = body.direction === "uniware_to_platform" ? "REMOVE" : "ADD";
      const remarks = String(body.transferNo || transferId);
      if (!skuCode || !(qty > 0)) throw new Error("skuCode and qty are required");
      try {
        const token = await uniwareToken(cfg);
        const result = await uniwarePost(cfg, token, "/services/rest/v1/inventory/adjust", {
          inventoryAdjustment: {
            itemSKU: skuCode,
            quantity: qty,
            adjustmentType,
            inventoryType: "GOOD_INVENTORY",
            remarks
          }
        });
        if (transferId) {
          await client.rpc("uni_mark_transfer_api", {
            p_transfer_id: transferId,
            p_ok: true,
            p_ref: result.adjustmentCode || result.code || remarks,
            p_error: null
          });
        }
        await client.from("uni_sync_log").insert({
          feed: "adjust_out",
          status: "success",
          finished_at: new Date().toISOString(),
          rows_upserted: 1,
          created_by: user.id
        });
        return jsonResponse({ ok: true, result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (transferId) {
          await client.rpc("uni_mark_transfer_api", {
            p_transfer_id: transferId,
            p_ok: false,
            p_ref: null,
            p_error: msg
          });
        }
        throw e;
      }
    }

    return jsonResponse({ error: `Unknown action ${action}` }, 400);
  } catch (e) {
    const msg = errToMessage(e);
    const status = (e as { status?: number }).status || 400;
    return jsonResponse({ error: msg }, status);
  }
});
