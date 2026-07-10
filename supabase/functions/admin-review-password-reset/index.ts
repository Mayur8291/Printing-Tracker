import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  callerIsAdmin,
  corsHeaders,
  createServiceClient,
  jsonResponse,
  MAIN_ADMIN_EMAIL
} from "../_shared/passwordReset.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !anonKey) {
      throw new Error("Server misconfiguration: missing Supabase env");
    }

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
      return jsonResponse({ error: "Forbidden: only admins can review password reset requests." }, 403);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const requestId = String(body.request_id ?? "").trim();
    const action = String(body.action ?? "").trim().toLowerCase();
    const adminNote = String(body.admin_note ?? body.adminNote ?? "").trim();

    if (!requestId) throw new Error("request_id is required.");
    if (action !== "approve" && action !== "reject") {
      throw new Error("action must be approve or reject.");
    }

    const { data: requestRow, error: fetchErr } = await client
      .from("password_reset_requests")
      .select("id, user_id, email, status, routing, requester_role")
      .eq("id", requestId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!requestRow) throw new Error("Request not found.");
    if (requestRow.status !== "pending") {
      throw new Error(`Request is already ${requestRow.status}.`);
    }

    if (requestRow.routing === "main_admin" && !adminCheck.isMainAdmin) {
      return jsonResponse(
        {
          error: `Only the main administrator (${MAIN_ADMIN_EMAIL}) can approve reset requests from admin users.`
        },
        403
      );
    }

    const now = new Date();
    const patch: Record<string, unknown> = {
      reviewed_by: user.id,
      reviewed_at: now.toISOString(),
      admin_note: adminNote || null
    };

    if (action === "approve") {
      const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      patch.status = "approved";
      patch.approved_expires_at = expires.toISOString();
    } else {
      patch.status = "rejected";
    }

    const { error: updateErr } = await client
      .from("password_reset_requests")
      .update(patch)
      .eq("id", requestId);
    if (updateErr) throw new Error(updateErr.message);

    return jsonResponse({
      ok: true,
      request_id: requestId,
      status: patch.status,
      message:
        action === "approve"
          ? "Approved. User can set a new password on the login screen."
          : "Request rejected."
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 400);
  }
});
