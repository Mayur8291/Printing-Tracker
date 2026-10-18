// All externally reachable writes enter one SQL transaction. No HTTP write retries.
import {
  deliverPendingWebhooks,
  errorResponse,
  jsonResponse,
  type SupabaseAdmin,
} from "./stockCore.ts";

export async function atomicMutation(
  req: Request,
  client: SupabaseAdmin,
  action: string,
  target: string | null = null,
) {
  const key = req.headers.get("Idempotency-Key") ??
    `legacy_${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(key)) {
    return errorResponse(400, "INVALID_IDEMPOTENCY_KEY");
  }
  let body: unknown;
  if (req.method === "DELETE") {
    body = {
      reason: new URL(req.url).searchParams.get("reason") ?? "CANCELLED",
    };
  } else {
    const raw = await req.text();
    if (raw.length > 262144) return errorResponse(413, "REQUEST_TOO_LARGE");
    try {
      body = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      return errorResponse(400, "INVALID_JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(400, "INVALID_REQUEST");
    }
  }
  const { data, error } = await client.rpc("dashboard_mutate_v1", {
    p_request_id: key,
    p_action: action,
    p_target: target,
    p_body: body,
  });
  if (error) {
    if (error.code === "23505") {
      return errorResponse(409, "IDEMPOTENCY_CONFLICT");
    }
    throw new Error(
      "Atomic mutation unavailable; reconcile the original request ID before retrying.",
    );
  }
  // The business result is already durable; delivery failure must never turn it
  // into a failed stock response. Outbox retains unsent events for later drain.
  try {
    await deliverPendingWebhooks(client);
  } catch { /* durable outbox remains */ }
  return jsonResponse(data.body, data.status);
}

export async function atomicMutationResult(client: SupabaseAdmin, key: string) {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(key)) {
    return errorResponse(400, "INVALID_IDEMPOTENCY_KEY");
  }
  const { data, error } = await client.rpc("dashboard_mutation_result_v1", {
    p_request_id: key,
  });
  if (error) throw new Error("Mutation reconciliation unavailable");
  return data ? jsonResponse(data) : errorResponse(404, "MUTATION_NOT_FOUND");
}

export async function routeAtomicMutation(
  req: Request,
  client: SupabaseAdmin,
  path: string,
): Promise<Response | null> {
  if (req.method === "GET" && path === "/api/v1/capabilities") {
    return jsonResponse({
      schema_version: 1,
      atomic_mutations_v1: true,
      order_edit_cas: true,
      durable_mutation_results: true,
    });
  }
  if (req.method === "GET" && path.startsWith("/api/v1/mutations/")) {
    return await atomicMutationResult(
      client,
      decodeURIComponent(path.slice("/api/v1/mutations/".length)),
    );
  }
  const stock = path.match(
    /^\/api\/v1\/stock\/(reserve|adjust|fulfill)(?:\/([^/]+))?$/,
  );
  if (stock && (req.method === "POST" || req.method === "DELETE")) {
    if (req.method === "DELETE" && stock[1] !== "reserve") {
      return errorResponse(405, "METHOD_NOT_ALLOWED");
    }
    const action = req.method === "DELETE" ? "release" : stock[1];
    if ((action === "release" || action === "fulfill") !== Boolean(stock[2])) {
      return errorResponse(400, "INVALID_REQUEST");
    }
    return await atomicMutation(
      req,
      client,
      action,
      stock[2] ? decodeURIComponent(stock[2]) : null,
    );
  }
  if (req.method === "POST" && path === "/api/v1/orders") {
    return await atomicMutation(req, client, "create");
  }
  const order = path.match(/^\/api\/v1\/orders\/([^/]+)(\/status)?$/);
  if (order && ["PATCH", "DELETE", "POST"].includes(req.method)) {
    const action = order[2] && req.method === "POST"
      ? "status"
      : !order[2] && req.method === "PATCH"
      ? "edit"
      : !order[2] && req.method === "DELETE"
      ? "cancel"
      : null;
    if (!action) return errorResponse(405, "METHOD_NOT_ALLOWED");
    return await atomicMutation(
      req,
      client,
      action,
      decodeURIComponent(order[1]),
    );
  }
  return null;
}
