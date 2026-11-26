import { useState } from "react";
import { ClipboardList, Ellipsis, Home, Plus, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const PRIMARY = [
  { id: "home", label: "Home", icon: Home },
  { id: "printing", label: "Orders", icon: ClipboardList }
];

export default function MobileAppNav({
  dashboardTab,
  onSelectTab,
  onCreate,
  canCreate,
  canOpen,
  moreSections,
  soonTabIds
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  function openTab(id) {
    if (canOpen && !canOpen(id)) return;
    setMoreOpen(false);
    onSelectTab(id);
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] md:hidden"
        aria-label="Mobile"
      >
        <div className="grid grid-cols-5 items-end px-1 pt-1">
          {PRIMARY.map((item) => (
            <NavButton
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={dashboardTab === item.id}
              disabled={canOpen ? !canOpen(item.id) : false}
              onClick={() => openTab(item.id)}
            />
          ))}
          <div className="flex justify-center pb-1">
            <Button
              type="button"
              className="-mt-5 size-14 min-h-14 min-w-14 rounded-full bg-red-700 text-white shadow-md hover:bg-red-800"
              aria-label="Create order"
              disabled={!canCreate}
              onClick={onCreate}
            >
              <Plus className="!size-7" />
            </Button>
          </div>
          <NavButton
            label="Inventory"
            icon={Warehouse}
            active={dashboardTab === "inventory"}
            disabled={canOpen ? !canOpen("inventory") : false}
            onClick={() => openTab("inventory")}
          />
          <NavButton label="More" icon={Ellipsis} active={moreOpen} onClick={() => setMoreOpen(true)} />
        </div>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-24">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription>Open another part of Scott Dashboard.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {moreSections.map((section) => (
              <div key={section.label} className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{section.label}</p>
                <div className="grid gap-2">
                  {section.items.map((item) => {
                    const soon = soonTabIds?.has?.(item.id);
                    return (
                      <Button
                        key={item.id}
                        type="button"
                        variant={dashboardTab === item.id ? "default" : "outline"}
                        className={cn("h-11 justify-start", dashboardTab === item.id && "bg-red-700 text-white hover:bg-red-800")}
                        disabled={soon}
                        onClick={() => openTab(item.id)}
                      >
                        {item.label}
                        {soon ? " (soon)" : ""}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function NavButton({ label, icon: Icon, active, disabled, onClick }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-14 min-h-14 w-full flex-col gap-1 px-1 text-xs font-medium",
        active ? "text-red-700 hover:text-red-700" : "text-foreground",
        disabled && "opacity-40"
      )}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="!size-5" aria-hidden />
      {label}
    </Button>
  );
}
