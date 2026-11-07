import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarIcon, Minus, Plus } from "lucide-react";
import { parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fetchInventorySuppliers } from "./inventory/inventoryDbUtils";
import PurchaseOrderC23Signature from "./PurchaseOrderC23Signature";
import { subscribePostgresChanges } from "./realtimeUtils";
import {
  PURCHASE_ORDER_C_HEADER_IDS,
  PURCHASE_ORDER_C_LINE_IDS,
  PURCHASE_ORDER_C_TOTAL_IDS,
  PURCHASE_ORDER_C_BASE_LINE_KEY,
  PURCHASE_ORDER_C_MAX_EXTRA_LINES,
  PURCHASE_ORDER_VOUCHER_CELL_IDS,
  purchaseOrderLineCellId,
  purchaseOrderSlNoText,
  isPurchaseOrderDescCell,
  isPurchaseOrderDueCell,
  isPurchaseOrderQtyCell,
  isPurchaseOrderRateCell,
  isPurchaseOrderPerCell,
  isPurchaseOrderAmountCell,
  formatPurchaseOrderLineAmount,
  sumPurchaseOrderLineAmounts,
  sumPurchaseOrderQuantities,
  formatPurchaseOrderC42Display,
  formatPurchaseOrderC82Display,
  PURCHASE_ORDER_QTY_UNITS,
  sanitizePurchaseOrderQty,
  sanitizePurchaseOrderRate,
  formatPurchaseOrderRate,
  PURCHASE_ORDER_R1_INVOICE,
  PURCHASE_ORDER_R2_CONSIGNEE,
  PURCHASE_ORDER_R3_HEADING,
  PURCHASE_ORDER_PAYMENT_HEADING,
  PURCHASE_ORDER_PAYMENT_VALUE,
  PURCHASE_ORDER_DELIVERY_HEADING,
  PURCHASE_ORDER_C_HEADINGS,
  PURCHASE_ORDER_AMOUNT_WORDS_HEADING,
  PURCHASE_ORDER_SHEET_TITLE,
  PURCHASE_ORDER_GROW_FIELD_HEADINGS,
  PURCHASE_ORDER_EMPTY_GROW_NOTES,
  purchaseOrderSupplierDetailLines,
  purchaseOrderCellPlacement
} from "./purchaseOrderLayout";
import {
  collectPurchaseOrderGenerateErrors,
  isPurchaseOrderGenerateCellMissing,
  isPurchaseOrderGenerateQtyMissing,
  isPurchaseOrderGenerateUnitMissing
} from "./purchaseOrderHistoryUtils";
import { purchaseOrderAmountInWords } from "./purchaseOrderAmountWords";
import {
  PURCHASE_ORDER_DATED_HEADING,
  PURCHASE_ORDER_REFERENCE_HEADING,
  PURCHASE_ORDER_VOUCHER_HEADING,
  allocatePurchaseOrderVoucher,
  formatPurchaseOrderDated,
  formatPurchaseOrderDueOn,
  isPurchaseOrderDueOnAllowed,
  purchaseOrderIstYmd,
  loadPurchaseOrderByVoucher,
  purchaseOrderFinancialYearCode,
  readSessionPurchaseOrder,
  writeSessionPurchaseOrder
} from "./purchaseOrderVoucherUtils";

const poCompactText =
  "flex h-full min-h-0 flex-col gap-0.5 overflow-auto p-1.5 text-[11px] font-normal leading-tight text-foreground";

const poFitText =
  "flex h-auto flex-col justify-start gap-0.5 overflow-visible p-1.5 text-[11px] font-normal leading-tight text-foreground";

const poCCols =
  "grid-cols-[minmax(1.1rem,0.5fr)_minmax(0,3fr)_minmax(5.5rem,1.15fr)_minmax(6.75rem,1.4fr)_minmax(0,0.6fr)_minmax(0,0.55fr)_minmax(0,0.5fr)_minmax(4.75rem,0.85fr)]";

const poQtyType = "text-[11px] font-normal leading-none md:text-[11px]";
const poTotalType = "whitespace-nowrap text-[11px] font-bold leading-none md:text-[11px]";

