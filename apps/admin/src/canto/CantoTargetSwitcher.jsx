import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCantoClient, getCantoTarget, setCantoTarget } from "./target";

export default function CantoTargetSwitcher({ environmentOnly = false, environment, onEnvironmentChange }) {
  const target = getCantoTarget();
  const selectedEnvironment = environment || target.environment;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function change(patch) {
    if (environmentOnly) { onEnvironmentChange?.(patch.environment); return; }
    if (window.confirm("Switch data target? Any unsaved edits will be closed.")) setCantoTarget({ ...target, ...patch });
  }
  async function signIn(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const client = getCantoClient(selectedEnvironment);
      const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
      setPassword("");
      if (authError) throw authError;
      const { error: accessError } = await client.schema("canto_api").rpc("access");
      if (accessError) throw accessError;
      window.location.reload();
    } catch (err) { setError(err.message || "Unable to sign in."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    {!environmentOnly && <Select value={target.source} onValueChange={source => change({ source })}>
      <SelectTrigger className="w-36" aria-label="Masters data source"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="legacy">Old system</SelectItem><SelectItem value="supabase">Supabase</SelectItem></SelectContent>
    </Select>}
    <Select value={selectedEnvironment} onValueChange={value => change({ environment: value })}>
      <SelectTrigger className={selectedEnvironment === "production" ? "w-36 border-amber-500 text-amber-700" : "w-36"} aria-label="Data environment"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="staging">Staging</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent>
    </Select>
    {(environmentOnly || target.source === "supabase") && <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Connect account</Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setPassword(""); setError(""); } }}>
      <DialogContent><DialogHeader><DialogTitle>Connect to {selectedEnvironment}</DialogTitle><DialogDescription>Use your dashboard administrator account for this environment.</DialogDescription></DialogHeader>
        <form onSubmit={signIn} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="canto-email">Email</Label><Input id="canto-email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="canto-password">Password</Label><Input id="canto-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
