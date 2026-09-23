import { forwardRef, type HTMLAttributes } from "react";
import { AlertTriangle, CircleCheck, CircleX } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs, formatPercent } from "@/lib/format";
import { Badge, Tooltip, TooltipProvider } from "@/primitives";

export type ProviderDayStatus = "ok" | "warn" | "danger" | "none";
export type ProviderHealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface ProviderHealthView {
  id: string;
  name: string;
  /** Number of models configured for this provider. */
  modelCount: number;
  status: ProviderHealthStatus;
  /** Availability over the window, 0..1. */
  availability: number;
  /** One entry per day, oldest first (30 for a month). */
  days: readonly ProviderDayStatus[];
  /** Optional per-day availability for the day tooltip, aligned with `days`. */
  dayAvailability?: readonly number[];
  p50Ms: number;
  p95Ms: number;
  /** Error rate, 0..1. */
  errorRate: number;
  rateLimitHits: number;
  lastIncident?: { at: string; summary: string };
  /** Runs locally (Ollama): shows a "local" badge. */
  local?: boolean;
}

export interface ProviderHealthCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  provider: ProviderHealthView;
  /** Day labels aligned with `provider.days`, used in the bar tooltips. */
  dayLabels?: readonly string[];
  onClick?: () => void;
}

const DAY_COLOR: Record<ProviderDayStatus, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  none: "var(--border)",
};

const STATUS: Record<
  ProviderHealthStatus,
  { label: string; tone: "ok" | "warn" | "danger" | "neutral"; Icon: typeof CircleCheck }
> = {
  healthy: { label: "Healthy", tone: "ok", Icon: CircleCheck },
  degraded: { label: "Degraded", tone: "warn", Icon: AlertTriangle },
  down: { label: "Down", tone: "danger", Icon: CircleX },
  unknown: { label: "Unknown", tone: "neutral", Icon: AlertTriangle },
};

/**
 * Provider status card: availability with a 30-day strip of status bars,
 * latency percentiles, error rate and rate-limit hits, and the last incident.
 * Status colours ship with an icon and a label, never colour alone.
 */
export const ProviderHealthCard = forwardRef<HTMLDivElement, ProviderHealthCardProps>(
  function ProviderHealthCard({ provider, dayLabels, onClick, className, ...rest }, ref) {
    const status = STATUS[provider.status];
    const interactive = typeof onClick === "function";
    const availabilityTone =
      provider.availability >= 0.995
        ? "text-ok-text"
        : provider.availability >= 0.98
          ? "text-warn-text"
          : "text-danger-text";

    return (
      <div
        ref={ref}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        data-status={provider.status}
        className={cn(
          "flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-4 text-ink shadow-1",
          "transition-[box-shadow,border-color] duration-(--dur-base) ease-(--ease-out)",
          interactive && "cursor-pointer hover:border-border-strong hover:shadow-2",
          className,
        )}
        {...rest}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight tracking-tight">
              <span className="truncate">{provider.name}</span>
              {provider.local ? (
                <Badge tone="outline" size="sm" mono>
                  local
                </Badge>
              ) : null}
            </span>
            <span className="font-mono text-2xs text-ink-3 tabular">
              {provider.modelCount} {provider.modelCount === 1 ? "model" : "models"}
            </span>
          </div>
          <Badge tone={status.tone} icon={<status.Icon strokeWidth={2} aria-hidden="true" />}>
            {status.label}
          </Badge>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-ink-2">Availability · {provider.days.length}d</span>
            <span className={cn("font-mono text-sm font-medium tabular", availabilityTone)}>
              {formatPercent(provider.availability, provider.availability >= 0.999 ? 2 : 1)}
            </span>
          </div>
          <TooltipProvider delayDuration={100}>
            <div className="flex h-5 gap-px" role="list" aria-label="Daily availability">
              {provider.days.map((d, i) => {
                const dayLabel = dayLabels?.[i] ?? `Day ${i + 1}`;
                const avail = provider.dayAvailability?.[i];
                const text = `${dayLabel}: ${DAY_LABEL[d]}${avail !== undefined ? ` · ${formatPercent(avail, 1)}` : ""}`;
                // The day cell is a button (the tooltip trigger) inside the list item, so
                // each day's detail is keyboard-reachable without a focusable listitem.
                return (
                  <span key={i} role="listitem" className="flex min-w-0 flex-1">
                    <Tooltip content={text}>
                      <button
                        type="button"
                        aria-label={text}
                        className="h-full w-full min-w-0 rounded-[1.5px] outline-none transition-opacity duration-(--dur-fast) hover:opacity-70 focus-visible:shadow-(--focus)"
                        style={{ backgroundColor: DAY_COLOR[d] }}
                      />
                    </Tooltip>
                  </span>
                );
              })}
            </div>
          </TooltipProvider>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <Stat label="P50" value={formatMs(provider.p50Ms)} />
          <Stat label="P95" value={formatMs(provider.p95Ms)} />
          <Stat
            label="Error rate"
            value={formatPercent(provider.errorRate, 2)}
            tone={
              provider.errorRate >= 0.02
                ? "danger"
                : provider.errorRate >= 0.005
                  ? "warn"
                  : undefined
            }
          />
          <Stat
            label="Rate limits"
            value={provider.rateLimitHits.toLocaleString("en")}
            tone={provider.rateLimitHits > 50 ? "warn" : undefined}
          />
        </dl>

        <div className="border-t border-border pt-2 text-2xs text-ink-3">
          {provider.lastIncident ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-mono tabular">{provider.lastIncident.at}</span>
              <span className="truncate text-ink-2">{provider.lastIncident.summary}</span>
            </span>
          ) : (
            <span>No incidents in the last {provider.days.length} days</span>
          )}
        </div>
      </div>
    );
  },
);

const DAY_LABEL: Record<ProviderDayStatus, string> = {
  ok: "Operational",
  warn: "Degraded",
  danger: "Outage",
  none: "No data",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-3">{label}</dt>
      <dd
        className={cn(
          "font-mono tabular",
          tone === "danger" ? "text-danger-text" : tone === "warn" ? "text-warn-text" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
