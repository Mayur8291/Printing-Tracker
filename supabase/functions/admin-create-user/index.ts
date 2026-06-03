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
    const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized: sign in and try again" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const {
      data: { user },
      error: userErr
    } = await adminClient.auth.getUser(jwt);
    if (userErr || !user) {
      const detail = userErr?.message ?? "Invalid or expired session";
      return new Response(JSON.stringify({ error: `Unauthorized: ${detail}` }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

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
    const department = String(body.department ?? "").trim();
    const job_role = String(body.job_role ?? "").trim();
    const employee_id = String(body.employee_id ?? "").trim();
    const roleInput = String(body.role ?? "viewer").trim().toLowerCase();
    const role = roleInput === "admin" ? "admin" : "viewer";
    const status_tones_enabled = body.status_tones_enabled === false ? false : true;
    const perm = (body.permissions ?? {}) as Record<string, unknown>;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Valid email is required");
    }
    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    // If admin role requested, seed admin_emails BEFORE auth user creation so the
    // `handle_new_user` DB trigger inserts the profile with role='admin'.
    if (role === "admin") {
      const { error: adminEmailErr } = await adminClient
        .from("admin_emails")
        .upsert({ email }, { onConflict: "email" });
      if (adminEmailErr) {
        throw new Error(`Failed to register admin email: ${adminEmailErr.message}`);
      }
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
        department: department || null,
        job_role: job_role || null,
        employee_id: employee_id || null,
        role,
        status_tones_enabled,
        is_active: true
      },
      { onConflict: "id" }
    );
    if (profileUpsertErr) {
      throw new Error(profileUpsertErr.message);
    }

    // Only viewers get per-field permissions; admins have implicit full access.
    if (role === "viewer") {
      const allowedTabsRaw = perm.allowed_dashboard_tabs;
      const allowed_dashboard_tabs =
        allowedTabsRaw === null || allowedTabsRaw === undefined
          ? null
          : Array.isArray(allowedTabsRaw)
            ? allowedTabsRaw.map((id) => String(id))
            : null;
      const editableTabsRaw = perm.editable_dashboard_tabs;
      const editable_dashboard_tabs =
        editableTabsRaw === null || editableTabsRaw === undefined
          ? null
          : Array.isArray(editableTabsRaw)
            ? editableTabsRaw.map((id) => String(id))
            : null;

      const { error: permUpsertErr } = await adminClient.from("profile_order_permissions").upsert(
        {
          user_id: newId,
          can_edit_status: perm.can_edit_status !== false,
          can_edit_remarks: Boolean(perm.can_edit_remarks),
          can_edit_due_date: Boolean(perm.can_edit_due_date),
          can_edit_qty: Boolean(perm.can_edit_qty),
          can_edit_coordinator_name: Boolean(perm.can_edit_coordinator_name),
          can_edit_printing_mtrs: Boolean(perm.can_edit_printing_mtrs),
          can_edit_approved_design_images: perm.can_edit_approved_design_images !== false,
          can_edit_received_at_printing: Boolean(perm.can_edit_received_at_printing),
          can_edit_payment_method: Boolean(perm.can_edit_payment_method),
          can_create_orders: Boolean(perm.can_create_orders),
          allowed_dashboard_tabs,
          editable_dashboard_tabs,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      );
      if (permUpsertErr) {
        throw new Error(permUpsertErr.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, user_id: newId, email, role }), {
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
