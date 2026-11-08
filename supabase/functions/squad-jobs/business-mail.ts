import nodemailer from "npm:nodemailer@10.3.1";
import { Buffer } from "node:buffer";
import type { MailConfig } from "../_shared/squad-mail.ts";
import type { DocumentStorage } from "./documents.ts";
import type { Rpc } from "./handler.ts";
export interface BusinessMail {
  state: "prepared";
  message_id: string;
  kind:
    | "dealer_order"
    | "price_alert"
    | "bulk_price_result"
    | "welcome"
    | "catalogue"
    | "delivery_challan"
    | "tailor_weekly";
  email: string;
  data: Record<string, unknown>;
  attachment?:
    | { path: string; bytes: number; sha256: string; pages: number }
    | null;
}
const kinds = [
  "dealer_order",
  "price_alert",
  "bulk_price_result",
  "welcome",
  "catalogue",
  "delivery_challan",
  "tailor_weekly",
];
const docKinds = ["catalogue", "delivery_challan", "tailor_weekly"];
const validEmail = (s: string) =>
  s.length <= 254 &&
  /^[^\s\x00-\x1f\x7f<>;,"@]+@[^\s\x00-\x1f\x7f<>;,"@]+\.[^\s\x00-\x1f\x7f<>;,"@]+$/
    .test(s);
function scalar(v: unknown, max = 1000) {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "string" && typeof v !== "number") {
    throw new Error("invalid_business_message");
  }
  const s = String(v);
  if (s.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)) {
    throw new Error("invalid_business_message");
  }
  return s;
}
function line(v: unknown, max = 200) {
  const s = scalar(v, max);
  if (/[\r\n]/.test(s)) throw new Error("invalid_business_message");
  return s;
}
export function businessMessage(m: BusinessMail, attachment?: Uint8Array) {
  if (
    !/^[a-f0-9-]{36}$/i.test(m.message_id) || typeof m.email !== "string" ||
    !validEmail(m.email) || !kinds.includes(m.kind) || !m.data ||
    typeof m.data !== "object" || Array.isArray(m.data) ||
    new TextEncoder().encode(JSON.stringify(m.data)).length > 65536
  ) throw new Error("invalid_business_message");
  const d = m.data;
  let subject: string, text: string;
  if (m.kind === "dealer_order") {
    if (!Array.isArray(d.items) || d.items.length > 50) {
      throw new Error("invalid_business_message");
    }
    subject = "New order created: " + line(d.order_number);
    text = `Order: ${line(d.order_number)}\nCreated by: ${
      scalar(d.created_by)
    }\n\n`;
    for (const item of d.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("invalid_business_message");
      }
      const i = item as Record<string, unknown>;
      text += `${scalar(i.name)} (${scalar(i.category)})\nQuantity: ${
        scalar(i.quantity)
      }; amount: INR ${scalar(i.amount)}\nCGST: INR ${
        scalar(i.cgst)
      }; SGST: INR ${scalar(i.sgst)}; IGST: INR ${scalar(i.igst)}\n\n`;
    }
    text += `Total quantity: ${scalar(d.total_quantity)}\nTotal amount: INR ${
      scalar(d.total_amount)
    }\n`;
    if (Number(d.item_count) > d.items.length) {
      text += `Showing ${d.items.length} of ${
        scalar(d.item_count)
      } items. Open the order for all items.\n`;
    }
  } else if (m.kind === "price_alert") {
    subject = "Price override requires review: " + line(d.order_number);
    text = `Order: ${line(d.order_number)}\nCustomer: ${
      scalar(d.customer)
    }\nSales coordinator: ${scalar(d.coordinator)}\nItem: ${
      scalar(d.item_id)
    }\nSystem price: INR ${scalar(d.original_price)}\nChanged price: INR ${
      scalar(d.changed_price)
    }\n\nReview the current order in Squad One.`;
  } else if (m.kind === "bulk_price_result") {
    subject = "Ready-made price import: " + line(d.status, 30);
    text = `Transfer: ${line(d.transfer_id)}\nStatus: ${
      line(d.status, 30)
    }\nTotal rows: ${scalar(d.total)}\nValid rows: ${
      scalar(d.valid)
    }\nInvalid rows: ${scalar(d.invalid)}\nApplied rows: ${
      scalar(d.applied)
    }\n`;
    const result =
      d.result && typeof d.result === "object" && !Array.isArray(d.result)
        ? d.result as Record<string, unknown>
        : {};
    for (
      const key of ["inserted", "updated", "duplicates", "skipped", "failed"]
    ) if (result[key] !== undefined) text += `${key}: ${scalar(result[key])}\n`;
    if (d.error_code) text += `Error code: ${line(d.error_code, 100)}\n`;
    text += "\nOpen Data Refresh / Transfers to review row-level results.";
  } else if (m.kind === "welcome") {
    const roles: Record<number, string> = {
      0: "Administrator",
      1: "Sales Coordinator",
      2: "Production Coordinator",
      3: "Customer",
      4: "Factory Manager",
      7: "Dispatch Incharge",
      8: "Inspector",
      9: "Cutting Master",
      10: "Dealer",
      11: "Job Worker",
      12: "Assistant Worker / Team",
    };
    if (!Object.hasOwn(roles, Number(d.role))) {
      throw new Error("invalid_business_message");
    }
    subject = "Welcome to Squad One";
    text = `Hello ${scalar(d.name)},\n\nYour ${
      roles[Number(d.role)]
    } account is ready. Existing users can keep using their current password. For a new account, ask your administrator to send the secure account invitation, then enter its verification code in Squad One to set your password.\n\nWe never send passwords by email. Business permissions continue to depend on your current role and approval status.`;
  } else {
    const label = {
      catalogue: "catalogue",
      delivery_challan: "delivery challan",
      tailor_weekly: "weekly work and payment report",
    }[m.kind];
    if (!attachment) throw new Error("mail_attachment_required");
    subject = m.kind === "delivery_challan"
      ? "Your order dispatch document"
      : m.kind === "tailor_weekly"
      ? "Weekly work and payment report"
      : "Your custom catalogue is ready";
    text = `Your ${label} is attached.\n\nDocument: ${
      line(d.document_id)
    }\nPages: ${scalar(d.pages)}\n`;
    if (m.kind === "catalogue") {
      text +=
        "\nGenerated catalogues expire after three days. Prices remain subject to the current catalogue and your account terms.";
    }
  }
  if (new TextEncoder().encode(text).length > 65536) {
    throw new Error("invalid_business_message");
  }
  return {
    to: { address: m.email, name: "" },
    messageId: `<squad-business-${m.message_id}@scottinternational.com>`,
    subject,
    text,
    ...(attachment
      ? {
        attachments: [{
          filename: m.kind + ".pdf",
          content: Buffer.from(attachment),
          contentType: "application/pdf",
        }],
      }
      : {}),
  };
}
export function businessMailer(config: MailConfig & { projectRef: string }) {
  return async (message: BusinessMail, attachment?: Uint8Array) => {
    if (
      !["scvojtvgnkmbupvyslmb", "levwrmvqdntngeasrtnb"].includes(
        config.projectRef,
      ) || !config.host || !config.username || !config.password ||
      !config.sender || ![2525, 465].includes(config.port)
    ) throw new Error("mail_recipient_not_enabled");
    if (
      config.projectRef === "scvojtvgnkmbupvyslmb" &&
      (!config.allowedRecipients?.length ||
        !message.email.endsWith("@mailinator.com"))
    ) throw new Error("mail_recipient_not_enabled");
    if (
      config.allowedRecipients &&
      !config.allowedRecipients.includes(message.email)
    ) throw new Error("mail_recipient_not_enabled");
    const content = businessMessage(message, attachment);
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: true,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      auth: { user: config.username, pass: config.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      pool: false,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          transport.close();
          reject(new Error("mail_deadline"));
        }, 35000);
      });
      const result = await Promise.race([
        transport.sendMail({
          ...content,
          from: { address: config.sender, name: "Squad One" },
        }),
        timeout,
      ]);
      if (
        !result.accepted?.includes(message.email) || result.rejected?.length
      ) throw new Error("mail_unconfirmed");
    } catch {
      throw new Error("mail_delivery_unavailable");
    } finally {
      clearTimeout(timer);
      transport.close();
    }
  };
}
export function businessMailWorker(
  rpc: Rpc,
  storage: DocumentStorage,
  send: (m: BusinessMail, attachment?: Uint8Array) => Promise<void>,
) {
  return async (job: { id: string; lease_token: string }) => {
    const args = { p_id: job.id, p_lease_token: job.lease_token },
      message = await rpc("squad_business_mail_prepare", args) as
        & BusinessMail
        & { state: string; error_code?: string };
    if (message.state !== "prepared") {
      return {
        id: job.id,
        state: message.state,
        ...(message.error_code ? { error_code: message.error_code } : {}),
      };
    }
    let code = "SENT";
    try {
      let attachment: Uint8Array | undefined;
      if (docKinds.includes(message.kind)) {
        const f = message.attachment;
        if (
          !f || !Number.isInteger(f.bytes) || f.bytes < 1 ||
          !Number.isInteger(f.pages) || f.pages < 1 ||
          !/^[a-f0-9]{64}$/.test(f.sha256) ||
          !/^g[0-9]+\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/document\.pdf$/.test(f.path)
        ) throw new Error("invalid_business_message");
        if (f.bytes > 10 * 1024 * 1024) {
          throw new Error("mail_attachment_limit");
        }
        attachment = await storage.part(f);
      }
      // Validate all trusted-contract data before invoking an injected sender too.
      businessMessage(message, attachment);
      await send(message, attachment);
    } catch (error) {
      code =
        error instanceof Error && error.message === "mail_recipient_not_enabled"
          ? "MAIL_NOT_ENABLED"
          : error instanceof Error && error.message === "mail_attachment_limit"
          ? "MAIL_ATTACHMENT_LIMIT"
          : error instanceof Error &&
              ["invalid_business_message", "mail_attachment_required"].includes(
                error.message,
              )
          ? "MAIL_MESSAGE_INVALID"
          : "PROVIDER_UNAVAILABLE";
    }
    // SMTP is at-least-once: a lost acknowledgement may duplicate a message. The
    // stable Message-ID helps providers; it does not claim exactly-once delivery.
    return await rpc("squad_business_mail_finish", {
      ...args,
      p_code: code,
    }) as { id: string; state: string; error_code?: string };
  };
}
