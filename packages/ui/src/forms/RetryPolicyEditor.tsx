import { forwardRef, useId, type HTMLAttributes } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import {
  Checkbox,
  FieldRow,
  NumberInput,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  useControllableState,
  useFieldControl,
} from "@/primitives";

export type RetryBackoff = "fixed" | "exponential";

export interface RetryPolicy {
  /** Total attempts including the first; 1 disables retries. */
  maxAttempts: number;
  initialDelayMs: number;
  backoff: RetryBackoff;
  maxDelayMs: number;
  /** Adds ±25% randomness to each delay. */
  jitter: boolean;
  /** Error codes that trigger a retry; others fail immediately. */
  retryableErrorCodes: string[];
}

export interface RetryErrorCodeOption {
  code: string;
  label: string;
  description?: string;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoff: "exponential",
  maxDelayMs: 10_000,
  jitter: true,
  retryableErrorCodes: ["TIMEOUT", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "NETWORK"],
};

export const DEFAULT_RETRY_ERROR_CODES: RetryErrorCodeOption[] = [
  { code: "TIMEOUT", label: "Timeout", description: "The call exceeded its deadline" },
  { code: "RATE_LIMITED", label: "Rate limited", description: "HTTP 429 or provider throttling" },
  { code: "PROVIDER_UNAVAILABLE", label: "Provider unavailable", description: "HTTP 502/503/504" },
  { code: "NETWORK", label: "Network error", description: "DNS, reset or TLS failures" },
  { code: "HTTP_5XX", label: "Any HTTP 5xx", description: "Other server errors" },
  { code: "PROVIDER_ERROR", label: "Provider error", description: "Malformed or refused response" },
];

/** Delays (ms) before each retry attempt, honouring backoff and the cap. Jitter is not applied. */
export function retrySchedule(policy: RetryPolicy): number[] {
  const retries = Math.max(0, Math.floor(policy.maxAttempts) - 1);
  const out: number[] = [];
  for (let i = 0; i < retries; i += 1) {
    const raw =
      policy.backoff === "exponential" ? policy.initialDelayMs * 2 ** i : policy.initialDelayMs;
    out.push(Math.min(policy.maxDelayMs, raw));
  }
  return out;
}

export interface RetryPolicyEditorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  value?: RetryPolicy;
  defaultValue?: RetryPolicy;
  onChange?: (policy: RetryPolicy) => void;
  /** Error codes offered in the multi-select. */
  errorCodes?: RetryErrorCodeOption[];
  /** The node performs an irreversible action (payment, email, delete): retries are refused for it. */
  irreversible?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}

/**
 * Retry policy editor: attempts, initial delay, backoff, cap, jitter and the
 * retryable error codes, with the resulting delay schedule shown in mono.
 * When the node is flagged irreversible the editor explains that the runtime
 * never retries it, whatever the policy says.
 */
