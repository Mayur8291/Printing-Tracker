import { useCallback, useEffect, useState } from "react";
import NotificationToneSettings from "./components/notifications/NotificationToneSettings";
import {
  fetchUserNotifications,
  formatNotificationWhen,
  notificationBodyText,
  notificationTitle,
  subscribeUserNotifications
} from "./notificationsUtils";
import { profileNotificationTonePublicUrl } from "./notificationToneUtils";
import { setUserNotificationToneUrl } from "./notificationTonePlayer";

export default function NotificationsPanel({
  userId,
  tonePath,
  tonesEnabled = true,
  onTonePathChange,
  onOpenNotification
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [localTonePath, setLocalTonePath] = useState(tonePath ?? null);

  useEffect(() => {
    setLocalTonePath(tonePath ?? null);
  }, [tonePath]);

  const handleToneUpdated = useCallback(
    (patch) => {
      const nextPath =
        patch?.notification_tone_path !== undefined ? patch.notification_tone_path : localTonePath;
      setLocalTonePath(nextPath);
      setUserNotificationToneUrl(profileNotificationTonePublicUrl(nextPath));
      onTonePathChange?.(patch);
    },
    [localTonePath, onTonePathChange]
  );

  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const rows = await fetchUserNotifications(userId, 60);
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
        return [item, ...prev].slice(0, 60);
      });
    });
  }, [userId]);

  return (
    <section className="panel table-panel dashboard-card notifications-panel" aria-labelledby="notifications-page-title">
      <div className="notifications-panel-head">
        <h2 id="notifications-page-title" className="dashboard-section-title">
          Notifications
        </h2>
        <p className="notifications-panel-sub">
          Order assignments, status updates, task assignments, inward tags, and printing inventory alerts.
        </p>
      </div>

      <div className="mb-6">
        <NotificationToneSettings
          userId={userId}
          tonePath={localTonePath}
          tonesEnabled={tonesEnabled}
          onUpdated={handleToneUpdated}
        />
      </div>

      {loading && !items.length ? <p className="notifications-panel-empty">Loading notifications…</p> : null}

      {!loading && !items.length ? (
        <p className="notifications-panel-empty">No notifications yet.</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="notifications-page-list">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="notifications-page-item" onClick={() => onOpenNotification?.(item)}>
                <span className="notifications-page-item-kind">{notificationTitle(item)}</span>
                <span className="notifications-page-item-body">{notificationBodyText(item)}</span>
                <span className="notifications-page-item-time">{formatNotificationWhen(item.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
