import { weeklyMailRehearsal } from "./weekly-mail-rehearsal.ts";
import type { Rpc } from "./handler.ts";
import type { DocumentStorage } from "./documents.ts";
import type { ProjectMailConfig } from "../_shared/squad-mail.ts";
import type { BusinessMailCapability } from "./business-mail.ts";
const assert = (v: unknown, text = "assertion failed") => {
  if (!v) throw new Error(text);
};
const cap = "00000000-0000-4000-8000-000000000035",
  job = "00000000-0000-4000-8000-000000000036",
  lease = "00000000-0000-4000-8000-000000000037",
  doc = "00000000-0000-4000-8000-000000000038";
const email = "squad-weekly-fixture@mailinator.com", now = Date.now();
const config: ProjectMailConfig = {
  projectRef: "scvojtvgnkmbupvyslmb",
  host: "fixture.invalid",
  port: 465,
  username: "fixture",
  password: "fixture",
  sender: "fixture@example.invalid",
  allowedRecipients: ["unrelated@mailinator.com"],
};
function fixture(
  options: {
    tick?: unknown;
    projectRef?: string;
    begin?: unknown;
    sendError?: boolean;
    finishError?: boolean;
    message?: Record<string, unknown>;
    fanoutPrepared?: boolean;
  } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [],
    sendConfigs: ProjectMailConfig[] = [],
    sendCapabilities: BusinessMailCapability[] = [],
    effects: string[] = [];
  const tick = options.tick ?? {
    state: "claimed",
    schedule: { secret: "not-exposed" },
    jobs: [{
      id: job,
      lease_token: lease,
      handler: "business_mail",
      attempt: 1,
      lease_until: new Date(now + 120_000).toISOString(),
    }],
  };
  let begun = false;
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "squad_weekly_mail_rehearsal_tick") {
      return begun ? { state: "idle", jobs: [] } : tick;
    }
    if (name === "squad_document_prepare") return { state: "pending" };
    if (name === "squad_document_mail_prepare") {
      return options.fanoutPrepared
        ? {
          state: "prepared",
          document_id: doc,
          email,
          kind: "catalogue",
          path: `g1/${cap}/${doc}/document.pdf`,
          bytes: 1,
          sha256: "a".repeat(64),
          pages: 1,
        }
        : { state: "done" };
    }
    if (name === "squad_business_mail_prepare") {
      return {
        state: "prepared",
        message_id: job,
        kind: "tailor_weekly",
        email,
        data: { document_id: doc, pages: 1 },
        attachment: {
          path: `g1/${cap}/${doc}/document.pdf`,
          bytes: 1,
          sha256: "a".repeat(64),
          pages: 1,
        },
        ...options.message,
      };
    }
    if (name === "squad_weekly_mail_rehearsal_send_begin") {
      begun = true;
      effects.push("durable-begin");
      return options.begin ??
        {
          capability_id: cap,
          message_id: job,
          allowed_recipient: email,
          document_id: doc,
          kind: "tailor_weekly",
          role_id: 0,
          attachment_path: `g1/${cap}/${doc}/document.pdf`,
        };
    }
    if (
      name === "squad_business_mail_finish" ||
      name === "squad_document_mail_finish"
    ) {
      effects.push("finish");
      if (options.finishError) throw new Error("lost secret finish");
      return {
        id: job,
        state: args.p_code === "SENT" ? "done" : "pending",
        ...(args.p_code !== "SENT" ? { error_code: args.p_code } : {}),
      };
    }
    throw new Error(`unexpected RPC ${name}`);
  };
  const storage: DocumentStorage = {
    part: async () => {
      effects.push("attachment");
      return new Uint8Array([1]);
    },
    asset: async () => {
      throw new Error("unexpected asset");
    },
    put: async () => {
      throw new Error("unexpected put");
    },
  };
  const run = weeklyMailRehearsal(rpc, storage, {
    ...config,
    ...(options.projectRef ? { projectRef: options.projectRef } : {}),
  }, (cfg, capability) => {
    sendConfigs.push(cfg);
    sendCapabilities.push(capability);
    return async () => {
      effects.push("SMTP");
      if (options.sendError) throw new Error("SMTP uncertain");
    };
  }, () => now);
  return { run, calls, effects, sendConfigs, sendCapabilities, tick };
}
async function rejects(work: () => Promise<unknown>) {
  try {
    await work();
    throw new Error("unexpected success");
  } catch (e) {
    assert((e as Error).message === "mail_rehearsal_unavailable");
  }
}

