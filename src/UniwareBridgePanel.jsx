import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AlertTriangle, Download, RefreshCw, Warehouse } from "lucide-react";
import { exportUniwareMirrorExcel } from "./uniwareMirrorExport";
import { fetchEntities, fetchLocations, fetchSkus } from "./mastersUtils";
import {
  createDraftUniTransfer,
  fetchUniFeedHealth,
  fetchUniInventoryMirror,
  fetchUniSaleOrders,
  fetchUniSettings,
  fetchUniTransfers,
  fetchUniDrrBySku,
  fetchUniSaleCoverage,
  invokeUniwareBridge,
  postUniTransfer,
  saveUniSettings
} from "./uniwareUtils";
import {
  clampDrrAmount,
  drrOfSku,
  drrPeriodDays,
  drrPeriodFromDate,
  formatUniDrrWithUnit,
  soldOfSku,
  UNIWARE_DRR_UNIT_LABEL
} from "./uniwareDrrUtils";

function formatWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function onHand(r) {
  return (Number(r.qty) || 0) + (Number(r.qty_blocked) || 0) + (Number(r.qty_putaway) || 0);
}

function isUniwareB2bChannel(channel) {
  const c = String(channel || "").trim().toUpperCase();
  return c === "CUSTOM" || c === "B2B" || c.includes("B2B") || c === "OFFLINE" || c === "MANUAL";
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
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [hideZeros, setHideZeros] = useState(true);
  const [mirrorSearch, setMirrorSearch] = useState("");
  const [orderChannelFilter, setOrderChannelFilter] = useState("all");
  const [drrUnit, setDrrUnit] = useState("days");
  const [drrAmountInput, setDrrAmountInput] = useState("30");
  const [drrAmount, setDrrAmount] = useState("30");
  const [drrBySku, setDrrBySku] = useState({});
  const [drrSort, setDrrSort] = useState("sku");
  const [drrLoading, setDrrLoading] = useState(false);
  const [saleCoverage, setSaleCoverage] = useState({ missing: 0, total: 0 });

  const facilityCodes = useMemo(() => {
    const codes = [...new Set(mirror.map((r) => r.facility_code).filter(Boolean))];
    return codes.sort((a, b) => a.localeCompare(b));
  }, [mirror]);

  const visibleMirror = useMemo(() => {
    const q = mirrorSearch.trim().toLowerCase();
    const rows = mirror.filter((r) => {
      if (facilityFilter !== "all" && r.facility_code !== facilityFilter) return false;
      const held = onHand(r) + (Number(r.qty_open_sale) || 0);
      if (hideZeros && held <= 0) return false;
      if (!q) return true;
      return String(r.sku_code || "").toLowerCase().includes(q);
    });
    if (drrSort === "high" || drrSort === "low") {
      const dir = drrSort === "high" ? -1 : 1;
      return [...rows].sort((a, b) => {
        const diff = (drrOfSku(drrBySku, a.sku_code) - drrOfSku(drrBySku, b.sku_code)) * dir;
        if (diff !== 0) return diff;
        return String(a.sku_code || "").localeCompare(String(b.sku_code || ""));
      });
    }
    return rows;
  }, [mirror, facilityFilter, hideZeros, mirrorSearch, drrSort, drrBySku]);

  const mirrorSummary = useMemo(() => {
    const rows = facilityFilter === "all" ? mirror : mirror.filter((r) => r.facility_code === facilityFilter);
    const available = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const held = rows.reduce((s, r) => s + onHand(r), 0);
    return {
      skus: rows.length,
      withStock: rows.filter((r) => onHand(r) > 0 || (Number(r.qty_open_sale) || 0) > 0).length,
      available,
      held
    };
  }, [mirror, facilityFilter]);

  const visibleOrders = useMemo(() => {
    return orders.filter((r) => {
      const b2b = isUniwareB2bChannel(r.channel);
      if (orderChannelFilter === "b2b") return b2b;
      if (orderChannelFilter === "ecom") return !b2b;
      return true;
    });
  }, [orders, orderChannelFilter]);

  const orderCounts = useMemo(() => {
    const b2b = orders.filter((r) => isUniwareB2bChannel(r.channel)).length;
    return { all: orders.length, b2b, ecom: orders.length - b2b };
  }, [orders]);

  const applyDrrPeriod = (unit, rawAmount) => {
    const next = String(clampDrrAmount(unit, rawAmount));
    setDrrUnit(unit);
    setDrrAmountInput(next);
    setDrrAmount(next);
  };

  const loadDrr = useCallback(async () => {
    const amount = clampDrrAmount(drrUnit, drrAmount);
    const days = drrPeriodDays(drrUnit, amount);
    const from = drrPeriodFromDate(drrUnit, amount);
    const facility = facilityFilter === "all" ? null : facilityFilter;
    try {
      const [map, coverage] = await Promise.all([
        fetchUniDrrBySku(from, days, facility),
        fetchUniSaleCoverage(from)
      ]);
      setDrrBySku(map);
      setSaleCoverage(coverage);
      return coverage;
    } catch (e) {
      setError(e.message ?? String(e));
      return { missing: 0, total: 0 };
    }
  }, [drrUnit, drrAmount, facilityFilter]);

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

  const appliedPeriod = `${drrUnit}:${clampDrrAmount(drrUnit, drrAmount)}`;
  const lastPeriod = useRef(appliedPeriod);
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    setDrrLoading(true);
    (async () => {
      const coverage = await loadDrr();
      const periodChanged = lastPeriod.current !== appliedPeriod;
      lastPeriod.current = appliedPeriod;
      if (!cancelled && periodChanged && coverage.missing > 0) {
        try {
          await invokeUniwareBridge("sync_orders", {
            days: drrPeriodDays(drrUnit, drrAmount)
          });
          if (!cancelled) await loadDrr();
        } catch (e) {
          if (!cancelled) setError(e.message ?? String(e));
        }
      }
      if (!cancelled) setDrrLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [appliedPeriod, facilityFilter, loadDrr, loading, drrUnit, drrAmount]);

  const run = async (fn, success) => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const result = await fn();
      setMsg(success(result));
      await load();
      await loadDrr();
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
            Step 5 — Uniware owns ecom-facility stock. This screen is a read-only mirror (inventory + Uniware sale orders, including CUSTOM/B2B) plus the transfer document that crosses the line.
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
          run(() => invokeUniwareBridge("sync_inventory"), (r) => {
            const extra = r.facilityErrors?.length ? ` (${r.facilityErrors.length} facility warnings)` : "";
            const cat = r.catalogSkus != null ? ` · ${r.catalogSkus} SKUs queued` : "";
            const trunc = r.catalogComplete === false ? " · catalog still paging — click Sync inventory again" : "";
            return `Inventory snapshot: ${r.rows} rows across ${r.facilities ?? "?"} facilities${cat}${trunc}${extra}.`;
          })
            }
          >
            Sync inventory
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading || drrLoading || !visibleMirror.length}
            onClick={async () => {
              setBusy(true);
              setError("");
              setMsg("");
              try {
                const result = await exportUniwareMirrorExcel({
                  rows: visibleMirror,
                  drrBySku
                });
                setMsg(`Exported ${result.rowCount} rows — same list as the table.`);
              } catch (e) {
                setError(e.message ?? String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> Export xls
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  invokeUniwareBridge("sync_orders", {
                    days: drrPeriodDays(drrUnit, drrAmount)
                  }),
                (r) => {
                  const pending = r.pendingLineOrders
                    ? ` · ${r.pendingLineOrders} orders still need lines (click Sync orders again)`
                    : "";
                  const gets = r.getErrors ? ` · ${r.getErrors} get errors${r.firstGetError ? `: ${r.firstGetError}` : ""}` : "";
                  return `Sale orders: ${r.lines ?? 0} lines from ${r.lineOrders ?? 0} orders (${r.rows} headers). DRR fills as lines land.${pending}${gets}`;
                }
              )
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
        <div className="flex flex-col gap-3">
          <Tabs value={facilityFilter} onValueChange={setFacilityFilter}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all" className="h-7 text-xs">
                All
              </TabsTrigger>
              {facilityCodes.map((code) => (
                <TabsTrigger key={code} value={code} className="h-7 text-xs">
                  {code}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {mirrorSummary.skus} SKUs · {mirrorSummary.withStock} with stock · available{" "}
              {mirrorSummary.available} · on hand {mirrorSummary.held}
              {" · "}Sold + DRR use exact Uniware sale items (dispatched / delivered / invoiced) in this
              period. DRR = sold ÷ {drrPeriodDays(drrUnit, drrAmount)} days.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Field orientation="horizontal" className="w-auto items-center gap-2">
                <FieldLabel className="text-xs text-muted-foreground">DRR period</FieldLabel>
                {drrLoading ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Spinner className="size-3.5" />
                    Loading Uniware sales…
                  </span>
                ) : null}
                <Input
                  type="number"
                  min="1"
                  value={drrAmountInput}
                  onChange={(e) => setDrrAmountInput(e.target.value)}
                  onBlur={() => applyDrrPeriod(drrUnit, drrAmountInput)}
                  className="h-8 w-16 text-xs"
                  aria-label="DRR period amount"
                  disabled={drrLoading}
                />
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={drrUnit}
                  onValueChange={(v) => v && applyDrrPeriod(v, drrAmountInput)}
                  disabled={drrLoading}
                >
                  <ToggleGroupItem value="days">Days</ToggleGroupItem>
                  <ToggleGroupItem value="months">Months</ToggleGroupItem>
                  <ToggleGroupItem value="years">Years</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field orientation="horizontal" className="w-auto items-center gap-2">
                <FieldLabel className="text-xs text-muted-foreground">Sort DRR</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={drrSort}
                  onValueChange={(v) => v && setDrrSort(v)}
                >
                  <ToggleGroupItem value="sku">SKU</ToggleGroupItem>
                  <ToggleGroupItem value="high">High to low</ToggleGroupItem>
                  <ToggleGroupItem value="low">Low to high</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Input
                value={mirrorSearch}
                onChange={(e) => setMirrorSearch(e.target.value)}
                placeholder="Search SKU…"
                className="h-8 w-44 text-xs"
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="uniware-hide-zeros"
                  checked={hideZeros}
                  onCheckedChange={setHideZeros}
                />
                <Label htmlFor="uniware-hide-zeros" className="text-xs text-muted-foreground">
                  Hide zeros
                </Label>
              </div>
            </div>
          </div>
          {saleCoverage.missing > 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Uniware sales still loading</AlertTitle>
              <AlertDescription>
                {saleCoverage.missing} of {saleCoverage.total} orders in this period still need exact
                sale lines. Sold and DRR stay short until you click Sync orders (or wait if the period
                just changed).
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Blocked</TableHead>
                <TableHead className="text-right">Open sale</TableHead>
                <TableHead className="text-right">Putaway</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">DRR ({UNIWARE_DRR_UNIT_LABEL})</TableHead>
                <TableHead>Synced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleMirror.length ? (
                visibleMirror.map((r) => (
                  <TableRow key={`${r.facility_code}-${r.sku_code}-${r.inventory_type}`}>
                    <TableCell className="font-mono text-xs">{r.sku_code}</TableCell>
                    <TableCell className="font-mono text-xs">{r.facility_code}</TableCell>
                    <TableCell className="text-right">{Number(r.qty)}</TableCell>
                    <TableCell className="text-right">{Number(r.qty_blocked) || 0}</TableCell>
                    <TableCell className="text-right">{Number(r.qty_open_sale) || 0}</TableCell>
                    <TableCell className="text-right">{Number(r.qty_putaway) || 0}</TableCell>
                    <TableCell className="text-right">{onHand(r)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", drrLoading && "opacity-40")}>
                      {soldOfSku(drrBySku, r.sku_code)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", drrLoading && "opacity-40")}>
                      {formatUniDrrWithUnit(drrOfSku(drrBySku, r.sku_code))}
                    </TableCell>
                    <TableCell>{formatWhen(r.synced_at)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                    {mirror.length
                      ? "No SKUs match this facility / hide-zeros filter. Turn Hide zeros off to see empty rows."
                      : "No mirror rows yet — click Sync inventory. These qty never add into Stock Ledger."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>
      ) : null}

      {!loading && tab === "orders" ? (
        <div className="flex flex-col gap-3">
          <Tabs value={orderChannelFilter} onValueChange={setOrderChannelFilter}>
            <TabsList>
              <TabsTrigger value="all">All {orderCounts.all}</TabsTrigger>
              <TabsTrigger value="b2b">B2B / CUSTOM {orderCounts.b2b}</TabsTrigger>
              <TabsTrigger value="ecom">Ecom {orderCounts.ecom}</TabsTrigger>
            </TabsList>
          </Tabs>
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
              {visibleOrders.length ? (
                visibleOrders.map((r) => (
                  <TableRow key={r.uni_code}>
                    <TableCell className="font-mono text-xs">{r.uni_code}</TableCell>
                    <TableCell className="font-mono text-xs">{r.display_order_code}</TableCell>
                    <TableCell>
                      <Badge variant={isUniwareB2bChannel(r.channel) ? "secondary" : "outline"} className="text-[10px]">
                        {r.channel ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.status ?? "—"}</TableCell>
                    <TableCell>{r.customer_name ?? "—"}</TableCell>
                    <TableCell>{r.order_date ?? "—"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    {orders.length
                      ? "No orders in this channel filter."
                      : "No Uniware orders mirrored yet — click Sync orders. Pulls ecom and CUSTOM/B2B. We do not edit them here."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
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
