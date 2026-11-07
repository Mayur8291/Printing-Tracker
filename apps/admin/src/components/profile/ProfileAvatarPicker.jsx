import { useRef } from "react";
import { Camera } from "lucide-react";
import { validateAvatarPhotoFile } from "@/avatarUtils";
import {
  PRESET_AVATARS,
  parsePresetAvatarId,
  presetAvatarPublicUrl
} from "@/presetAvatars";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Button } from "@/components/ui/button";

export function resolveProfileAvatarPreview({
  avatarPath,
  selectedPresetId,
  uploadPreviewUrl
}) {
  if (uploadPreviewUrl) return uploadPreviewUrl;
  if (selectedPresetId) return presetAvatarPublicUrl(selectedPresetId);
  const presetFromPath = parsePresetAvatarId(avatarPath);
  if (presetFromPath) return presetAvatarPublicUrl(presetFromPath);
  return "";
}

export default function ProfileAvatarPicker({
  name,
  email,
  avatarPath = "",
  imageUrl = "",
  selectedPresetId = null,
  uploadPreviewUrl = "",
  onPresetSelect,
  onUploadPick,
  onError,
  disabled = false,
  size = "xl",
  showUpload = true
}) {
  const inputRef = useRef(null);
  const presetFromPath = parsePresetAvatarId(avatarPath);
  const activePresetId = selectedPresetId ?? presetFromPath ?? null;
  const displayUrl =
    uploadPreviewUrl ||
    (selectedPresetId ? presetAvatarPublicUrl(selectedPresetId) : "") ||
    imageUrl ||
    (presetFromPath ? presetAvatarPublicUrl(presetFromPath) : "");

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const validationError = validateAvatarPhotoFile(file);
    if (validationError) {
      onError?.(validationError);
      return;
    }
    onUploadPick?.(file);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative shrink-0">
          <PersonAvatar name={name} email={email} imageUrl={displayUrl} size={size} />
          {showUpload && !disabled ? (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "absolute inset-0 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  disabled && "cursor-not-allowed opacity-60"
                )}
                aria-label="Upload profile photo"
              >
                <span className="flex size-full items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity hover:opacity-100">
                  <Camera className="size-5 text-white" aria-hidden />
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp,image/gif"
                tabIndex={-1}
                aria-hidden
                onChange={handleFileChange}
              />
            </>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1 pt-1">
          <p className="text-sm font-medium">Profile photo</p>
          <p className="text-xs text-muted-foreground">
            Pick a character below or upload your own photo (JPEG, PNG, WebP, GIF · max 5 MB).
          </p>
          {showUpload && !disabled ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              Upload photo
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Choose avatar
        </p>
        <div className="max-h-52 overflow-y-auto rounded-lg border bg-muted/20 p-2">
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {PRESET_AVATARS.map((preset) => {
              const selected = activePresetId === preset.id && !uploadPreviewUrl;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={disabled}
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={selected}
                  onClick={() => onPresetSelect?.(preset.id)}
                  className={cn(
                    "aspect-square overflow-hidden rounded-full border-2 bg-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-muted-foreground/40",
                    disabled && "cursor-not-allowed opacity-60"
                  )}
                >
                  <img src={preset.url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
