import InventoryDashboard from "./inventory/InventoryDashboard";
import { InventoryDataProvider } from "./inventory/InventoryDataContext";
import "./inventory/inventory.css";

export default function InventoryTabPanel({ session }) {
  return (
    <section className="panel inventory-panel dashboard-card dashboard-card--flat flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <InventoryDataProvider session={session}>
        <InventoryDashboard />
      </InventoryDataProvider>
    </section>
  );
}

