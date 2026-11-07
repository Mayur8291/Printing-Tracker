import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchInventorySuppliers } from "./inventory/inventoryDbUtils";
import PurchaseOrderC23Signature from "./PurchaseOrderC23Signature";
import { purchaseOrderAmountInWords } from "./purchaseOrderAmountWords";
import {
  PURCHASE_ORDER_AMOUNT_WORDS_HEADING,
  PURCHASE_ORDER_C_BASE_LINE_KEY,
  PURCHASE_ORDER_C_HEADER_IDS,
  PURCHASE_ORDER_C_HEADINGS,
  PURCHASE_ORDER_C_LINE_IDS,
  PURCHASE_ORDER_C_TOTAL_IDS,
  PURCHASE_ORDER_DELIVERY_HEADING,
  PURCHASE_ORDER_GROW_FIELD_HEADINGS,
  PURCHASE_ORDER_PAYMENT_HEADING,
  PURCHASE_ORDER_PAYMENT_VALUE,
  PURCHASE_ORDER_R1_INVOICE,
  PURCHASE_ORDER_R2_CONSIGNEE,
  PURCHASE_ORDER_R3_HEADING,
  PURCHASE_ORDER_SHEET_TITLE,
  PURCHASE_ORDER_VOUCHER_CELL_IDS,
  formatPurchaseOrderC42Display,
  formatPurchaseOrderC82Display,
  formatPurchaseOrderLineAmount,
  purchaseOrderLineCellId,
  purchaseOrderSlNoText,
  purchaseOrderSupplierDetailLines,
  sumPurchaseOrderLineAmounts,
  sumPurchaseOrderQuantities
} from "./purchaseOrderLayout";
import {
  PURCHASE_ORDER_DATED_HEADING,
  PURCHASE_ORDER_REFERENCE_HEADING,
  PURCHASE_ORDER_VOUCHER_HEADING,
  formatPurchaseOrderDueOn
} from "./purchaseOrderVoucherUtils";

const poFitText =
  "flex h-auto flex-col justify-start gap-0.5 overflow-visible p-1.5 text-[11px] font-normal leading-tight text-foreground";
const poCompactText =
  "flex h-full min-h-0 flex-col gap-0.5 overflow-hidden p-1.5 text-[11px] font-normal leading-tight text-foreground";
const poCCols =
  "grid-cols-[minmax(1.1rem,0.5fr)_minmax(0,3fr)_minmax(5.5rem,1.15fr)_minmax(6.75rem,1.4fr)_minmax(0,0.6fr)_minmax(0,0.55fr)_minmax(0,0.5fr)_minmax(4.75rem,0.85fr)]";
const poQtyType = "text-[11px] font-normal leading-none md:text-[11px]";
const poTotalType = "whitespace-nowrap text-[11px] font-bold leading-none md:text-[11px]";

function PrintCell({ children, grow }) {
  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-none border border-border/60 bg-muted/40",
        grow ? "h-full min-h-0 overflow-visible" : "min-h-0"
      )}
    >
      {children}
    </div>
  );
}

