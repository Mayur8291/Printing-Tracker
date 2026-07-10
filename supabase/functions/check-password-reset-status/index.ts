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
    if (!email) {
      throw new Error("Email is required.");
    }

    const client = createServiceClient();
    const profile = await findProfileByEmail(client, email);
    if (!profile) {
      return jsonResponse({ status: "none" });
    }

    const { data: openRequest } = await client
      .from("password_reset_requests")
      .select("id, status, approved_expires_at, routing")
      .eq("user_id", profile.id)
      .in("status", ["pending", "approved"])
      .order("requested_at", { ascending: false })
      .maybeSingle();

    if (!openRequest) {
      return jsonResponse({ status: "none" });
    }

    if (openRequest.status === "approved") {
      const expiresAt = openRequest.approved_expires_at
        ? new Date(openRequest.approved_expires_at).getTime()
        : 0;
      if (expiresAt && expiresAt < Date.now()) {
        await client
          .from("password_reset_requests")
          .update({ status: "rejected", admin_note: "Approval expired." })
          .eq("id", openRequest.id);
        return jsonResponse({ status: "none", message: "Approval expired. Submit a new request." });
      }
    }

    return jsonResponse({
      status: openRequest.status,
      routing: openRequest.routing,
      approved_expires_at: openRequest.approved_expires_at
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 400);
  }
});
