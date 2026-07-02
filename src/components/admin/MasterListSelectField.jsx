import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Select backed by a master list. When empty and `onAdd` is provided, shows inline add + auto-select.
 */
export default function MasterListSelectField({
  id,
  label,
  value,
  onValueChange,
  options = [],
  onAdd,
  placeholder = "Select…",
  emptyHint = "No entries yet. Add one to use it here.",
  addPlaceholder = "Name",
  addButtonLabel = "Add & use",
  required = false,
  disabled = false,
  allowEmptyOption = false,
  emptyOptionLabel = "—",
  triggerClassName,
  className
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const normalized = options
    .map((opt) => ({
      value: String(opt.value ?? opt.name ?? opt.id ?? ""),
      label: String(opt.label ?? opt.name ?? opt.value ?? "")
    }))
    .filter((opt) => opt.value);

  async function handleAdd() {
    const name = draft.trim();
    if (!name || !onAdd) return;
    setAdding(true);
    setAddError("");
    try {
      const result = await onAdd(name);
      if (result?.error) {
        setAddError(result.error);
        return;
      }
      onValueChange(result?.value ?? result?.name ?? name);
      setDraft("");
    } finally {
      setAdding(false);
    }
  }

  if (normalized.length === 0 && onAdd) {
    return (
      <div className={cn("grid gap-2", className)}>
        {label ? <Label htmlFor={id}>{label}</Label> : null}
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={addPlaceholder}
            disabled={disabled || adding}
            required={required}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
            className="min-w-[10rem] flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void handleAdd()}
            disabled={disabled || adding || !draft.trim()}
          >
            {adding ? "Adding…" : addButtonLabel}
          </Button>
        </div>
        {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
      </div>
    );
  }

  const selectValue = value ? String(value) : allowEmptyOption ? "__empty__" : undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Select
        value={selectValue}
        onValueChange={(next) => onValueChange(next === "__empty__" ? "" : next)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger id={id} className={cn("w-full", triggerClassName)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowEmptyOption ? <SelectItem value="__empty__">{emptyOptionLabel}</SelectItem> : null}
          {normalized.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
