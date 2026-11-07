// Which Scott API the browser is talking to right now, plus a switcher.
//
// The target lives in localStorage (see `src/scott/scottRuntime.js`). Switching reloads the
// page — every Scott list holds cached upstream rows, and a reload is the only reliable way
// to drop them all at once. This mirrors the original dashboard's behaviour.

import { useSyncExternalStore } from "react";
import { Check, ChevronDown, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  SCOTT_PRODUCTION_BASE_URL,
  SCOTT_STAGING_BASE_URL,
  getEffectiveScottApiBaseUrl,
  getResolvedScottApiTarget,
  setStoredScottApiTarget,
  subscribeScottApiRuntime
} from "@/scott/scottRuntime";

const TARGETS = [
  {
    id: "production",
    label: "Production",
    short: "PROD",
    baseUrl: SCOTT_PRODUCTION_BASE_URL,
    // Hardcoded palette colours, so each needs a dark counterpart.
    tone: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
  },
  {
    id: "staging",
    label: "Staging",
    short: "STG",
    baseUrl: SCOTT_STAGING_BASE_URL,
    tone: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-400"
  }
];

/** Read the live target through React's external-store bridge (updates across tabs too). */
export function useScottApiTarget() {
  return useSyncExternalStore(subscribeScottApiRuntime, getResolvedScottApiTarget, getResolvedScottApiTarget);
}

/**
 * Production / staging indicator for the Scott API, with an optional switcher.
 *
 * @param {object} props
 * @param {boolean} [props.canSwitch=true] when false renders a plain read-only badge.
 * @param {boolean} [props.showBaseUrl=false] append the resolved base URL next to the badge.
 * @param {boolean} [props.confirmBeforeSwitch=true] ask before discarding page state on reload.
 * @param {"sm"|"default"} [props.size="sm"] trigger button size.
 * @param {string} [props.className] extra classes on the wrapper.
 */
export default function ScottEnvBadge({
  canSwitch = true,
  showBaseUrl = false,
  confirmBeforeSwitch = true,
  size = "sm",
  className
}) {
  const target = useScottApiTarget();
  const active = TARGETS.find((t) => t.id === target) || TARGETS[1];
  const baseUrl = getEffectiveScottApiBaseUrl();

  function switchTo(next) {
    if (next === target) return;
    const nextMeta = TARGETS.find((t) => t.id === next);
    if (
      confirmBeforeSwitch &&
      typeof window !== "undefined" &&
      !window.confirm(
        `Switch the Scott API to ${nextMeta?.label ?? next}?\n\n${nextMeta?.baseUrl ?? ""}\n\nThe page reloads and any unsaved changes are lost.`
      )
    ) {
      return;
    }
    setStoredScottApiTarget(next);
    if (typeof window !== "undefined") window.location.reload();
  }

  if (!canSwitch) {
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        <Badge variant="outline" className={cn("font-normal", active.tone)}>
          <Server className="mr-1 size-3" aria-hidden />
          Scott · {active.label}
        </Badge>
        {showBaseUrl ? <span className="font-mono text-xs text-muted-foreground">{baseUrl}</span> : null}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={size}
            className="gap-2"
            aria-label={`Scott API environment: ${active.label}. Click to switch.`}
          >
            <Badge variant="outline" className={cn("font-normal", active.tone)}>
              {active.short}
            </Badge>
            <span className="hidden sm:inline">Scott API</span>
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Scott API target</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {TARGETS.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => switchTo(t.id)} className="gap-2">
              <Check className={cn("size-4 shrink-0", t.id === target ? "opacity-100" : "opacity-0")} aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm">{t.label}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">{t.baseUrl}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Switching reloads the page.
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>

      {showBaseUrl ? <span className="hidden font-mono text-xs text-muted-foreground lg:inline">{baseUrl}</span> : null}
    </span>
  );
}
