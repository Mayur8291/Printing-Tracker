// Deploy: supabase functions deploy admin-create-user
// Hosted projects inject SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !serviceKey || !anonKey) {
      throw new Error("Server misconfiguration: missing Supabase env");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const {
      data: { user },
      error: userErr
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: prof } = await adminClient
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    const emailForAdminCheck = (user.email ?? prof?.email ?? "").trim().toLowerCase();
    let listedAsAdmin = false;
    if (emailForAdminCheck) {
      const { data: adminRow } = await adminClient
        .from("admin_emails")
        .select("email")
        .ilike("email", emailForAdminCheck)
        .maybeSingle();
      listedAsAdmin = Boolean(adminRow);
    }

    const isAdmin = prof?.role === "admin" || listedAsAdmin;
    if (!isAdmin) {
      return new Response(
        JSON.stringify({
          error:
            "Forbidden: only admins can create users. Add your email to admin_emails or set profiles.role to admin."
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    const full_name = String(body.full_name ?? "").trim();
    const perm = (body.permissions ?? {}) as Record<string, boolean>;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Valid email is required");
    }
    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || email.split("@")[0] }
    });

    if (createErr) {
      throw new Error(createErr.message);
    }

    const newId = created.user.id;

    const { error: profileUpsertErr } = await adminClient.from("profiles").upsert(
      {
        id: newId,
        email: email.toLowerCase(),
        full_name: full_name || email.split("@")[0],
        role: "viewer"
      },
      { onConflict: "id" }
    );
    if (profileUpsertErr) {
      throw new Error(profileUpsertErr.message);
    }

    const { error: permUpsertErr } = await adminClient.from("profile_order_permissions").upsert(
      {
        user_id: newId,
        can_edit_status: perm.can_edit_status !== false,
        can_edit_remarks: Boolean(perm.can_edit_remarks),
        can_edit_due_date: Boolean(perm.can_edit_due_date),
        can_edit_qty: Boolean(perm.can_edit_qty),
        can_edit_coordinator_name: Boolean(perm.can_edit_coordinator_name),
        can_edit_printing_mtrs: Boolean(perm.can_edit_printing_mtrs),
        can_edit_received_at_printing: Boolean(perm.can_edit_received_at_printing),
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );
    if (permUpsertErr) {
      throw new Error(permUpsertErr.message);
    }

    return new Response(JSON.stringify({ ok: true, user_id: newId, email }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
