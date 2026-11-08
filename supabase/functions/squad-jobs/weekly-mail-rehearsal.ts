/** Three registered document roots, at most five controlled recipients. The
 * database capability schedules and leases one exact descendant at a time. */
import {
  type BusinessMail,
  type BusinessMailCapability,
  businessMailer,
  businessMailWorker,
} from "./business-mail.ts";
import { documentMailWorker } from "./document-mail.ts";
import { type DocumentStorage, documentWorker } from "./documents.ts";
import type { ProjectMailConfig } from "../_shared/squad-mail.ts";
import type { Rpc } from "./handler.ts";
type Job = {
  id: string;
  lease_token: string;
  handler: string;
  attempt: number;
  lease_until: string;
};
type Result = { id: string; state: string; error_code?: string };
type Sender = (message: BusinessMail, attachment?: Uint8Array) => Promise<void>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const staging = "scvojtvgnkmbupvyslmb";
const controlled = (s: unknown): s is string =>
  typeof s === "string" &&
  s.length <= 254 &&
  /^[^\s\x00-\x1f\x7f<>;,"@]+@[^\s\x00-\x1f\x7f<>;,"@]+\.[^\s\x00-\x1f\x7f<>;,"@]+$/
    .test(s);
export function weeklyMailRehearsal(
  rpc: Rpc,
  storage: DocumentStorage,
  config: ProjectMailConfig,
  sender: (
    config: ProjectMailConfig,
    capability: BusinessMailCapability,
  ) => Sender = businessMailer,
  now: () => number = Date.now,
) {
  const render = documentWorker(rpc, storage);
  // The ordinary document-mail worker now performs real recipient fanout in
  // SQL. An unexpected legacy direct-email response has no send-begin proof.
  const fanout = documentMailWorker(rpc, storage, async () => {
    throw new Error("mail_recipient_not_enabled");
  });
  return async (id: string): Promise<{ state: string; results: Result[] }> => {
    if (config.projectRef !== staging || !uuid.test(id)) {
      throw new Error("mail_rehearsal_unavailable");
    }
    const tick = await rpc("squad_weekly_mail_rehearsal_tick", {
      p_id: id,
    }) as { state: string; jobs: Job[] };
    if (
      !tick || !["claimed", "idle", "busy"].includes(tick.state) ||
      !Array.isArray(tick.jobs) || tick.jobs.length > 1 ||
      (tick.state === "claimed") !== (tick.jobs.length === 1) ||
      tick.jobs.some((j) =>
        !j || !uuid.test(j.id) || !uuid.test(j.lease_token) ||
        !["document_render", "document_mail", "business_mail"].includes(
          j.handler,
        ) || !Number.isInteger(j.attempt) || j.attempt < 1 || j.attempt > 5 ||
        !Number.isFinite(Date.parse(j.lease_until)) ||
        Date.parse(j.lease_until) <= now() ||
        Date.parse(j.lease_until) > now() + 181_000
      )
    ) throw new Error("mail_rehearsal_unavailable");
    if (!tick.jobs.length) return { state: tick.state, results: [] };
    const job = tick.jobs[0];
    const mail = businessMailWorker(
      rpc,
      storage,
      async (message, attachment) => {
        if (
          !controlled(message.email) ||
          !["catalogue", "delivery_challan", "tailor_weekly"].includes(
            message.kind,
          ) || message.message_id !== job.id
        ) {
          throw new Error("mail_recipient_not_enabled");
        }
        // This is the final awaited authorization before SMTP. The committed
        // started marker stops further claims even if SMTP or finish is ambiguous.
        const grant = await rpc("squad_weekly_mail_rehearsal_send_begin", {
          p_id: id,
          p_job_id: job.id,
          p_lease_token: job.lease_token,
        }) as {
          message_id: string;
          allowed_recipient: string;
          document_id: string;
          capability_id: string;
          role_id: number;
          kind: BusinessMailCapability["kind"];
          attachment_path: string;
        };
        if (
          !grant || grant.capability_id !== id || grant.message_id !== job.id ||
          !controlled(grant.allowed_recipient) ||
          grant.allowed_recipient !== message.email ||
          !uuid.test(grant.document_id) ||
          grant.kind !== message.kind ||
          !(grant.kind === "tailor_weekly"
            ? [0, 2, 4]
            : grant.kind === "catalogue"
            ? [0]
            : grant.kind === "delivery_challan"
            ? [3]
            : []).includes(grant.role_id) ||
          message.data.document_id !== grant.document_id ||
          grant.attachment_path !== message.attachment?.path ||
          !message.attachment?.path.endsWith(
            `/${grant.document_id}/document.pdf`,
          )
        ) throw new Error("mail_recipient_not_enabled");
        await sender({
          ...config,
          allowedRecipients: [grant.allowed_recipient],
        }, {
          source: "weekly_mail_rehearsal",
          capability_id: id,
          message_id: job.id,
          document_id: grant.document_id,
          kind: grant.kind,
          recipient: grant.allowed_recipient,
          attachment_path: grant.attachment_path,
        })(message, attachment);
      },
    );
    try {
      const result = await (job.handler === "document_render"
        ? render(job)
        : job.handler === "document_mail"
        ? fanout(job)
        : mail(job));
      if (
        !result || result.id !== job.id || typeof result.state !== "string" ||
        !/^[a-z_]{1,40}$/.test(result.state) ||
        result.error_code !== undefined &&
          !/^[A-Z0-9_]{1,100}$/.test(result.error_code)
      ) {
        throw new Error("invalid_rehearsal_result");
      }
      return {
        state: tick.state,
        results: [{
          id: job.id,
          state: result.state,
          ...(result.error_code ? { error_code: result.error_code } : {}),
        }],
      };
    } catch {
      // Do not manufacture a second worker finish or repeat SMTP after a lost
      // acknowledgement. SQL receipts decide whether recovery is possible.
      return {
        state: tick.state,
        results: [{ id: job.id, state: "unconfirmed" }],
      };
    }
  };
}
