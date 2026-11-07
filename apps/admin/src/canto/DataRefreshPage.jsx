import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CantoTargetSwitcher from "./CantoTargetSwitcher";
import { defaultRefreshEnvironment, getCantoClient } from "./target";

const stages = { queued: "Waiting for worker", starting: "Starting", capturing: "Reading old-system database", validating: "Checking the source snapshot", comparing: "Comparing all tables", backing_up: "Saving and verifying encrypted backup", applying: "Applying and verifying data and accounts", verified: "Verified", failed: "Failed" };
const when = value => value ? new Date(value).toLocaleString() : "Never";
export default function DataRefreshPage() {
  const [environment, setEnvironment] = useState(() => sessionStorage.getItem("canto:refresh-environment") || defaultRefreshEnvironment());
  const [data, setData] = useState(null); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const generation = useRef(0);
  async function request(action, extra = {}) {
    const client = getCantoClient(environment);
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new Error(`Connect your ${environment} administrator account to continue.`);
    const result = await client.functions.invoke("canto-refresh", { body: { action, environment, ...extra } });
    if (result.error) {
      let message = result.error.message;
      try { message = (await result.error.context.json()).error || message; } catch { /* network error */ }
      throw new Error(message);
    }
    if (result.data.error) throw new Error(result.data.error);
    return result.data;
  }
  useEffect(() => {
    const version = ++generation.current; let pending = false;
    setData(null); setError(""); sessionStorage.setItem("canto:refresh-environment", environment);
    async function load() {
      if (pending) return; pending = true;
      try { const result = await request("status"); if (generation.current === version) { setData(result); setError(""); } }
      catch (err) { if (generation.current === version) setError(err.message); }
      finally { pending = false; }
    }
    load(); const timer = setInterval(load, 10000);
    return () => { ++generation.current; clearInterval(timer); };
  }, [environment]);
  async function start() {
    setBusy(true); setError("");
    try {
      const result = await request("start", { discard_revision: data.state.edit_revision !== data.state.synced_revision ? data.state.edit_revision : null });
      setData(await request("status")); if (result.warning) setError(result.warning);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function retryWorker() {
    setBusy(true); setError("");
    try { await request("retry"); setData(await request("status")); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const dirty = data && data.state.edit_revision !== data.state.synced_revision;
  const active = data?.jobs.find(j => j.id === data.state.active_job);
  return <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Data refresh</h1><p className="mt-1 text-sm text-muted-foreground">Bring Canto up to date from the old system.</p></div>
      <CantoTargetSwitcher environmentOnly environment={environment} onEnvironmentChange={value => { if (!busy) setEnvironment(value); }} />
    </div>
    <Card><CardHeader><CardTitle className="capitalize">{environment}</CardTitle><CardDescription>DigitalOcean {environment} → Supabase {environment}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">Last verified refresh: {when(data?.last_success?.committed_at)}</p>
        {data?.state.cutover && <p role="status">This environment has switched to Canto. Old-system refresh is disabled.</p>}
        {dirty && <p className="text-sm text-amber-700">This copy has changes made in Supabase. Refreshing replaces them with the old system’s data. An encrypted recovery backup is saved first.</p>}
        {active && <p role="status" className="text-sm font-medium">{stages[active.stage] || active.stage}… You can leave this page; the refresh continues.</p>}
        {active?.status === "queued" && Date.now() - Date.parse(active.created_at) > 120000 && <Button variant="outline" disabled={busy} onClick={retryWorker}>Retry starting worker</Button>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button disabled={!data || busy || !!active || data?.state.cutover} onClick={() => setConfirm(true)}>{busy ? "Starting…" : "Refresh from old system"}</Button>
        <p className="text-xs text-muted-foreground">Refreshes imported application data and account access. The Printing Tracker’s own tables stay separate.</p>
      </CardContent></Card>
    <Card><CardHeader><CardTitle>Recent refreshes</CardTitle></CardHeader><CardContent>
      {!data?.jobs.length ? <p className="text-sm text-muted-foreground">No dashboard refreshes yet.</p> : <ul className="divide-y">{data.jobs.map(job => <li key={job.id} className="space-y-2 py-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{job.status === "succeeded" ? "Success — verified" : stages[job.stage] || job.status}</span><time>{when(job.created_at)}</time></div>
        {job.summary?.changes && <p className="text-muted-foreground">{job.summary.changes.inserted.toLocaleString()} added · {job.summary.changes.updated.toLocaleString()} updated · {job.summary.changes.deleted.toLocaleString()} removed</p>}
        {job.message && <p>{job.message}</p>}
        {job.github_run_id && <a className="underline" href={`https://github.com/Mayur8291/Printing-Tracker/actions/runs/${job.github_run_id}`} target="_blank" rel="noreferrer">View run</a>}
      </li>)}</ul>}
    </CardContent></Card>
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Refresh {environment}?</DialogTitle><DialogDescription>{dirty ? "Replace changes made in Supabase with the latest old-system data. A recovery backup is saved before publication." : "Read the latest old-system data, save a recovery backup, and refresh this environment. Masters editing pauses until the refresh finishes."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={() => { setConfirm(false); start(); }}>Refresh {environment}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
