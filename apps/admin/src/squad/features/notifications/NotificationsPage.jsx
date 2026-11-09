import { Bell, ArrowUpRight } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useSquadQuery, useCursorPage } from "../../data/hooks";
import { date } from "../../data/format";
import { PageHeader, SectionCard, ResourceState, Pagination } from "../../components";

export function notificationPath(target) {
  if (!target?.id || !/^[1-9]\d*$/.test(String(target.id))) return null;
  const routes = { order:"orders", person:"people", task:"tasks", responsibility:"goals", milestone:"targets", item:"production", jobsheet:"production/inspection", delivery:"stock/deliveries" };
  return routes[target.kind] ? `/squad/${routes[target.kind]}/${target.id}` : null;
}
export default function NotificationsPage({ sdk, onNavigate }) {
  const page = useCursorPage("notifications");
  const query = useSquadQuery(["notifications",page.cursor], ({sdk}) => sdk.notifications(null,{cursor:page.cursor,limit:25}));
  return <div className="space-y-6"><PageHeader title="Notifications" description="Updates on the work and records you can access." />{query.isLoading ? <ResourceState status="loading" /> : query.error ? <ResourceState status="error" error={query.error} onRetry={query.refetch} /> : <SectionCard>{!query.data?.data?.length ? <ResourceState title="You’re all caught up" description="New updates will appear here." /> : <ul className="divide-y">{query.data.data.map((item) => <li key={item.id} className="flex gap-4 py-5 first:pt-0"><div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted"><Bell className="size-4" /></div><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.title}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.body}</p><p className="mt-2 text-xs text-muted-foreground">{date(item.created_at,true)}</p></div>{notificationPath(item.target) && <Button variant="ghost" size="icon" aria-label={`Open ${item.title}`} onClick={() => onNavigate(notificationPath(item.target))}><ArrowUpRight className="size-4" /></Button>}</li>)}</ul>}<Pagination page={page.page} hasNext={!!query.data?.next_cursor} onPrevious={page.previous} onNext={() => page.next(query.data.next_cursor)} loading={query.isFetching} /></SectionCard>}</div>;
}
