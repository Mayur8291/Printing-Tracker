import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInventory } from "./InventoryDataContext";

function NavButton({ item, active, onNavigate }) {
  return (
    <Button
      type="button"
      variant={active === item.id ? "secondary" : "ghost"}
      className={cn("h-9 w-full justify-start px-3 font-normal", active === item.id && "font-medium")}
      onClick={() => onNavigate(item.id)}
    >
      <span className="truncate">{item.label}</span>
      {item.dot ? (
        <Badge variant="destructive" className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px]">
          {item.count}
        </Badge>
      ) : item.count != null ? (
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {item.count.toLocaleString()}
        </Badge>
      ) : null}
    </Button>
  );
}

export default function InventorySubNav({ active, onNavigate, alertCount }) {
  const { fabrics, trims, apparel, suppliers, warehouses, pos, alerts } = useInventory();
  const alertsCount = alertCount ?? alerts.length;
  const openPoCount = pos.filter((p) => p.status !== "Received").length;

  const navGroups = [
    {
      title: "Workspace",
      items: [
        { id: "overview", label: "Overview" },
        { id: "alerts", label: "Alerts & Reorder", dot: alertsCount > 0, count: alertsCount },
        { id: "movements", label: "Movements" }
      ]
    },
    {
      title: "Inventory",
      items: [
        { id: "fabrics", label: "Fabrics", count: fabrics.length },
        { id: "trims", label: "Trims", count: trims.length },
        { id: "apparel", label: "Apparel", count: apparel.length }
      ]
    },
    {
      title: "Operations",
      items: [
        { id: "pos", label: "Purchase Orders", count: openPoCount },
        { id: "suppliers", label: "Suppliers", count: suppliers.length },
        { id: "warehouses", label: "Warehouses", count: warehouses.length }
      ]
    }
  ];

  return (
    <aside className="flex h-full min-h-0 w-56 shrink-0 flex-col border-r bg-muted/30">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {navGroups.map((group, idx) => (
          <div key={group.title} className={cn(idx > 0 && "mt-4")}>
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavButton key={item.id} item={item} active={active} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
