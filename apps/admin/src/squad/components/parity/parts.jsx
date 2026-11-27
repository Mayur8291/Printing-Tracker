import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { visibleCounters } from "./statsModel";

/** Tappable counter tiles; horizontal scroll on phones (Flutter), grid on desktop. */
export function OrderCounters({ stats, loading, criteria = false, onSelect, className }) {
  if (loading) return <div className={cn("squad-counters", className)} role="status" aria-label="Loading counters">{[0, 1, 2, 3].map((i) => <div key={i} className="squad-counter animate-pulse" aria-hidden="true"><p>&nbsp;</p><strong>--</strong></div>)}</div>;
  const tiles = visibleCounters(stats, { criteria });
  if (!tiles.length) return null;
  return <div className={cn("squad-counters", className)}>{tiles.map((t) => {
    const body = <><p>{t.label}</p><strong>{t.value}</strong>{t.hint && <span>{t.hint}</span>}</>;
    return onSelect && t.drill ? <button type="button" key={t.key} className="squad-counter is-tappable" onClick={() => onSelect(t)}>{body}</button> : <div key={t.key} className="squad-counter">{body}</div>;
  })}</div>;
}

/** "Pending (3)" / "Completed (5)" tabs; swipe left/right switches (Flutter swipeable tabs). */
export function CountTabs({ tabs, value, onChange, className }) {
  const start = useRef(null);
  const index = tabs.findIndex((t) => t.key === value);
  const swipe = (event) => {
    if (!start.current) return;
    const dx = event.changedTouches[0].clientX - start.current.x, dy = Math.abs(event.changedTouches[0].clientY - start.current.y);
    start.current = null;
    if (Math.abs(dx) < 60 || dy > Math.abs(dx) / 2) return;
    const next = tabs[index + (dx < 0 ? 1 : -1)];
    if (next) onChange(next.key);
  };
  return <div role="tablist" className={cn("squad-count-tabs", className)} onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }} onTouchEnd={swipe}>
    {tabs.map((t) => <button type="button" role="tab" key={t.key} aria-selected={t.key === value} className={cn("squad-count-tab", t.key === value && "is-active")} onClick={() => onChange(t.key)}>{t.label}{t.count != null ? ` (${t.count})` : ""}</button>)}
  </div>;
}

/** Flutter SearchBar header: "Orders (124)" title, search field, refresh. */
export function SearchHeader({ title, count, placeholder, onSearch, onRefresh, refreshing, children }) {
  const [text, setText] = useState("");
  return <div className="squad-search-header">
    <h2>{title}{count != null ? ` (${count})` : ""}</h2>
    <form role="search" onSubmit={(e) => { e.preventDefault(); onSearch?.(text.trim()); }}>
      <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input aria-label={placeholder} className="pl-9" value={text} placeholder={placeholder} onChange={(e) => { setText(e.target.value); if (!e.target.value) onSearch?.(""); }} /></div>
      {onRefresh && <Button type="button" variant="outline" size="icon" aria-label="Refresh" disabled={refreshing} onClick={onRefresh}><RefreshCw className={cn("size-4", refreshing && "animate-spin motion-reduce:animate-none")} /></Button>}
    </form>{children}
  </div>;
}

/** Floating add button; clears the mobile bottom bar. */
export function Fab({ label, onClick }) {
  return <button type="button" className="squad-fab" aria-label={label} title={label} onClick={onClick}><Plus className="size-6" aria-hidden="true" /></button>;
}

/** Person card (SC / PC / customer): initials, name, pending/completed counts, actions. */
export function PersonCard({ name, subtitle, photo, pending, completed, onOpen, actions }) {
  const initials = String(name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return <article className="squad-person-card">
    <button type="button" className="squad-person-main" onClick={onOpen}>
      <span className="squad-person-avatar" aria-hidden="true">{photo ? <img src={photo} alt="" /> : initials}</span>
      <span className="min-w-0 text-left"><strong className="block truncate">{name}</strong>{subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}</span>
    </button>
    <dl className="squad-person-counts"><div><dt>PENDING ORDERS</dt><dd>{pending ?? "—"}</dd></div><div><dt>COMPLETED ORDERS</dt><dd>{completed ?? "—"}</dd></div></dl>
    {actions && <div className="flex gap-2">{actions}</div>}
  </article>;
}

/** Order card in Flutter order_widget field order. Money/factory fields render only when the server sent them. */
export function OrderCard({ order, onOpen, money, date, status }) {
  const rows = [["Customer Name", order.customer_name], ["Due date", order.due_on ? date(order.due_on) : null], ["Total Quantity", order.total_quantity],
    ["Total Order Value", order.total_amount != null ? money(order.total_amount) : null], ["Payment Status", order.payment_status != null ? (["Paid", "Unpaid", "Partially paid"][order.payment_status] ?? null) : null],
    ["Order Status", status], ["FACTORY MANAGER", "factory_manager_id" in order ? (order.factory_manager_id ? "Assigned" : "Yet to be assigned") : null]].filter(([, v]) => v != null && v !== "");
  return <button type="button" className="squad-order-card" onClick={onOpen}>
    <header><strong>Order No: {order.id}</strong>{order.is_prime && <span className="squad-chip">PRIORITY</span>}</header>
    <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
  </button>;
}

/** Calls onMore when the sentinel scrolls into view (infinite scroll). */
export function LoadMore({ hasMore, loading, onMore }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !loading) onMore(); }, { rootMargin: "200px" });
    io.observe(node); return () => io.disconnect();
  }, [hasMore, loading, onMore]);
  if (!hasMore) return null;
  return <div ref={ref} className="flex justify-center py-4"><Button variant="outline" size="sm" disabled={loading} onClick={onMore}>{loading ? "Loading…" : "Load more"}</Button></div>;
}

/** Pull down from the top of the scroll area to refresh (touch only). */
export function PullToRefresh({ onRefresh, children }) {
  const [pull, setPull] = useState(0), y0 = useRef(null);
  return <div onTouchStart={(e) => { const top = e.currentTarget.closest(".squad-main")?.scrollTop ?? 0; y0.current = top <= 0 ? e.touches[0].clientY : null; }}
    onTouchMove={(e) => { if (y0.current != null) setPull(Math.max(0, Math.min(90, e.touches[0].clientY - y0.current))); }}
    onTouchEnd={() => { if (pull >= 70) onRefresh(); y0.current = null; setPull(0); }}>
    {pull > 0 && <div className="py-2 text-center text-xs text-muted-foreground" role="status">{pull >= 70 ? "Release to refresh" : "Pull to refresh"}</div>}{children}
  </div>;
}
