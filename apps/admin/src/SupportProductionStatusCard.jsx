import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchProductionStatusAlerts } from "./supportProductionStatusUtils";
import { subscribePostgresChanges } from "./realtimeUtils";
import { Radio } from "lucide-react";

/**
 * Read-only log of automatic production status WhatsApp texts (admin and staff).
 */
export default function SupportProductionStatusCard() {
  const [recent, setRecent] = useState([]);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await fetchProductionStatusAlerts());
    } catch (e) {
      console.warn("production status alerts:", e.message);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    return subscribePostgresChanges({
      channelName: "support-production-status-live",
      tables: ["support_production_status_alerts"],
      onEvent: () => {
        void loadRecent();
      }
    });
  }, [loadRecent]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4" aria-hidden />
          Production status texts
        </CardTitle>
        <CardDescription>
          When production updates an order status, Concierge queues a WhatsApp text automatically.
          Track Order is not in the simulator — status comes from the backend. Live Meta WhatsApp
          is not sent from this dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recent.length ? (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {recent.map((row) => (
              <li key={row.id}>
                {row.order_id}
                {row.customer_name ? ` · ${row.customer_name}` : ""}
                {row.new_status ? ` · ${row.new_status}` : ""}
                {row.skipped_reason ? ` · skipped (${row.skipped_reason})` : " · queued"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No automatic texts yet. Change a printing order status after the customer phone is on
            an enquiry (same Order ID), contact book, or Ready Stock order.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
