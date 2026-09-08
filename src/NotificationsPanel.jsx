import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Calendar,
  ClipboardList,
  FileText,
  MoreVertical,
  Tag,
  TriangleAlert,
  UserPlus
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_CATEGORY_FILTERS,
  NOTIFICATION_TIME_RANGES,
  countNotificationsByCategory,
  fetchUserNotifications,
  formatNotificationWhenLong,
  formatOrderStatusCode,
  isNotificationUnread,
  notificationActionLabel,
  notificationBodyText,
  notificationCategory,
  notificationCopyValue,
  notificationInTimeRange,
  notificationTitle,
  readNotificationsSeenAt,
  subscribeUserNotifications
} from "./notificationsUtils";

const CATEGORY_TONE = {
  orders: {
    dot: "bg-emerald-500",
    iconWrap: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    badge: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
  },
  tasks: {
    dot: "bg-amber-500",
    iconWrap: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    badge: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
  },
  inventory: {
    dot: "bg-violet-500",
    iconWrap: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    badge: "border-transparent bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300"
  },
  mentions: {
    dot: "bg-rose-500",
    iconWrap: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    badge: "border-transparent bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300"
  }
};

const ALERT_TONE = {
  dot: "bg-destructive",
  iconWrap: "bg-destructive/10 text-destructive"
};

function categoryTone(item) {
  if (item?.kind === "printing_inventory") return { ...CATEGORY_TONE.inventory, ...ALERT_TONE };
  return CATEGORY_TONE[notificationCategory(item)] ?? CATEGORY_TONE.orders;
}

function NotificationIcon({ item }) {
  if (item?.kind === "goal_task") return <UserPlus />;
  if (item?.kind === "printing_inventory") return <TriangleAlert />;
  if (item?.kind === "inward") return <Tag />;
  if (item?.kind === "assignment") return <ClipboardList />;
  return <FileText />;
}

function NotificationBody({ item, onOpen }) {
  const open = () => onOpen?.(item);

  if (item?.kind === "order_status") {
    const from = formatOrderStatusCode(item.previous_status);
    const to = formatOrderStatusCode(item.new_status);
    return (
      <>
        {item.order_display_id ? (
          <>
            Order{" "}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={open}>
              {item.order_display_id}
            </Button>
            {" · "}
          </>
        ) : (
          "Order · "
        )}
        {from} → {to}
      </>
    );
  }

  if (item?.kind === "assignment" && item.order_display_id) {
    return (
      <>
        Order{" "}
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={open}>
          {item.order_display_id}
        </Button>
        {" · coordinator"}
      </>
    );
  }

  return notificationBodyText(item);
}

async function copyNotificationRef(item) {
  const value = notificationCopyValue(item);
  if (!value || !navigator.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* user can retry from the menu */
  }
}

function NotificationRow({ item, unread, emphasizeAction, onOpen }) {
  const tone = categoryTone(item);
  const actionLabel = notificationActionLabel(item);
  const copyValue = notificationCopyValue(item);

  return (
    <Card className={cn("shadow-none", unread && "bg-primary/5")}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={cn("mt-2 size-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
              tone.iconWrap
            )}
          >
            <NotificationIcon item={item} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{notificationTitle(item)}</p>
            <p className="text-xs text-muted-foreground">
              <NotificationBody item={item} onOpen={onOpen} />
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatNotificationWhenLong(item.created_at)}
          </span>
          <Button
            type="button"
            variant={emphasizeAction ? "default" : "outline"}
            size="sm"
            onClick={() => onOpen?.(item)}
          >
            {actionLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="More notification actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => onOpen?.(item)}>Open</DropdownMenuItem>
                <DropdownMenuItem disabled={!copyValue} onClick={() => void copyNotificationRef(item)}>
                  Copy ID
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NotificationsPanel({ userId, onOpenNotification }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [timeRange, setTimeRange] = useState("all");
  const [highlightSeenAt, setHighlightSeenAt] = useState(() => readNotificationsSeenAt(userId));
  const highlightUserIdRef = useRef(userId);

  useEffect(() => {
    if (highlightUserIdRef.current === userId) return;
    highlightUserIdRef.current = userId;
    setHighlightSeenAt(readNotificationsSeenAt(userId));
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const rows = await fetchUserNotifications(userId, 80);
    setItems(rows);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeUserNotifications(userId, (item) => {
      setItems((prev) => {
        if (prev.some((row) => row.id === item.id)) return prev;
        return [item, ...prev].slice(0, 80);
      });
    });
  }, [userId]);

  const timedItems = useMemo(
    () => items.filter((item) => notificationInTimeRange(item, timeRange)),
    [items, timeRange]
  );
  const counts = useMemo(() => countNotificationsByCategory(timedItems), [timedItems]);
  const visibleItems = useMemo(
    () =>
      filter === "all"
        ? timedItems
        : timedItems.filter((item) => notificationCategory(item) === filter),
    [timedItems, filter]
  );
  const firstUnreadId = visibleItems.find((item) => isNotificationUnread(item, highlightSeenAt))?.id;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="notifications-page-title">
      <div className="flex flex-col gap-1">
        <h2 id="notifications-page-title" className="text-lg font-semibold tracking-tight">
          Notifications
        </h2>
        <p className="text-sm text-muted-foreground">
          Order assignments, status updates, task assignments, inward tags, and printing inventory alerts.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value);
          }}
          className="flex-wrap justify-start"
          aria-label="Notification category"
        >
          {NOTIFICATION_CATEGORY_FILTERS.map((chip) => {
            const selected = filter === chip.id;
            const count = counts[chip.id] ?? 0;
            return (
              <ToggleGroupItem
                key={chip.id}
                value={chip.id}
                className={cn(
                  "gap-2 px-3",
                  chip.id === "all" &&
                    "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                )}
                aria-label={`${chip.label}, ${count}`}
              >
                {chip.label}
                <Badge
                  variant={chip.id === "all" ? "secondary" : "outline"}
                  className={cn(
                    "rounded-full px-1.5 py-0 text-[10px]",
                    selected && chip.id === "all" && "border-transparent bg-primary-foreground/20 text-primary-foreground",
                    !selected && chip.id !== "all" && CATEGORY_TONE[chip.id]?.badge
                  )}
                >
                  {count}
                </Badge>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[10.5rem]" aria-label="Notification time range">
            <Calendar />
            <SelectValue placeholder="All time" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {NOTIFICATION_TIME_RANGES.map((range) => (
                <SelectItem key={range.id} value={range.id}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {loading && !items.length ? (
        <div className="flex flex-col gap-2">
          {["a", "b", "c", "d"].map((key) => (
            <Card key={key} className="shadow-none">
              <CardContent className="flex items-center gap-3 p-4">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {!loading && !visibleItems.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bell />
            </EmptyMedia>
            <EmptyTitle>
              {items.length ? "No notifications in this filter" : "No notifications yet"}
            </EmptyTitle>
            <EmptyDescription>
              {items.length
                ? "Try All, another category, or a wider time range."
                : "Order assignments, status changes, tasks, inward tags, and inventory alerts show here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="flex flex-col gap-2">
          {visibleItems.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              unread={isNotificationUnread(item, highlightSeenAt)}
              emphasizeAction={item.id === firstUnreadId}
              onOpen={onOpenNotification}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
