import { useState } from "react";
import { Menu, LogOut, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EfficiencyGauge } from "../features/factory/FactoryTabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

/** Flutter SVGs tinted with currentColor via CSS mask (assets copied to /public/squad-icons). */
export function TabIcon({ name, className = "" }) {
  const url = `url(/squad-icons/${name}.svg)`;
  return <span aria-hidden="true" className={`inline-block size-5 bg-current ${className}`} style={{ WebkitMask: `${url} center/contain no-repeat`, mask: `${url} center/contain no-repeat` }} />;
}

/** Bottom tab bar: same labels/order as the Flutter dashboard, phones and tablets only. */
export function BottomBar({ tabs, activeKey, onNavigate }) {
  if (!tabs.length) return null;
  return <nav aria-label="Primary" className="squad-bottom-bar md:hidden">
    {tabs.map((tab) => {
      const active = tab.key === activeKey;
      return <a key={tab.key} href={tab.href} aria-current={active ? "page" : undefined} className={`squad-bottom-tab ${active ? "is-active" : ""}`}
        onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); onNavigate(tab.href); }}>
        <TabIcon name={tab.icon} /><span>{tab.label}</span>
      </a>;
    })}
  </nav>;
}

/** Right-hand menu (Flutter endDrawer): persona drawer items, then web-only modules, then sign out. */
export function RightMenu({ identity, items, onNavigate, onSignOut }) {
  const [open, setOpen] = useState(false);
  const groups = [...new Set(items.map((item) => item.group))];
  const name = identity?.name || identity?.display_name || identity?.email || "Your account";
  return <>
    <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="size-5" /></Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-[300px] flex-col gap-0 p-0">
        <SheetHeader className="border-b p-4 text-left"><SheetTitle className="truncate">{name}</SheetTitle><SheetDescription>{identity?.role_name}</SheetDescription></SheetHeader>
        <EfficiencyGauge identity={identity} />
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {groups.map((group) => <div key={group} className="py-1">
            <p className="squad-eyebrow px-4 py-1">{group}</p>
            {items.filter((item) => item.group === group).map((item) => <button type="button" key={item.label} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-muted/60" onClick={() => { setOpen(false); onNavigate(item.href); }}>{item.label}<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></button>)}
          </div>)}
        </div>
        <button type="button" className="flex items-center gap-2 border-t px-4 py-4 text-sm font-medium text-destructive" onClick={onSignOut}><LogOut className="size-4" aria-hidden="true" />Logout</button>
      </SheetContent>
    </Sheet>
  </>;
}
