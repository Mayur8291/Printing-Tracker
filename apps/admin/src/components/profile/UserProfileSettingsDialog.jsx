import { useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import ProfileAvatarSettings from "@/components/profile/ProfileAvatarSettings";
import NotificationToneSettings from "@/components/notifications/NotificationToneSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { profileNotificationTonePublicUrl } from "@/notificationToneUtils";
import { setUserNotificationToneUrl } from "@/notificationTonePlayer";

export default function UserProfileSettingsDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userEmail,
  avatarPath,
  tonePath,
  tonesEnabled = true,
  onAvatarPathChange,
  onTonePathChange
}) {
  const [localTonePath, setLocalTonePath] = useState(tonePath ?? null);

  useEffect(() => {
    setLocalTonePath(tonePath ?? null);
  }, [tonePath, open]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4" />
            Profile settings
          </DialogTitle>
          <DialogDescription>Update your photo and notification sound.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <ProfileAvatarSettings
            userId={userId}
            name={userName}
            email={userEmail}
            avatarPath={avatarPath}
            onUpdated={onAvatarPathChange}
          />
          <NotificationToneSettings
            userId={userId}
            tonePath={localTonePath}
            tonesEnabled={tonesEnabled}
            onUpdated={handleToneUpdated}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
