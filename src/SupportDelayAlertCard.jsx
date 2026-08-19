import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lookupOrderForEnquiry, normalizeOrderCode } from "./enquiryConciergeUtils";
import { fetchDelayAlerts, formatDelayDate, sendSupportDelayAlert } from "./supportDelayAlertUtils";
import { subscribePostgresChanges } from "./realtimeUtils";
import { Bell } from "lucide-react";

const EMPTY_FORM = {
  orderNumber: "",
  customerName: "",
  phone: "",
  oldDeliveryDate: "",
  newDeliveryDate: ""
};

/**
 * Concierge production delay alert — Support tab, admin and non-admin.
 */
export default function SupportDelayAlertCard({ sessionUserId }) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState([]);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await fetchDelayAlerts());
    } catch (e) {
      console.warn("delay alerts:", e.message);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    return subscribePostgresChanges({
      channelName: "support-delay-alerts-live",
      tables: ["support_delay_alerts"],
      onEvent: () => {
        void loadRecent();
      }
    });
  }, [loadRecent]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function fillFromOrder() {
    const code = normalizeOrderCode(form.orderNumber);
    if (!code) {
      setHint("");
      return;
    }
    try {
      const lookup = await lookupOrderForEnquiry(code);
      if (!lookup.found) {
        setHint("Order not in dashboard. You can still send if name, phone, and dates are filled.");
        return;
      }
      setForm((prev) => ({
        ...prev,
        orderNumber: lookup.orderId || prev.orderNumber,
        customerName: lookup.customerName || prev.customerName,
        phone: lookup.phone || prev.phone,
        oldDeliveryDate: lookup.dueDate || prev.oldDeliveryDate
      }));
      setHint(
        lookup.phone
          ? `Loaded ${lookup.orderId}${lookup.dueDate ? ` · due ${formatDelayDate(lookup.dueDate)}` : ""}.`
          : `Loaded ${lookup.orderId}. Add the customer phone to queue the message.`
      );
    } catch (e) {
      setHint(e.message || "Could not look up order.");
    }
  }

  async function handleSend() {
    setSaving(true);
    setError("");
    setOk("");
    try {
      const result = await sendSupportDelayAlert({
        ...form,
        sessionUserId
      });
      setOk(`Delay alert queued for ${result.orderId}. Open WhatsApp simulator with that phone to see it.`);
      setForm({ ...EMPTY_FORM });
      setHint("");
      await loadRecent();
    } catch (e) {
      setError(e.message || "Could not send delay alert.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" aria-hidden />
          Send production delay alert
        </CardTitle>
        <CardDescription>
          Production updates the delivery date. Customer gets the Concierge apology text. Admin and staff
          can send. Live Meta WhatsApp is not sent from this dashboard — the WhatsApp simulator shows the
          queued message. Track Order is automatic from production status updates, not this form.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="delay-order">Order number</Label>
            <Input
              id="delay-order"
              value={form.orderNumber}
              onChange={(e) => setField("orderNumber", e.target.value)}
              onBlur={() => void fillFromOrder()}
              placeholder="SC123456"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delay-name">Customer name</Label>
            <Input
              id="delay-name"
              value={form.customerName}
              onChange={(e) => setField("customerName", e.target.value)}
              placeholder="John Smith"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delay-phone">Phone</Label>
            <Input
              id="delay-phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="+919876543210"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delay-old">Old delivery date</Label>
            <Input
              id="delay-old"
              type="date"
              value={form.oldDeliveryDate}
              onChange={(e) => setField("oldDeliveryDate", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delay-new">New delivery date</Label>
            <Input
              id="delay-new"
              type="date"
              value={form.newDeliveryDate}
              onChange={(e) => setField("newDeliveryDate", e.target.value)}
            />
          </div>
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {ok ? <p className="text-sm text-emerald-700">{ok}</p> : null}
        <Button type="button" disabled={saving} onClick={() => void handleSend()}>
          {saving ? "Sending…" : "Send delay alert"}
        </Button>
        {recent.length ? (
          <div className="space-y-1 border-t pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recently sent</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {recent.map((row) => (
                <li key={row.id}>
                  {row.order_id}
                  {row.customer_name ? ` · ${row.customer_name}` : ""}
                  {row.new_delivery_date ? ` · new ${formatDelayDate(row.new_delivery_date)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
