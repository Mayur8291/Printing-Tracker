import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { normalizeGoalOwnership } from "../../goalTrackerUtils";

const NEW_OWNERSHIP_VALUE = "__new_ownership__";

/**
 * Pick an existing ownership label or type a new one — uses Radix Select (not native datalist).
 */
export default function GoalOwnershipField({
  id,
  value,
  onChange,
  suggestions = [],
  placeholder = "e.g. Sales, Production, Personal development"
}) {
  const options = useMemo(
    () => [...new Set((suggestions ?? []).map((s) => String(s).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [suggestions]
  );

  const current = normalizeGoalOwnership(value) ?? "";
  const [customMode, setCustomMode] = useState(() => options.length === 0 || (current && !options.includes(current)));

  useEffect(() => {
    if (!current) {
      if (options.length === 0) setCustomMode(true);
      return;
    }
    setCustomMode(!options.includes(current));
  }, [current, options]);

  const selectValue =
    current && options.includes(current) ? current : customMode ? NEW_OWNERSHIP_VALUE : undefined;

  if (options.length === 0) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="space-y-2">
      {!customMode ? (
        <Select
          value={selectValue}
          onValueChange={(next) => {
            if (next === NEW_OWNERSHIP_VALUE) {
              setCustomMode(true);
              onChange("");
              return;
            }
            setCustomMode(false);
            onChange(next);
          }}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select ownership" />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[200] max-h-[min(16rem,var(--radix-select-content-available-height))]">
            {options.map((label) => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
            <SelectItem value={NEW_OWNERSHIP_VALUE}>+ New ownership…</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <>
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus
          />
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 text-xs"
            onClick={() => {
              setCustomMode(false);
              onChange("");
            }}
          >
            Pick from existing ownerships
          </Button>
        </>
      )}
    </div>
  );
}
