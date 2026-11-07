import { useRef } from "react";
import { Camera } from "lucide-react";
import { validateAvatarPhotoFile } from "@/avatarUtils";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/ui/person-avatar";

export function AvatarUploadField({
  name,
  email,
  imageUrl,
  previewUrl,
  onPick,
  onError,
  disabled = false,
  size = "lg",
  hint = "Click to upload photo",
  accept = "image/jpeg,image/png,image/webp,image/gif"
}) {
  const inputRef = useRef(null);
  const displayUrl = previewUrl || imageUrl;

  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const validationError = validateAvatarPhotoFile(file);
    if (validationError) {
      onError?.(validationError);
      return;
    }
    onPick?.(file);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          disabled && "cursor-not-allowed opacity-60"
        )}
        aria-label={hint}
      >
        <PersonAvatar name={name} email={email} imageUrl={displayUrl} size={size} />
        {!disabled ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="size-5 text-white" aria-hidden />
          </span>
        ) : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        tabIndex={-1}
        aria-hidden
        onChange={handleChange}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
