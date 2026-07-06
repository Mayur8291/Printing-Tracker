import * as React from "react";
import { Button as RadixButton } from "@radix-ui/themes";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Tailwind classes for calendar nav + legacy classNames API (react-day-picker). */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        success:
          "border border-emerald-600/50 bg-background text-emerald-700 shadow-sm hover:bg-emerald-600/10 dark:border-emerald-500/60 dark:text-emerald-400 dark:hover:bg-emerald-500/10",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

const SHADCN_TO_RADIX = {
  default: { variant: "solid", color: "gray", highContrast: true },
  destructive: { variant: "solid", color: "red" },
  success: { variant: "outline", color: "green" },
  outline: { variant: "outline", color: "gray" },
  secondary: { variant: "soft", color: "gray" },
  ghost: { variant: "ghost", color: "gray" },
  link: { variant: "ghost", color: "gray" }
};

const SHADCN_SIZE_TO_RADIX = {
  default: "2",
  sm: "1",
  lg: "3",
  icon: "2"
};

const Button = React.forwardRef(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const mapped = SHADCN_TO_RADIX[variant] ?? SHADCN_TO_RADIX.default;
    const radixSize = SHADCN_SIZE_TO_RADIX[size] ?? "2";

    return (
      <RadixButton
        ref={ref}
        asChild={asChild}
        variant={mapped.variant}
        color={mapped.color}
        highContrast={mapped.highContrast}
        size={radixSize}
        className={cn(
          variant === "success" &&
            "border border-emerald-600/50 bg-background text-emerald-700 shadow-sm hover:bg-emerald-600/10 dark:border-emerald-500/60 dark:text-emerald-400 dark:hover:bg-emerald-500/10",
          variant === "link" && "h-auto min-h-0 px-0 font-normal text-primary underline-offset-4 hover:underline",
          size === "icon" && "h-9 w-9 min-w-9 p-0",
          size === "sm" && "text-xs",
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
