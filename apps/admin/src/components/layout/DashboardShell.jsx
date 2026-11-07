import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import DashboardAppSidebar from "./DashboardAppSidebar";

export default function DashboardShell({
  children,
  topbarTitle,
  topbarEyebrow = "Dashboard",
  topbarActions,
  mainSections,
  footerItems,
  adminTab,
  isAdmin,
  dashboardTab,
  onSelectTab,
  soonTabIds,
  userName,
  userDept,
  userInitials,
  userAvatarUrl,
  onOpenProfileSettings,
  sidebarFooterSlot,
  fullBleed = false,
  tabBadges,
  tabMarkers
}) {
  return (
    <SidebarProvider defaultOpen className="flex h-svh max-h-svh w-full min-h-0 overflow-hidden">
      <DashboardAppSidebar
        mainSections={mainSections}
        footerItems={footerItems}
        adminTab={adminTab}
        isAdmin={isAdmin}
        dashboardTab={dashboardTab}
        onSelectTab={onSelectTab}
        soonTabIds={soonTabIds}
        userName={userName}
        userDept={userDept}
        userInitials={userInitials}
        userAvatarUrl={userAvatarUrl}
        onOpenProfileSettings={onOpenProfileSettings}
        footerSlot={sidebarFooterSlot}
        tabBadges={tabBadges}
        tabMarkers={tabMarkers}
      />
      <SidebarInset className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
        <header className="sticky top-0 z-20 shrink-0 overflow-visible border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-col gap-3 px-4 py-3 lg:min-h-14 lg:flex-row lg:items-center lg:gap-3 lg:py-0">
            <div className="flex min-w-0 items-center gap-2 lg:flex-1">
              <SidebarTrigger className="-ml-1 shrink-0" />
              <Separator orientation="vertical" className="hidden h-4 sm:block" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {topbarEyebrow}
                </p>
                <h1 className="truncate text-base font-semibold leading-tight md:text-lg">{topbarTitle}</h1>
              </div>
            </div>
            {topbarActions ? (
              <div className="flex w-full shrink-0 items-center gap-2 lg:w-auto lg:max-w-xl">
                {topbarActions}
              </div>
            ) : null}
          </div>
        </header>
        <div
          data-dashboard-scroll
          data-scroll-mode={fullBleed ? "panel" : "main"}
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            fullBleed
              ? "overflow-hidden"
              : "overflow-y-auto overscroll-contain gap-4 p-4 md:gap-6 md:p-6"
          )}
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