const poOpenNum =
  "h-5 w-full min-w-0 rounded-none border-0 bg-transparent px-0 py-0 font-normal text-foreground shadow-none outline-none ring-0 ring-offset-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0";

const poMissingCell = "border-destructive bg-destructive/15";
const poMissingControl = "border-destructive bg-destructive/15 text-destructive";

let poExtraLineSeq = 0;

function nextPoExtraLineKey() {
  poExtraLineSeq += 1;
  return `L${poExtraLineSeq}`;
}

function lineInsertAfterFromY(y, height, rowCount) {
  if (rowCount <= 0 || height <= 0) return 0;
  const row = Math.floor((y / height) * rowCount);
  return Math.min(rowCount - 1, Math.max(0, row));
}

function extraLineKeyNearY(y, height, lineKeys) {
  const rowCount = lineKeys.length;
  if (rowCount < 2 || height <= 0) return null;
  const rowHeight = height / rowCount;
  const threshold = 12;
  for (let index = 1; index < rowCount; index += 1) {
    if (Math.abs(y - index * rowHeight) <= threshold) return lineKeys[index];
  }
  return null;
}

function PurchaseOrderLineHandle({ kind, onClick, top }) {
  const Icon = kind === "add" ? Plus : Minus;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={kind === "add" ? "Add line row" : "Remove line row"}
      data-po-line-handle={kind}
      style={{ top }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="absolute left-0 z-20 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background p-0 shadow-none"
    >
      <Icon />
    </Button>
  );
}

function PurchaseOrderLineRail({ lineKeys, canAdd, onAddAfter, onRemove }) {
  const railRef = useRef(null);
  const [hoverY, setHoverY] = useState(null);
  const [railHeight, setRailHeight] = useState(0);

  function readPoint(event) {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return null;
    const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    return { y, height: rect.height };
  }

  function handleMove(event) {
    const point = readPoint(event);
    if (!point) return;
    setHoverY(point.y);
    setRailHeight(point.height);
  }

  const deleteKey = hoverY == null ? null : extraLineKeyNearY(hoverY, railHeight, lineKeys);
  const insertAfter = hoverY == null ? 0 : lineInsertAfterFromY(hoverY, railHeight, lineKeys.length);
  const rowCount = lineKeys.length;
  const joinY = (index) => (railHeight > 0 && rowCount > 0 ? (index / rowCount) * railHeight : 0);

  return (
    <div
      ref={railRef}
      data-po-line-rail=""
      className="absolute inset-y-0 -left-1 z-20 w-5"
      onMouseEnter={handleMove}
      onMouseMove={handleMove}
      onMouseLeave={() => {
        setHoverY(null);
      }}
    >
      {lineKeys.map((lineKey, index) => {
        if (index === 0 || deleteKey !== lineKey) return null;
        return (
          <PurchaseOrderLineHandle
            key={`remove-${lineKey}`}
            kind="remove"
            top={joinY(index)}
            onClick={() => onRemove(lineKey)}
          />
        );
      })}
      {hoverY != null && canAdd && !deleteKey ? (
        <PurchaseOrderLineHandle kind="add" top={hoverY} onClick={() => onAddAfter(insertAfter)} />
      ) : null}
    </div>
  );
}

function isAddressSideCell(id) {
  return id === "R1" || id === "R2" || id === "R3";
}

function isGrowTypeCell(id) {
  return id === "R32" || id === "R41" || id === "R42" || isPurchaseOrderDescCell(id);
}

function isAmountWordsCell(id) {
  return id === "C13";
}

