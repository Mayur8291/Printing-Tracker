import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const MAIN_ADMIN_EMAIL = "admin@scott.com";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

export function createServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Server misconfiguration: missing Supabase env");
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function normalizeEmail(email: unknown) {
  return String(email ?? "").trim().toLowerCase();
}

export async function findProfileByEmail(client: SupabaseClient, email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data, error } = await client
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .ilike("email", normalized)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function callerIsAdmin(client: SupabaseClient, userId: string, email: string) {
  const { data: prof } = await client.from("profiles").select("role, email").eq("id", userId).maybeSingle();
  const emailForCheck = normalizeEmail(email || prof?.email);
  let listedAsAdmin = false;
  if (emailForCheck) {
    const { data: adminRow } = await client
      .from("admin_emails")
      .select("email")
      .ilike("email", emailForCheck)
      .maybeSingle();
    listedAsAdmin = Boolean(adminRow);
  }
  return {
    isAdmin: prof?.role === "admin" || listedAsAdmin,
    isMainAdmin: emailForCheck === normalizeEmail(MAIN_ADMIN_EMAIL)
  };
}

export async function resolveRequesterRouting(client: SupabaseClient, profile: {
  id: string;
  role?: string | null;
  email?: string | null;
}) {
  const email = normalizeEmail(profile.email);
  let listedAsAdmin = false;
  if (email) {
    const { data: adminRow } = await client
      .from("admin_emails")
      .select("email")
      .ilike("email", email)
      .maybeSingle();
    listedAsAdmin = Boolean(adminRow);
  }
  const isAdminUser = profile.role === "admin" || listedAsAdmin;
  return {
    requester_role: isAdminUser ? "admin" : "viewer",
    routing: isAdminUser ? "main_admin" : "panel_admin"
  };
}
