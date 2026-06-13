import InventoryDashboard from "./inventory/InventoryDashboard";
import { InventoryDataProvider } from "./inventory/InventoryDataContext";
import "./inventory/inventory.css";

export default function InventoryTabPanel({ session }) {
  return (
    <section className="panel inventory-panel dashboard-card dashboard-card--flat">
      <InventoryDataProvider session={session}>
        <InventoryDashboard />
      </InventoryDataProvider>
    </section>
  );
}
