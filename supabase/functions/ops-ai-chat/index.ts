// Deploy: npx supabase functions deploy ops-ai-chat --project-ref scvojtvgnkmbupvyslmb
// Secret: ANTHROPIC_API_KEY (optional). Without it, briefing UI still works; chat returns chatEnabled false.
// Staging only unless an explicit production release.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const TOOLS = [
  {
    name: "create_followup_task",
    description:
      "Create one follow-up task for the signed-in user from an item already in their Today queue. Never place orders or change money.",
    input_schema: {
      type: "object",
      properties: {
        source_kind: {
          type: "string",
          enum: ["open_job", "production", "pending_pay", "ar_invoice"]
        },
        source_id: { type: "string", description: "order_pk or invoice id from the queue" },
        title: { type: "string" },
        description: { type: "string" }
      },
      required: ["source_kind", "source_id", "title"]
    }
  }
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
    const body = await req.json().catch(() => ({}));

    if (!apiKey) {
      return json({
        chatEnabled: false,
        error: "Briefing works. Chat off until API key."
      });
    }

    if (body?.ping === true) {
      return json({ chatEnabled: true });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !anonKey) {
      return json({ error: "Supabase env missing on function." }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const {
      data: { user },
      error: userErr
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Sign in required." }, 401);
    }

    const message = String(body?.message ?? "").trim();
    if (!message) {
      return json({ error: "Type or speak a message first." }, 400);
    }

    const [jobsRes, prodRes, payRes] = await Promise.all([
      userClient.from("rpt_ops_my_open_jobs").select("*").limit(40),
      userClient.from("rpt_ops_my_production").select("*").limit(40),
      userClient.from("rpt_ops_my_pending_pay").select("*").limit(40)
    ]);

    const queue = {
      open_jobs: jobsRes.data ?? [],
      production: prodRes.data ?? [],
      pending_pay: payRes.data ?? []
    };

    const history = Array.isArray(body?.history) ? body.history.slice(-8) : [];
    const anthropicMessages: Array<{ role: string; content: unknown }> = [];
    for (const row of history) {
      const role = row?.role === "assistant" ? "assistant" : "user";
      const text = String(row?.text ?? "").trim();
      if (!text) continue;
      anthropicMessages.push({ role, content: text });
    }
    if (
      !anthropicMessages.length ||
      anthropicMessages[anthropicMessages.length - 1].role !== "user" ||
      anthropicMessages[anthropicMessages.length - 1].content !== message
    ) {
      anthropicMessages.push({ role: "user", content: message });
    }

    const system = [
      "You are the Scott Dashboard ops briefing helper.",
      "You may only remind the user about their Today queue and create follow-up tasks via create_followup_task.",
      "Refuse placing printing orders, changing status, invoices, receipts, or stock.",
      "source_id for jobs/production is order_pk. For pending pay use source_kind and source_id from pending_pay rows.",
      `Queue JSON: ${JSON.stringify(queue)}`
    ].join(" ");

    const model = (Deno.env.get("ANTHROPIC_MODEL") ?? "claude-3-5-haiku-20241022").trim();
    const tasksCreated: Array<{ title: string; source_kind: string; source_id: string }> = [];
    let reply = "";

    for (let round = 0; round < 4; round++) {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system,
          tools: TOOLS,
          messages: anthropicMessages
        })
      });
      const claudeJson = await claudeRes.json().catch(() => ({}));
      if (!claudeRes.ok) {
        const errText =
          (claudeJson as { error?: { message?: string } })?.error?.message ||
          `Claude error (${claudeRes.status})`;
        return json({ error: errText, chatEnabled: true }, 200);
      }

      const content = Array.isArray(claudeJson.content) ? claudeJson.content : [];
      const toolUses = content.filter((b: { type?: string }) => b.type === "tool_use");
      const texts = content
        .filter((b: { type?: string }) => b.type === "text")
        .map((b: { text?: string }) => String(b.text ?? "").trim())
        .filter(Boolean);

      if (!toolUses.length) {
        reply = texts.join("\n") || "No change.";
        break;
      }

      anthropicMessages.push({ role: "assistant", content });
      const toolResults = [];
      for (const tool of toolUses) {
        if (tool.name !== "create_followup_task") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: "That tool is not allowed.",
            is_error: true
          });
          continue;
        }
        const input = (tool.input ?? {}) as {
          source_kind?: string;
          source_id?: string;
          title?: string;
          description?: string;
        };
        const { data, error } = await userClient.rpc("ops_create_followup_task", {
          p_source_kind: input.source_kind,
          p_source_id: String(input.source_id ?? ""),
          p_title: input.title,
          p_description: input.description || null
        });
        if (error) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: error.message,
            is_error: true
          });
        } else {
          tasksCreated.push({
            title: String(input.title ?? ""),
            source_kind: String(input.source_kind ?? ""),
            source_id: String(input.source_id ?? "")
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: JSON.stringify({ ok: true, task: data })
          });
        }
      }
      anthropicMessages.push({ role: "user", content: toolResults });
    }

    if (!reply) {
      reply = tasksCreated.length
        ? `Made ${tasksCreated.length} follow-up task(s).`
        : "Could not finish that ask.";
    }

    return json({ chatEnabled: true, reply, tasksCreated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
