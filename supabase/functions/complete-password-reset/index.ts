import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  createServiceClient,
  findProfileByEmail,
  jsonResponse,
  normalizeEmail
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
    const password = String(body.password ?? "");
    const confirmPassword = String(body.confirm_password ?? body.confirmPassword ?? "");

    if (!email) throw new Error("Email is required.");
    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }
    if (password !== confirmPassword) {
      throw new Error("Passwords do not match.");
    }

    const client = createServiceClient();
    const profile = await findProfileByEmail(client, email);
    if (!profile) {
      throw new Error("No approved reset request for this email.");
    }

    const { data: approvedRequest, error: reqErr } = await client
      .from("password_reset_requests")
      .select("id, status, approved_expires_at")
      .eq("user_id", profile.id)
      .eq("status", "approved")
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!approvedRequest) {
      throw new Error("No approved reset request. Wait for admin approval or submit a new request.");
    }

    const expiresAt = approvedRequest.approved_expires_at
      ? new Date(approvedRequest.approved_expires_at).getTime()
      : 0;
    if (expiresAt && expiresAt < Date.now()) {
      await client
        .from("password_reset_requests")
        .update({ status: "rejected", admin_note: "Approval expired before password change." })
        .eq("id", approvedRequest.id);
      throw new Error("Approval expired. Submit a new reset request.");
    }

    const { error: updateErr } = await client.auth.admin.updateUserById(profile.id, { password });
    if (updateErr) throw new Error(updateErr.message);

    const now = new Date().toISOString();
    const { error: completeErr } = await client
      .from("password_reset_requests")
      .update({ status: "completed", completed_at: now })
      .eq("id", approvedRequest.id);
    if (completeErr) throw new Error(completeErr.message);

    return jsonResponse({ ok: true, message: "Password updated. You can sign in now." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 400);
  }
});
