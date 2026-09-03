import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AlertTriangle, RefreshCw, Warehouse } from "lucide-react";
import { fetchEntities, fetchLocations, fetchSkus } from "./mastersUtils";
import {
  createDraftUniTransfer,
  fetchUniFeedHealth,
  fetchUniInventoryMirror,
  fetchUniSaleOrders,
  fetchUniSettings,
  fetchUniTransfers,
  invokeUniwareBridge,
  postUniTransfer,
  saveUniSettings
} from "./uniwareUtils";

function formatWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function UniwareBridgePanel() {
  const [tab, setTab] = useState("mirror");
  const [health, setHealth] = useState([]);
  const [mirror, setMirror] = useState([]);
  const [orders, setOrders] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [locations, setLocations] = useState([]);
  const [entities, setEntities] = useState([]);
  const [skus, setSkus] = useState([]);
  const [configured, setConfigured] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [direction, setDirection] = useState("platform_to_uniware");
  const [skuCode, setSkuCode] = useState("");
  const [qty, setQty] = useState("");
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [h, m, o, t, s, loc, ents, skuRows, status] = await Promise.all([
        fetchUniFeedHealth(),
        fetchUniInventoryMirror(),
        fetchUniSaleOrders(),
        fetchUniTransfers(),
        fetchUniSettings(),
        fetchLocations(),
        fetchEntities(),
        fetchSkus(),
        invokeUniwareBridge("status").catch(() => ({ configured: false }))
      ]);
      setHealth(h);
      setMirror(m);
      setOrders(o);
      setTransfers(t);
      setSettings(s);
      setLocations(loc.filter((l) => l.is_active));
      setEntities(ents.filter((e) => e.is_active));
      setSkus(skuRows.filter((x) => x.is_active));
      setConfigured(Boolean(status?.configured));
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const result = await fn();
      setMsg(success(result));
      await load();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (patch) => {
    await saveUniSettings(patch);
    await load();
  };

  const submitTransfer = async () => {
    const sku = skus.find((s) => s.sku_code.toLowerCase() === skuCode.trim().toLowerCase());
    if (!sku || !fromLoc || !toLoc || !(Number(qty) > 0)) {
      setError("SKU code, both locations and qty > 0 are required.");
      return;
    }
    if (fromLoc === toLoc) {
      setError("From and to locations must differ.");
      return;
    }
    await run(async () => {
      const id = await createDraftUniTransfer({
        direction,
        skuId: sku.id,
        qty: Number(qty),
        fromLocationId: fromLoc,
        toLocationId: toLoc
      });
      const no = await postUniTransfer(id);
      try {
        await invokeUniwareBridge("adjust", {
          transferId: id,
          skuCode: sku.sku_code,
          qty: Number(qty),
          direction,
          transferNo: no
        });
      } catch (apiErr) {
        return { no, apiError: apiErr.message };
      }
      return { no };
    }, (r) =>
      r.apiError
        ? `Transfer ${r.no} posted in the ledger; Uniware API failed: ${r.apiError}`
        : `Transfer ${r.no} posted and sent to Uniware.`
    );
  };

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Warehouse className="h-5 w-5" /> Uniware Bridge
          </h2>
          <p className="text-sm text-muted-foreground">
            Step 5 — Uniware owns ecom-facility stock. This screen is a read-only mirror plus the transfer document that crosses the line.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(() => invokeUniwareBridge("sync_inventory"), (r) => `Inventory snapshot: ${r.rows} SKUs.`)
            }
          >
            Sync inventory
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(() => invokeUniwareBridge("sync_orders"), (r) => `Sale orders: ${r.rows} upserted.`)
            }
          >
            Sync orders
          </Button>
        </div>
      </div>

      {configured === false ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Uniware API secrets not set</AlertTitle>
          <AlertDescription>
            Staging edge needs <code>UNIWARE_BASE_URL</code>, <code>UNIWARE_USERNAME</code>,{" "}
            <code>UNIWARE_PASSWORD</code>, <code>UNIWARE_FACILITY</code>. Mirror tables still load if you synced before.
            See docs/UNIWARE_BOUNDARY.md.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {msg ? (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {health.map((f) => (
          <Badge
            key={f.feed}
            variant="outline"
            className={cn("font-normal", f.stale ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800")}
          >
            {f.feed}: {f.last_status ?? "never"} · {formatWhen(f.last_finished_at)}
            {f.stale ? " · stale" : ""}
          </Badge>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mirror">Inventory mirror</TabsTrigger>
          <TabsTrigger value="orders">Ecom orders</TabsTrigger>
          <TabsTrigger value="transfer">Transfers</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? <Skeleton className="h-32 w-full" /> : null}

      {!loading && tab === "mirror" ? (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty (Uniware)</TableHead>
                <TableHead>Synced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mirror.length ? (
                mirror.map((r) => (
                  <TableRow key={`${r.facility_code}-${r.sku_code}-${r.inventory_type}`}>
                    <TableCell className="font-mono text-xs">{r.sku_code}</TableCell>
                    <TableCell className="font-mono text-xs">{r.facility_code}</TableCell>
                    <TableCell>{r.inventory_type}</TableCell>
                    <TableCell className="text-right">{Number(r.qty)}</TableCell>
                    <TableCell>{formatWhen(r.synced_at)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No mirror rows yet — sync inventory after secrets are set. These qty are never added into Stock Ledger.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {!loading && tab === "orders" ? (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Uniware code</TableHead>
                <TableHead>Display</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length ? (
                orders.map((r) => (
                  <TableRow key={r.uni_code}>
                    <TableCell className="font-mono text-xs">{r.uni_code}</TableCell>
                    <TableCell className="font-mono text-xs">{r.display_order_code}</TableCell>
                    <TableCell>{r.channel ?? "—"}</TableCell>
                    <TableCell>{r.status ?? "—"}</TableCell>
                    <TableCell>{r.customer_name ?? "—"}</TableCell>
                    <TableCell>{r.order_date ?? "—"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No ecom orders mirrored. The platform does not edit these — Uniware stays the fulfilment engine.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {!loading && tab === "transfer" ? (
        <div className="grid gap-4">
          <div className="grid gap-3 rounded border p-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform_to_uniware">Platform → Uniware</SelectItem>
                  <SelectItem value="uniware_to_platform">Uniware → Platform</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>SKU code</Label>
              <Input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="Platform SKU" />
            </div>
            <div className="grid gap-1.5">
              <Label>Qty</Label>
              <Input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>From location</Label>
              <Select value={fromLoc} onValueChange={setFromLoc}>
                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.code} — {l.name} ({l.owner_system})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>To location</Label>
              <Select value={toLoc} onValueChange={setToLoc}>
                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.code} — {l.name} ({l.owner_system})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={submitTransfer} disabled={busy}>Post transfer</Button>
            </div>
          </div>

          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>API</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.length ? (
                  transfers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.transfer_no ?? "draft"}</TableCell>
                      <TableCell>{t.direction}</TableCell>
                      <TableCell className="font-mono text-xs">{t.cat_sku?.sku_code}</TableCell>
                      <TableCell className="text-right">{Number(t.qty)}</TableCell>
                      <TableCell>{t.status}</TableCell>
                      <TableCell className="text-xs">{t.uniware_ref ?? t.error_text ?? "—"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No transfers. This is the only way platform stock may enter the Uniware facility.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {!loading && tab === "settings" ? (
        <div className="grid max-w-xl gap-3">
          <p className="text-sm text-muted-foreground">
            Point the transfer document at the Uniware marker location (owner_system = uniware) and a platform source. API login stays in edge secrets.
          </p>
          <div className="grid gap-1.5">
            <Label>Default entity</Label>
            <Select
              value={settings?.default_entity_id ?? ""}
              onValueChange={(v) => saveSettings({ default_entity_id: v })}
            >
              <SelectTrigger><SelectValue placeholder="Pick entity" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Uniware location (marker)</Label>
            <Select
              value={settings?.uniware_location_id ?? ""}
              onValueChange={(v) => saveSettings({ uniware_location_id: v })}
            >
              <SelectTrigger><SelectValue placeholder="Pick uniware location" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.code} — {l.owner_system}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
