import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import ProfileAvatarPicker from "@/components/profile/ProfileAvatarPicker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  profileAvatarPublicUrl,
  setProfilePresetAvatar,
  uploadProfileAvatar
} from "@/avatarUtils";
import { parsePresetAvatarId } from "@/presetAvatars";

export default function ProfileAvatarSettings({
  userId,
  name,
  email,
  avatarPath,
  onUpdated
}) {
  const [selectedPresetId, setSelectedPresetId] = useState(() => parsePresetAvatarId(avatarPath));
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setSelectedPresetId(parsePresetAvatarId(avatarPath));
    setUploadFile(null);
    setUploadPreviewUrl("");
    setError("");
    setSuccess("");
  }, [avatarPath, userId]);

  const hasPendingChange = Boolean(uploadFile) || selectedPresetId !== parsePresetAvatarId(avatarPath);

  async function handleSave() {
    if (!userId || !hasPendingChange) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      let nextPath = avatarPath;
      if (uploadFile) {
        nextPath = await uploadProfileAvatar(userId, uploadFile);
      } else if (selectedPresetId) {
        nextPath = await setProfilePresetAvatar(userId, selectedPresetId);
      }
      setUploadFile(null);
      setUploadPreviewUrl("");
      setSuccess("Profile photo updated.");
      onUpdated?.({ avatar_path: nextPath });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="size-4" />
          Profile photo
        </CardTitle>
        <CardDescription>Choose a character avatar or upload your own photo for chat and the sidebar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProfileAvatarPicker
          name={name}
          email={email}
          avatarPath={avatarPath}
          imageUrl={!uploadFile ? profileAvatarPublicUrl(avatarPath) : ""}
          selectedPresetId={selectedPresetId}
          uploadPreviewUrl={uploadPreviewUrl}
          disabled={saving || !userId}
          onPresetSelect={(id) => {
            setError("");
            setSuccess("");
            setUploadFile(null);
            setUploadPreviewUrl("");
            setSelectedPresetId(id);
          }}
          onUploadPick={(file) => {
            setError("");
            setSuccess("");
            setSelectedPresetId(null);
            setUploadFile(file);
            setUploadPreviewUrl(URL.createObjectURL(file));
          }}
          onError={setError}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={!hasPendingChange || saving || !userId} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save photo"}
          </Button>
          {hasPendingChange ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setSelectedPresetId(parsePresetAvatarId(avatarPath));
                setUploadFile(null);
                setUploadPreviewUrl("");
                setError("");
                setSuccess("");
              }}
            >
              Reset
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      </CardContent>
    </Card>
  );
}
