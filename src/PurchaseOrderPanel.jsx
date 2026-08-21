import { FileSpreadsheet } from "lucide-react";
import PurchaseOrderLayoutGrid from "./PurchaseOrderLayoutGrid";

export default function PurchaseOrderPanel() {
  return (
    <section className="panel table-panel dashboard-card flex flex-col gap-4">
      <h2 className="dashboard-section-title flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5" aria-hidden />
        Purchase Order
      </h2>
      <PurchaseOrderLayoutGrid />
    </section>
  );
}
