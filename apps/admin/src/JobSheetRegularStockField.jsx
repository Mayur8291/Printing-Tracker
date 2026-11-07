import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  groupInventoryProducts,
  inventoryProductDisplayLabel
} from "@/inventory/inventoryProductPickerUtils";

export function newJobSheetRegularStockRow(product) {
  return {
    id: `rs-${product._uuid}-${Date.now()}`,
    sku_uuid: String(product._uuid ?? ""),
    sku_code: String(product.id ?? "").trim(),
    name: String(product.name ?? "").trim(),
    color: String(product.color ?? "").trim(),
    qty: ""
  };
}

export default function JobSheetRegularStockField({
  items = [],
  onChange,
  products = [],
  loading = false
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => groupInventoryProducts(products), [products]);
  const selectedUuids = useMemo(
    () => new Set((items ?? []).map((row) => String(row.sku_uuid ?? ""))),
    [items]
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map((group) => ({
        ...group,
        products: group.products.filter((product) => {
          const haystack = [product.id, product.name, product.color, product.kind]
            .map((v) => String(v ?? "").toLowerCase())
            .join(" ");
          return haystack.includes(q);
        })
      }))
      .filter((group) => group.products.length > 0);
  }, [grouped, search]);

  const availableCount = filteredGroups.reduce(
    (sum, group) => sum + group.products.filter((p) => !selectedUuids.has(String(p._uuid))).length,
    0
  );

  function addProduct(product) {
    const uuid = String(product._uuid ?? "");
    if (!uuid || selectedUuids.has(uuid)) return;
    onChange?.([...(items ?? []), newJobSheetRegularStockRow(product)]);
    setOpen(false);
    setSearch("");
  }

  function updateQty(rowId, qty) {
    onChange?.(
      (items ?? []).map((row) => (row.id === rowId ? { ...row, qty: qty.replace(/\D/g, "") } : row))
    );
  }

  function removeRow(rowId) {
    onChange?.((items ?? []).filter((row) => row.id !== rowId));
  }

  if (loading) {
    return (
      <div className="grid gap-2">
        <Label>Inventory product</Label>
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className="job-sheet-regular-stock space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="job-sheet-regular-stock-picker">Add product from inventory</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="job-sheet-regular-stock-picker"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-9 w-full justify-between font-normal text-muted-foreground"
            >
              <span className="truncate">Select product to add</span>
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(24rem,calc(100vw-2rem))] p-0"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="border-b p-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU, name, or color…"
                className="h-8"
                autoFocus
              />
              <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">
                {availableCount} available · {products.length} total SKUs
              </p>
            </div>
            <div
              className="max-h-72 overflow-y-auto overscroll-contain p-1 [-webkit-overflow-scrolling:touch]"
              onWheel={(e) => e.stopPropagation()}
            >
              {filteredGroups.map((group) => {
                const groupProducts = group.products.filter(
                  (product) => !selectedUuids.has(String(product._uuid))
                );
                if (!groupProducts.length) return null;
                return (
                  <div key={group.kind} className="py-1">
                    <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</p>
                    {groupProducts.map((product) => (
                      <button
                        key={product._uuid}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                        onClick={() => addProduct(product)}
                      >
                        <Check className="size-4 shrink-0 opacity-0" />
                        <span className="min-w-0 flex-1 truncate">{inventoryProductDisplayLabel(product)}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
              {availableCount === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {products.length ? "All matching products are already added." : "No inventory products found."}
                </p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {items.length > 0 ? (
        <ul className="job-sheet-regular-stock-list space-y-2" aria-label="Regular stock products">
          {items.map((row) => (
            <li
              key={row.id}
              className="job-sheet-regular-stock-row flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-sm font-medium">
                {inventoryProductDisplayLabel({
                  id: row.sku_code,
                  name: row.name,
                  color: row.color
                })}
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor={`job-sheet-rs-qty-${row.id}`} className="sr-only">
                  Quantity for {row.name}
                </Label>
                <Input
                  id={`job-sheet-rs-qty-${row.id}`}
                  className="h-8 w-24"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Qty"
                  aria-label={`Quantity for ${row.name}`}
                  value={row.qty}
                  onChange={(e) => updateQty(row.id, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={`Remove ${row.name}`}
                  onClick={() => removeRow(row.id)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No products added yet. Select from inventory above.</p>
      )}
    </div>
  );
}
