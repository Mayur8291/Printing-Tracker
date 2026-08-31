import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import OrderStatusBadge from "./OrderStatusBadge";
import { isJobSheetOrder } from "../../jobSheetUtils";
import { isSampleJobSheetOrder } from "../../sampleJobSheetUtils";
import {
  jobSheetProductionStageLabel,
  jobSheetProductionStatusOptions
} from "../../jobSheetProductionStages";
import {
  sampleJobSheetStageLabel,
  sampleJobSheetStatusOptions,
  sampleJobSheetIsClosed,
  sampleJobSheetDisplayStatus
} from "../../sampleJobSheetStages";
import { FORM_STAGES, STAGE_LABEL } from "../../orderViewUtils";
import {
  isCompactPrintingOrder,
  stageLabelForOrder,
  STICKER_STAGE_LABEL,
  STICKER_STAGES
} from "../../stickerOrderUtils";

/**
 * Status column for order lists — badge when read-only, Select when user may edit.
 */
export default function OrderListStatusCell({
  order,
  canEdit = false,
  isAdmin = false,
  statusUpdates = {},
  renderStageIcon,
  onStatusChange
}) {
  const effectiveStatus = statusUpdates[order.id] ?? order.status;
  const sampleJobSheet = isSampleJobSheetOrder(order);
  const sampleClosed = sampleJobSheet && sampleJobSheetIsClosed(order);
  const displayStatus = sampleJobSheet
    ? sampleJobSheetDisplayStatus(order, effectiveStatus)
    : effectiveStatus;
  const statusLabel = sampleJobSheet
    ? sampleJobSheetStageLabel(displayStatus)
    : stageLabelForOrder(order, effectiveStatus);
  const jobSheet = isJobSheetOrder(order);
  const compactPrinting = isCompactPrintingOrder(order);

  const selectOptions = useMemo(() => {
    let stages;
    if (sampleJobSheet) {
      stages = sampleJobSheetStatusOptions(effectiveStatus);
    } else if (jobSheet) {
      stages = jobSheetProductionStatusOptions(effectiveStatus);
    } else if (compactPrinting && !isAdmin) {
      stages = STICKER_STAGES;
    } else {
      stages = FORM_STAGES;
    }
    const current = String(effectiveStatus ?? "").trim();
    const list = [...stages];
    if (current && !list.includes(current)) {
      list.unshift(current);
    }
    return list.map((stage) => ({
      value: stage,
      label: sampleJobSheet
        ? sampleJobSheetStageLabel(stage)
        : jobSheet
          ? jobSheetProductionStageLabel(stage)
          : compactPrinting
            ? (STICKER_STAGE_LABEL[stage] ?? STAGE_LABEL[stage] ?? stage)
            : (STAGE_LABEL[stage] ?? stage)
    }));
  }, [sampleJobSheet, jobSheet, compactPrinting, isAdmin, effectiveStatus]);

  const readOnly =
    !canEdit || order._isPending || !order.id || sampleClosed;

  if (readOnly) {
    return (
      <OrderStatusBadge
        status={displayStatus}
        label={statusLabel}
        icon={renderStageIcon?.(displayStatus, statusLabel)}
      />
    );
  }

  const selectValue = String(effectiveStatus ?? "").trim() || "__empty__";

  return (
    <Select
      value={selectValue}
      onValueChange={(next) => {
        const value = next === "__empty__" ? "" : next;
        if (value && value !== effectiveStatus) {
          void onStatusChange?.(order, value);
        }
      }}
    >
      <SelectTrigger className="h-8 min-w-[10rem] max-w-[14rem] text-xs">
        <SelectValue placeholder="Status">
          <span className="flex items-center gap-1.5 truncate">
            {renderStageIcon?.(displayStatus, statusLabel)}
            {statusLabel}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value="__empty__">—</SelectItem>
        {selectOptions.map((opt) => (
          <SelectItem key={opt.value} value={String(opt.value)}>
            <span className="flex items-center gap-1.5">
              {renderStageIcon?.(opt.value, opt.label)}
              {opt.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
