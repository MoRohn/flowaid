import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Layers, Workflow } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select, SelectItem, ToggleGroup, ToggleGroupItem } from "@/primitives";

export type TimeRangePreset = "1h" | "24h" | "7d" | "30d" | "90d";

export const TIME_RANGE_PRESETS: ReadonlyArray<{ id: TimeRangePreset; label: string; ms: number }> =
  [
    { id: "1h", label: "1h", ms: 3_600_000 },
    { id: "24h", label: "24h", ms: 86_400_000 },
    { id: "7d", label: "7d", ms: 7 * 86_400_000 },
    { id: "30d", label: "30d", ms: 30 * 86_400_000 },
    { id: "90d", label: "90d", ms: 90 * 86_400_000 },
  ];

export type DashboardEnvironment = "development" | "staging" | "production";

export interface DashboardFilterState {
  range: TimeRangePreset;
  /** Undefined means every workflow. */
  workflowId?: string;
  /** Undefined means every environment. */
  environment?: DashboardEnvironment;
}

export interface DashboardFiltersProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: DashboardFilterState;
  onChange: (next: DashboardFilterState) => void;
  workflows?: ReadonlyArray<{ id: string; name: string }>;
  environments?: readonly DashboardEnvironment[];
  presets?: ReadonlyArray<{ id: TimeRangePreset; label: string }>;
  /** Right-aligned slot (a refresh button, an export menu). */
  trailing?: ReactNode;
  disabled?: boolean;
}

const ALL = "__all__";
const ENV_LABEL: Record<DashboardEnvironment, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
};

/**
 * The one filter row above a dashboard: time-range presets first, then the
 * workflow and environment selects. Emits a whole filter object so every
 * chart below re-renders against the same slice.
 */
export const DashboardFilters = forwardRef<HTMLDivElement, DashboardFiltersProps>(
  function DashboardFilters(
    {
      value,
      onChange,
      workflows = [],
      environments = ["development", "staging", "production"],
      presets = TIME_RANGE_PRESETS,
      trailing,
      disabled = false,
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        role="group"
        aria-label="Dashboard filters"
        className={cn("flex flex-wrap items-center gap-2", className)}
        {...rest}
      >
        <ToggleGroup
          type="single"
          value={value.range}
          onValueChange={(v) => {
            const preset = presets.find((p) => p.id === v);
            if (preset) onChange({ ...value, range: preset.id });
          }}
          aria-label="Time range"
          disabled={disabled}
        >
          {presets.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} className="font-mono tabular">
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          value={value.workflowId ?? ALL}
          onValueChange={(v) => onChange({ ...value, workflowId: v === ALL ? undefined : v })}
          aria-label="Workflow"
          leading={<Workflow strokeWidth={1.75} />}
          className="w-52"
          contentWidth="auto"
          disabled={disabled}
        >
          <SelectItem value={ALL}>All workflows</SelectItem>
          {workflows.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </Select>
        <Select
          value={value.environment ?? ALL}
          onValueChange={(v) =>
            onChange({ ...value, environment: environments.find((e) => e === v) })
          }
          aria-label="Environment"
          leading={<Layers strokeWidth={1.75} />}
          className="w-40"
          contentWidth="auto"
          disabled={disabled}
        >
          <SelectItem value={ALL}>All environments</SelectItem>
          {environments.map((e) => (
            <SelectItem key={e} value={e}>
              {ENV_LABEL[e]}
            </SelectItem>
          ))}
        </Select>
        {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
      </div>
    );
  },
);
