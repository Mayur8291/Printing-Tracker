import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInventory } from "../InventoryDataContext";
import { EmptyHint } from "../inventoryUiUtils";

export default function InventoryThresholdSettingsModal({ onClose }) {
  const { settings, skus, updateAlertSettings, saveSkuReorder, refresh } = useInventory();
  const [criticalPct, setCriticalPct] = useState(50);
  const [lowEnabled, setLowEnabled] = useState(true);
  const [oosCritical, setOosCritical] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skuDrafts, setSkuDrafts] = useState({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settings) return;
    setCriticalPct(Math.round((Number(settings.critical_ratio) || 0.5) * 100));
    setLowEnabled(settings.low_stock_enabled !== false);
    setOosCritical(settings.out_of_stock_critical !== false);
  }, [settings]);

  useEffect(() => {
    const drafts = {};
    skus.forEach((s) => {
      drafts[s._uuid] = String(s.reorder ?? 0);
    });
    setSkuDrafts(drafts);
  }, [skus]);

  const saveGlobal = async () => {
    setSaving(true);
    setMessage("");
    try {
      await updateAlertSettings({
        critical_ratio: Math.min(100, Math.max(1, criticalPct)) / 100,
        low_stock_enabled: lowEnabled,
        out_of_stock_critical: oosCritical
      });
      setMessage("Global thresholds saved.");
    } catch (err) {
      setMessage(err?.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const saveSkuRow = async (sku) => {
    setMessage("");
    try {
      await saveSkuReorder(sku._uuid, skuDrafts[sku._uuid]);
      setMessage(`Reorder point saved for ${sku.id}.`);
    } catch (err) {
      setMessage(err?.message || "Could not save SKU threshold.");
    }
  };

  const saveAllSkus = async () => {
    setSaving(true);
    setMessage("");
    try {
      for (const sku of skus) {
        await saveSkuReorder(sku._uuid, skuDrafts[sku._uuid]);
      }
      await refresh();
      setMessage("All SKU reorder points saved.");
    } catch (err) {
      setMessage(err?.message || "Could not save SKU thresholds.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alert & reorder thresholds</DialogTitle>
          <DialogDescription>
            Alerts only appear for SKUs you add. Set a reorder point per SKU; the app compares on-hand stock to that number.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Critical level (% of reorder point)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={criticalPct}
                onChange={(e) => setCriticalPct(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Stock below this % of reorder point = critical (e.g. 50% means half of reorder qty).
              </p>
            </div>
            <div className="space-y-3">
              <Label>Options</Label>
              <div className="flex items-center gap-2">
                <Checkbox id="low-enabled" checked={lowEnabled} onCheckedChange={(v) => setLowEnabled(!!v)} />
                <label htmlFor="low-enabled" className="text-sm leading-none">
                  Show low-stock warnings when below reorder point
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="oos-critical" checked={oosCritical} onCheckedChange={(v) => setOosCritical(!!v)} />
                <label htmlFor="oos-critical" className="text-sm leading-none">
                  Treat out of stock (0) as critical
                </label>
              </div>
            </div>
          </div>

          <Button type="button" disabled={saving} onClick={saveGlobal}>
            Save global rules
          </Button>

          <div>
            <h4 className="mb-1 text-sm font-medium">Per-SKU reorder points</h4>
            <p className="mb-3 text-xs text-muted-foreground">SKUs with reorder point 0 are ignored in alerts until you set a value.</p>

            {skus.length === 0 ? (
              <EmptyHint>No SKUs yet. Add fabrics, trims, or apparel first.</EmptyHint>
            ) : (
              <ScrollArea className="max-h-80 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reorder at</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skus.map((sku) => {
                      const onHand = sku.stock ?? sku.totalStock ?? 0;
                      return (
                        <TableRow key={sku._uuid}>
                          <TableCell className="font-mono text-xs">{sku.id}</TableCell>
                          <TableCell>{sku.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {onHand.toLocaleString()} {sku.unit || "pc"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              className="ml-auto h-8 w-24 text-right"
                              value={skuDrafts[sku._uuid] ?? "0"}
                              onChange={(e) => setSkuDrafts((d) => ({ ...d, [sku._uuid]: e.target.value }))}
                            />
                          </TableCell>
                          <TableCell>
                            <Button type="button" variant="outline" size="sm" onClick={() => saveSkuRow(sku)}>
                              Save
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}

            {skus.length > 0 && (
              <Button type="button" variant="outline" className="mt-3" disabled={saving} onClick={saveAllSkus}>
                Save all SKU reorder points
              </Button>
            )}
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
