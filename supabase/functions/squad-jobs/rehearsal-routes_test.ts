import { createHandler, serviceRpc } from "./handler.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("assertion failed");
};
const secret = "fixture-worker-secret-at-least-thirty-two-characters",
  id = "00000000-0000-4000-8000-000000000035";
const routes = ["warehouse-rehearsal", "mail-rehearsal"];
const body = (route: string) =>
  route === "warehouse-rehearsal"
    ? { run_id: id, step: "preflight" }
    : { capability_id: id };
function setup(project = "scvojtvgnkmbupvyslmb", fail = false) {
  const calls: unknown[] = [], forbidden: string[] = [];
  const handler = createHandler(
    secret,
    async (name) => {
      forbidden.push(name);
      throw new Error("generic RPC forbidden");
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      rehearsalProjectRef: project,
      heartbeat: async () => {
        forbidden.push("heartbeat");
      },
      warehouseRehearsal: async (run, step) => {
        calls.push([run, step]);
        if (fail) throw new Error("credential SQL secret");
        return { run_id: run, step, state: "done" };
      },
      weeklyMailRehearsal: async (capability) => {
        calls.push([capability]);
        if (fail) throw new Error("credential SQL secret");
        return { state: "idle", results: [] };
      },
    },
  );
  return { handler, calls, forbidden };
}
function req(
  route: string,
  payload: unknown = body(route),
  auth = `Bearer ${secret}`,
  content = "application/json",
  method = "POST",
) {
  return new Request(
    `https://fixture.invalid/functions/v1/squad-jobs/${route}`,
    {
      method,
      headers: { Authorization: auth, "Content-Type": content },
      ...(method === "POST"
        ? {
          body: typeof payload === "string" ? payload : JSON.stringify(payload),
        }
        : {}),
    },
  );
}
Deno.test("rehearsal routes require worker secret and POST before any capability call", async () => {
  for (const route of routes) {
    for (const auth of ["", "Bearer invalid", "Bearer " + "x".repeat(1100)]) {
      const f = setup();
      assert(
        (await f.handler(req(route, body(route), auth))).status === 401 &&
          !f.calls.length,
      );
    }
    const f = setup();
    assert(
      (await f.handler(req(route, undefined, undefined, undefined, "GET")))
            .status === 405 && !f.calls.length,
    );
  }
});
Deno.test("rehearsal routes fail closed outside staging and without installed capability worker", async () => {
  for (const route of routes) {
    const f = setup("levwrmvqdntngeasrtnb");
    assert((await f.handler(req(route))).status === 503 && !f.calls.length);
    assert(
      (await createHandler(secret, async () => {
        throw new Error("forbidden");
      })(req(route))).status === 503,
    );
  }
});
Deno.test("rehearsal routes accept only fixed capability IDs and warehouse step, never recipients or DTOs", async () => {
  for (const route of routes) {
    for (
      const input of [
        null,
        [],
        {},
        { ...body(route), email: "somebody@mailinator.com" },
        { ...body(route), job_id: id },
        { ...body(route), payload: {} },
        { ...body(route), actor_id: id },
        { run_id: "all", step: "preflight" },
        { run_id: id, step: "ship" },
        { capability_id: "all" },
        "{bad",
      ]
    ) {
      const f = setup();
      assert(
        (await f.handler(req(route, input))).status === 400 && !f.calls.length,
      );
    }
  }
});
Deno.test("rehearsal route body MIME and byte bounds precede capability execution", async () => {
  for (const route of routes) {
    for (const content of ["text/plain", "", "application/jsonx"]) {
      const f = setup();
      assert(
        (await f.handler(req(route, body(route), undefined, content)))
              .status === 400 && !f.calls.length,
      );
    }
    const f = setup();
    assert(
      (await f.handler(
            req(route, { ...body(route), padding: "x".repeat(4096) }),
          )).status === 400 && !f.calls.length,
    );
  }
});
Deno.test("rehearsal routes call one exact capability and no generic claim or heartbeat", async () => {
  for (const route of routes) {
    const f = setup(), r = await f.handler(req(route));
    assert(
      r.status === 200 && f.calls.length === 1 && !f.forbidden.length &&
        r.headers.get("cache-control") === "no-store",
    );
  }
});
Deno.test("rehearsal route failures redact secrets and never retry worker automatically", async () => {
  for (const route of routes) {
    const f = setup(undefined, true),
      r = await f.handler(req(route)),
      text = await r.text();
    assert(
      r.status === 503 && !text.includes("secret") && f.calls.length === 1 &&
        !f.forbidden.length,
    );
  }
});
Deno.test("service RPC allows only named rehearsal commands without arbitrary RPC escape", async () => {
  const saved = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  };
  try {
    const rpc = serviceRpc("https://fixture.invalid", "fixture");
    for (
      const name of [
        "squad_warehouse_rehearsal_prepare",
        "squad_warehouse_rehearsal_finish",
        "squad_weekly_mail_rehearsal_tick",
        "squad_weekly_mail_rehearsal_send_begin",
      ]
    ) await rpc(name, {});
    try {
      await rpc("arbitrary_sql", {});
      throw new Error("unexpected success");
    } catch (e) {
      assert((e as Error).message === "unknown_rpc");
    }
    assert(calls.length === 4);
  } finally {
    globalThis.fetch = saved;
  }
});
