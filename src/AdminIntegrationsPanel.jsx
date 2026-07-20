import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Check, Copy, KeyRound, Plug, Warehouse } from "lucide-react";

const CHANNEL_TYPES = [
  "CUSTOM",
  "MOBILE_APP",
  "SHOPIFY",
  "AMAZON",
  "FLIPKART",
  "MYNTRA",
  "JIOMART",
  "OTHER"
];

function randomKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `scott_${hex}`;
}

async function sha256Hex(message) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function cleanFacilityCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "");
}

// ---------------------------------------------------------------------------
// API keys

function ApiKeysSection() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ label: "", username: "" });
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("dashboard_api_keys")
      .select("id, label, username, key_prefix, status, created_at, last_used_at")
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      setError("");
      setKeys(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      const plaintext = randomKey();
      const key_hash = await sha256Hex(plaintext);
      const {
        data: { user }
      } = await supabase.auth.getUser();

      const { error: err } = await supabase.from("dashboard_api_keys").insert({
        label: form.label.trim(),
        username: form.username.trim(),
        key_prefix: plaintext.slice(0, 14),
        key_hash,
        status: "active",
        created_by: user?.id ?? null
      });
      if (err) throw err;

      setNewKey(plaintext);
      setForm({ label: "", username: "" });
      await load();
    } catch (err) {
      setError(err?.message || "Failed to generate key.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row) => {
    const next = row.status === "active" ? "disabled" : "active";
    const { error: err } = await supabase
      .from("dashboard_api_keys")
      .update({ status: next, revoked_at: next === "disabled" ? new Date().toISOString() : null })
      .eq("id", row.id);
    if (err) setError(err.message);
    else await load();
  };

  const deleteKey = async (row) => {
    if (!window.confirm(`Delete API key "${row.label}"? Clients using it stop working immediately.`)) return;
    const { error: err } = await supabase.from("dashboard_api_keys").delete().eq("id", row.id);
    if (err) setError(err.message);
    else await load();
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  const closeCreate = () => {
    setShowCreate(false);
    setNewKey("");
    setCopied(false);
    setForm({ label: "", username: "" });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">API keys</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keys authenticate the Stock &amp; Order API (<code className="font-mono">Authorization: Bearer …</code>).
            Only a fingerprint is stored — the full key is shown once at creation.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
          Generate a new API key
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {error ? <p className="mb-3 text-xs text-destructive">{error}</p> : null}
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : !keys.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No API keys yet. The legacy <code className="font-mono">DASHBOARD_API_KEY</code> secret keeps
            working; keys generated here can be disabled or deleted per client.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm font-medium">{row.label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.username || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{row.key_prefix}…</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        row.status === "active"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-red-200 bg-red-50 text-red-600"
                      )}
                    >
                      {row.status === "active" ? "ACTIVE" : "DISABLED"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.last_used_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => toggleStatus(row)}>
                        {row.status === "active" ? "Disable" : "Enable"}
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => deleteKey(row)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={showCreate} onOpenChange={(open) => (!open ? closeCreate() : null)}>
        <DialogContent className="sm:max-w-md">
          {newKey ? (
            <>
              <DialogHeader>
                <DialogTitle>API key created</DialogTitle>
                <DialogDescription>
                  Copy it now — for security only a fingerprint is stored and it cannot be shown again.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input readOnly value={newKey} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button type="button" size="sm" variant="outline" onClick={copyKey} className="shrink-0 gap-1.5">
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <DialogFooter>
                <Button type="button" onClick={closeCreate}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleGenerate} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Generate a new API key</DialogTitle>
                <DialogDescription>
                  One key per client (e.g. the mobile app, a marketplace connector).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="api-key-label">Label</Label>
                <Input
                  id="api-key-label"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="SCOTT_APP"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-key-username">Username (optional)</Label>
                <Input
                  id="api-key-username"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="scott_app"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={closeCreate} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !form.label.trim()}>
                  {saving ? "Generating…" : "Generate key"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Channels

function ChannelsSection({ facilities }) {
  const [channels, setChannels] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    channel_type: "CUSTOM",
    api_key_id: "",
    default_facility_code: "",
    notes: ""
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows, error: chErr }, { data: keyRows }] = await Promise.all([
      supabase
        .from("dashboard_channels")
        .select("id, code, name, channel_type, enabled, api_key_id, default_facility_code, notes, created_at")
        .order("created_at", { ascending: true }),
      supabase.from("dashboard_api_keys").select("id, label, status")
    ]);
    if (chErr) {
      setError(chErr.message);
    } else {
      setError("");
      setChannels(rows ?? []);
      setApiKeys(keyRows ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const keyById = useMemo(() => new Map(apiKeys.map((k) => [k.id, k])), [apiKeys]);

  const connectorStatus = (row) => {
    if (!row.enabled) return { label: "Disabled", cls: "border-slate-200 bg-slate-50 text-slate-500" };
    const key = row.api_key_id ? keyById.get(row.api_key_id) : null;
    if (!key) return { label: "No API key", cls: "border-amber-200 bg-amber-50 text-amber-700" };
    if (key.status !== "active") return { label: "Key disabled", cls: "border-red-200 bg-red-50 text-red-600" };
    return { label: "Connected", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const code = form.code.trim().toUpperCase().replace(/\s+/g, "_");
    if (!code) return;
    setSaving(true);
    try {
      const { error: err } = await supabase.from("dashboard_channels").insert({
        code,
        name: form.name.trim() || code,
        channel_type: form.channel_type,
        api_key_id: form.api_key_id || null,
        default_facility_code: form.default_facility_code,
        notes: form.notes.trim(),
        enabled: true
      });
      if (err) throw err;
      setShowForm(false);
      setForm({ code: "", name: "", channel_type: "CUSTOM", api_key_id: "", default_facility_code: "", notes: "" });
      await load();
    } catch (err) {
      setError(err?.message || "Failed to add channel.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (row, enabled) => {
    const { error: err } = await supabase
      .from("dashboard_channels")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (err) setError(err.message);
    else await load();
  };

  const deleteChannel = async (row) => {
    if (!window.confirm(`Delete channel "${row.code}"?`)) return;
    const { error: err } = await supabase.from("dashboard_channels").delete().eq("id", row.id);
    if (err) setError(err.message);
    else await load();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Channels</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Order sources (app, marketplaces). Link each channel to an API key and default facility.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setShowForm(true)}>
          Add channel
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {error ? <p className="mb-3 text-xs text-destructive">{error}</p> : null}
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : !channels.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No channels yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>API key</TableHead>
                <TableHead>Default facility</TableHead>
                <TableHead>Connector status</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((row) => {
                const status = connectorStatus(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{row.code}</p>
                      {row.name && row.name !== row.code ? (
                        <p className="text-xs text-muted-foreground">{row.name}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {row.channel_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.api_key_id ? keyById.get(row.api_key_id)?.label ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.default_facility_code || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px]", status.cls)}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(checked) => toggleEnabled(row, checked)}
                        aria-label={`Enable channel ${row.code}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button type="button" size="sm" variant="destructive" onClick={() => deleteChannel(row)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleAdd} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add channel</DialogTitle>
              <DialogDescription>Register an order source for the dashboard.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="channel-code">Code</Label>
                <Input
                  id="channel-code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="SCOTT_APP"
                  className="font-mono"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="channel-name">Display name</Label>
                <Input
                  id="channel-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Scott App"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.channel_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, channel_type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Default facility</Label>
                <Select
                  value={form.default_facility_code || "__none__"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, default_facility_code: v === "__none__" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {facilities
                      .filter((w) => w.facility_code)
                      .map((w) => (
                        <SelectItem key={w.id} value={w.facility_code}>
                          {w.facility_code} — {w.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>API key</Label>
              <Select
                value={form.api_key_id || "__none__"}
                onValueChange={(v) => setForm((f) => ({ ...f, api_key_id: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {apiKeys.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.label} {k.status !== "active" ? "(disabled)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="channel-notes">Notes (optional)</Label>
              <Input
                id="channel-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Contact, integration details…"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !form.code.trim()}>
                {saving ? "Saving…" : "Add channel"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Facilities

function FacilitiesSection({ facilities, reload }) {
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  const draftFor = (w) => drafts[w.id] ?? w.facility_code ?? "";

  const save = async (w) => {
    const code = cleanFacilityCode(draftFor(w));
    setSavingId(w.id);
    setError("");
    const { error: err } = await supabase
      .from("inventory_warehouses")
      .update({ facility_code: code || null })
      .eq("id", w.id);
    if (err) {
      setError(
        err.message?.includes("duplicate") || err.code === "23505"
          ? `Facility code "${code}" is already used by another warehouse.`
          : err.message
      );
    } else {
      setDrafts((d) => {
        const next = { ...d };
        delete next[w.id];
        return next;
      });
      await reload();
    }
    setSavingId(null);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Facilities</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Map each warehouse to the external facility code used by the Stock &amp; Order API
          (snapshot keys, <code className="font-mono">facility_code</code> on orders). Must match the
          partner side exactly.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {error ? <p className="mb-3 text-xs text-destructive">{error}</p> : null}
        {!facilities.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No warehouses yet — add one under Inventory → Warehouses.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-72">Facility code (external)</TableHead>
                <TableHead className="text-right">Save</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {facilities.map((w) => {
                const dirty = draftFor(w) !== (w.facility_code ?? "");
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{w.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{w.id}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.city || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {w.warehouse_type || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          value={draftFor(w)}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [w.id]: cleanFacilityCode(e.target.value) }))
                          }
                          placeholder="SCOTT_1DAY_01"
                          className="h-8 font-mono text-xs"
                        />
                        {!w.facility_code && !dirty ? (
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal text-muted-foreground">
                            Not mapped
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant={dirty ? "default" : "outline"}
                        disabled={!dirty || savingId === w.id}
                        onClick={() => save(w)}
                      >
                        {savingId === w.id ? "Saving…" : "Save"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** Admin Panel → Integrations: API keys, channel setup, facility mapping. */
export default function AdminIntegrationsPanel() {
  const [facilities, setFacilities] = useState([]);

  const loadFacilities = useCallback(async () => {
    const { data } = await supabase
      .from("inventory_warehouses")
      .select("id, name, city, warehouse_type, facility_code")
      .order("name", { ascending: true });
    setFacilities(data ?? []);
  }, []);

  useEffect(() => {
    loadFacilities();
  }, [loadFacilities]);

  return (
    <Tabs defaultValue="api_keys" className="space-y-4">
      <TabsList>
        <TabsTrigger value="api_keys" className="gap-1.5">
          <KeyRound className="size-3.5" /> API keys
        </TabsTrigger>
        <TabsTrigger value="channels" className="gap-1.5">
          <Plug className="size-3.5" /> Channels
        </TabsTrigger>
        <TabsTrigger value="facilities" className="gap-1.5">
          <Warehouse className="size-3.5" /> Facilities
        </TabsTrigger>
      </TabsList>
      <TabsContent value="api_keys">
        <ApiKeysSection />
      </TabsContent>
      <TabsContent value="channels">
        <ChannelsSection facilities={facilities} />
      </TabsContent>
      <TabsContent value="facilities">
        <FacilitiesSection facilities={facilities} reload={loadFacilities} />
      </TabsContent>
    </Tabs>
  );
}
