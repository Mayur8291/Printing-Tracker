// Deploy: supabase functions deploy admin-promote-production
// Secrets: GITHUB_PROMOTE_TOKEN (PAT with repo + workflow), optional GITHUB_REPO (owner/name)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const WORKFLOW_FILE = "promote-to-production.yml";

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
    const githubToken = Deno.env.get("GITHUB_PROMOTE_TOKEN") ?? "";
    const githubRepo = Deno.env.get("GITHUB_REPO") ?? "Mayur8291/Printing-Tracker";

    if (!supabaseUrl || !serviceKey || !anonKey) {
      throw new Error("Server misconfiguration: missing Supabase env");
    }
    if (!githubToken) {
      return new Response(
        JSON.stringify({
          error:
            "Release automation not configured. Set GITHUB_PROMOTE_TOKEN on this edge function (see docs/RELEASE_AUTOMATION.md)."
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ error: `Unauthorized: ${userErr?.message ?? "Invalid session"}` }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(JSON.stringify({ error: "Forbidden: only admins can release to production" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({ ref: "main" })
      }
    );

    if (!ghRes.ok) {
      const text = await ghRes.text();
      return new Response(
        JSON.stringify({
          error: `GitHub workflow trigger failed (${ghRes.status}): ${text.slice(0, 400)}`
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const actionsUrl = `https://github.com/${githubRepo}/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}`;

    return new Response(
      JSON.stringify({
        ok: true,
        message:
          "Production release started. GitHub is merging develop → main, applying migrations, and deploying functions.",
        actions_url: actionsUrl
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
