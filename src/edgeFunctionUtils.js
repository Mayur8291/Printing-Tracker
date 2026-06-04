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
      "npx supabase functions deploy admin-promote-production. See docs/RELEASE_AUTOMATION.md."
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

  const { data, error, response } = await supabase.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (error) {
    throw new Error(await messageFromFunctionInvoke(error, response));
  }
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }

  return data;
}
