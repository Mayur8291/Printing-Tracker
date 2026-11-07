import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { invokeAdminEdgeFunction } from "../edgeFunctionUtils";
import {
  getRuntimeEnv,
  getScottRestBaseUrl,
  setEnvironmentOverride,
  setScottRestBaseUrl
} from "../runtimeEnv";

/**
 * Admin-only header control: switch the Supabase backend (staging/production,
 * saved in this browser) and configure the Scott REST base URL used for the
 * webhook connectivity test. Switching reloads the app; sessions are kept
 * per environment, so first switch may ask to log in again.
 */
export default function EnvironmentSwitcherPopover() {
  const runtime = getRuntimeEnv();
  const isProduction = runtime.env === "production";
  const [scottUrl, setScottUrl] = useState(() => getScottRestBaseUrl());
  const [savedNote, setSavedNote] = useState("");
  const [confirmProd, setConfirmProd] = useState(false);
  const [testState, setTestState] = useState({ busy: false, ok: null, message: "" });

  const applyEnv = (target) => {
    setEnvironmentOverride(target === runtime.buildEnv ? null : target);
    window.location.reload();
  };

  const handleEnvSwitch = (checked) => {
    const target = checked ? "production" : "staging";
    if (target === runtime.env) return;
    if (target === "production") {
      setConfirmProd(true);
      return;
    }
    setConfirmProd(false);
    applyEnv(target);
  };

  const handleSaveScottUrl = () => {
    const cleaned = setScottRestBaseUrl(scottUrl);
    setScottUrl(cleaned);
    setSavedNote(cleaned ? "Saved in this browser." : "Cleared.");
    window.setTimeout(() => setSavedNote(""), 2500);
  };

  const handleTestWebhook = async () => {
    const base = String(scottUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) {
      setTestState({ busy: false, ok: false, message: "Enter the Scott REST base URL first." });
      return;
    }
    setTestState({ busy: true, ok: null, message: "Sending signed test webhook…" });
    try {
      const data = await invokeAdminEdgeFunction("admin-test-scott-webhook", { base_url: base });
      setTestState({
        busy: false,
        ok: Boolean(data?.ok),
        message: data?.ok
          ? `Delivered — their server answered ${data.status}.`
          : `Failed: ${data?.message || `status ${data?.status ?? "unknown"}`}`
      });
    } catch (err) {
      setTestState({ busy: false, ok: false, message: err?.message || "Test failed." });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              isProduction ? "bg-amber-500" : "bg-emerald-500"
            )}
          />
          {isProduction ? "Production" : "Staging"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Backend environment</p>
              <p className="text-xs text-muted-foreground">
                Saved in this browser · app reloads on switch
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Staging</span>
              <Switch
                checked={isProduction || confirmProd}
                onCheckedChange={handleEnvSwitch}
                aria-label="Switch between staging and production backend"
              />
              <span className="text-xs text-muted-foreground">Production</span>
            </div>
          </div>
          {confirmProd ? (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2">
              <p className="text-xs text-amber-700">
                Switch to <strong>live production data</strong>? Changes affect real orders.
                You may need to log in again.
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="destructive" onClick={() => applyEnv("production")}>
                  Yes, switch to production
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmProd(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {runtime.isOverride ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Overriding build default ({runtime.buildEnv})
            </Badge>
          ) : null}
          {isProduction ? (
            <p className="text-xs text-amber-600">
              Live production data — changes affect real orders.
            </p>
          ) : null}
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="scott-rest-base-url" className="text-sm font-medium">
            Scott REST base URL
          </Label>
          <p className="text-xs text-muted-foreground">
            Saved in this browser. Used to test webhook delivery to the Scott
            International backend.
          </p>
          <Input
            id="scott-rest-base-url"
            value={scottUrl}
            onChange={(e) => setScottUrl(e.target.value)}
            placeholder="https://your-scott-backend.example.com"
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleSaveScottUrl}>
              Save
            </Button>
            <Button type="button" size="sm" onClick={handleTestWebhook} disabled={testState.busy}>
              {testState.busy ? "Testing…" : "Send test webhook"}
            </Button>
            {savedNote ? <span className="text-xs text-muted-foreground">{savedNote}</span> : null}
          </div>
          {testState.message ? (
            <p
              className={cn(
                "text-xs",
                testState.ok == null
                  ? "text-muted-foreground"
                  : testState.ok
                    ? "text-emerald-600"
                    : "text-destructive"
              )}
            >
              {testState.message}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
