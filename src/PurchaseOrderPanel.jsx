import { useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PurchaseOrderHistoryTable from "./PurchaseOrderHistoryTable";
import PurchaseOrderLayoutGrid from "./PurchaseOrderLayoutGrid";
import {
  PO_GENERATE_MANDATORY_MESSAGE,
  generatePurchaseOrderHistory
} from "./purchaseOrderHistoryUtils";
import { allocatePurchaseOrderVoucher } from "./purchaseOrderVoucherUtils";

const PO_CREATE_TAB = "create";
const PO_HISTORY_TAB = "history";

export default function PurchaseOrderPanel() {
  const [subTab, setSubTab] = useState(PO_CREATE_TAB);
  const [generateError, setGenerateError] = useState("");
  const [generating, setGenerating] = useState(false);
  const sheetRef = useRef(null);

  async function handleGeneratePo() {
    if (sheetRef.current?.validateMandatory && !sheetRef.current.validateMandatory()) {
      setGenerateError(PO_GENERATE_MANDATORY_MESSAGE);
      return;
    }
    const snapshot = sheetRef.current?.getSnapshot?.();
    if (!snapshot?.voucherCode) {
      setGenerateError("Voucher number missing. Wait for the sheet to load, then try again.");
      return;
    }
    setGenerating(true);
    setGenerateError("");
    try {
      await generatePurchaseOrderHistory(snapshot);
      await allocatePurchaseOrderVoucher();
      setSubTab(PO_HISTORY_TAB);
    } catch (e) {
      setGenerateError(e.message || "Could not generate purchase order.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="panel table-panel dashboard-card flex flex-col gap-4">
      <div data-po-no-print="" className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="dashboard-section-title mb-0 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" aria-hidden />
          Purchase Order
        </h2>
        <Tabs value={subTab} onValueChange={setSubTab}>
          <TabsList aria-label="Purchase Order views">
            <TabsTrigger value={PO_CREATE_TAB}>Create new PO</TabsTrigger>
            <TabsTrigger value={PO_HISTORY_TAB}>PO History</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {subTab === PO_CREATE_TAB ? (
        <div className="flex flex-col gap-4">
          <PurchaseOrderLayoutGrid ref={sheetRef} />
          <div data-po-no-print="" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={generating} onClick={() => void handleGeneratePo()}>
                Generate PO
              </Button>
              <Button type="button" variant="outline" onClick={() => window.print()}>
                Print
              </Button>
            </div>
            {generateError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{generateError}</AlertTitle>
              </Alert>
            ) : null}
          </div>
        </div>
      ) : (
        <PurchaseOrderHistoryTable />
      )}
    </section>
  );
}
