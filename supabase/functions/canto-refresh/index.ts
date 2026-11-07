// The browser supplies a user JWT, never database, SSH, or GitHub credentials.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const repo = "Mayur8291/Printing-Tracker";
// Existing default-branch entrypoint calls the reusable refresh workflow on the selected ref.
const workflow = "check-scott-config.yml";
const refs: Record<string,string> = { scvojtvgnkmbupvyslmb: "staging", levwrmvqdntngeasrtnb: "production" };
const url = Deno.env.get("SUPABASE_URL")!;
const environment = refs[new URL(url).hostname.split(".")[0]];
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
async function rpc(name: string, body: unknown, authorization: string, service = false) {
  const key = Deno.env.get(service ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY")!;
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: service ? `Bearer ${key}` : authorization, "Content-Type": "application/json", "Content-Profile": "canto_api", "Accept-Profile": "canto_api" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Administrator access required");
  return data;
}
async function github(path: string, body?: unknown) {
  return await fetch(`https://api.github.com/repos/${repo}/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${Deno.env.get("CANTO_GITHUB_TOKEN")}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization") || "";
  try {
    if (!environment) throw new Error("Refresh environment is not configured");
    await rpc("access", {}, authorization); // Verified by Auth/PostgREST, including live role and session checks.
    const input = await req.json();
    if (input.environment !== environment) return response({ error: "Environment mismatch" }, 400);
    if (input.action === "status") {
      let status = await rpc("refresh_status", {}, authorization);
      const job = status.jobs.find((j: { id: string }) => j.id === status.state.active_job);
      if (job && Deno.env.get("CANTO_GITHUB_TOKEN")) {
        try {
          const runs = await github(`actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`);
          if (runs.ok) {
            const list = (await runs.json()).workflow_runs;
            const run = list.find((r: { display_title: string }) => r.display_title === `Canto ${environment} ${job.id}`);
            if (run?.status === "completed") {
              await rpc("refresh_reconcile", { job_id: job.id, outcome: "workflow_completed", workflow_run_id: String(run.id) }, authorization, true);
              status = await rpc("refresh_status", {}, authorization);
            }
          }
        } catch { /* A GitHub outage must not falsely report a completed or failed refresh. */ }
      }
      return response(status);
    }
    if (input.action !== "start") return response({ error: "Unknown action" }, 400);
    if (!Deno.env.get("CANTO_GITHUB_TOKEN")) return response({ error: "Refresh worker is not configured" }, 503);
    const job = await rpc("request_refresh", { environment, discard_revision: input.discard_revision ?? null }, authorization);
    try {
      const dispatched = await github(`actions/workflows/${workflow}/dispatches`, { ref: Deno.env.get("CANTO_WORKFLOW_REF") || "develop", inputs: { environment, job_id: job.id } });
      if (!dispatched.ok && dispatched.status >= 400 && dispatched.status < 500) {
        await rpc("refresh_reconcile", { job_id: job.id, outcome: "dispatch_rejected" }, authorization, true);
        return response({ error: "The refresh worker could not be started. No data was replaced." }, 502);
      }
      if (!dispatched.ok) return response({ job, warning: "Worker dispatch is unconfirmed. Status will update when it starts." }, 202);
    } catch { return response({ job, warning: "Worker dispatch is unconfirmed. Keep this job visible while its status is checked." }, 202); }
    return response({ job }, 202);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Refresh request failed" }, 400);
  }
});
