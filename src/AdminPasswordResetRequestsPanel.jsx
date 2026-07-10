import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  canAdminActionRequest,
  fetchPasswordResetRequests,
  filterRequestsForAdmin,
  isMainAdminProfile,
  passwordResetRoutingLabel,
  passwordResetStatusLabel,
  reviewPasswordResetRequest
} from "./passwordResetUtils";
import { profileDisplayName } from "./goalTrackerUtils";
import { subscribePostgresChanges } from "./realtimeUtils";

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function AdminPasswordResetRequestsPanel({ profile }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  const visibleRequests = useMemo(
    () => filterRequestsForAdmin(requests, profile),
    [requests, profile]
  );

  const pendingCount = useMemo(
    () => visibleRequests.filter((row) => row.status === "pending").length,
    [visibleRequests]
  );

  const load = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const rows = await fetchPasswordResetRequests();
      setRequests(rows);
    } catch (e) {
      setError(e.message || "Could not load password reset requests.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribePostgresChanges({
      channelName: "admin-password-reset-requests",
      tables: ["password_reset_requests"],
      onEvent: () => {
        void load({ silent: true });
      }
    });
  }, [load]);

  async function handleReview(requestId, action) {
    setBusyId(requestId);
    setError("");
    try {
      await reviewPasswordResetRequest(requestId, action, notes[requestId] ?? "");
      await load({ silent: true });
    } catch (e) {
      setError(e.message || "Could not update request.");
    } finally {
      setBusyId(null);
    }
  }

  const mainAdmin = isMainAdminProfile(profile);

  return (
    <section className="admin-user-mgmt-card space-y-4">
      <div>
        <h4 className="admin-user-mgmt-title">Password reset requests</h4>
        <p className="text-sm text-muted-foreground">
          Users request resets from the login screen. Approve to let them set a new password on login only.
          {mainAdmin
            ? " You are the main admin — you approve reset requests from other admin users."
            : " Admin-user requests go to admin@scott.com only."}
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : visibleRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No password reset requests yet.</p>
      ) : (
        <div className="space-y-3">
          {pendingCount > 0 ? (
            <p className="text-sm font-medium">{pendingCount} pending request{pendingCount === 1 ? "" : "s"}</p>
          ) : null}
          <ul className="space-y-3">
            {visibleRequests.map((row) => {
              const canAction = canAdminActionRequest(row, profile);
              const userLabel = profileDisplayName(row.user) || row.email;
              return (
                <li key={row.id} className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{userLabel}</p>
                      <p className="text-sm text-muted-foreground">{row.email}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Requested {formatWhen(row.requested_at)} · {passwordResetRoutingLabel(row.routing)}
                        {row.requester_role === "admin" ? " · Admin user" : ""}
                      </p>
                    </div>
                    <Badge variant={row.status === "pending" ? "default" : "outline"}>
                      {passwordResetStatusLabel(row.status)}
                    </Badge>
                  </div>

                  {row.admin_note ? (
                    <p className="mt-3 text-sm text-muted-foreground">Note: {row.admin_note}</p>
                  ) : null}

                  {row.status === "approved" ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      User can set password until {formatWhen(row.approved_expires_at)}.
                    </p>
                  ) : null}

                  {canAction ? (
                    <div className="mt-4 space-y-3 border-t pt-4">
                      <Textarea
                        placeholder="Optional note for audit trail"
                        value={notes[row.id] ?? ""}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        rows={2}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => handleReview(row.id, "approve")}
                        >
                          {busyId === row.id ? "Saving…" : "Approve"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyId === row.id}
                          onClick={() => handleReview(row.id, "reject")}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ) : row.status === "pending" && row.routing === "main_admin" && !mainAdmin ? (
                    <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
                      Only admin@scott.com can approve this admin-user request.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
