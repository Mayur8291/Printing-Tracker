import { supabase } from "./supabaseClient";

/**
 * Read `{ error: "..." }` from a failed Edge Function invoke (FunctionsHttpError).
 */
export async function messageFromFunctionInvoke(error, response) {
  if (!error) return "Unknown error";

  const res = response ?? error?.context;
  if (res && typeof res.json === "function") {
    try {
      const body = await res.clone().json();
      if (body && typeof body === "object" && body.error) {
        return String(body.error);
      }
      if (body && typeof body === "object" && body.message) {
        return String(body.message);
      }
    } catch {
      /* fall through */
    }
    try {
      const text = (await res.clone().text()).trim();
      if (text) return text.slice(0, 500);
    } catch {
      /* fall through */
    }
  }

  const msg = error.message || String(error);
  if (/failed to send a request to the edge function/i.test(msg)) {
    return (
      "Edge function not reachable (often not deployed on this Supabase project). " +
      "An admin must run: npx supabase link --project-ref YOUR_PROJECT_REF && " +
      "npx supabase functions deploy <function-name>. " +
      "For password reset: request-password-reset check-password-reset-status complete-password-reset admin-review-password-reset"
    );
  }
  if (/edge function returned a non-2xx/i.test(msg)) {
    return "Request failed. Sign out, sign in again, then retry. If it still fails, ask an admin to redeploy the function.";
  }
  return msg;
}

async function accessTokenForInvoke() {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) {
    throw new Error(sessionErr.message || "Could not read session.");
  }
  let token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error("You are not signed in. Sign in again and retry.");
  }

  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (!refreshErr && refreshed?.session?.access_token) {
    token = refreshed.session.access_token;
  }

  return token;
}

/**
 * Invoke an admin Edge Function with a fresh JWT and surfaced error text.
 */
export async function invokeAdminEdgeFunction(functionName, body) {
  const accessToken = await accessTokenForInvoke();
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

  let response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body ?? {})
    });
  } catch {
    const ref = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] ?? "unknown";
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
