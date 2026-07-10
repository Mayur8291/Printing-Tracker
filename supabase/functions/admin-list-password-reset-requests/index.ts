import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callerIsAdmin, corsHeaders, createServiceClient, jsonResponse } from "../_shared/passwordReset.ts";

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
      return jsonResponse({ error: "Forbidden: admin only." }, 403);
    }

    const { data, error } = await client
      .from("password_reset_requests")
      .select(
        "id, user_id, email, requester_role, routing, status, admin_note, requested_at, reviewed_by, reviewed_at, approved_expires_at, completed_at, user:profiles!password_reset_requests_user_id_fkey(full_name, email, role)"
      )
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true, requests: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 400);
  }
});
