import { useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  countUnreadNotifications,
  fetchUserNotifications,
  readNotificationsSeenAt,
  subscribeUserNotifications,
  writeNotificationsSeenAt
} from "./notificationsUtils";

export default function NotificationBellButton({ userId, active, onOpen }) {
  const [items, setItems] = useState([]);
  const [lastSeenAt, setLastSeenAt] = useState(() => readNotificationsSeenAt(userId));

  useEffect(() => {
    setLastSeenAt(readNotificationsSeenAt(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      return undefined;
    }
    let cancelled = false;
    void fetchUserNotifications(userId, 40).then((rows) => {
      if (!cancelled) setItems(rows);
    });
    const unsubscribe = subscribeUserNotifications(userId, (item) => {
      setItems((prev) => {
        if (prev.some((row) => row.id === item.id)) return prev;
        return [item, ...prev].slice(0, 40);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  useEffect(() => {
    if (!active || !userId) return;
    const now = new Date().toISOString();
    writeNotificationsSeenAt(userId, now);
    setLastSeenAt(now);
  }, [active, userId]);

  const unreadCount = useMemo(
    () => countUnreadNotifications(items, lastSeenAt),
    [items, lastSeenAt]
  );

  function handleClick() {
    if (userId) {
      const now = new Date().toISOString();
      writeNotificationsSeenAt(userId, now);
      setLastSeenAt(now);
    }
    onOpen?.();
  }

  if (!userId) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("relative size-8 shrink-0 text-sidebar-foreground", active && "bg-sidebar-accent")}
      aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
      title="Notifications"
      onClick={handleClick}
    >
      <Bell className="size-4" />
      {unreadCount > 0 ? (
        <Badge
          variant="destructive"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </Badge>
      ) : null}
    </Button>
  );
}
