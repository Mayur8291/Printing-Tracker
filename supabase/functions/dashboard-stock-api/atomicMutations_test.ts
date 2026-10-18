import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { routeAtomicMutation } from "./atomicMutations.ts";
import type { SupabaseAdmin } from "./stockCore.ts";

for (
  const [method, path, action] of [
    ["POST", "/api/v1/stock/reserve", "reserve"],
    ["DELETE", "/api/v1/stock/reserve/rsv_test", "release"],
    ["POST", "/api/v1/stock/fulfill/rsv_test", "fulfill"],
    ["POST", "/api/v1/stock/adjust", "adjust"],
    ["POST", "/api/v1/orders", "create"],
    ["PATCH", "/api/v1/orders/ord_test", "edit"],
    ["DELETE", "/api/v1/orders/ord_test", "cancel"],
    ["POST", "/api/v1/orders/ord_test/status", "status"],
  ]
) {
  Deno.test(`Scott ${method} ${path} reaches atomic ${action} exactly once`, async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({
          data: { status: 200, body: { ok: true } },
          error: null,
        });
      },
      from() {
        throw new Error("No live webhook delivery in test");
      },
    } as unknown as SupabaseAdmin;
    const request = new Request(`https://example.test${path}`, {
      method,
      headers: { "Idempotency-Key": "NFOP_test_identity" },
      ...(method === "DELETE" ? {} : { body: "{}" }),
    });
    const response = await routeAtomicMutation(request, client, path);
    assertEquals(response?.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].name, "dashboard_mutate_v1");
    assertEquals(calls[0].args.p_action, action);
    assertEquals(calls[0].args.p_request_id, "NFOP_test_identity");
  });
}
Deno.test("Scott snapshots remain provider-free read route", async () => {
  const client = {
    rpc() {
      throw new Error("not expected");
    },
  } as unknown as SupabaseAdmin;
  assertEquals(
    await routeAtomicMutation(
      new Request("https://example.test/api/v1/stock/snapshot"),
      client,
      "/api/v1/stock/snapshot",
    ),
    null,
  );
});
