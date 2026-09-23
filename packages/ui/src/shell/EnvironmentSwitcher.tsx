import { forwardRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ConfirmDialog, ToggleGroup, ToggleGroupItem } from "@/primitives";
import type { EnvironmentId, EnvironmentView } from "@/types";

/** Conventional abbreviations; any other long name is cut to its first four characters. */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  development: "Dev",
  production: "Prod",
};

/** Short label for a narrow bar: "Production" → "Prod", "Staging" → "Staging", "Development" → "Dev". */
export function environmentShortLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 7) return trimmed;
  return SHORT_LABELS[trimmed.toLowerCase()] ?? trimmed.slice(0, 4).replace(/[-_ ]+$/, "");
}

/** Human label for an environment id from the workspace's list; falls back to the id. */
export function environmentLabel(
  environments: readonly EnvironmentView[],
  id: EnvironmentId,
  short = false,
): string {
  const env = environments.find((e) => e.id === id);
  if (!env) return id;
  return short ? environmentShortLabel(env.name) : env.name;
}

export interface EnvironmentSwitcherProps {
  /** The workspace's environments, in display order. Environments are data (`{ id, name, protected }`), not an enum. */
  environments: readonly EnvironmentView[];
  value: EnvironmentId;
  onChange: (next: EnvironmentId) => void;
  /** Ask before switching to a protected environment (default true). */
  confirmProtected?: boolean;
  /** Extra copy for the confirm, e.g. what runs there today. */
  protectedNotice?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Abbreviated labels ("Dev", "Prod") for narrow bars. */
  short?: boolean;
  className?: string;
  id?: string;
}

/**
 * Segmented environment control over the workspace's environments. Each
 * item carries a dot (ok for protected environments, ink-3 otherwise);
 * choosing a protected environment opens a ConfirmDialog first so a stray
 * click cannot retarget a live workflow.
 */
export const EnvironmentSwitcher = forwardRef<HTMLDivElement, EnvironmentSwitcherProps>(
  function EnvironmentSwitcher(
    {
      environments,
      value,
      onChange,
      confirmProtected = true,
      protectedNotice,
      disabled,
      size = "md",
      short = false,
      className,
      id,
    },
    ref,
  ) {
    const [confirming, setConfirming] = useState<EnvironmentView | null>(null);
    const handle = (next: string) => {
      if (next === "" || next === value) return;
      const env = environments.find((e) => e.id === next);
      if (!env) return;
      if (env.protected && confirmProtected) {
        setConfirming(env);
        return;
      }
      onChange(env.id);
    };
    return (
      <>
        <ToggleGroup
          ref={ref}
          type="single"
          value={value}
          onValueChange={handle}
          aria-label="Environment"
          disabled={disabled}
          size={size}
          className={cn("bg-surface-2 shadow-none", className)}
          id={id}
        >
          {environments.map((env) => (
            <ToggleGroupItem
              key={env.id}
              value={env.id}
              aria-label={env.name}
              data-protected={env.protected || undefined}
              className={cn(
                "gap-1.5",
                env.id === value && "bg-surface shadow-1 data-[state=on]:bg-surface",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  env.protected ? "bg-ok" : "bg-ink-3",
                )}
              />
              {short ? environmentShortLabel(env.name) : env.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title={`Switch to ${confirming?.name ?? "this environment"}?`}
          description={
            protectedNotice ??
            `Runs, credentials and published versions will target the ${confirming?.name ?? "protected"} environment.`
          }
          confirmLabel={`Switch to ${confirming?.name ?? "environment"}`}
          onConfirm={() => {
            const env = confirming;
            setConfirming(null);
            if (env) onChange(env.id);
          }}
        />
      </>
    );
  },
);
