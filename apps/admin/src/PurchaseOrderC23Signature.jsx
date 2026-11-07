import { cn } from "@/lib/utils";
import {
  PURCHASE_ORDER_C23_FOR_LABEL,
  PURCHASE_ORDER_C23_SIGN_LABEL
} from "./purchaseOrderLayout";

const poCCols =
  "grid-cols-[minmax(1.1rem,0.5fr)_minmax(0,3fr)_minmax(5.5rem,1.15fr)_minmax(6.75rem,1.4fr)_minmax(0,0.6fr)_minmax(0,0.55fr)_minmax(0,0.5fr)_minmax(4.75rem,0.85fr)]";

/** Print-only signature box. Hidden on screen. Width C42–C82, height R22. */
export default function PurchaseOrderC23Signature({ height }) {
  return (
    <div
      data-po-cell="C23"
      data-po-print-only=""
      className={cn("grid shrink-0", poCCols)}
      style={{ height: height > 0 ? height : "2.25rem" }}
    >
      <div className="col-start-4 col-end-9">
        <div className="flex h-full min-h-0 flex-col justify-between border border-border/60 bg-muted/40 px-1.5 py-0.5 text-right">
          <p className="text-[9px] font-normal leading-tight text-foreground">{PURCHASE_ORDER_C23_FOR_LABEL}</p>
          <p className="text-[8px] font-normal leading-tight text-foreground">{PURCHASE_ORDER_C23_SIGN_LABEL}</p>
        </div>
      </div>
    </div>
  );
}