Deno.test("weekly mail capability refuses production or invalid capability before scheduling", async () => {
  for (const projectRef of ["levwrmvqdntngeasrtnb", "unknown"]) {
    const f = fixture({ projectRef });
    await rejects(() => f.run(cap));
    assert(!f.calls.length);
  }
  const f = fixture();
  await rejects(() => f.run("all"));
  assert(!f.calls.length);
});
Deno.test("weekly mail idle and busy ticks have no worker or SMTP effects", async () => {
  for (const state of ["idle", "busy"]) {
    const f = fixture({ tick: { state, jobs: [] } });
    const r = await f.run(cap);
    assert(
      r.state === state && !r.results.length && f.calls.length === 1 &&
        !f.effects.length,
    );
  }
});
Deno.test("weekly mail rejects unbounded, unknown, expired and malformed leases", async () => {
  const valid = (fixture().tick as { jobs: unknown[] }).jobs[0] as Record<
    string,
    unknown
  >;
  for (
    const tick of [
      { state: "claimed", jobs: [] },
      { state: "idle", jobs: [valid] },
      { state: "claimed", jobs: [valid, valid] },
      ...[
        { handler: "account_mail" },
        { handler: "warehouse" },
        { attempt: 6 },
        { lease_token: "x" },
        { lease_until: new Date(now - 1).toISOString() },
        { lease_until: new Date(now + 200_000).toISOString() },
      ].map((change) => ({
        state: "claimed",
        jobs: [{ ...valid, ...change }],
      })),
    ]
  ) {
    const f = fixture({ tick });
    await rejects(() => f.run(cap));
    assert(f.calls.length === 1 && !f.effects.length);
  }
});
Deno.test("weekly render and document-mail phases reuse existing worker RPCs without send authorization", async () => {
  for (const handler of ["document_render", "document_mail"]) {
    const f = fixture({
      tick: {
        state: "claimed",
        jobs: [{
          id: job,
          lease_token: lease,
          handler,
          attempt: 1,
          lease_until: new Date(now + 120_000).toISOString(),
        }],
      },
    });
    await f.run(cap);
    assert(
      f.calls.length === 2 && f.calls[1].name === (handler === "document_render"
            ? "squad_document_prepare"
            : "squad_document_mail_prepare") &&
        !f.effects.length,
    );
  }
});
Deno.test("weekly actual sender is preceded by durable begin and receives only exact route-local recipient", async () => {
  const f = fixture(), r = await f.run(cap);
  assert(
    r.results[0].state === "done" &&
      f.effects.join() === "attachment,durable-begin,SMTP,finish",
  );
  assert(
    f.sendConfigs.length === 1 &&
      f.sendConfigs[0].allowedRecipients?.join() === email,
  );
  assert(config.allowedRecipients?.join() === "unrelated@mailinator.com");
  assert(
    f.sendCapabilities[0].message_id === job &&
      f.sendCapabilities[0].document_id === doc &&
      f.sendCapabilities[0].source === "weekly_mail_rehearsal",
  );
  assert(
    !JSON.stringify(r).includes(email) &&
      !JSON.stringify(r).includes("not-exposed"),
  );
});
Deno.test("weekly sender refuses changed message, document or recipient returned by capability", async () => {
  for (
    const change of [
      { capability_id: job },
      { message_id: cap },
      { document_id: cap },
      { role_id: 3 },
      { kind: "catalogue" },
      { attachment_path: "wrong/path" },
      {
        allowed_recipient: "different@mailinator.com",
      },
      { allowed_recipient: "real@example.com" },
    ]
  ) {
    const f = fixture({
      begin: {
        capability_id: cap,
        message_id: job,
        document_id: doc,
        allowed_recipient: email,
        kind: "tailor_weekly",
        role_id: 0,
        attachment_path: `g1/${cap}/${doc}/document.pdf`,
        ...change,
      },
    });
    await f.run(cap);
    assert(!f.sendConfigs.length && !f.effects.includes("SMTP"));
  }
});
Deno.test("weekly sender refuses malformed recipients or non-document messages before send begin", async () => {
  for (
    const message of [{ email: "invalid\n@example.com" }, { message_id: cap }, {
      kind: "welcome",
      data: { role: 0, name: "Fixture" },
    }]
  ) {
    const f = fixture({ message });
    await f.run(cap);
    assert(
      !f.calls.some((x) => x.name.endsWith("send_begin")) &&
        !f.effects.includes("SMTP"),
    );
  }
});
Deno.test("weekly approved attachment-capable alias requires exact durable grant before sender construction", async () => {
  const alias = "controlled+squad-000000000000-0@example.invalid";
  const f = fixture({
    message: { email: alias },
    begin: {
      capability_id: cap,
      message_id: job,
      document_id: doc,
      allowed_recipient: alias,
      kind: "tailor_weekly",
      role_id: 0,
      attachment_path: `g1/${cap}/${doc}/document.pdf`,
    },
  });
  const result = await f.run(cap);
  assert(
    result.results[0].state === "done" &&
      f.effects.join() === "attachment,durable-begin,SMTP,finish",
  );
  assert(
    f.sendConfigs[0].allowedRecipients?.join() === alias &&
      f.sendCapabilities[0].recipient === alias,
  );
  const missing = fixture({ message: { email: alias } });
  await missing.run(cap);
  assert(!missing.sendConfigs.length && !missing.effects.includes("SMTP"));
});
Deno.test("weekly direct legacy document SMTP response fails closed without durable send capability", async () => {
  const f = fixture({
    fanoutPrepared: true,
    tick: {
      state: "claimed",
      jobs: [{
        id: job,
        lease_token: lease,
        handler: "document_mail",
        attempt: 1,
        lease_until: new Date(now + 120_000).toISOString(),
      }],
    },
  });
  const r = await f.run(cap);
  assert(
    r.results[0].error_code === "MAIL_NOT_ENABLED" &&
      !f.effects.includes("SMTP") &&
      !f.calls.some((x) => x.name.endsWith("send_begin")),
  );
});
Deno.test("weekly uncertain SMTP records one finish and next durable tick cannot send twice", async () => {
  const f = fixture({ sendError: true });
  await f.run(cap);
  const next = await f.run(cap);
  assert(
    f.effects.filter((x) => x === "SMTP").length === 1 &&
      f.effects.filter((x) => x === "finish").length === 1 &&
      next.state === "idle",
  );
  assert(
    f.calls.find((x) => x.name === "squad_business_mail_finish")?.args
      .p_code === "PROVIDER_UNAVAILABLE",
  );
});
Deno.test("weekly lost finish remains unconfirmed with no second result or SMTP replay", async () => {
  const f = fixture({ finishError: true });
  const r = await f.run(cap);
  await f.run(cap);
  assert(
    r.results[0].state === "unconfirmed" &&
      f.effects.filter((x) => x === "SMTP").length === 1 &&
      f.effects.filter((x) => x === "finish").length === 1,
  );
});
