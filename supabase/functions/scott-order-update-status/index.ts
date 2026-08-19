// Authenticated dashboard users: progress Scott RMP order status (syncs to app via webhook).
// Wraps dashboard-stock-api order handlers — PROCESSING, COMPLETE, FAILED, CANCELLED.
// Deploy: supabase functions deploy scott-order-update-status

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCancelOrder, handleSetOrderStatus } from "../dashboard-stock-api/orders.ts";
import { corsHeaders, createServiceClient, jsonResponse } from "../_shared/passwordReset.ts";

async function forwardHandler(result: Response) {
  let body: Record<string, unknown> = {};
  try {
    body = (await result.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!result.ok) {
    const details = body.details as Record<string, unknown> | undefined;
    const message =
      (typeof details?.message === "string" && details.message) ||
      (typeof body.message === "string" && body.message) ||
      String(body.error ?? "Status update failed.");
    return jsonResponse({ error: message, code: body.error ?? null }, result.status);
  }
  return jsonResponse(body, result.status);
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

    const body = (await req.json()) as Record<string, unknown>;
    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) {
      return jsonResponse({ error: "order_id is required." }, 400);
    }

    const action = String(body.action ?? "set_status").trim().toLowerCase();

    if (action === "cancel") {
      const reason = String(body.reason ?? "CUSTOMER_CANCELLED").trim() || "CUSTOMER_CANCELLED";
      const fakeReq = new Request(`https://local/?reason=${encodeURIComponent(reason)}`, {
        method: "DELETE"
      });
      return await forwardHandler(await handleCancelOrder(orderId, fakeReq, client));
    }

    const status = String(body.status ?? "").trim().toUpperCase();
    if (!status) {
      return jsonResponse({ error: "status is required (PROCESSING, COMPLETE, or FAILED)." }, 400);
    }

    const fakeReq = new Request("https://local/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        dispatched_at: body.dispatched_at ?? undefined
      })
    });
    return await forwardHandler(await handleSetOrderStatus(orderId, fakeReq, client));
  } catch (e) {
    return jsonResponse({ error: String(e?.message ?? e) }, 500);
  }
});
