import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchInventorySuppliers } from "./inventory/inventoryDbUtils";
import { subscribePostgresChanges } from "./realtimeUtils";
import {
  PURCHASE_ORDER_CELL_IDS,
  PURCHASE_ORDER_CELL_PLACEMENT,
  PURCHASE_ORDER_R1_INVOICE,
  PURCHASE_ORDER_R2_CONSIGNEE,
  PURCHASE_ORDER_R3_HEADING,
  PURCHASE_ORDER_PAYMENT_HEADING,
  PURCHASE_ORDER_PAYMENT_VALUE,
  PURCHASE_ORDER_DELIVERY_HEADING,
  purchaseOrderSupplierDetailLines
} from "./purchaseOrderLayout";
import {
  PURCHASE_ORDER_DATED_HEADING,
  PURCHASE_ORDER_REFERENCE_HEADING,
  PURCHASE_ORDER_VOUCHER_HEADING,
  allocatePurchaseOrderVoucher,
  formatPurchaseOrderDated,
  loadPurchaseOrderByVoucher,
  purchaseOrderFinancialYearCode,
  readSessionPurchaseOrder,
  writeSessionPurchaseOrder
} from "./purchaseOrderVoucherUtils";

function PurchaseOrderAddressBlock({ heading, company, lines }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-auto p-3 text-sm font-normal leading-snug text-foreground">
      <p>{heading}</p>
      <p className="font-bold">{company}</p>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function PurchaseOrderR3Supplier() {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const rows = await fetchInventorySuppliers();
        if (!cancelled) setSuppliers(rows);
      } catch (e) {
        console.warn("purchase order suppliers:", e.message || e);
      }
    }
    void load();
    const unsub = subscribePostgresChanges({
      channelName: "purchase-order-suppliers",
      tables: ["inventory_suppliers"],
      onEvent: () => {
        void load();
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const selected = useMemo(
    () => suppliers.find((row) => row.id === selectedId) ?? null,
    [suppliers, selectedId]
  );
  const detailLines = purchaseOrderSupplierDetailLines(selected);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-auto p-3 text-sm font-normal leading-snug text-foreground">
      <p>{PURCHASE_ORDER_R3_HEADING}</p>
      <Select value={selectedId || undefined} onValueChange={setSelectedId}>
        <SelectTrigger className="h-8 w-full bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {suppliers
              .filter((row) => row.id)
              .map((row) => (
                <SelectItem key={row.id} value={row.id} className="font-bold">
                  {row.name}
                </SelectItem>
              ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {selected ? (
        <>
          <p className="font-bold">{selected.name}</p>
          {detailLines.map((line, index) => (
            <p key={`${index}-${line}`}>{line}</p>
          ))}
        </>
      ) : null}
    </div>
  );
}

function PurchaseOrderLabelValue({ heading, value }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-auto p-2 text-sm font-normal leading-snug text-foreground">
      <p>{heading}</p>
      {value ? <p className="font-bold">{value}</p> : null}
    </div>
  );
}

function PurchaseOrderTermsOfDelivery({ value, onChange }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-auto p-3 text-sm font-normal leading-snug text-foreground">
      <p>{PURCHASE_ORDER_DELIVERY_HEADING}</p>
      <Input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={PURCHASE_ORDER_DELIVERY_HEADING}
        className="bg-background"
      />
    </div>
  );
}

function PurchaseOrderCellContent({ id, voucherCode, datedLabel, termsOfDelivery, onTermsOfDeliveryChange }) {
  if (id === "R1") {
    return <PurchaseOrderAddressBlock {...PURCHASE_ORDER_R1_INVOICE} />;
  }
  if (id === "R2") {
    return <PurchaseOrderAddressBlock {...PURCHASE_ORDER_R2_CONSIGNEE} />;
  }
  if (id === "R3") {
    return <PurchaseOrderR3Supplier />;
  }
  if (id === "R11") {
    return <PurchaseOrderLabelValue heading={PURCHASE_ORDER_VOUCHER_HEADING} value={voucherCode} />;
  }
  if (id === "R12") {
    return <PurchaseOrderLabelValue heading={PURCHASE_ORDER_DATED_HEADING} value={datedLabel} />;
  }
  if (id === "R22") {
    return <PurchaseOrderLabelValue heading={PURCHASE_ORDER_PAYMENT_HEADING} value={PURCHASE_ORDER_PAYMENT_VALUE} />;
  }
  if (id === "R31") {
    return <PurchaseOrderLabelValue heading={PURCHASE_ORDER_REFERENCE_HEADING} value={voucherCode} />;
  }
  if (id === "R21B") {
    return (
      <PurchaseOrderTermsOfDelivery value={termsOfDelivery} onChange={onTermsOfDeliveryChange} />
    );
  }
  return null;
}

function PurchaseOrderCell({ id, voucherCode, datedLabel, termsOfDelivery, onTermsOfDeliveryChange }) {
  return (
    <div
      data-po-cell={id}
      className={cn(
        "min-h-0 overflow-hidden rounded-md border border-border/60 bg-muted/40",
        PURCHASE_ORDER_CELL_PLACEMENT[id]
      )}
    >
      <PurchaseOrderCellContent
        id={id}
        voucherCode={voucherCode}
        datedLabel={datedLabel}
        termsOfDelivery={termsOfDelivery}
        onTermsOfDeliveryChange={onTermsOfDeliveryChange}
      />
    </div>
  );
}

function applyPurchaseOrderRecord(record, setVoucherCode, setCreatedAt) {
  if (!record?.code) return;
  setVoucherCode(record.code);
  setCreatedAt(record.createdAt || new Date().toISOString());
}

export default function PurchaseOrderLayoutGrid() {
  const [voucherCode, setVoucherCode] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [termsOfDelivery, setTermsOfDelivery] = useState("");
  const datedLabel = createdAt ? formatPurchaseOrderDated(createdAt) : "";

  useEffect(() => {
    let cancelled = false;
    async function loadCurrent() {
      const fy = purchaseOrderFinancialYearCode();
      const existing = readSessionPurchaseOrder();
      if (existing?.code && existing.code.includes(`/${fy}/`)) {
        const fromDb = await loadPurchaseOrderByVoucher(existing.code);
        const loaded = fromDb || existing;
        const record = {
          code: loaded.code,
          createdAt: loaded.createdAt || new Date().toISOString()
        };
        writeSessionPurchaseOrder(record);
        if (!cancelled) applyPurchaseOrderRecord(record, setVoucherCode, setCreatedAt);
        return;
      }
      try {
        const record = await allocatePurchaseOrderVoucher();
        if (!cancelled) applyPurchaseOrderRecord(record, setVoucherCode, setCreatedAt);
      } catch (e) {
        console.warn("purchase order voucher:", e.message || e);
      }
    }
    void loadCurrent();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleNewPurchaseOrder() {
    try {
      const record = await allocatePurchaseOrderVoucher();
      applyPurchaseOrderRecord(record, setVoucherCode, setCreatedAt);
      setTermsOfDelivery("");
      setFormKey((n) => n + 1);
    } catch (e) {
      console.warn("purchase order new voucher:", e.message || e);
    }
  }

  return (
    <Card className="max-w-3xl shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="New purchase order"
          className="self-start"
          onClick={() => {
            void handleNewPurchaseOrder();
          }}
        >
          <Plus />
        </Button>
        <div className="grid w-full grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[repeat(4,minmax(1.75rem,auto))_repeat(4,minmax(2.15rem,auto))] gap-2">
          {PURCHASE_ORDER_CELL_IDS.map((id) => (
            <PurchaseOrderCell
              key={id === "R3" ? `R3-${formKey}` : id}
              id={id}
              voucherCode={voucherCode}
              datedLabel={datedLabel}
              termsOfDelivery={termsOfDelivery}
              onTermsOfDeliveryChange={setTermsOfDelivery}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
