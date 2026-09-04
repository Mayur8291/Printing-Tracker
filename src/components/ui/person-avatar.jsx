import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { personDisplayInitials } from "@/avatarUtils";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-base",
  xl: "size-24 text-xl"
};

const DOT_SIZE = {
  xs: "size-1.5",
  sm: "size-2",
  md: "size-2.5",
  lg: "size-3.5",
  xl: "size-5"
};

const PRESENCE_DOT = {
  online: "bg-presence-online",
  away: "bg-presence-away",
  offline: "bg-presence-offline"
};

export function PersonAvatar({
  name,
  email,
  imageUrl,
  size = "md",
  className,
  fallbackClassName,
  presence
}) {
  const initials = personDisplayInitials(name, email);
  const sizeClass = SIZE_CLASS[size] ?? SIZE_CLASS.md;
  const status = PRESENCE_DOT[presence] ? presence : null;

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar className={cn("aspect-square", sizeClass)}>
        {imageUrl ? <AvatarImage src={imageUrl} alt={name ? `${name} avatar` : "Avatar"} /> : null}
        <AvatarFallback className={cn("bg-muted font-medium text-muted-foreground", fallbackClassName)}>
          {initials}
        </AvatarFallback>
      </Avatar>
      {status ? (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-2 ring-background",
            DOT_SIZE[size] ?? DOT_SIZE.md,
            PRESENCE_DOT[status]
          )}
          aria-label={status}
        />
      ) : null}
    </span>
  );
}
