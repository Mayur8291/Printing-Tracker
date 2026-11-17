import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import SampleJobSheetSlaSettingsControl from "./SampleJobSheetSlaSettingsDialog";
import { useSampleJobSheetSla } from "./SampleJobSheetSlaContext";

export default function ProductionTrackerSettings({ isAdmin, userId }) {
  const { policy } = useSampleJobSheetSla();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sample card timing</CardTitle>
        <CardDescription>
          Open sample cards use this time when the job has no due date. Due In on the sample list reads the same setting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Default time is {policy.defaultSlaDays} days and {policy.defaultSlaHours} hours. Warn at{" "}
          {policy.warnHours} hours. Urgent at {policy.urgentHours} hours.
        </p>
        <SampleJobSheetSlaSettingsControl isAdmin={isAdmin} userId={userId} />
        {isAdmin ? null : (
          <p className="text-muted-foreground">Only an admin can change these times.</p>
        )}
      </CardContent>
    </Card>
  );
}
