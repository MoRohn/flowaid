/**
 * The `cron` widget: a five-field cron expression (minute hour day-of-month month
 * day-of-week) with presets, a plain-language summary and the next runs in the schedule's
 * time zone, computed by croner — the library the worker's scheduler uses, so the preview
 * matches what will actually fire.
 */
import { useMemo } from "react";
import { Cron } from "croner";
import { cn } from "@/lib/cn";
import { Button, Input } from "@/primitives";

export interface CronPreset {
  label: string;
  pattern: string;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: "Every 15 minutes", pattern: "*/15 * * * *" },
  { label: "Hourly", pattern: "0 * * * *" },
  { label: "Daily at 09:00", pattern: "0 9 * * *" },
  { label: "Weekdays at 09:00", pattern: "0 9 * * 1-5" },
  { label: "Mondays at 08:00", pattern: "0 8 * * 1" },
  { label: "Monthly on the 1st", pattern: "0 0 1 * *" },
];

export type CronCheck = { ok: true; next: Date[] } | { ok: false; message: string };

/** Validates a five-field pattern and returns its next `count` runs after `from`. */
export function checkCron(
  pattern: string,
  timezone = "UTC",
  count = 5,
  from: Date = new Date(),
): CronCheck {
  const text = pattern.trim();
  if (text === "") return { ok: false, message: "Enter a cron expression." };
  if (text.split(/\s+/).length !== 5)
    return { ok: false, message: "Use five fields: minute hour day-of-month month day-of-week." };
  try {
    const job = new Cron(text, { timezone, paused: true, mode: "5-part" });
    return { ok: true, next: job.nextRuns(count, from) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message.replace(/^CronPattern: /, "") };
  }
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: string) => n.padStart(2, "0");

/** A short English summary for the common shapes; null when the pattern is unusual. */
export function describeCron(pattern: string): string | null {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const everyDay = dom === "*" && month === "*";
  if (minute === "*" && hour === "*" && everyDay && dow === "*") return "Every minute";
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step && hour === "*" && everyDay && dow === "*") return `Every ${step[1]} minutes`;
  if (/^\d+$/.test(minute) && hour === "*" && everyDay && dow === "*")
    return `Every hour at minute ${minute}`;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  const time = `${pad(hour)}:${pad(minute)}`;
  if (everyDay && dow === "*") return `Every day at ${time}`;
  if (everyDay && dow === "1-5") return `Weekdays at ${time}`;
  if (everyDay && dow === "0,6") return `Weekends at ${time}`;
  if (everyDay && /^[0-6]$/.test(dow)) return `Every ${DAYS[Number(dow)]} at ${time}`;
  if (/^\d+$/.test(dom) && month === "*" && dow === "*")
    return `Day ${dom} of every month at ${time}`;
  return null;
}

export interface CronEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** IANA time zone the schedule runs in (default UTC). */
  timezone?: string;
  /** Runs to preview (default 5). */
  previewCount?: number;
  /** Reference time for the preview (tests pass a fixed date). */
  now?: Date;
  disabled?: boolean;
  invalid?: boolean;
  onBlur?: () => void;
  "aria-label"?: string;
}

export function CronEditor({
  value,
  onChange,
  timezone = "UTC",
  previewCount = 5,
  now,
  disabled,
  invalid,
  onBlur,
  "aria-label": ariaLabel,
}: CronEditorProps) {
  const check = useMemo(
    () => checkCron(value, timezone, previewCount, now),
    [value, timezone, previewCount, now],
  );
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [timezone],
  );
  const summary = check.ok ? describeCron(value) : null;
  const showError = value.trim() !== "" && !check.ok;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-widget="cron">
      <Input
        aria-label={ariaLabel}
        mono
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="0 9 * * 1-5"
        invalid={invalid === true || showError}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Presets">
        {CRON_PRESETS.map((preset) => (
          <Button
            key={preset.pattern}
            size="sm"
            variant={preset.pattern === value.trim() ? "secondary" : "ghost"}
            disabled={disabled}
            aria-pressed={preset.pattern === value.trim()}
            onClick={() => onChange(preset.pattern)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      {showError ? (
        <p className="text-xs text-danger-text" role="alert">
          {check.message}
        </p>
      ) : check.ok ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-ink-2">
            {summary ?? "Custom schedule"} <span className="text-ink-3">· {timezone}</span>
          </p>
          <ol className="flex flex-col gap-0.5" aria-label="Next runs">
            {check.next.map((d) => (
              <li key={d.toISOString()} className={cn("font-mono text-2xs text-ink-3 tabular")}>
                <time dateTime={d.toISOString()}>{format.format(d)}</time>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="font-mono text-2xs text-ink-3">minute hour day-of-month month day-of-week</p>
      )}
    </div>
  );
}
