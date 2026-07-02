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

export function PersonAvatar({
  name,
  email,
  imageUrl,
  size = "md",
  className,
  fallbackClassName
}) {
  const initials = personDisplayInitials(name, email);
  const sizeClass = SIZE_CLASS[size] ?? SIZE_CLASS.md;

  return (
    <Avatar className={cn("aspect-square shrink-0", sizeClass, className)}>
      {imageUrl ? <AvatarImage src={imageUrl} alt={name ? `${name} avatar` : "Avatar"} /> : null}
      <AvatarFallback className={cn("bg-muted font-medium text-muted-foreground", fallbackClassName)}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
