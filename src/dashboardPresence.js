import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

export const PRESENCE_OFFLINE_MS = 2 * 60 * 60 * 1000;
export const PRESENCE_ONLINE_GRACE_MS = 5 * 60 * 1000;

export const PRESENCE_LABEL = {
  online: "Online",
  away: "Away",
  offline: "Offline"
};

export function presenceFromRow(row, now = Date.now()) {
  if (!row?.last_seen_at) return "offline";
  const seen = new Date(row.last_seen_at).getTime();
  if (Number.isNaN(seen) || now - seen >= PRESENCE_OFFLINE_MS) return "offline";
  if (now - seen < PRESENCE_ONLINE_GRACE_MS) return "online";
  return "away";
}

export function presenceLabel(status) {
  return PRESENCE_LABEL[status] ?? PRESENCE_LABEL.offline;
}

function dashboardIsActive() {
  if (typeof document === "undefined") return false;
  if (document.visibilityState !== "visible") return false;
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  return true;
}

export async function pushMyDashboardPresence(state) {
  const { error } = await supabase.rpc("set_my_dashboard_presence", {
    p_client_state: state
  });
  if (error) throw new Error(error.message);
}

export async function fetchAllPresenceRows() {
  const { data, error } = await supabase
    .from("hr_user_presence")
    .select("user_id, client_state, last_seen_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function usePublishDashboardPresence(userId) {
  useEffect(() => {
    if (!userId) return undefined;

    let cancelled = false;
    let awayTimer = 0;

    function clearAwayTimer() {
      if (awayTimer) {
        window.clearTimeout(awayTimer);
        awayTimer = 0;
      }
    }

    function sync() {
      if (cancelled) return;
      if (dashboardIsActive()) {
        clearAwayTimer();
        void pushMyDashboardPresence("online").catch(() => {});
        return;
      }
      if (!awayTimer) {
        awayTimer = window.setTimeout(() => {
          awayTimer = 0;
          if (cancelled || dashboardIsActive()) return;
          void pushMyDashboardPresence("away").catch(() => {});
        }, PRESENCE_ONLINE_GRACE_MS);
      }
    }

    sync();
    const interval = window.setInterval(sync, 25000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);

    return () => {
      cancelled = true;
      clearAwayTimer();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, [userId]);
}

export function usePresenceByUserId() {
  const [rows, setRows] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchAllPresenceRows();
        if (!cancelled) setRows(next);
      } catch {
        if (!cancelled) setRows([]);
      }
    }

    void load();
    const tick = window.setInterval(() => setNow(Date.now()), 15000);

    const channel = supabase
      .channel("hr-user-presence")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hr_user_presence" },
        () => {
          void load();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, []);

  return useMemo(() => {
    const map = {};
    for (const row of rows) {
      map[row.user_id] = presenceFromRow(row, now);
    }
    return map;
  }, [rows, now]);
}
