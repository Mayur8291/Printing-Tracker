import { useEffect, useRef, useState } from "react";
import { Home, LayoutGrid, LogOut, Moon, Sun, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import EnvironmentSwitcherPopover from "../components/EnvironmentSwitcherPopover";
import "./squad.css";

const initials = (value) => String(value || "S").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const activeItem = (location, href) => {
  if (!href) return false;
  const [path, search = ""] = String(location || "").split("?");
  const [target, required = ""] = href.split("?");
  const matchesPath = (target === "/squad/customers" && path.startsWith("/squad/distributors/")) || path === target || (target !== "/squad/home" && path.startsWith(`${target}/`));
  const query = new URLSearchParams(search);
  return matchesPath && [...new URLSearchParams(required)].every(([key, value]) => query.get(key) === value);
};

function Navigation({ identity, navItems, activePath, onNavigate, onSignOut }) {
  const { setOpenMobile } = useSidebar();
  const groups = [...new Set(navItems.map((item) => item.group || "Workspace"))];
  const name = identity?.name || identity?.display_name || identity?.user?.name || identity?.email || "Your account";
  const role = identity?.role_name || identity?.roleName || identity?.role_label || "Squad One";
  const navigate = (event, href) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate?.(href);
    setOpenMobile(false);
  };
  return <Sidebar collapsible="icon" aria-label="Main navigation">
    <SidebarHeader className="border-b border-sidebar-border p-3">
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild size="lg" tooltip="Squad One home">
        <a href="/squad/home" onClick={(event) => navigate(event, "/squad/home")}>
          <img src="/brand-logo.png" alt="" width="32" height="32" className="size-8 shrink-0 object-contain" />
          <span className="grid min-w-0 leading-tight"><span className="truncate text-sm font-semibold">Squad One</span><span className="mt-1 truncate text-xs text-muted-foreground">Scott workspace</span></span>
        </a>
      </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarHeader>
    <SidebarContent className="py-2">
      {groups.map((group) => <SidebarGroup key={group}>
        <SidebarGroupLabel>{group}</SidebarGroupLabel>
        <SidebarGroupContent><SidebarMenu>
          {navItems.filter((item) => (item.group || "Workspace") === group).map((item) => {
            const Icon = item.icon && (typeof item.icon === "function" || typeof item.icon === "object") ? item.icon : item.key === "home" ? Home : LayoutGrid;
            const selected = activeItem(activePath, item.href);
            return <SidebarMenuItem key={item.key}><SidebarMenuButton asChild isActive={selected} tooltip={item.label} className="h-10">
              <a href={item.href} onClick={(event) => navigate(event, item.href)} aria-current={selected ? "page" : undefined}>
                <Icon className="size-4" aria-hidden="true" /><span>{item.label}</span>
              </a>
            </SidebarMenuButton></SidebarMenuItem>;
          })}
        </SidebarMenu></SidebarGroupContent>
      </SidebarGroup>)}
    </SidebarContent>
    <SidebarFooter className="border-t border-sidebar-border p-3">
      <div className="flex min-w-0 items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
        <Avatar className="size-9 shrink-0"><AvatarFallback className="bg-muted text-xs font-semibold">{initials(name)}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-muted-foreground">{role}</p></div>
      </div>
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="Sign out" onClick={onSignOut} className="mt-1"><LogOut className="size-4" aria-hidden="true" /><span>Sign out</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarFooter>
  </Sidebar>;
}

export default function SquadShell({ identity, navItems = [], activePath = "/squad/home", onNavigate, onSignOut, environment, writeState, bottomBar, rightMenu, children }) {
  const main = useRef(null);
  const previousPath = useRef(activePath);
  const [dark, setDark] = useState(() => {
    if (typeof document === "undefined") return false;
    try { return localStorage.getItem("printing-tracker-theme") === "dark" || document.documentElement.classList.contains("dark"); }
    catch { return document.documentElement.classList.contains("dark"); }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("theme-dark", dark);
    try { localStorage.setItem("printing-tracker-theme", dark ? "dark" : "light"); } catch { /* Appearance still works when storage is unavailable. */ }
  }, [dark]);
  const current = [...navItems].sort((a, b) => b.href?.length - a.href?.length).find((item) => activeItem(activePath, item.href));
  const readOnly = writeState === "read_only" || writeState === "mirror" || writeState?.canWrite === false || writeState?.writable === false || writeState?.allowed === false;
  const writeLabel = typeof writeState === "object" ? writeState?.label : undefined;
  const testSession = writeState?.mode === "test" && writeState?.allowed === true;
  const expiry = writeState?.expires_at ? new Date(writeState.expires_at) : null;
  const expiryLabel = expiry && !Number.isNaN(expiry.getTime()) ? expiry.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;
  const notice = writeLabel || (testSession ? `Test session: changes are enabled${expiryLabel ? ` until ${expiryLabel}` : " temporarily"}.` : writeState?.mode === "refresh" ? "Data is being refreshed. Changes are temporarily unavailable." : "Viewing synced data. Changes are currently unavailable.");
  useEffect(() => {
    if (previousPath.current !== activePath) {
      main.current?.scrollTo({ top: 0 });
      main.current?.focus({ preventScroll: true });
      previousPath.current = activePath;
    }
  }, [activePath]);
  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }
  return <div className="squad-app">
    <a href="#squad-main" className="squad-skip-link">Skip to content</a>
    <SidebarProvider defaultOpen className="h-svh min-h-0 overflow-hidden">
      <Navigation {...{ identity, navItems, activePath, onNavigate, onSignOut }} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <header className="squad-topbar">
          <div className="flex min-w-0 items-center gap-3"><span className={rightMenu ? "hidden md:inline-flex" : "inline-flex"}><SidebarTrigger /></span><span className="h-5 w-px bg-border" aria-hidden="true" /><div className="min-w-0"><p className="squad-eyebrow">Squad One</p><p className="truncate text-sm font-semibold">{current?.label || "Workspace"}</p></div></div>
          <div className="flex shrink-0 items-center gap-2">
            {rightMenu}<EnvironmentSwitcherPopover showAdminTools={identity?.role === 0} />
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? "Use light appearance" : "Use dark appearance"}>{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
          </div>
        </header>
        {(readOnly || testSession) && <div className="squad-write-notice" role="status"><LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" /><span>{notice}</span></div>}
        <main ref={main} id="squad-main" tabIndex={-1} className="squad-main"><div className="squad-content">{children}</div></main>
        {bottomBar}
      </SidebarInset>
    </SidebarProvider>
  </div>;
}
