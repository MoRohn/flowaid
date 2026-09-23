import { forwardRef, type HTMLAttributes } from "react";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type { ToolCallView } from "@/types";
import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  CopyButton,
} from "@/primitives";
import { TraceJsonBlock } from "./TraceJsonBlock";
import { stringifyCompact } from "./traceFormat";

function sizeLabel(value: unknown): string {
  const bytes = new TextEncoder().encode(
    stringifyCompact(value, Number.POSITIVE_INFINITY).text,
  ).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

/** What the card shows: the folded `ToolCallView` plus the presentation-only target line and idempotency key. */
export interface ToolCallCardView extends Omit<ToolCallView, "error"> {
  /** Idempotency key sent with the call, when the tool supports one. */
  idempotencyKey?: string;
  /** HTTP method + URL or another one-line target description. */
  target?: string;
  error?: { code: string; message: string };
}

export interface ToolCallCardProps extends HTMLAttributes<HTMLDivElement> {
  call: ToolCallCardView;
  /** Open the args block by default. */
  defaultOpenArgs?: boolean;
  /** Open the result block by default. */
  defaultOpenResult?: boolean;
}

/** Badge tone for an HTTP-style status code. */
export function statusCodeTone(code: number | undefined): "neutral" | "ok" | "warn" | "danger" {
  if (code === undefined) return "neutral";
  if (code < 300) return "ok";
  if (code < 500) return "warn";
  return "danger";
}

/**
 * One tool invocation: name, target, duration, status code, then args and
 * result as collapsible mono blocks. The idempotency key, when present, is a
 * mono chip so operators can correlate retries.
 */
export const ToolCallCard = forwardRef<HTMLDivElement, ToolCallCardProps>(function ToolCallCard(
  { call, defaultOpenArgs = true, defaultOpenResult = true, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-border bg-surface shadow-1",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Wrench className="size-4 shrink-0 text-cat-tool" strokeWidth={1.75} aria-hidden="true" />
        <span className="font-mono text-xs font-medium text-ink">{call.name}</span>
        {call.target ? (
          <span className="min-w-0 truncate font-mono text-2xs text-ink-3">{call.target}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {call.durationMs !== undefined ? (
            <span className="font-mono text-2xs text-ink-3 tabular">
              {formatMs(call.durationMs)}
            </span>
          ) : null}
          {call.statusCode !== undefined ? (
            <Badge tone={statusCodeTone(call.statusCode)} mono>
              {call.statusCode}
            </Badge>
          ) : null}
        </span>
      </div>
      {call.idempotencyKey || call.error ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
          {call.idempotencyKey ? (
            <span className="flex min-w-0 items-center gap-1">
              <Badge tone="outline" mono className="max-w-full">
                <span className="text-ink-3">idem</span>
                <span className="truncate">{call.idempotencyKey}</span>
              </Badge>
              <CopyButton value={call.idempotencyKey} label="Copy idempotency key" size="xs" />
            </span>
          ) : null}
          {call.error ? (
            <span className="flex min-w-0 items-center gap-2 text-xs text-danger-text">
              <Badge tone="danger" size="sm" mono>
                {call.error.code}
              </Badge>
              <span className="truncate">{call.error.message}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <CollapsibleRoot defaultOpen={defaultOpenArgs}>
          <CollapsibleTrigger meta={sizeLabel(call.args)}>Arguments</CollapsibleTrigger>
          <CollapsibleContent className="pl-1 pr-1">
            <TraceJsonBlock value={call.args} maxChars={1200} />
          </CollapsibleContent>
        </CollapsibleRoot>
        {call.result !== undefined ? (
          <Collapsible
            title="Result"
            meta={sizeLabel(call.result)}
            defaultOpen={defaultOpenResult}
            contentClassName="pl-1 pr-1"
          >
            <TraceJsonBlock value={call.result} maxChars={1200} />
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
});
