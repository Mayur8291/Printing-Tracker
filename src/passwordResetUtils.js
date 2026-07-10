import { invokeAdminEdgeFunction } from "./edgeFunctionUtils";

export const MAIN_ADMIN_EMAIL = "admin@scott.com";

export function isMainAdminEmail(email) {
  return String(email ?? "").trim().toLowerCase() === MAIN_ADMIN_EMAIL;
}

export function isMainAdminProfile(profile) {
  return isMainAdminEmail(profile?.email);
}

function supabaseProjectRef() {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? "");
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] ?? "unknown";
}

/** Public Edge Function invoke (login screen — no session). Uses fetch + anon JWT. */
export async function invokePublicEdgeFunction(functionName, body) {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase env vars for password reset.");
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify(body ?? {})
    });
  } catch {
    const ref = supabaseProjectRef();
    throw new Error(
      `Cannot reach ${functionName} on Supabase project ${ref}. ` +
        `Deploy with: npx supabase link --project-ref ${ref} && npx supabase functions deploy ${functionName}`
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }
  if (data && typeof data === "object" && data.error) {
    throw new Error(String(data.error));
  }
  return data;
}

export async function requestPasswordReset(email) {
  return invokePublicEdgeFunction("request-password-reset", { email: String(email ?? "").trim() });
}

export async function checkPasswordResetStatus(email) {
  return invokePublicEdgeFunction("check-password-reset-status", { email: String(email ?? "").trim() });
}

export async function completePasswordReset(email, password, confirmPassword) {
  return invokePublicEdgeFunction("complete-password-reset", {
    email: String(email ?? "").trim(),
    password,
    confirm_password: confirmPassword
  });
}

export async function reviewPasswordResetRequest(requestId, action, adminNote = "") {
  return invokeAdminEdgeFunction("admin-review-password-reset", {
    request_id: requestId,
    action,
    admin_note: adminNote
  });
}

export async function fetchPasswordResetRequests() {
  const data = await invokeAdminEdgeFunction("admin-list-password-reset-requests", {});
  return data?.requests ?? [];
}

export function filterRequestsForAdmin(requests, profile) {
  const mainAdmin = isMainAdminProfile(profile);
  return (requests ?? []).filter((row) => {
    if (row.routing === "main_admin") return mainAdmin;
    return true;
  });
}

export function canAdminActionRequest(request, profile) {
  if (!request || request.status !== "pending") return false;
  if (request.routing === "main_admin") return isMainAdminProfile(profile);
  return true;
}

export function passwordResetStatusLabel(status) {
  switch (status) {
    case "pending":
      return "Pending approval";
    case "approved":
      return "Approved — user may set password";
    case "rejected":
      return "Rejected";
    case "completed":
      return "Completed";
    default:
      return status ?? "—";
  }
}

export function passwordResetRoutingLabel(routing) {
  return routing === "main_admin" ? "Main admin (admin@scott.com)" : "Any admin";
}
