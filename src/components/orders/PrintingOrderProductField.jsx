import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  PRINTING_PRODUCT_CUSTOM_KEY,
  colorsFromInventoryProduct,
  groupInventoryProducts
} from "@/inventory/inventoryProductPickerUtils";

function productLabel(product) {
  const code = String(product.id ?? "").trim();
  const name = String(product.name ?? "").trim();
  const color = String(product.color ?? "").trim();
  const parts = [code && code !== name ? code : "", name, color ? color : ""].filter(Boolean);
  return parts.join(" · ");
}

export default function PrintingOrderProductField({
  id = "create-product-name",
  label = "Product name",
  products = [],
  loading = false,
  productName = "",
  onProductNameChange,
  onColorsChange,
  required = false,
  disabled = false
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectKey, setSelectKey] = useState(PRINTING_PRODUCT_CUSTOM_KEY);

  const grouped = useMemo(() => groupInventoryProducts(products), [products]);

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

  const filteredCount = filteredGroups.reduce((sum, g) => sum + g.products.length, 0);

  useEffect(() => {
    const trimmed = String(productName ?? "").trim();
    if (!trimmed) {
      setSelectKey(PRINTING_PRODUCT_CUSTOM_KEY);
      return;
    }
    const match = products.find(
      (p) => String(p.name ?? "").trim().toLowerCase() === trimmed.toLowerCase()
    );
    setSelectKey(match?._uuid ?? PRINTING_PRODUCT_CUSTOM_KEY);
  }, [productName, products]);

  const isCustom = selectKey === PRINTING_PRODUCT_CUSTOM_KEY;
  const selectedProduct = products.find((p) => p._uuid === selectKey);

  function pickProduct(product) {
    setSelectKey(product._uuid);
    onProductNameChange?.(String(product.name ?? "").trim());
    onColorsChange?.(colorsFromInventoryProduct(product));
    setOpen(false);
    setSearch("");
  }

  function pickCustom() {
    setSelectKey(PRINTING_PRODUCT_CUSTOM_KEY);
    setOpen(false);
    setSearch("");
  }

  if (loading) {
    return (
      <div className="grid gap-2">
        {label ? <Label htmlFor={id}>{label}</Label> : null}
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {label ? <Label htmlFor={isCustom ? id : `${id}-trigger`}>{label}</Label> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={`${id}-trigger`}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn("h-9 w-full justify-between font-normal", !selectedProduct && isCustom && !productName && "text-muted-foreground")}
          >
            <span className="truncate">
              {isCustom
                ? productName?.trim() || "Custom product"
                : selectedProduct
                  ? productLabel(selectedProduct)
                  : "Select product from inventory"}
            </span>
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
              {filteredCount} of {products.length} SKUs
            </p>
          </div>
          <div
            className="max-h-72 overflow-y-auto overscroll-contain p-1 [-webkit-overflow-scrolling:touch]"
            onWheel={(e) => e.stopPropagation()}
          >
            {filteredGroups.map((group) => (
              <div key={group.kind} className="py-1">
                <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</p>
                {group.products.map((product) => {
                  const selected = selectKey === product._uuid;
                  return (
                    <button
                      key={product._uuid}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                        selected && "bg-accent text-accent-foreground"
                      )}
                      onClick={() => pickProduct(product)}
                    >
                      <Check className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1 truncate">{productLabel(product)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {filteredCount === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No SKUs match your search.</p>
            ) : null}
            <div className="border-t py-1">
              <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Other</p>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  isCustom && "bg-accent text-accent-foreground"
                )}
                onClick={pickCustom}
              >
                <Check className={cn("size-4 shrink-0", isCustom ? "opacity-100" : "opacity-0")} />
                Custom
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {isCustom ? (
        <Input
          id={id}
          name="product_name"
          placeholder="Enter custom product name"
          value={productName}
          onChange={(e) => onProductNameChange?.(e.target.value)}
          required={required}
          disabled={disabled}
        />
      ) : null}
      {!isCustom && selectedProduct ? (
        <p className="text-xs text-muted-foreground">
          Selected: <span className="font-medium text-foreground">{productLabel(selectedProduct)}</span>
        </p>
      ) : null}
    </div>
  );
}
