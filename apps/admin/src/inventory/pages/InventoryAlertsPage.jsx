import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ColorSwatch from "../components/ColorSwatch";
import { useInventory } from "../InventoryDataContext";
import InventoryThresholdSettingsModal from "../modals/InventoryThresholdSettingsModal";
import { EmptyHint, PageHeader } from "../inventoryUiUtils";

export default function InventoryAlertsPage({ openCreatePO, openSku }) {
  const { alerts, skus, suppliers, settings } = useInventory();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const critical = alerts.filter((a) => a.severity === "critical");
  const warn = alerts.filter((a) => a.severity === "warn");
  const criticalPct = Math.round((Number(settings?.critical_ratio) || 0.5) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts & reorder"
        subtitle={
          <>
            <span className="text-red-600">● {critical.length} critical</span>
            {" · "}
            <span className="text-amber-600">● {warn.length} low</span>
            {skus.length === 0 && " · Add SKUs first — no demo data is loaded."}
          </>
        }
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              Threshold settings
            </Button>
            <Button type="button" size="sm" onClick={() => openCreatePO()}>
              Bulk reorder
            </Button>
          </>
        }
      />

      <Alert>
        <AlertTitle>Why do alerts appear?</AlertTitle>
        <AlertDescription>
          Each SKU you add can have a <em>reorder point</em>. When on-hand stock drops below that number, a low-stock
          alert shows. Critical alerts use your global rule (currently {criticalPct}% of reorder, or out of stock). SKUs
          with reorder point 0 are ignored. Old demo entries are gone — only your database SKUs count.
        </AlertDescription>
      </Alert>

      {alerts.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No alerts right now. Add SKUs under Fabrics / Trims / Apparel, set reorder points in{" "}
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => setSettingsOpen(true)}>
              Threshold settings
            </Button>
            , or stock will look healthy until it drops.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-red-600">Critical · immediate action</CardTitle>
          <CardDescription>Out of stock or below {criticalPct}% of reorder threshold</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {critical.length === 0 && <EmptyHint>No critical alerts.</EmptyHint>}
          {critical.map((a) => {
            const sku = skus.find((s) => s.id === a.id);
            const sup = suppliers.find((s) => s.id === a.supplier);
            return (
              <div key={a.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Badge variant="destructive" className="mt-0.5 shrink-0">
                  Critical
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <ColorSwatch color={a.color} hex={a.hex} size="xs" />
                    {a.name}
                    {a.color ? ` · ${a.color}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{a.id}</span> · {a.message} · on hand <strong>{a.stock.toLocaleString()}</strong>{" "}
                    / reorder at <strong>{a.reorder.toLocaleString()}</strong>
                    {sup ? ` · supplier ${sup.name} (${sup.leadDays}d)` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openSku(sku)}>
                    View
                  </Button>
                  <Button type="button" size="sm" onClick={() => openCreatePO(sku)}>
                    Reorder
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-amber-600">Low stock · plan reorder</CardTitle>
          <CardDescription>Below reorder threshold but not yet critical</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {warn.length === 0 && <EmptyHint>No low-stock warnings.</EmptyHint>}
          {warn.map((a) => {
            const sku = skus.find((s) => s.id === a.id);
            const sup = suppliers.find((s) => s.id === a.supplier);
            return (
              <div key={a.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Badge variant="outline" className="mt-0.5 shrink-0 border-amber-300 bg-amber-50 text-amber-700">
                  Low
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <ColorSwatch color={a.color} hex={a.hex} size="xs" />
                    {a.name}
                    {a.color ? ` · ${a.color}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{a.id}</span> · on hand <strong>{a.stock.toLocaleString()}</strong> / reorder at{" "}
                    <strong>{a.reorder.toLocaleString()}</strong>
                    {sup ? ` · supplier ${sup.name}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openSku(sku)}>
                    View
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => openCreatePO(sku)}>
                    Plan PO
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {settingsOpen && <InventoryThresholdSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
