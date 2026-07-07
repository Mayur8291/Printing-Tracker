import { useRef, useState } from "react";
import { Music2, Play, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  clearProfileNotificationTone,
  profileNotificationTonePublicUrl,
  uploadProfileNotificationTone,
  validateNotificationToneFile
} from "../../notificationToneUtils";
import {
  previewNotificationToneUrl,
  resolveDefaultNotificationToneUrl
} from "../../notificationTonePlayer";

export default function NotificationToneSettings({
  userId,
  tonePath,
  tonesEnabled = true,
  onUpdated
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  const customUrl = profileNotificationTonePublicUrl(tonePath);
  const hasCustom = Boolean(customUrl);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !userId) return;

    const validationError = validateNotificationToneFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploading(true);
    setError("");
    try {
      const path = await uploadProfileNotificationTone(userId, file);
      onUpdated?.({ notification_tone_path: path });
    } catch (e) {
      setError(e.message || "Could not upload tone.");
    } finally {
      setUploading(false);
    }
  }

  async function handleClear() {
    if (!userId || !hasCustom) return;
    if (!window.confirm("Remove your custom tone and use the default app sound?")) return;
    setClearing(true);
    setError("");
    try {
      await clearProfileNotificationTone(userId);
      onUpdated?.({ notification_tone_path: null });
    } catch (e) {
      setError(e.message || "Could not remove tone.");
    } finally {
      setClearing(false);
    }
  }

  function handlePreview() {
    if (!tonesEnabled) {
      setError("Status tone is off for your account. Ask admin to enable it.");
      return;
    }
    setError("");
    previewNotificationToneUrl(hasCustom ? customUrl : resolveDefaultNotificationToneUrl());
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Music2 className="size-4" />
          Notification tone
        </CardTitle>
        <CardDescription>
          Upload an MP3 (max 2 MB). Used for assignments, task alerts, order status, and other
          dashboard notifications on your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          {hasCustom ? (
            <p>
              <strong>Custom tone</strong> — your uploaded MP3 plays for alerts.
            </p>
          ) : (
            <p>
              <strong>Default tone</strong> — built-in app sound. Upload MP3 to personalize.
            </p>
          )}
          {!tonesEnabled ? (
            <p className="mt-2 text-xs text-amber-800">
              Status tone is OFF for your account — you will not hear alerts until admin turns it on.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            className="sr-only"
            onChange={(e) => void handleFileChange(e)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || clearing || !userId}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" />
            {uploading ? "Uploading…" : hasCustom ? "Replace MP3" : "Upload MP3"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || clearing}
            onClick={handlePreview}
          >
            <Play className="size-4" />
            Preview
          </Button>
          {hasCustom ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={uploading || clearing}
              onClick={() => void handleClear()}
            >
              <Trash2 className="size-4" />
              {clearing ? "Removing…" : "Use default"}
            </Button>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Accepted format</Label>
          <p className="text-xs text-muted-foreground">MP3 only · up to 2 MB</p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
