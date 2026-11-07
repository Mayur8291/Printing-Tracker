// Left rail for the 22 Scott masters — the `InventorySubNav.jsx` template (w-56 aside,
// `border-r bg-muted/30`, ghost/secondary 9-high buttons) with two additions the longer list
// needs: the group headers collapse, and small screens get a grouped Select instead of a rail.
//
// Groups and their order come from `MASTER_NAV` / `MASTER_GROUP_ORDER`; nothing here knows
// which masters exist.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MASTER_NAV } from "@/scott/data/masterConfigs";

/** The group a master belongs to, or `""` when the key is unknown. */
export function groupOfMaster(key) {
  for (const group of MASTER_NAV) {
    if (group.items.some((item) => item.key === key)) return group.group;
  }
  return "";
}

/**
 * Grouped master picker for small screens — the rail's stand-in below `md`.
 *
 * @param {object} props
 * @param {string} props.activeKey
 * @param {(key: string) => void} props.onSelect
 * @param {string} [props.className]
 */
export function ScottMastersNavSelect({ activeKey, onSelect, className }) {
  return (
    <Select value={activeKey || ""} onValueChange={(next) => onSelect?.(next)}>
      <SelectTrigger className={cn("w-full sm:w-64", className)} aria-label="Choose a master">
        <SelectValue placeholder="Choose a master…" />
      </SelectTrigger>
      <SelectContent className="max-h-[60vh]">
        {MASTER_NAV.map((group) => (
          <SelectGroup key={group.group}>
            <SelectLabel>{group.group}</SelectLabel>
            {group.items.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The rail itself.
 *
 * @param {object} props
 * @param {string} props.activeKey currently selected master key.
 * @param {(key: string) => void} props.onSelect
 * @param {string} [props.className] e.g. `hidden md:flex` to hide it on phones.
 */
export function ScottMastersNav({ activeKey, onSelect, className }) {
  // Every group starts open; a group is force-opened whenever it owns the active master, so
  // a persisted selection is never hidden behind a collapsed header after a reload.
  const [collapsed, setCollapsed] = useState(() => ({}));

  const activeGroup = groupOfMaster(activeKey);
  useEffect(() => {
    if (!activeGroup) return;
    setCollapsed((prev) => (prev[activeGroup] ? { ...prev, [activeGroup]: false } : prev));
  }, [activeGroup]);

  function toggleGroup(group) {
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  return (
    // `cn` resolves the display class for us: a caller passing `hidden md:flex` wins over the
    // base `flex` on small screens and restores it from `md` up.
    <aside className={cn("flex h-full min-h-0 w-56 shrink-0 flex-col border-r bg-muted/30", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {MASTER_NAV.map((group, idx) => {
          const isOpen = collapsed[group.group] !== true;
          return (
            <div key={group.group} className={cn(idx > 0 && "mt-4")}>
              <Button
                type="button"
                variant="ghost"
                className="h-7 w-full justify-start gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                onClick={() => toggleGroup(group.group)}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate">{group.group}</span>
                <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                  {group.items.length}
                </Badge>
              </Button>

              {isOpen ? (
                <div className="mt-0.5 space-y-0.5">
                  {group.items.map((item) => {
                    const active = item.key === activeKey;
                    return (
                      <Button
                        key={item.key}
                        type="button"
                        variant={active ? "secondary" : "ghost"}
                        className={cn("h-9 w-full justify-start px-3 font-normal", active && "font-medium")}
                        onClick={() => onSelect?.(item.key)}
                        aria-current={active ? "page" : undefined}
                        title={item.resource}
                      >
                        <span className="truncate">{item.label}</span>
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default ScottMastersNav;
