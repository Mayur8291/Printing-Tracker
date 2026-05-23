// Deploy: supabase functions deploy admin-delete-user
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
      data: { user: caller },
      error: userErr
    } = await userClient.auth.getUser();
    if (userErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: callerProf } = await adminClient
      .from("profiles")
      .select("role, email")
      .eq("id", caller.id)
      .maybeSingle();

    const callerEmail = (caller.email ?? callerProf?.email ?? "").trim().toLowerCase();
    let listedAsAdmin = false;
    if (callerEmail) {
      const { data: adminRow } = await adminClient
        .from("admin_emails")
        .select("email")
        .ilike("email", callerEmail)
        .maybeSingle();
      listedAsAdmin = Boolean(adminRow);
    }

    const isAdmin = callerProf?.role === "admin" || listedAsAdmin;
    if (!isAdmin) {
      return new Response(
        JSON.stringify({
          error:
            "Forbidden: only admins can remove users. Add your email to admin_emails or set profiles.role to admin."
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const userId = String(body.user_id ?? "").trim();
    if (!userId) {
      throw new Error("user_id is required");
    }

    if (userId === caller.id) {
      throw new Error("You cannot remove your own account while signed in.");
    }

    // Look up target email so we can clean up admin_emails if they were admin.
    const { data: targetProf } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    const targetEmail = (targetProf?.email ?? "").trim().toLowerCase();

    // orders.created_by has no ON DELETE cascade — null it out first to allow auth user deletion.
    const { error: ordersUpdateErr } = await adminClient
      .from("orders")
      .update({ created_by: null })
      .eq("created_by", userId);
    if (ordersUpdateErr) {
      throw new Error(`Failed to detach orders: ${ordersUpdateErr.message}`);
    }

    // Drop from admin_emails so a future re-registration doesn't silently re-promote.
    if (targetEmail) {
      const { error: adminEmailDelErr } = await adminClient
        .from("admin_emails")
        .delete()
        .ilike("email", targetEmail);
      if (adminEmailDelErr) {
        throw new Error(`Failed to clear admin email: ${adminEmailDelErr.message}`);
      }
    }

    // Delete auth user — DB cascades remove profiles + profile_order_permissions rows.
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      throw new Error(deleteErr.message);
    }

    return new Response(JSON.stringify({ ok: true, user_id: userId }), {
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
