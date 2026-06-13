import InventoryIcon from "./InventoryIcon";
import { useInventory } from "./InventoryDataContext";

export default function InventorySubNav({ active, onNavigate, alertCount }) {
  const { fabrics, trims, apparel, suppliers, warehouses, pos, alerts } = useInventory();
  const alertsCount = alertCount ?? alerts.length;
  const openPoCount = pos.filter((p) => p.status !== "Received").length;

  const navGroups = [
    {
      title: "Workspace",
      items: [
        { id: "overview", label: "Overview", icon: "home" },
        { id: "alerts", label: "Alerts & Reorder", icon: "bell", dot: alertsCount > 0, count: alertsCount },
        { id: "movements", label: "Movements", icon: "swap" }
      ]
    },
    {
      title: "Inventory",
      items: [
        { id: "fabrics", label: "Fabrics", icon: "layers", count: fabrics.length },
        { id: "trims", label: "Trims", icon: "box", count: trims.length },
        { id: "apparel", label: "Apparel", icon: "shirt", count: apparel.length }
      ]
    },
    {
      title: "Operations",
      items: [
        { id: "pos", label: "Purchase Orders", icon: "cart", count: openPoCount },
        { id: "suppliers", label: "Suppliers", icon: "truck", count: suppliers.length },
        { id: "warehouses", label: "Warehouses", icon: "building", count: warehouses.length }
      ]
    }
  ];

  return (
    <nav className="inv-subnav" aria-label="Inventory sections">
      {navGroups.map((group) => (
        <div className="inv-subnav-group" key={group.title}>
          <div className="inv-subnav-title">{group.title}</div>
          <div className="inv-subnav-items">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`inv-subnav-item${active === item.id ? " active" : ""}`}
                onClick={() => onNavigate(item.id)}
              >
                <InventoryIcon name={item.icon} size={15} stroke={1.6} />
                <span>{item.label}</span>
                {item.dot ? (
                  <span className="inv-subnav-dot" title={`${item.count} alerts`} />
                ) : (
                  item.count != null && <span className="inv-subnav-count">{item.count.toLocaleString()}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
