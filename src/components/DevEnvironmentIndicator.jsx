import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getDeployEnvironment } from "../deployEnvironmentUtils";

export default function DevEnvironmentIndicator({ className }) {
  if (!import.meta.env.DEV) return null;

  const env = getDeployEnvironment();

  if (env.isProduction) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex size-2 shrink-0 animate-pulse rounded-full bg-amber-500 shadow-[0_0_6px] shadow-amber-500/80",
              className
            )}
            role="status"
            aria-label="Production database connected"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          Live production database — use <code>npm run dev</code> with staging keys
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex size-2 shrink-0 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/80",
            className
          )}
          role="status"
          aria-label="Staging database connected"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        Staging database ({env.ref}) — safe to test
      </TooltipContent>
    </Tooltip>
  );
}