export const RetryPolicyEditor = forwardRef<HTMLDivElement, RetryPolicyEditorProps>(
  function RetryPolicyEditor(
    {
      value,
      defaultValue = DEFAULT_RETRY_POLICY,
      onChange,
      errorCodes = DEFAULT_RETRY_ERROR_CODES,
      irreversible = false,
      disabled,
      invalid,
      id,
      className,
      ...rest
    },
    ref,
  ) {
    const [policy, setPolicy] = useControllableState<RetryPolicy>(value, defaultValue, onChange);
    const field = useFieldControl({ id, disabled, "aria-invalid": invalid });
    const isDisabled = Boolean(field.disabled) || irreversible;
    const baseId = useId();
    const patch = (p: Partial<RetryPolicy>) => setPolicy({ ...policy, ...p });
    const schedule = retrySchedule(policy);
    const retriesOff = policy.maxAttempts <= 1;

    return (
      <div
        ref={ref}
        id={field.id}
        role="group"
        aria-describedby={field["aria-describedby"]}
        className={cn("@container flex min-w-0 flex-col gap-3", className)}
        {...rest}
      >
        {irreversible ? (
          <div className="flex items-start gap-2 rounded-sm border border-warn/40 bg-warn-soft px-2.5 py-2 text-xs text-ink-2">
            <ShieldAlert
              className="mt-0.5 size-4 shrink-0 text-warn-text"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <p>
              <span className="font-medium text-ink">Never retried.</span> This node performs an
              irreversible action, so the runtime fails it on the first error and routes to the
              failure exit. The policy below is kept for when the flag is removed.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 @md:grid-cols-2">
          <FieldRow
            label="Max attempts"
            htmlFor={`${baseId}-attempts`}
            hint={retriesOff ? "1 attempt: retries are off." : undefined}
          >
            <NumberInput
              id={`${baseId}-attempts`}
              min={1}
              max={10}
              step={1}
              value={policy.maxAttempts}
              disabled={isDisabled}
              unit="tries"
              onValueChange={(n) => {
                if (n !== null) patch({ maxAttempts: n });
              }}
            />
          </FieldRow>
          <FieldRow label="Backoff" htmlFor={`${baseId}-backoff`}>
            <ToggleGroup
              id={`${baseId}-backoff`}
              type="single"
              fullWidth
              value={policy.backoff}
              disabled={isDisabled || retriesOff}
              onValueChange={(v) => {
                if (v === "fixed" || v === "exponential") patch({ backoff: v });
              }}
              aria-label="Backoff strategy"
            >
              <ToggleGroupItem value="fixed">Fixed</ToggleGroupItem>
              <ToggleGroupItem value="exponential">Exponential</ToggleGroupItem>
            </ToggleGroup>
          </FieldRow>
          <FieldRow label="Initial delay" htmlFor={`${baseId}-initial`}>
            <NumberInput
              id={`${baseId}-initial`}
              min={0}
              max={600_000}
              step={100}
              value={policy.initialDelayMs}
              disabled={isDisabled || retriesOff}
              unit="ms"
              onValueChange={(n) => {
                if (n !== null) patch({ initialDelayMs: n });
              }}
            />
          </FieldRow>
          <FieldRow label="Max delay" htmlFor={`${baseId}-max`}>
            <NumberInput
              id={`${baseId}-max`}
              min={0}
              max={3_600_000}
              step={1000}
              value={policy.maxDelayMs}
              disabled={isDisabled || retriesOff || policy.backoff === "fixed"}
              unit="ms"
              onValueChange={(n) => {
                if (n !== null) patch({ maxDelayMs: n });
              }}
            />
          </FieldRow>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${baseId}-jitter`} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium text-ink-2">Jitter</span>
            <span className="text-2xs text-ink-3">
              Randomise each delay by ±25% to avoid thundering herds.
            </span>
          </label>
          <Switch
            id={`${baseId}-jitter`}
            checked={policy.jitter}
            disabled={isDisabled || retriesOff}
            onCheckedChange={(checked) => patch({ jitter: checked })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-2">Retry on</span>
          <div
            className="grid gap-x-4 gap-y-1.5 @md:grid-cols-2"
            role="group"
            aria-label="Retryable error codes"
          >
            {errorCodes.map((opt) => {
              const checked = policy.retryableErrorCodes.includes(opt.code);
              return (
                <Checkbox
                  key={opt.code}
                  size="sm"
                  checked={checked}
                  disabled={isDisabled || retriesOff}
                  label={
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-xs">{opt.label}</span>
                      <span className="font-mono text-2xs text-ink-3">{opt.code}</span>
                    </span>
                  }
                  description={opt.description}
                  onCheckedChange={(next) => {
                    const set = new Set(policy.retryableErrorCodes);
                    if (next === true) set.add(opt.code);
                    else set.delete(opt.code);
                    patch({
                      retryableErrorCodes: errorCodes.map((o) => o.code).filter((c) => set.has(c)),
                    });
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 items-start gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-ink-3 tabular">
          <span className="shrink-0 text-ink-3">Schedule</span>
          <span className="min-w-0 flex-1 break-words text-ink-2">
            {irreversible
              ? "fail on first error"
              : schedule.length === 0
                ? "single attempt"
                : ["try", ...schedule.map((d) => `wait ${formatMs(d)}`)].join(" → ")}
          </span>
          {!irreversible && policy.jitter && schedule.length > 0 ? (
            <span className="shrink-0 text-ink-3">±25%</span>
          ) : null}
        </div>
      </div>
    );
  },
);
