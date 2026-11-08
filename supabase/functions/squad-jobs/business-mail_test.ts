import {
  type BusinessMail,
  businessMailer,
  businessMailWorker,
  businessMessage,
} from "./business-mail.ts";
import type { DocumentStorage } from "./documents.ts";
const assert = (value: unknown) => {
  if (!value) throw new Error("assertion failed");
};
const job = {
  id: "00000000-0000-4000-8000-000000000001",
  lease_token: "00000000-0000-4000-8000-000000000002",
};
const message: BusinessMail = {
  state: "prepared",
  message_id: job.id,
  kind: "dealer_order",
  email: "squad-fixture@mailinator.com",
  data: {
    order_number: "S-1",
    created_by: "Coordinator",
    total_quantity: "5",
    total_amount: "500.50",
    item_count: 1,
    items: [{
      name: "Shirt",
      category: "Ready-made",
      quantity: "5",
      amount: "500.50",
      cgst: "0",
      sgst: "0",
      igst: "0",
    }],
  },
};
const storage: DocumentStorage = {
  asset: async () => new Uint8Array(),
  part: async () => new Uint8Array(100),
  put: async () => {},
};
const config = {
  projectRef: "scvojtvgnkmbupvyslmb",
  host: "smtp.invalid",
  port: 2525,
  username: "fixture",
  password: "fixture",
  sender: "fixture@squad.invalid",
  allowedRecipients: ["squad-fixture@mailinator.com"],
};
Deno.test("business mail preserves dealer order details and bounded stable Message-ID", () => {
  const a = businessMessage(message), b = businessMessage(message);
  assert(
    a.messageId === b.messageId && a.text.includes("500.50") &&
      a.text.includes("CGST") && a.subject === "New order created: S-1",
  );
  const bounded = businessMessage({
    ...message,
    data: { ...message.data, item_count: 52 },
  });
  assert(bounded.text.includes("Showing 1 of 52 items"));
});
Deno.test("price mail describes a price difference without claiming every change was below system price", () => {
  const r = businessMessage({
    ...message,
    kind: "price_alert",
    data: {
      order_number: "S-1",
      customer: "Customer",
      coordinator: "Coordinator",
      item_id: "1",
      original_price: "100.50",
      changed_price: "125.75",
    },
  });
  assert(
    r.text.includes("100.50") && r.text.includes("125.75") &&
      !r.text.includes("below") && r.subject.includes("requires review"),
  );
});
Deno.test("bulk result includes source counters without raw errors or arbitrary result fields", () => {
  const r = businessMessage({
    ...message,
    kind: "bulk_price_result",
    data: {
      transfer_id: job.id,
      status: "completed",
      total: "10",
      valid: "9",
      invalid: "1",
      applied: "9",
      result: { inserted: 3, updated: 6, raw_error: "SECRET" },
    },
  });
  assert(
    r.text.includes("inserted: 3") && r.text.includes("updated: 6") &&
      !r.text.includes("SECRET"),
  );
});
Deno.test("welcome preserves role and secure invitation guidance without credentials", () => {
  const r = businessMessage({
    ...message,
    kind: "welcome",
    data: { name: "Synthetic User", role: 10, password: "MUST_NOT_RENDER" },
  });
  assert(
    r.text.includes("Dealer") && r.text.includes("verification code") &&
      !r.text.includes("MUST_NOT_RENDER"),
  );
});
Deno.test("document mail uses the recipient job ID and requires a real PDF attachment", () => {
  const m = {
      ...message,
      kind: "delivery_challan" as const,
      data: { document_id: job.id, pages: 2 },
    },
    r = businessMessage(m, new Uint8Array(100));
  assert(
    r.messageId.includes(job.id) &&
      r.attachments?.[0].filename === "delivery_challan.pdf",
  );
  try {
    businessMessage(m);
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof Error && e.message === "mail_attachment_required");
  }
});
Deno.test("mail templates reject header injection, unsupported roles and excessive rows", () => {
  for (
    const m of [
      { ...message, email: "x@example.com\r\nBcc:other@example.com" },
      {
        ...message,
        data: { ...message.data, order_number: "S-1\r\nInjected: header" },
      },
      { ...message, kind: "welcome" as const, data: { role: 5 } },
      { ...message, data: { ...message.data, items: Array(51).fill({}) } },
    ]
  ) {
    try {
      businessMessage(m);
      throw new Error("accepted");
    } catch (e) {
      assert(e instanceof Error && e.message === "invalid_business_message");
    }
  }
});
Deno.test("staging SMTP cannot send without explicit Mailinator allowlist or to real recipients", async () => {
  for (
    const [cfg, m] of [
      [{ ...config, allowedRecipients: undefined }, message],
      [{ ...config, allowedRecipients: ["person@example.com"] }, {
        ...message,
        email: "person@example.com",
      }],
      [{ ...config, allowedRecipients: ["other@mailinator.com"] }, message],
      [{ ...config, projectRef: "unknown" }, message],
    ] as const
  ) {
    try {
      await businessMailer({
        ...cfg,
        allowedRecipients: cfg.allowedRecipients
          ? [...cfg.allowedRecipients]
          : undefined,
      })(m);
      throw new Error("accepted");
    } catch (e) {
      assert(e instanceof Error && e.message === "mail_recipient_not_enabled");
    }
  }
});
Deno.test("terminal or fanout prepare never reads attachments or sends", async () => {
  let touched = false;
  const result = await businessMailWorker(async () => ({ state: "done" }), {
    ...storage,
    part: async () => {
      touched = true;
      return new Uint8Array();
    },
  }, async () => {
    touched = true;
  })(job);
  assert(result.state === "done" && !touched);
});
Deno.test("business worker confirms one send then records completion once", async () => {
  const events: string[] = [];
  const result = await businessMailWorker(
    async (name, args) => {
      events.push(name);
      if (name.endsWith("prepare")) return message;
      assert(args.p_code === "SENT");
      return { id: job.id, state: "done" };
    },
    storage,
    async (m) => {
      assert(m.email === message.email);
      events.push("sent");
    },
  )(job);
  assert(
    result.state === "done" &&
      events.join() ===
        "squad_business_mail_prepare,sent,squad_business_mail_finish",
  );
});
Deno.test("business worker passes verified private PDF bytes only after recipient preparation", async () => {
  let read = false, sent = false;
  const m = {
    ...message,
    kind: "tailor_weekly",
    data: { document_id: job.id, pages: 2 },
    attachment: {
      path: `g0/${job.id}/${job.id}/document.pdf`,
      bytes: 100,
      sha256: "a".repeat(64),
      pages: 2,
    },
  };
  await businessMailWorker(
    async (name, args) =>
      name.endsWith("prepare")
        ? m
        : { id: job.id, state: args.p_code === "SENT" ? "done" : "dead" },
    {
      ...storage,
      part: async (f) => {
        read = true;
        assert(f.bytes === 100);
        return new Uint8Array(100);
      },
    },
    async (_m, bytes) => {
      sent = true;
      assert(read && bytes?.length === 100);
    },
  )(job);
  assert(sent);
});
Deno.test("oversized or invalid attachment is a visible failure instead of an unusable email", async () => {
  for (
    const [path, bytes, expected] of [[
      `g0/${job.id}/${job.id}/document.pdf`,
      11000000,
      "MAIL_ATTACHMENT_LIMIT",
    ], ["../secret", 100, "MAIL_MESSAGE_INVALID"]] as const
  ) {
    let code = "", touched = false;
    await businessMailWorker(
      async (name, args) =>
        name.endsWith("prepare")
          ? {
            ...message,
            kind: "delivery_challan",
            data: { document_id: job.id, pages: 2 },
            attachment: { path, bytes, sha256: "a".repeat(64), pages: 2 },
          }
          : (code = String(args.p_code), { state: "dead" }),
      {
        ...storage,
        part: async () => {
          touched = true;
          return new Uint8Array();
        },
      },
      async () => {
        touched = true;
      },
    )(job);
    assert(code === expected && !touched);
  }
});
Deno.test("SMTP errors are sanitized and allowlist failure is terminal", async () => {
  for (
    const [error, expected] of [[
      "network secret provider response",
      "PROVIDER_UNAVAILABLE",
    ], ["mail_recipient_not_enabled", "MAIL_NOT_ENABLED"]]
  ) {
    let code = "";
    await businessMailWorker(
      async (name, args) =>
        name.endsWith("prepare")
          ? message
          : (code = String(args.p_code), { state: "pending" }),
      storage,
      async () => {
        throw new Error(error);
      },
    )(job);
    assert(code === expected);
  }
});
Deno.test("lost finish response never retries SMTP or issues a contradictory finish", async () => {
  let sent = 0, finished = 0;
  try {
    await businessMailWorker(
      async (name) => {
        if (name.endsWith("prepare")) return message;
        finished++;
        throw new Error("network");
      },
      storage,
      async () => {
        sent++;
      },
    )(job);
  } catch {}
  assert(sent === 1 && finished === 1);
});
