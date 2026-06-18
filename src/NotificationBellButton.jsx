import { useEffect, useMemo, useState } from "react";
import {
  countUnreadNotifications,
  fetchUserNotifications,
  readNotificationsSeenAt,
  subscribeUserNotifications,
  writeNotificationsSeenAt
} from "./notificationsUtils";

function BellIcon() {
  return (
    <svg className="notification-bell-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="10.5" y="2" width="3" height="2.25" rx="1.125" />
      <path d="M12 5.75C9.15 5.75 7 7.55 6.75 10.25V14.5L4.5 16.25V16.75H19.5V16.25L17.25 14.5V10.25C17 7.55 14.85 5.75 12 5.75Z" />
      <path d="M12 21.5c.97 0 1.75-.78 1.75-1.75H10.25c0 .97.78 1.75 1.75 1.75z" />
    </svg>
  );
}

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
    <div className="notification-bell-wrap">
      <button
        type="button"
        className="notification-bell-btn theme-toggle-btn theme-toggle-btn--sidebar"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        title="Notifications"
        onClick={handleClick}
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className="notification-bell-badge" aria-hidden>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
