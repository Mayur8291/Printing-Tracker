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

async function uniwarePost(cfg: ReturnType<typeof uniwareConfig>, token: string, path: string, payload: unknown) {
  const res = await fetch(`${cfg.base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      Facility: cfg.facility || ""
    },
    body: JSON.stringify(payload ?? {})
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.successful === false) {
    throw new Error(`Uniware ${path} failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
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
        const snap = await uniwarePost(cfg, token, "/services/rest/v1/inventory/inventorySnapshot/get", {
          inventoryType: "GOOD_INVENTORY"
        });
        const rows = Array.isArray(snap.inventorySnapshots)
          ? snap.inventorySnapshots
          : Array.isArray(snap.inventorySnapshotDTOs)
            ? snap.inventorySnapshotDTOs
            : [];
        const facility = cfg.facility || "DEFAULT";
        const now = new Date().toISOString();
        const upserts = rows
          .map((r: Record<string, unknown>) => ({
            facility_code: facility,
            sku_code: String(r.itemSKU || r.skuCode || r.itemTypeSKU || "").trim(),
            inventory_type: String(r.inventoryType || "GOOD_INVENTORY"),
            qty: Number(r.inventory || r.quantity || 0),
            synced_at: now
          }))
          .filter((r) => r.sku_code);
        if (upserts.length) {
          const { error } = await client.from("uni_inventory_mirror").upsert(upserts);
          if (error) throw error;
        }
        await client.rpc("uni_finish_sync", {
          p_log_id: logId,
          p_ok: true,
          p_rows: upserts.length,
          p_error: null
        });
        return jsonResponse({ ok: true, rows: upserts.length, feed: "inventory" });
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
        const minutes = Number(body.updatedSinceMinutes) || 180;
        const search = await uniwarePost(cfg, token, "/services/rest/v1/oms/saleOrder/search", {
          updatedSinceInMinutes: minutes
        });
        const codes: string[] = (search.saleOrderCodes || search.elements || [])
          .map((c: unknown) => (typeof c === "string" ? c : (c as { code?: string })?.code))
          .filter(Boolean);
        let upserted = 0;
        for (const code of codes.slice(0, 200)) {
          const got = await uniwarePost(cfg, token, "/services/rest/v1/oms/saleOrder/get", { code });
          const so = got.saleOrder || got;
          const { error } = await client.from("uni_sale_order").upsert({
            uni_code: String(so.code || code),
            channel: so.channel || so.source || null,
            status: so.status || null,
            facility_code: cfg.facility || null,
            customer_name: so.billingParty?.name || so.customerName || null,
            display_order_code: so.displayOrderCode || so.code || code,
            order_date: so.created ? String(so.created).slice(0, 10) : null,
            payload: so,
            synced_at: new Date().toISOString()
          });
          if (error) throw error;
          upserted++;
        }
        await client.rpc("uni_finish_sync", {
          p_log_id: logId,
          p_ok: true,
          p_rows: upserted,
          p_error: null
        });
        return jsonResponse({ ok: true, rows: upserted, feed: "sale_orders" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await client.rpc("uni_finish_sync", { p_log_id: logId, p_ok: false, p_rows: 0, p_error: msg });
        throw e;
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
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number }).status || 400;
    return jsonResponse({ error: msg }, status);
  }
});
