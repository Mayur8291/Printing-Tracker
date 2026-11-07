import { supabase } from "./supabaseClient";

export const OPS_AI_FUNCTION = "ops-ai-chat";

function missingRelation(error) {
  const msg = String(error?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("does not exist") || msg.includes("schema cache");
}

async function fetchView(name) {
  const { data, error } = await supabase.from(name).select("*").limit(80);
  if (error) {
    if (missingRelation(error)) return [];
    throw error;
  }
  return data ?? [];
}

export async function fetchOpsFollowupLinks() {
  const { data, error } = await supabase
    .from("ops_followup_task_link")
    .select("source_kind, source_id, task_id");
  if (error) {
    if (missingRelation(error)) return [];
    throw error;
  }
  return data ?? [];
}

export function followupLinkKey(kind, sourceId) {
  return `${kind}:${sourceId}`;
}

export async function fetchOpsBriefing() {
  const [jobs, production, pendingPay, links] = await Promise.all([
    fetchView("rpt_ops_my_open_jobs"),
    fetchView("rpt_ops_my_production"),
    fetchView("rpt_ops_my_pending_pay"),
    fetchOpsFollowupLinks()
  ]);
  const linked = new Set(links.map((row) => followupLinkKey(row.source_kind, row.source_id)));
  return { jobs, production, pendingPay, linked };
}

export function defaultFollowupTitle(kind, code, customer) {
  const ref = String(code ?? "").trim() || "item";
  const who = String(customer ?? "").trim();
  const tail = who ? ` — ${who}` : "";
  if (kind === "production") return `Production follow-up ${ref}${tail}`;
  if (kind === "pending_pay" || kind === "ar_invoice") return `Collect pending ${ref}${tail}`;
  return `Follow up ${ref}${tail}`;
}

export async function createOpsFollowupTask({ sourceKind, sourceId, title, description }) {
  const { data, error } = await supabase.rpc("ops_create_followup_task", {
    p_source_kind: sourceKind,
    p_source_id: String(sourceId),
    p_title: title,
    p_description: description || null
  });
  if (error) throw error;
  return data;
}

export async function pingOpsAiChat() {
  const { data, error } = await supabase.functions.invoke(OPS_AI_FUNCTION, {
    body: { ping: true }
  });
  if (error) {
    return { chatEnabled: false, error: data?.error || error.message || "Chat off." };
  }
  if (data?.chatEnabled === false) {
    return { chatEnabled: false, error: data.error || "Chat off until API key." };
  }
  return { chatEnabled: true, error: "" };
}

export async function sendOpsAiChat({ message, history, queue }) {
  const { data, error } = await supabase.functions.invoke(OPS_AI_FUNCTION, {
    body: { message, history: history ?? [], queue: queue ?? null }
  });
  if (error) {
    const msg =
      (typeof data?.error === "string" && data.error) || error.message || "Could not reach ops AI.";
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function compactQueueForAi({ jobs, production, pendingPay }) {
  return {
    open_jobs: (jobs ?? []).slice(0, 25).map((row) => ({
      source_kind: "open_job",
      source_id: String(row.order_pk),
      code: row.code,
      customer: row.customer_name,
      why: row.why,
      due_date: row.due_date,
      status: row.status
    })),
    production: (production ?? []).slice(0, 25).map((row) => ({
      source_kind: "production",
      source_id: String(row.order_pk),
      code: row.code,
      customer: row.customer_name,
      why: row.why,
      due_date: row.due_date,
      status: row.status
    })),
    pending_pay: (pendingPay ?? []).slice(0, 25).map((row) => ({
      source_kind: row.source_kind,
      source_id: String(row.source_id),
      code: row.code,
      customer: row.customer_name,
      why: row.why,
      amount: row.amount
    }))
  };
}