function PrintAddress({ heading, company, lines }) {
  return (
    <div className={poFitText}>
      <p>{heading}</p>
      <p className="font-bold">{company}</p>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function PrintLabelValue({ heading, value }) {
  return (
    <div className={poCompactText}>
      <p>{heading}</p>
      {value ? <p className="font-bold">{value}</p> : null}
    </div>
  );
}

function dueOnLabel(ymd) {
  if (!ymd) return "";
  try {
    return formatPurchaseOrderDueOn(parseISO(`${ymd}T12:00:00`));
  } catch {
    return String(ymd);
  }
}

function PrintCellBody({
  id,
  lineKey,
  lineIndex,
  snapshot,
  supplierName,
  supplierLines,
  voucherCode,
  datedLabel,
  c42QtyTotal,
  c82Amount
}) {
  if (id === "R1") return <PrintAddress {...PURCHASE_ORDER_R1_INVOICE} />;
  if (id === "R2") return <PrintAddress {...PURCHASE_ORDER_R2_CONSIGNEE} />;
  if (id === "R3") {
    return (
      <div className={poFitText}>
        <p>{PURCHASE_ORDER_R3_HEADING}</p>
        {supplierName ? <p className="font-bold">{supplierName}</p> : null}
        {supplierLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    );
  }
  if (id === "R11") return <PrintLabelValue heading={PURCHASE_ORDER_VOUCHER_HEADING} value={voucherCode} />;
  if (id === "R12") return <PrintLabelValue heading={PURCHASE_ORDER_DATED_HEADING} value={datedLabel} />;
  if (id === "R22") {
    return <PrintLabelValue heading={PURCHASE_ORDER_PAYMENT_HEADING} value={PURCHASE_ORDER_PAYMENT_VALUE} />;
  }
  if (id === "R31") return <PrintLabelValue heading={PURCHASE_ORDER_REFERENCE_HEADING} value={voucherCode} />;
  if (id === "R21B") {
    return (
      <div className={cn(poCompactText, "min-h-0")}>
        <p className="shrink-0">{PURCHASE_ORDER_DELIVERY_HEADING}</p>
        {snapshot.termsOfDelivery ? <p>{snapshot.termsOfDelivery}</p> : null}
      </div>
    );
  }
  if (PURCHASE_ORDER_GROW_FIELD_HEADINGS[id]) {
    const note = snapshot.typedNotes?.[id] || "";
    return (
      <div className={poFitText}>
        <p>{PURCHASE_ORDER_GROW_FIELD_HEADINGS[id]}</p>
        {note ? <p className="font-bold">{note}</p> : null}
      </div>
    );
  }
  if (PURCHASE_ORDER_C_HEADINGS[id] && !String(id).includes(":")) {
    if (id === "C22") {
      return (
        <div className="flex size-full items-center justify-center px-1 py-0.5 text-center text-[11px] font-bold leading-tight text-foreground">
          {PURCHASE_ORDER_C_HEADINGS.C22}
        </div>
      );
    }
    if (PURCHASE_ORDER_C_HEADER_IDS.includes(id)) {
      return (
        <div className="flex size-full items-center justify-center px-1 py-0.5 text-center text-[11px] font-bold leading-tight text-foreground">
          {PURCHASE_ORDER_C_HEADINGS[id]}
        </div>
      );
    }
  }
  if (id === "C11" || String(id).startsWith("C11:")) {
    return (
      <div className="flex size-full items-start justify-center px-1 py-0.5 text-center text-[11px] leading-tight text-foreground">
        {purchaseOrderSlNoText(lineIndex ?? 0)}
      </div>
    );
  }
  if (id === "C21" || String(id).startsWith("C21:")) {
    return (
      <p className="size-full min-h-0 p-1.5 text-[11px] font-normal leading-tight">{snapshot.lineDescriptions?.[lineKey] || ""}</p>
    );
  }
  if (id === "C31" || String(id).startsWith("C31:")) {
    const label = dueOnLabel(snapshot.lineDueDates?.[lineKey]);
    return (
      <div className="flex size-full items-start justify-center p-1">
        {label ? <p className="whitespace-nowrap text-center text-[11px] leading-tight">{label}</p> : null}
      </div>
    );
  }
  if (id === "C41" || String(id).startsWith("C41:")) {
    const qty = snapshot.lineQtys?.[lineKey] || "";
    const unit = snapshot.lineUnits?.[lineKey] || "";
    return (
      <div className="flex size-full items-start gap-1 p-1">
        <p className={cn(poQtyType, "min-w-0 flex-1")}>{qty}</p>
        {unit ? <p className={cn(poQtyType, "shrink-0")}>{unit}</p> : null}
      </div>
    );
  }
  if (id === "C51" || String(id).startsWith("C51:")) {
    return (
      <div className="flex size-full items-start p-1">
        <p className={poQtyType}>{snapshot.lineRates?.[lineKey] || ""}</p>
      </div>
    );
  }
  if (id === "C61" || String(id).startsWith("C61:")) {
    const unit = snapshot.lineUnits?.[lineKey] || "";
    return (
      <div className="flex size-full items-start p-1">
        {unit ? <p className={cn(poQtyType, "text-foreground")}>{unit}</p> : null}
      </div>
    );
  }
  if (id === "C81" || String(id).startsWith("C81:")) {
    const amount = formatPurchaseOrderLineAmount(snapshot.lineQtys?.[lineKey], snapshot.lineRates?.[lineKey]);
    return (
      <div className="flex size-full items-start p-1">
        {amount ? <p className={cn(poQtyType, "text-foreground")}>{amount}</p> : null}
      </div>
    );
  }
  if (id === "C42") {
    const label = formatPurchaseOrderC42Display(c42QtyTotal);
    return (
      <div className="flex size-full items-start p-1">
        {label ? <p className={cn(poTotalType, "text-foreground")}>{label}</p> : null}
      </div>
    );
  }
  if (id === "C82") {
    const label = formatPurchaseOrderC82Display(c82Amount);
    return (
      <div className="flex size-full items-start p-1">
        {label ? <p className={cn(poTotalType, "text-foreground")}>{label}</p> : null}
      </div>
    );
  }
  if (id === "C13") {
    const words = purchaseOrderAmountInWords(c82Amount);
    return (
      <div className={cn(poFitText, "h-full min-h-0")}>
        <p>{PURCHASE_ORDER_AMOUNT_WORDS_HEADING}</p>
        {words ? <p className="font-bold">{words}</p> : null}
      </div>
    );
  }
  return null;
}

/** Read-only A4 print: PURCHASE ORDER heading plus the saved R/C table. */
export default function PurchaseOrderPrintSheet({ snapshot = {}, voucherCode = "", datedLabel = "", supplierName = "" }) {
  const lineKeys = useMemo(
    () => (snapshot.lineKeys?.length ? snapshot.lineKeys : [PURCHASE_ORDER_C_BASE_LINE_KEY]),
    [snapshot.lineKeys]
  );
  const c42QtyTotal = useMemo(
    () => sumPurchaseOrderQuantities(lineKeys, snapshot.lineQtys),
    [lineKeys, snapshot.lineQtys]
  );
  const c82Amount = useMemo(
    () => sumPurchaseOrderLineAmounts(lineKeys, snapshot.lineQtys, snapshot.lineRates),
    [lineKeys, snapshot.lineQtys, snapshot.lineRates]
  );
  const [supplierLines, setSupplierLines] = useState([]);
  const r2Ref = useRef(null);
  const r22Ref = useRef(null);
  const [r2Height, setR2Height] = useState(0);
  const [r22Height, setR22Height] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadSupplier() {
      if (!snapshot.supplierId) {
        setSupplierLines([]);
        return;
      }
      try {
        const rows = await fetchInventorySuppliers();
        const selected = rows.find((row) => row.id === snapshot.supplierId) ?? null;
        if (!cancelled) setSupplierLines(purchaseOrderSupplierDetailLines(selected));
      } catch {
        if (!cancelled) setSupplierLines([]);
      }
    }
    void loadSupplier();
    return () => {
      cancelled = true;
    };
  }, [snapshot.supplierId]);

  useLayoutEffect(() => {
    const el = r2Ref.current;
    if (!el) return undefined;
    function measure() {
      const next = el.getBoundingClientRect().height;
      setR2Height((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [supplierName]);

  useLayoutEffect(() => {
    const el = r22Ref.current;
    if (!el) return undefined;
    function measure() {
      const next = el.getBoundingClientRect().height;
      setR22Height((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fields = {
    snapshot,
    supplierName,
    supplierLines,
    voucherCode,
    datedLabel,
    c42QtyTotal,
    c82Amount
  };

  return (
    <Card data-po-print-root="" className="h-[297mm] w-[210mm] max-w-full overflow-hidden shadow-sm">
      <CardContent className="flex h-full min-h-0 flex-col gap-1.5 p-2">
        <h1 className="shrink-0 text-center text-sm font-bold tracking-wide text-foreground">
          {PURCHASE_ORDER_SHEET_TITLE}
        </h1>
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="grid w-full grid-cols-[minmax(0,3.2fr)_minmax(0,1.3fr)] items-stretch gap-0">
            <div className="flex flex-col justify-start gap-0">
              <PrintCell>
                <PrintCellBody id="R1" {...fields} />
              </PrintCell>
              <div ref={r2Ref} className="w-full">
                <PrintCell>
                  <PrintCellBody id="R2" {...fields} />
                </PrintCell>
              </div>
              <PrintCell>
                <PrintCellBody id="R3" {...fields} />
              </PrintCell>
            </div>
            <div className="flex min-h-0 flex-col gap-0">
              <div className="grid shrink-0 grid-cols-2 auto-rows-[minmax(1.1rem,auto)] gap-0">
                {PURCHASE_ORDER_VOUCHER_CELL_IDS.map((id) =>
                  id === "R22" ? (
                    <div key={id} ref={r22Ref} className="min-h-0">
                      <PrintCell>
                        <PrintCellBody id={id} {...fields} />
                      </PrintCell>
                    </div>
                  ) : (
                    <PrintCell key={id}>
                      <PrintCellBody id={id} {...fields} />
                    </PrintCell>
                  )
                )}
              </div>
              <div className="min-h-0 flex-1">
                <PrintCell grow>
                  <PrintCellBody id="R21B" {...fields} />
                </PrintCell>
              </div>
            </div>
          </div>
          <div data-po-c-table="" className="flex min-h-0 w-full flex-1 flex-col gap-0">
            <div className={cn("grid shrink-0", poCCols)}>
              {PURCHASE_ORDER_C_HEADER_IDS.map((id) => (
                <PrintCell key={id} grow>
                  <PrintCellBody id={id} {...fields} />
                </PrintCell>
              ))}
            </div>
            <div
              data-po-c-lines=""
              className="grid min-h-0 flex-1"
              style={{ gridTemplateRows: `repeat(${lineKeys.length}, minmax(1.25rem, 1fr))` }}
            >
              {lineKeys.map((lineKey, lineIndex) => (
                <div key={lineKey} className={cn("grid h-full min-h-0", poCCols)}>
                  {PURCHASE_ORDER_C_LINE_IDS.map((colId) => {
                    const id = purchaseOrderLineCellId(lineKey, colId);
                    return (
                      <PrintCell key={id} grow>
                        <PrintCellBody id={id} lineKey={lineKey} lineIndex={lineIndex} {...fields} />
                      </PrintCell>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className={cn("grid shrink-0", poCCols)}>
              {PURCHASE_ORDER_C_TOTAL_IDS.map((id) => (
                <PrintCell key={id} grow>
                  <PrintCellBody id={id} {...fields} />
                </PrintCell>
              ))}
            </div>
            <div
              data-po-c13=""
              className="relative grid shrink-0 grid-cols-1"
              style={r2Height > 0 ? { height: r2Height } : undefined}
            >
              <PrintCell grow>
                <PrintCellBody id="C13" {...fields} />
              </PrintCell>
              <div className="pointer-events-none absolute inset-x-0 bottom-0">
                <PurchaseOrderC23Signature height={r22Height} />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
