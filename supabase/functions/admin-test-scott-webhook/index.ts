// Admin-only connectivity test: sends an HMAC-signed test stock.level_changed
// webhook to the Scott International backend so integration can be verified
// from the dashboard without waiting for a real stock mutation.
// Deploy: supabase functions deploy admin-test-scott-webhook
// Secrets: SCOTT_WEBHOOK_SECRET (required). base_url comes from the request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callerIsAdmin, corsHeaders, createServiceClient, jsonResponse } from "../_shared/passwordReset.ts";

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!jwt) {
      return jsonResponse({ error: "Unauthorized: sign in and try again." }, 401);
    }

    const client = createServiceClient();
    const {
      data: { user },
      error: userErr
    } = await client.auth.getUser(jwt);
    if (userErr || !user) {
      return jsonResponse({ error: `Unauthorized: ${userErr?.message ?? "Invalid session"}` }, 401);
    }

    const adminCheck = await callerIsAdmin(client, user.id, user.email ?? "");
    if (!adminCheck.isAdmin) {
      return jsonResponse({ error: "Forbidden: only admins can send test webhooks." }, 403);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const baseUrl = String(body.base_url ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) {
      return jsonResponse({ ok: false, message: "base_url must start with http:// or https://" }, 400);
    }

    const secret = Deno.env.get("SCOTT_WEBHOOK_SECRET")?.trim();
    if (!secret) {
      return jsonResponse({
        ok: false,
        message: "SCOTT_WEBHOOK_SECRET is not set in Edge Function secrets — set it first."
      });
    }

    const payload = JSON.stringify({
      event: "stock.level_changed",
      event_id: `evt_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      occurred_at: new Date().toISOString(),
      facility_code: "TEST",
      trigger: "ADJUST",
      test: true,
      changed_skus: [{ sku_code: "SKU-TEST", previous_stock: 0, current_stock: 0 }]
    });
    const signature = await hmacSha256Hex(secret, payload);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${baseUrl}/webhooks/stock/level_changed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Signature": `sha256=${signature}`
        },
        body: payload,
        signal: controller.signal
      });
      const text = await res.text();
      return jsonResponse({
        ok: res.ok,
        status: res.status,
        message: res.ok ? "" : text.slice(0, 300)
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      return jsonResponse({
        ok: false,
        message: aborted ? "Timed out after 10s — server unreachable." : String(e).slice(0, 300)
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    return jsonResponse({ error: String(e?.message ?? e) }, 500);
  }
});
