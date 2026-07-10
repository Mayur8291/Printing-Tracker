import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  createServiceClient,
  findProfileByEmail,
  jsonResponse,
  normalizeEmail,
  resolveRequesterRouting
} from "../_shared/passwordReset.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) {
      throw new Error("Email is required.");
    }

    const client = createServiceClient();
    const profile = await findProfileByEmail(client, email);
    if (!profile) {
      return jsonResponse({
        ok: true,
        message: "If this email is registered, an admin will review your request."
      });
    }
    if (profile.is_active === false) {
      throw new Error("This account is inactive. Contact an administrator.");
    }

    const { data: existing } = await client
      .from("password_reset_requests")
      .select("id, status")
      .eq("user_id", profile.id)
      .in("status", ["pending", "approved"])
      .maybeSingle();

    if (existing?.status === "pending") {
      return jsonResponse({
        ok: true,
        status: "pending",
        message: "A reset request is already waiting for admin approval."
      });
    }
    if (existing?.status === "approved") {
      return jsonResponse({
        ok: true,
        status: "approved",
        message: "Your request is approved. Set a new password on this screen."
      });
    }

    const routing = await resolveRequesterRouting(client, profile);
    const { error: insertErr } = await client.from("password_reset_requests").insert({
      user_id: profile.id,
      email: normalizeEmail(profile.email) || email,
      requester_role: routing.requester_role,
      routing: routing.routing,
      status: "pending"
    });
    if (insertErr) throw new Error(insertErr.message);

    const approverHint =
      routing.routing === "main_admin"
        ? "The main administrator (admin@scott.com) will review your request."
        : "An administrator will review your request.";

    return jsonResponse({
      ok: true,
      status: "pending",
      routing: routing.routing,
      message: `Request submitted. ${approverHint}`
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 400);
  }
});
