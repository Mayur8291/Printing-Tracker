import {
  BarChart3,
  Briefcase,
  ClipboardList,
  Contact,
  Database,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  Globe,
  Home,
  Headphones,
  Link2,
  MessageSquare,
  Package,
  Printer,
  Settings,
  ShoppingBag,
  Target,
  Truck,
  Users
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const TAB_ICONS = {
  home: Home,
  printing: Printer,
  billing: FileText,
  dispatch: Truck,
  inventory: Package,
  purchase_order: FileSpreadsheet,
  regular: ShoppingBag,
  production_tracker: BarChart3,
  distributor: Globe,
  enquiry: Headphones,
  shared_links: Link2,
  contact_book: Users,
  goals: Target,
  chat: MessageSquare,
  asset_management: Briefcase,
  audit: ClipboardList,
  admin: Settings,
  scott_customers: Contact,
  scott_reports: FileBarChart2,
  scott_masters: Database
};

function NavItem({ item, isActive, onSelect, showSoon, badgeCount = 0, showActivityDot = false }) {
  const Icon = TAB_ICONS[item.id] ?? Package;
  const showBadge = badgeCount > 0 && !showSoon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => onSelect(item.id)}
        tooltip={item.label}
        className="relative"
      >
        <Icon className="size-4 shrink-0" />
        <span>{item.label}</span>
        {showSoon ? (
          <Badge
            variant="secondary"
            className="ml-auto text-[10px] px-1.5 py-0 group-data-[collapsible=icon]:hidden"
          >
            Soon
          </Badge>
        ) : null}
        {showActivityDot && !showSoon ? (
          <span
            className={cn(
              "ml-auto size-2 shrink-0 rounded-full bg-primary",
              "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:ml-0"
            )}
            title="New updates"
            aria-label="New updates on this tab"
          />
        ) : null}
        {showBadge ? (
          <Badge className="ml-auto min-w-5 justify-center rounded-full bg-primary px-1.5 py-0 text-[10px] text-primary-foreground group-data-[collapsible=icon]:hidden">
            {badgeCount > 9 ? "9+" : badgeCount}
          </Badge>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function DashboardAppSidebar({
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
  footerSlot,
  tabBadges = {},
  tabMarkers = {}
}) {
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="cursor-default hover:bg-transparent active:bg-transparent data-[active=true]:bg-transparent"
            >
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
                <img
                  src="/brand-logo.png"
                  alt="Scott Dashboard"
                  className="size-full origin-center object-contain motion-reduce:animate-none animate-logo-spin"
                  width={32}
                  height={32}
                  draggable={false}
                />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">Scott Dashboard</span>
                <span className="truncate text-xs text-sidebar-foreground/70">Operations workspace</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {mainSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <NavItem
                    key={item.id}
                    item={item}
                    isActive={dashboardTab === item.id}
                    onSelect={onSelectTab}
                    showSoon={soonTabIds.has(item.id)}
                    badgeCount={tabBadges[item.id] ?? 0}
                    showActivityDot={Boolean(tabMarkers[item.id])}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {footerItems.map((item) => (
                <NavItem
                  key={item.id}
                  item={item}
                  isActive={dashboardTab === item.id}
                  onSelect={onSelectTab}
                  showSoon={soonTabIds.has(item.id)}
                  badgeCount={tabBadges[item.id] ?? 0}
                  showActivityDot={Boolean(tabMarkers[item.id])}
                />
              ))}
              {isAdmin && adminTab ? (
                <NavItem
                  item={adminTab}
                  isActive={dashboardTab === adminTab.id}
                  onSelect={onSelectTab}
                  showSoon={false}
                  badgeCount={tabBadges[adminTab.id] ?? 0}
                  showActivityDot={Boolean(tabMarkers[adminTab.id])}
                />
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2",
                "group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:px-0"
              )}
            >
              <button
                type="button"
                onClick={() => onOpenProfileSettings?.()}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center"
                )}
                aria-label="Open profile settings"
                title="Profile settings"
              >
                <Avatar className="size-8 shrink-0">
                  {userAvatarUrl ? <AvatarImage src={userAvatarUrl} alt="" /> : null}
                  <AvatarFallback className="bg-muted text-muted-foreground text-xs">{userInitials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-medium text-sidebar-foreground">{userName}</p>
                  {userDept ? (
                    <p className="truncate text-xs text-sidebar-foreground/70">{userDept}</p>
                  ) : (
                    <p className="truncate text-xs text-sidebar-foreground/70">Profile settings</p>
                  )}
                </div>
                <Settings className="size-3.5 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" aria-hidden />
              </button>
              {footerSlot ? (
                <div className="flex shrink-0 items-center gap-1 group-data-[collapsible=icon]:hidden">
                  {footerSlot}
                </div>
              ) : null}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
