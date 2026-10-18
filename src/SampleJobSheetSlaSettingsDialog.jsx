import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSampleJobSheetSettings } from "./sampleJobSheetSettings";
import {
  clampSampleSlaDays,
  clampSampleSlaHours,
  clampSampleSlaWarnHours
} from "./sampleJobSheetSlaUtils";
import { useSampleJobSheetSla } from "./SampleJobSheetSlaContext";

export default function SampleJobSheetSlaSettingsControl({ isAdmin, userId }) {
  const { policy, setPolicy } = useSampleJobSheetSla();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("2");
  const [hours, setHours] = useState("0");
  const [warnHours, setWarnHours] = useState("24");
  const [urgentHours, setUrgentHours] = useState("12");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDays(String(policy.defaultSlaDays));
    setHours(String(policy.defaultSlaHours));
    setWarnHours(String(policy.warnHours));
    setUrgentHours(String(policy.urgentHours));
    setError("");
  }, [open, policy]);

  if (!isAdmin) return null;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const next = await saveSampleJobSheetSettings(
        {
          defaultSlaDays: clampSampleSlaDays(days),
          defaultSlaHours: clampSampleSlaHours(hours),
          warnHours: clampSampleSlaWarnHours(warnHours),
          urgentHours: clampSampleSlaWarnHours(urgentHours)
        },
        userId
      );
      setPolicy(next);
      setOpen(false);
    } catch (err) {
      setError(err?.message || "Could not save SLA settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings data-icon="inline-start" />
        SLA settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Sampling SLA</DialogTitle>
              <DialogDescription>
                Used for Due In when Sampling required on is empty. If that date is filled, Due In
                still ends that day.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sample-sla-days">Default days</Label>
                <Input
                  id="sample-sla-days"
                  type="number"
                  min="1"
                  max="30"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sample-sla-hours">Plus hours</Label>
                <Input
                  id="sample-sla-hours"
                  type="number"
                  min="0"
                  max="23"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sample-sla-warn">Warn under (hours)</Label>
                <Input
                  id="sample-sla-warn"
                  type="number"
                  min="1"
                  max="168"
                  value={warnHours}
                  onChange={(e) => setWarnHours(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sample-sla-urgent">Urgent under (hours)</Label>
                <Input
                  id="sample-sla-urgent"
                  type="number"
                  min="1"
                  max="168"
                  value={urgentHours}
                  onChange={(e) => setUrgentHours(e.target.value)}
                />
              </div>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save SLA"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