function resizeGrowField(el) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${Math.max(el.scrollHeight, 22)}px`;
}

function PurchaseOrderAddressBlock({ heading, company, lines }) {
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

function PurchaseOrderR3Supplier({ selectedId, onSupplierChange, invalid }) {
  const [suppliers, setSuppliers] = useState([]);

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
    <div className={poFitText}>
      <p>{PURCHASE_ORDER_R3_HEADING}</p>
      <Select
        value={selectedId || undefined}
        onValueChange={(id) => {
          const row = suppliers.find((item) => item.id === id);
          onSupplierChange?.({ id, name: row?.name || "" });
        }}
      >
        <SelectTrigger
          aria-invalid={invalid || undefined}
          className={cn("h-6 w-full bg-background text-[11px]", invalid && poMissingControl)}
        >
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
    <div className={poCompactText}>
      <p>{heading}</p>
      {value ? <p className="font-bold">{value}</p> : null}
    </div>
  );
}

function PurchaseOrderGrowField({ heading, value, onChange }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    resizeGrowField(ref.current);
  }, [value]);

  return (
    <div className={poFitText}>
      <p>{heading}</p>
      <Textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={heading}
        className="min-h-[1.35rem] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[11px] font-bold leading-tight shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

function PurchaseOrderAmountInWords({ c82Amount }) {
  const words = purchaseOrderAmountInWords(c82Amount);
  return (
    <div className={cn(poFitText, "h-full min-h-0")}>
      <p>{PURCHASE_ORDER_AMOUNT_WORDS_HEADING}</p>
      {words ? <p className="font-bold">{words}</p> : null}
    </div>
  );
}

function PurchaseOrderDueOn({ value, onChange, invalid }) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(`${value}T12:00:00`) : undefined;
  const label = selected ? formatPurchaseOrderDueOn(selected) : "";
  const thisYear = Number(purchaseOrderIstYmd(new Date()).slice(0, 4));

  return (
    <div className="flex size-full min-h-0 flex-col items-center justify-start p-1">
      {label ? (
        <p className="whitespace-nowrap text-center text-[11px] leading-tight text-foreground">
          {label}
        </p>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Due on"
            aria-invalid={invalid || undefined}
            className={cn("size-6 shrink-0", invalid && poMissingControl)}
          >
            <CalendarIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="z-[200] w-auto p-0" align="start" side="bottom" sideOffset={4}>
          <Calendar
            mode="single"
            selected={selected}
            disabled={(date) => !isPurchaseOrderDueOnAllowed(date)}
            onSelect={(date) => {
              if (!date || !isPurchaseOrderDueOnAllowed(date)) return;
              onChange(purchaseOrderIstYmd(date));
              setOpen(false);
            }}
            captionLayout="dropdown"
            fromYear={thisYear}
            toYear={thisYear + 5}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PurchaseOrderQuantity({ qty, unit, onQtyChange, onUnitChange, qtyInvalid, unitInvalid }) {
  return (
    <div className="flex size-full items-start gap-1 p-1">
      <div className="min-w-0 flex-1">
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={qty}
          aria-label="Quantity"
          aria-invalid={qtyInvalid || undefined}
          onChange={(event) => onQtyChange(sanitizePurchaseOrderQty(event.target.value))}
          className={cn(poQtyType, poOpenNum, qtyInvalid && "text-destructive")}
        />
      </div>
      <Select value={unit || undefined} onValueChange={onUnitChange}>
        <SelectTrigger
          data-po-qty-unit=""
          aria-invalid={unitInvalid || undefined}
          className={cn(
            poQtyType,
            "h-5 min-h-5 w-auto min-w-[2.8rem] shrink-0 rounded-sm bg-background px-1 py-0 font-normal shadow-none [&>span]:line-clamp-none [&>span]:overflow-visible [&>span]:font-normal [&_svg]:size-2.5",
            unitInvalid && poMissingControl
          )}
        >
          <span className={cn(poQtyType, "font-normal")}>{unit}</span>
        </SelectTrigger>
        <SelectContent className="z-[200] font-normal" data-po-qty-unit-menu="">
          <SelectGroup>
            {PURCHASE_ORDER_QTY_UNITS.map((item) => (
              <SelectItem key={item} value={item} className={cn(poQtyType, "font-normal")}>
                {item}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function PurchaseOrderRate({ value, onChange, invalid }) {
  return (
    <div className="flex size-full items-start p-1">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-label="Rate"
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(sanitizePurchaseOrderRate(event.target.value))}
        onBlur={() => onChange(formatPurchaseOrderRate(value))}
        className={cn(poQtyType, poOpenNum, invalid && "text-destructive")}
      />
    </div>
  );
}

function PurchaseOrderPer({ unit }) {
  return (
    <div className="flex size-full items-start justify-start p-1">
      {unit ? <p className={cn(poQtyType, "font-normal text-foreground")}>{unit}</p> : null}
    </div>
  );
}

function PurchaseOrderLineAmount({ qty, rate }) {
  const amount = formatPurchaseOrderLineAmount(qty, rate);
  return (
    <div className="flex size-full items-start justify-start p-1">
      {amount ? <p className={cn(poQtyType, "font-normal text-foreground")}>{amount}</p> : null}
    </div>
  );
}

function PurchaseOrderC42Total({ total }) {
  const label = formatPurchaseOrderC42Display(total);
  return (
    <div className="flex size-full items-start justify-start p-1">
      {label ? <p className={cn(poTotalType, "text-foreground")}>{label}</p> : null}
    </div>
  );
}

function PurchaseOrderC82Total({ total }) {
  const label = formatPurchaseOrderC82Display(total);
  return (
    <div className="flex size-full items-start justify-start p-1">
      {label ? <p className={cn(poTotalType, "text-foreground")}>{label}</p> : null}
    </div>
  );
}

function PurchaseOrderLineDesc({ value, onChange, invalid }) {
  return (
    <Textarea
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Description of Goods"
      aria-invalid={invalid || undefined}
      className={cn(
        "size-full min-h-0 flex-1 resize-none overflow-hidden rounded-none border-0 bg-transparent p-1.5 text-[11px] font-normal leading-tight shadow-none focus-visible:ring-0",
        invalid && "text-destructive"
      )}
    />
  );
}

function PurchaseOrderSlNo({ lineIndex }) {
  return (
    <div className="flex size-full items-start justify-center px-1 py-0.5 text-center text-[11px] leading-tight text-foreground">
      {purchaseOrderSlNoText(lineIndex)}
    </div>
  );
}

function PurchaseOrderCHeading({ label }) {
  return (
    <div className="flex size-full items-center justify-center px-1 py-0.5 text-center text-[11px] font-bold leading-tight text-foreground">
      {label}
    </div>
  );
}

function PurchaseOrderTermsOfDelivery({ value, onChange }) {
  return (
    <div className={cn(poCompactText, "min-h-0")}>
      <p className="shrink-0">{PURCHASE_ORDER_DELIVERY_HEADING}</p>
      <Textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={PURCHASE_ORDER_DELIVERY_HEADING}
        className="min-h-[4.5rem] w-full flex-1 resize-none bg-background text-[11px]"
      />
    </div>
  );
}

function PurchaseOrderCellContent({
  id,
  voucherCode,
  datedLabel,
  termsOfDelivery,
  onTermsOfDeliveryChange,
  typedNotes,
  onTypedNoteChange,
  supplierId,
  onSupplierChange,
  c42QtyTotal,
  c82Amount,
  lineIndex,
  lineKey,
  lineDescriptions,
  onLineDescChange,
  lineDueDates,
  onLineDueDateChange,
  lineQtys,
  onLineQtyChange,
  lineUnits,
  onLineUnitChange,
  lineRates,
  onLineRateChange,
  fieldErrors
}) {
  if (id === "R1") {
    return <PurchaseOrderAddressBlock {...PURCHASE_ORDER_R1_INVOICE} />;
  }
  if (id === "R2") {
    return <PurchaseOrderAddressBlock {...PURCHASE_ORDER_R2_CONSIGNEE} />;
  }
  if (id === "R3") {
    return (
      <PurchaseOrderR3Supplier
        selectedId={supplierId}
        onSupplierChange={onSupplierChange}
        invalid={isPurchaseOrderGenerateCellMissing(id, lineKey, fieldErrors)}
      />
    );
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
  if (PURCHASE_ORDER_GROW_FIELD_HEADINGS[id]) {
    return (
      <PurchaseOrderGrowField
        heading={PURCHASE_ORDER_GROW_FIELD_HEADINGS[id]}
        value={typedNotes?.[id] || ""}
        onChange={(next) => onTypedNoteChange(id, next)}
      />
    );
  }
  if (id === "C11" || String(id).startsWith("C11:")) {
    return <PurchaseOrderSlNo lineIndex={lineIndex ?? 0} />;
  }
  if (isPurchaseOrderDescCell(id)) {
    return (
      <PurchaseOrderLineDesc
        value={lineDescriptions?.[lineKey] || ""}
        onChange={(next) => onLineDescChange(lineKey, next)}
        invalid={isPurchaseOrderGenerateCellMissing(id, lineKey, fieldErrors)}
      />
    );
  }
  if (isPurchaseOrderDueCell(id)) {
    return (
      <PurchaseOrderDueOn
        value={lineDueDates?.[lineKey] || ""}
        onChange={(next) => onLineDueDateChange(lineKey, next)}
        invalid={isPurchaseOrderGenerateCellMissing(id, lineKey, fieldErrors)}
      />
    );
  }
  if (isPurchaseOrderQtyCell(id)) {
    return (
      <PurchaseOrderQuantity
        qty={lineQtys?.[lineKey] || ""}
        unit={lineUnits?.[lineKey] || ""}
        onQtyChange={(next) => onLineQtyChange(lineKey, next)}
        onUnitChange={(next) => onLineUnitChange(lineKey, next)}
        qtyInvalid={isPurchaseOrderGenerateQtyMissing(lineKey, fieldErrors)}
        unitInvalid={isPurchaseOrderGenerateUnitMissing(lineKey, fieldErrors)}
      />
    );
  }
  if (isPurchaseOrderRateCell(id)) {
    return (
      <PurchaseOrderRate
        value={lineRates?.[lineKey] || ""}
        onChange={(next) => onLineRateChange(lineKey, next)}
        invalid={isPurchaseOrderGenerateCellMissing(id, lineKey, fieldErrors)}
      />
    );
  }
  if (isPurchaseOrderPerCell(id)) {
    return <PurchaseOrderPer unit={lineUnits?.[lineKey] || ""} />;
  }
  if (isPurchaseOrderAmountCell(id)) {
    return (
      <PurchaseOrderLineAmount
        qty={lineQtys?.[lineKey] || ""}
        rate={lineRates?.[lineKey] || ""}
      />
    );
  }
  if (id === "C42") {
    return <PurchaseOrderC42Total total={c42QtyTotal} />;
  }
  if (id === "C82") {
    return <PurchaseOrderC82Total total={c82Amount} />;
  }
  if (id === "C13") {
    return <PurchaseOrderAmountInWords c82Amount={c82Amount} />;
  }
  if (PURCHASE_ORDER_C_HEADINGS[id]) {
    return <PurchaseOrderCHeading label={PURCHASE_ORDER_C_HEADINGS[id]} />;
  }
  return null;
}

function PurchaseOrderCell({
  id,
  place = true,
  voucherCode,
  datedLabel,
  termsOfDelivery,
  onTermsOfDeliveryChange,
  typedNotes,
  onTypedNoteChange,
  supplierId,
  onSupplierChange,
  c42QtyTotal,
  c82Amount,
  lineIndex,
  lineKey,
  lineDescriptions,
  onLineDescChange,
  lineDueDates,
  onLineDueDateChange,
  lineQtys,
  onLineQtyChange,
  lineUnits,
  onLineUnitChange,
  lineRates,
  onLineRateChange,
  fieldErrors
}) {
  const missing = isPurchaseOrderGenerateCellMissing(id, lineKey, fieldErrors);
  return (
    <div
      data-po-cell={id}
      className={cn(
        "flex w-full flex-col rounded-none border border-border/60 bg-muted/40",
        missing && poMissingCell,
        isAddressSideCell(id)
          ? id === "R3"
            ? "min-h-0 flex-1 overflow-visible"
            : "h-auto shrink-0 overflow-visible"
          : isGrowTypeCell(id) ||
              isAmountWordsCell(id) ||
              isPurchaseOrderDueCell(id) ||
              isPurchaseOrderQtyCell(id) ||
              isPurchaseOrderRateCell(id) ||
              isPurchaseOrderPerCell(id) ||
              isPurchaseOrderAmountCell(id) ||
              id === "C42" ||
              id === "C82"
            ? "h-full min-h-0 overflow-visible"
            : "size-full min-h-0 overflow-hidden",
        place && purchaseOrderCellPlacement(id)
      )}
    >
      <PurchaseOrderCellContent
        id={id}
        voucherCode={voucherCode}
        datedLabel={datedLabel}
        termsOfDelivery={termsOfDelivery}
        onTermsOfDeliveryChange={onTermsOfDeliveryChange}
        typedNotes={typedNotes}
        onTypedNoteChange={onTypedNoteChange}
        supplierId={supplierId}
        onSupplierChange={onSupplierChange}
        c42QtyTotal={c42QtyTotal}
        c82Amount={c82Amount}
        lineIndex={lineIndex}
        lineKey={lineKey}
        lineDescriptions={lineDescriptions}
        onLineDescChange={onLineDescChange}
        lineDueDates={lineDueDates}
        onLineDueDateChange={onLineDueDateChange}
        lineQtys={lineQtys}
        onLineQtyChange={onLineQtyChange}
        lineUnits={lineUnits}
        onLineUnitChange={onLineUnitChange}
        lineRates={lineRates}
        onLineRateChange={onLineRateChange}
        fieldErrors={fieldErrors}
      />
    </div>
  );
}

function applyPurchaseOrderRecord(record, setVoucherCode, setCreatedAt) {
  if (!record?.code) return;
  setVoucherCode(record.code);
  setCreatedAt(record.createdAt || new Date().toISOString());
}

const PurchaseOrderLayoutGrid = forwardRef(function PurchaseOrderLayoutGrid(_props, ref) {
  const [voucherCode, setVoucherCode] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ supplier: false, lines: {}, hasError: false });
  const [formKey, setFormKey] = useState(0);
  const [termsOfDelivery, setTermsOfDelivery] = useState("");
  const [typedNotes, setTypedNotes] = useState(PURCHASE_ORDER_EMPTY_GROW_NOTES);
  const [extraLineKeys, setExtraLineKeys] = useState([]);
  const [lineDescriptions, setLineDescriptions] = useState({
    [PURCHASE_ORDER_C_BASE_LINE_KEY]: ""
  });
  const [lineDueDates, setLineDueDates] = useState({
    [PURCHASE_ORDER_C_BASE_LINE_KEY]: ""
  });
  const [lineQtys, setLineQtys] = useState({
    [PURCHASE_ORDER_C_BASE_LINE_KEY]: ""
  });
  const [lineUnits, setLineUnits] = useState({
    [PURCHASE_ORDER_C_BASE_LINE_KEY]: ""
  });
  const [lineRates, setLineRates] = useState({
    [PURCHASE_ORDER_C_BASE_LINE_KEY]: ""
  });
  const r2Ref = useRef(null);
  const r22Ref = useRef(null);
  const [r2Height, setR2Height] = useState(0);
  const [r22Height, setR22Height] = useState(0);
  const [datedLabel, setDatedLabel] = useState(() => formatPurchaseOrderDated(new Date()));
  const lineKeys = useMemo(
    () => [PURCHASE_ORDER_C_BASE_LINE_KEY, ...extraLineKeys],
    [extraLineKeys]
  );
  const c42QtyTotal = useMemo(
    () => sumPurchaseOrderQuantities(lineKeys, lineQtys),
    [lineKeys, lineQtys]
  );
  const c82Amount = useMemo(
    () => sumPurchaseOrderLineAmounts(lineKeys, lineQtys, lineRates),
    [lineKeys, lineQtys, lineRates]
  );

  function addLineAfter(afterIndex) {
    if (extraLineKeys.length >= PURCHASE_ORDER_C_MAX_EXTRA_LINES) return;
    const key = nextPoExtraLineKey();
    setExtraLineKeys((prev) => {
      const next = [...prev];
      next.splice(afterIndex, 0, key);
      return next;
    });
  }

  function removeExtraLine(key) {
    setExtraLineKeys((prev) => prev.filter((item) => item !== key));
    setLineDescriptions((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLineDueDates((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLineQtys((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLineUnits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLineRates((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleLineDescChange(key, value) {
    setLineDescriptions((prev) => ({ ...prev, [key]: value }));
  }

  function handleLineDueDateChange(key, value) {
    setLineDueDates((prev) => ({ ...prev, [key]: value }));
  }

  function handleLineQtyChange(key, value) {
    setLineQtys((prev) => ({ ...prev, [key]: value }));
  }

  function handleLineUnitChange(key, value) {
    setLineUnits((prev) => ({ ...prev, [key]: value }));
  }

  function handleLineRateChange(key, value) {
    setLineRates((prev) => ({ ...prev, [key]: value }));
  }

  function handleTypedNoteChange(id, value) {
    setTypedNotes((prev) => ({ ...prev, [id]: value }));
  }

  function handleSupplierChange({ id, name }) {
    setSupplierId(id || "");
    setSupplierName(name || "");
  }

  const sheetFields = {
    voucherCode,
    datedLabel,
    termsOfDelivery,
    onTermsOfDeliveryChange: setTermsOfDelivery,
    typedNotes,
    onTypedNoteChange: handleTypedNoteChange,
    supplierId,
    onSupplierChange: handleSupplierChange,
    fieldErrors,
    c42QtyTotal,
    c82Amount,
    lineDescriptions,
    onLineDescChange: handleLineDescChange,
    lineDueDates,
    onLineDueDateChange: handleLineDueDateChange,
    lineQtys,
    onLineQtyChange: handleLineQtyChange,
    lineUnits,
    onLineUnitChange: handleLineUnitChange,
    lineRates,
    onLineRateChange: handleLineRateChange
  };

  useEffect(() => {
    function stampToday() {
      const next = formatPurchaseOrderDated(new Date());
      setDatedLabel((prev) => (prev === next ? prev : next));
    }
    stampToday();
    const timer = window.setInterval(stampToday, 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    async function loadCurrent() {
      const fy = purchaseOrderFinancialYearCode();
      const existing = readSessionPurchaseOrder();
      if (existing?.code && existing.code.includes(`/${fy}/`)) {
        const fromDb = await loadPurchaseOrderByVoucher(existing.code);
        const loaded = fromDb || existing;
        if (loaded.generatedAt) {
          const record = await allocatePurchaseOrderVoucher();
          if (!cancelled) applyPurchaseOrderRecord(record, setVoucherCode, setCreatedAt);
          return;
        }
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
      setSupplierId("");
      setSupplierName("");
      setTermsOfDelivery("");
      setTypedNotes(PURCHASE_ORDER_EMPTY_GROW_NOTES);
      setExtraLineKeys([]);
      setLineDescriptions({ [PURCHASE_ORDER_C_BASE_LINE_KEY]: "" });
      setLineDueDates({ [PURCHASE_ORDER_C_BASE_LINE_KEY]: "" });
      setLineQtys({ [PURCHASE_ORDER_C_BASE_LINE_KEY]: "" });
      setLineUnits({ [PURCHASE_ORDER_C_BASE_LINE_KEY]: "" });
      setLineRates({ [PURCHASE_ORDER_C_BASE_LINE_KEY]: "" });
      setShowMissing(false);
      setFieldErrors({ supplier: false, lines: {}, hasError: false });
      setFormKey((n) => n + 1);
    } catch (e) {
      console.warn("purchase order new voucher:", e.message || e);
    }
  }

  const snapshot = useMemo(
    () => ({
      voucherCode,
      datedLabel,
      createdAt,
      supplierId,
      supplierName,
      quantity: c42QtyTotal,
      termsOfDelivery,
      typedNotes,
      extraLineKeys,
      lineKeys,
      lineDescriptions,
      lineDueDates,
      lineQtys,
      lineUnits,
      lineRates
    }),
    [
      voucherCode,
      datedLabel,
      createdAt,
      supplierId,
      supplierName,
      c42QtyTotal,
      termsOfDelivery,
      typedNotes,
      extraLineKeys,
      lineKeys,
      lineDescriptions,
      lineDueDates,
      lineQtys,
      lineUnits,
      lineRates
    ]
  );

  useEffect(() => {
    if (!showMissing) return;
    setFieldErrors(collectPurchaseOrderGenerateErrors(snapshot));
  }, [showMissing, snapshot]);

  useImperativeHandle(
    ref,
    () => ({
      getSnapshot() {
        return snapshot;
      },
      validateMandatory() {
        const next = collectPurchaseOrderGenerateErrors(snapshot);
        setShowMissing(next.hasError);
        setFieldErrors(next);
        return !next.hasError;
      }
    }),
    [snapshot]
  );

  return (
    <Card data-po-print-root="" className="h-[297mm] w-[210mm] max-w-full overflow-hidden shadow-sm">
      <CardContent className="flex h-full min-h-0 flex-col gap-1.5 p-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="New purchase order"
          data-po-no-print=""
          className="size-7 self-start"
          onClick={() => {
            void handleNewPurchaseOrder();
          }}
        >
          <Plus />
        </Button>
        <h1 className="shrink-0 text-center text-sm font-bold tracking-wide text-foreground">
          {PURCHASE_ORDER_SHEET_TITLE}
        </h1>
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="grid w-full grid-cols-[minmax(0,3.2fr)_minmax(0,1.3fr)] items-stretch gap-0">
            <div className="flex flex-col justify-start gap-0">
              <PurchaseOrderCell id="R1" place={false} {...sheetFields} />
              <div ref={r2Ref} className="w-full">
                <PurchaseOrderCell id="R2" place={false} {...sheetFields} />
              </div>
              <PurchaseOrderCell key={`R3-${formKey}`} id="R3" place={false} {...sheetFields} />
            </div>
            <div className="flex min-h-0 flex-col gap-0">
              <div className="grid shrink-0 grid-cols-2 auto-rows-[minmax(1.1rem,auto)] gap-0">
                {PURCHASE_ORDER_VOUCHER_CELL_IDS.map((id) =>
                  id === "R22" ? (
                    <div key={id} ref={r22Ref} className="min-h-0">
                      <PurchaseOrderCell id={id} place={false} {...sheetFields} />
                    </div>
                  ) : (
                    <PurchaseOrderCell key={id} id={id} place={false} {...sheetFields} />
                  )
                )}
              </div>
              <div className="min-h-0 flex-1">
                <PurchaseOrderCell id="R21B" {...sheetFields} />
              </div>
            </div>
          </div>
          <div data-po-c-table="" className="flex min-h-0 w-full flex-1 flex-col gap-0">
            <div className={cn("grid shrink-0", poCCols)}>
              {PURCHASE_ORDER_C_HEADER_IDS.map((id) => (
                <PurchaseOrderCell key={id} id={id} place={false} {...sheetFields} />
              ))}
            </div>
            <div
              data-po-c-lines=""
              className="relative grid min-h-0 flex-1"
              style={{ gridTemplateRows: `repeat(${lineKeys.length}, minmax(1.25rem, 1fr))` }}
            >
              {lineKeys.map((lineKey, lineIndex) => (
                  <div
                    key={lineKey}
                    data-po-line-row={lineKey}
                    className="relative min-h-0"
                  >
                    <div className={cn("grid h-full min-h-0", poCCols)}>
                      {PURCHASE_ORDER_C_LINE_IDS.map((colId) => {
                        const id = purchaseOrderLineCellId(lineKey, colId);
                        return (
                          <PurchaseOrderCell
                            key={id}
                            id={id}
                            place={false}
                            lineIndex={lineIndex}
                            lineKey={lineKey}
                            {...sheetFields}
                          />
                        );
                      })}
                    </div>
                  </div>
              ))}
              <PurchaseOrderLineRail
                lineKeys={lineKeys}
                canAdd={extraLineKeys.length < PURCHASE_ORDER_C_MAX_EXTRA_LINES}
                onAddAfter={addLineAfter}
                onRemove={removeExtraLine}
              />
            </div>
            <div className={cn("grid shrink-0", poCCols)}>
              {PURCHASE_ORDER_C_TOTAL_IDS.map((id) => (
                <PurchaseOrderCell key={id} id={id} place={false} {...sheetFields} />
              ))}
            </div>
            <div
              data-po-c13=""
              className="relative grid shrink-0 grid-cols-1"
              style={r2Height > 0 ? { height: r2Height } : undefined}
            >
              <PurchaseOrderCell id="C13" place={false} {...sheetFields} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0">
                <PurchaseOrderC23Signature height={r22Height} />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export default PurchaseOrderLayoutGrid;
