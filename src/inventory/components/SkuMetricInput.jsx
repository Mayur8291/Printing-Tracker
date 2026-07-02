import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useInventory } from "../InventoryDataContext";

export default function SkuMetricInput({ sku, field, value, className, step = "1" }) {
  const { saveSkuFields } = useInventory();
  const [draft, setDraft] = useState(String(value ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(String(value ?? 0));
  }, [value]);

  const commit = async () => {
    if (!sku?._uuid) return;
    const next = Number(draft) || 0;
    const prev = Number(value) || 0;
    if (next === prev) return;
    setSaving(true);
    try {
      await saveSkuFields(sku._uuid, { [field]: next });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Input
      type="number"
      min={0}
      step={step}
      className={cn("h-11 w-20 text-right tabular-nums", className)}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onClick={(e) => e.stopPropagation()}
      disabled={saving || !sku?._uuid}
      aria-label={field}
    />
  );
}
