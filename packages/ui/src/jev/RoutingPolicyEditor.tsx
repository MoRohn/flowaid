import { forwardRef, useId, type HTMLAttributes } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { Button } from "@/primitives/Button";
import { FieldError } from "@/primitives/Field";
import { IconButton } from "@/primitives/IconButton";
import { Input } from "@/primitives/Input";
import { NumberInput } from "@/primitives/NumberInput";
import { Select, SelectItem } from "@/primitives/Select";
import { Switch } from "@/primitives/Switch";
import { useControllableState } from "@/primitives/useControllableState";
import { BlockTitle, ConsequenceBadge } from "./badges";
import { validateZones } from "./contract";
import {
  ROUTING_CELL_DESCRIPTION,
  ROUTING_CELL_LABEL,
  cellCoverage,
  routingMatrix,
  type RoutingCell,
  type RoutingMatrixRow,
} from "./routing";
import type {
  ConfigurableConsequence,
  ConsequenceClass,
  ImproveActionKind,
  JevRoutingPolicy,
  JevZoneThresholds,
} from "./types";
import { CONSEQUENCE_MEANING, ILLUSTRATIVE_THRESHOLDS, IMPROVE_ACTION_LABEL } from "./vocabulary";

/** Fill, text and border tokens per cell. Routes reuse the gate tones; the consequence lock is danger-soft. */
const CELL_STYLE: Record<RoutingCell, { bg: string; fg: string }> = {
  act: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  verify: { bg: "var(--info-soft)", fg: "var(--info)" },
  escalate: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  human: { bg: "var(--danger-soft)", fg: "var(--danger)" },
};

const CELLS: readonly RoutingCell[] = ["act", "verify", "escalate", "human"];
const IMPROVE_KINDS = Object.keys(IMPROVE_ACTION_LABEL).filter(
  (k): k is ImproveActionKind => k in IMPROVE_ACTION_LABEL,
);
const GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export interface RoutingPolicyEditorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  value?: JevRoutingPolicy;
  defaultValue?: JevRoutingPolicy;
  onChange?: (next: JevRoutingPolicy) => void;
  readOnly?: boolean;
  /** A confidence to mark across every row, e.g. the one a receipt was routed on. */
  probe?: number | null;
  /** Hide the escape-route, improve and provider settings (matrix only). */
  matrixOnly?: boolean;
}

const EMPTY_POLICY: JevRoutingPolicy = {
  consequenceClass: "low",
  thresholds: {},
  escapeRoutes: { none: "human", other: "human", stop: "auto" },
  uncalibratedProviders: "human",
  onModelChange: "continue",
};

function pct(v: number): string {
  return `${(v * 100).toFixed(3)}%`;
}

function segmentText(from: number, to: number, cell: RoutingCell): string {
  if (cell === "human") return "Human at any confidence";
  const range =
    from <= 0
      ? `< ${formatProbability(to)}`
      : to >= 1
        ? `≥ ${formatProbability(from)}`
        : `${formatProbability(from)}–${formatProbability(to)}`;
  return `${ROUTING_CELL_LABEL[cell]} ${range}`;
}

/**
 * Confidence × consequence matrix (JEV_ENGINEERING.md §6): one row per
 * consequence class, each drawn as the confidence axis split into the cells
 * the routing engine would produce — act (auto), verify (improve), escalate
 * (human, low confidence) or human (the class never automates). Consequence
 * comes before confidence: irreversible is locked to human. Classes without
 * their own zones show Table V's illustrative defaults, flagged.
 */
export const RoutingPolicyEditor = forwardRef<HTMLDivElement, RoutingPolicyEditorProps>(
  function RoutingPolicyEditor(
    {
      value,
      defaultValue = EMPTY_POLICY,
      onChange,
      readOnly = false,
      probe = null,
      matrixOnly = false,
      className,
      ...rest
    },
    ref,
  ) {
    const id = useId();
    const [policy, setPolicy] = useControllableState<JevRoutingPolicy>(
      value,
      defaultValue,
      onChange,
    );
    const rows = routingMatrix(policy);

    const setZones = (cc: ConfigurableConsequence, zones: JevZoneThresholds | undefined) => {
      const thresholds = { ...policy.thresholds };
      if (zones) thresholds[cc] = zones;
      else delete thresholds[cc];
      setPolicy({ ...policy, thresholds });
    };

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-5", className)} {...rest}>
        <div className="flex flex-col gap-3">
          <BlockTitle meta={`contract class ${policy.consequenceClass}`}>
            Confidence × consequence
          </BlockTitle>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label="Legend">
            {CELLS.map((c) => (
              <li key={c} className="flex items-center gap-1.5 text-2xs text-ink-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 rounded-[2px] border"
                  style={{ backgroundColor: CELL_STYLE[c].bg, borderColor: CELL_STYLE[c].fg }}
                />
                <span className="font-medium text-ink">{ROUTING_CELL_LABEL[c]}</span>
                <span className="text-ink-3">{ROUTING_CELL_DESCRIPTION[c]}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2" role="table" aria-label="Routing matrix">
            <div role="rowgroup">
              {rows.map((row) => (
                <MatrixRow
                  key={row.consequenceClass}
                  row={row}
                  isDefault={row.consequenceClass === policy.consequenceClass}
                  probe={probe}
                  readOnly={readOnly}
                  idBase={`${id}-${row.consequenceClass}`}
                  onZones={(z) => {
                    if (row.consequenceClass !== "irreversible") setZones(row.consequenceClass, z);
                  }}
                />
              ))}
            </div>
            <div
              aria-hidden="true"
              className="grid grid-cols-[112px_1fr] gap-3 sm:grid-cols-[112px_1fr_292px]"
            >
              <span />
              <div className="relative h-3 font-mono text-2xs text-ink-4 tabular">
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <span
                    key={t}
                    className="absolute top-0"
                    style={{
                      left: pct(t),
                      transform:
                        t === 0 ? "none" : t === 1 ? "translateX(-100%)" : "translateX(-50%)",
                    }}
                  >
                    {t.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {matrixOnly ? null : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <BlockTitle>Escape routes</BlockTitle>
              <p className="m-0 text-xs text-ink-3">
                review and escalate always route human; stop authorises no action, so it may be auto
                at any class.
              </p>
              {(["none", "other"] as const).map((k) => (
                <label
                  key={k}
                  className="grid grid-cols-[96px_1fr] items-center gap-3 text-xs text-ink-2"
                >
                  <span className="font-mono">{k}</span>
                  <Select
                    size="sm"
                    aria-label={`Route of the ${k} escape`}
                    value={policy.escapeRoutes[k]}
                    disabled={readOnly}
                    onValueChange={(v) => {
                      if (v === "improve" || v === "human")
                        setPolicy({ ...policy, escapeRoutes: { ...policy.escapeRoutes, [k]: v } });
                    }}
                  >
                    <SelectItem value="human">Human</SelectItem>
                    <SelectItem value="improve">Improve</SelectItem>
                  </Select>
                </label>
              ))}
              <label className="grid grid-cols-[96px_1fr] items-center gap-3 text-xs text-ink-2">
                <span className="font-mono">stop</span>
                <Select
                  size="sm"
                  aria-label="Route of the stop escape"
                  value={policy.escapeRoutes.stop}
                  disabled={readOnly}
                  onValueChange={(v) => {
                    if (v === "auto" || v === "human")
                      setPolicy({ ...policy, escapeRoutes: { ...policy.escapeRoutes, stop: v } });
                  }}
                >
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="human">Human</SelectItem>
                </Select>
              </label>
              <label className="grid grid-cols-[96px_1fr] items-center gap-3 text-xs text-ink-2">
                <span>Uncalibrated</span>
                <Select
                  size="sm"
                  aria-label="Route of uncalibrated answers"
                  value={policy.uncalibratedProviders}
                  disabled={readOnly}
                  onValueChange={(v) => {
                    if (v === "human" || v === "improve" || v === "allow")
                      setPolicy({ ...policy, uncalibratedProviders: v });
                  }}
                >
                  <SelectItem
                    value="human"
                    description="LLM, rule or fuzzy-mapped answers never automate"
                  >
                    Human
                  </SelectItem>
                  <SelectItem value="improve">Cap at improve</SelectItem>
                  <SelectItem value="allow">Allow (not recommended)</SelectItem>
                </Select>
              </label>
              <label className="grid grid-cols-[96px_1fr] items-center gap-3 text-xs text-ink-2">
                <span>Model change</span>
                <Select
                  size="sm"
                  aria-label="Route when the resolved model changes"
                  value={policy.onModelChange}
                  disabled={readOnly}
                  onValueChange={(v) => {
                    if (v === "continue" || v === "human")
                      setPolicy({ ...policy, onModelChange: v });
                  }}
                >
                  <SelectItem value="continue">Continue</SelectItem>
                  <SelectItem value="human">Human until re-shadowed</SelectItem>
                </Select>
              </label>
            </div>

            <div className="flex flex-col gap-3">
              <BlockTitle meta={policy.improve ? `max ${policy.improve.maxRounds} rounds` : "none"}>
                Improve actions
              </BlockTitle>
              <p className="m-0 text-xs text-ink-3">
                Each round must change the packet, the option set or the contract. Confidence
                without a different next action is decoration.
              </p>
              {policy.improve?.actions.map((a, i) => (
                <div key={i} className="grid grid-cols-[148px_1fr_auto] items-center gap-2">
                  <Select
                    size="sm"
                    aria-label={`Improve action ${i + 1} kind`}
                    value={a.kind}
                    disabled={readOnly}
                    onValueChange={(v) => {
                      const kind = IMPROVE_KINDS.find((k) => k === v);
                      if (!kind || !policy.improve) return;
                      const actions = policy.improve.actions.map((x, j) =>
                        j === i ? { ...x, kind } : x,
                      );
                      setPolicy({ ...policy, improve: { ...policy.improve, actions } });
                    }}
                  >
                    {IMPROVE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {IMPROVE_ACTION_LABEL[k]}
                      </SelectItem>
                    ))}
                  </Select>
                  <Input
                    size="sm"
                    aria-label={`Improve action ${i + 1} description`}
                    value={a.description}
                    readOnly={readOnly}
                    invalid={a.description.trim().length === 0}
                    onChange={(e) => {
                      if (!policy.improve) return;
                      const actions = policy.improve.actions.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      );
                      setPolicy({ ...policy, improve: { ...policy.improve, actions } });
                    }}
                  />
                  <IconButton
                    size="sm"
                    label={`Remove improve action ${i + 1}`}
                    disabled={readOnly}
                    onClick={() => {
                      if (!policy.improve) return;
                      const actions = policy.improve.actions.filter((_, j) => j !== i);
                      const next = { ...policy };
                      if (actions.length === 0) delete next.improve;
                      else next.improve = { ...policy.improve, actions };
                      setPolicy(next);
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    setPolicy({
                      ...policy,
                      improve: {
                        maxRounds: policy.improve?.maxRounds ?? 2,
                        actions: [
                          ...(policy.improve?.actions ?? []),
                          { kind: "collect_evidence", description: "" },
                        ],
                      },
                    })
                  }
                >
                  <Plus /> Add improve action
                </Button>
              )}
              {policy.improve ? (
                <label className="grid grid-cols-[148px_96px] items-center gap-2 text-xs text-ink-2">
                  <span>Rounds per decision</span>
                  <NumberInput
                    size="sm"
                    aria-label="Maximum improve rounds"
                    value={policy.improve.maxRounds}
                    min={1}
                    max={5}
                    step={1}
                    precision={0}
                    readOnly={readOnly}
                    onValueChange={(v) => {
                      if (v !== null && policy.improve)
                        setPolicy({ ...policy, improve: { ...policy.improve, maxRounds: v } });
                    }}
                  />
                </label>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  },
);

function MatrixRow({
  row,
  isDefault,
  probe,
  readOnly,
  idBase,
  onZones,
}: {
  row: RoutingMatrixRow;
  isDefault: boolean;
  probe: number | null;
  readOnly: boolean;
  idBase: string;
  onZones: (z: JevZoneThresholds | undefined) => void;
}) {
  const cc: ConsequenceClass = row.consequenceClass;
  const locked = cc === "irreversible";
  const zones = row.zones;
  const error = zones && !row.illustrative ? validateZones(zones) : null;
  const coverage = cellCoverage(row);
  const summary = row.segments.map((s) => segmentText(s.from, s.to, s.cell)).join("; ");

  return (
    <div
      role="row"
      data-class={cc}
      className={cn(
        "grid items-center gap-3 border-b border-border py-2 last:border-b-0 grid-cols-[112px_1fr] sm:grid-cols-[112px_1fr_292px]",
      )}
    >
      <div role="rowheader" className="flex flex-col items-start gap-1">
        <ConsequenceBadge value={cc} />
        <span className="text-2xs text-ink-4">
          {isDefault
            ? "contract default"
            : locked
              ? "not configurable"
              : row.illustrative
                ? "illustrative"
                : "governed zones"}
        </span>
      </div>
      <div
        role="cell"
        className="relative min-w-0"
        aria-label={`${cc}: ${summary}`}
        data-coverage-act={coverage.act.toFixed(2)}
      >
        <div className="relative flex h-8 w-full overflow-hidden rounded-sm border border-border">
          {row.segments.map((s) => (
            <div
              key={`${s.from}-${s.cell}`}
              data-cell={s.cell}
              className="flex min-w-0 items-center justify-center overflow-hidden border-r border-surface px-1 last:border-r-0"
              style={{
                width: pct(s.to - s.from),
                backgroundColor: CELL_STYLE[s.cell].bg,
                color: CELL_STYLE[s.cell].fg,
              }}
            >
              <span className="truncate font-mono text-2xs font-medium tabular">
                {s.to - s.from >= 0.22
                  ? segmentText(s.from, s.to, s.cell)
                  : s.to - s.from >= 0.08
                    ? ROUTING_CELL_LABEL[s.cell]
                    : ROUTING_CELL_LABEL[s.cell].charAt(0)}
              </span>
            </div>
          ))}
          {GRID.map((g) => (
            <span
              key={g}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-border opacity-50"
              style={{ left: pct(g) }}
            />
          ))}
          {row.illustrative ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--ink) 6%, transparent) 6px 7px)",
              }}
            />
          ) : null}
        </div>
        {probe !== null && Number.isFinite(probe) ? (
          <span
            aria-hidden="true"
            data-probe
            className="pointer-events-none absolute -inset-y-1 w-0.5 rounded-full bg-ink"
            style={{ left: `calc(${pct(Math.min(1, Math.max(0, probe)))} - 1px)` }}
          />
        ) : null}
        {error ? <FieldError className="mt-1">{error}</FieldError> : null}
      </div>
      <div role="cell" className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
        {locked ? (
          <span className="text-xs text-ink-3">{CONSEQUENCE_MEANING.irreversible}</span>
        ) : (
          <ZoneControls
            cc={cc}
            zones={zones}
            illustrative={row.illustrative}
            readOnly={readOnly}
            idBase={idBase}
            invalid={error !== null}
            onZones={onZones}
          />
        )}
      </div>
    </div>
  );
}

function ZoneControls({
  cc,
  zones,
  illustrative,
  readOnly,
  idBase,
  invalid,
  onZones,
}: {
  cc: ConfigurableConsequence;
  zones: JevZoneThresholds | null;
  illustrative: boolean;
  readOnly: boolean;
  idBase: string;
  invalid: boolean;
  onZones: (z: JevZoneThresholds | undefined) => void;
}) {
  const own = !illustrative && zones !== null;
  const current = zones ?? ILLUSTRATIVE_THRESHOLDS[cc];
  const num = (
    label: string,
    v: number | null,
    set: (n: number | null) => void,
    disabled: boolean,
  ) => (
    <NumberInput
      aria-label={`${cc} ${label}`}
      className="w-[72px]"
      size="sm"
      value={v}
      min={0}
      max={1}
      step={0.01}
      precision={2}
      hideStepper
      invalid={invalid}
      disabled={disabled || readOnly}
      onValueChange={set}
    />
  );
  return (
    <>
      <label className="flex items-center gap-1.5 text-2xs text-ink-3" htmlFor={`${idBase}-own`}>
        <Switch
          id={`${idBase}-own`}
          size="sm"
          checked={own}
          disabled={readOnly}
          aria-label={`${cc}: own zones`}
          onCheckedChange={(on) => onZones(on ? { ...current } : undefined)}
        />
        own
      </label>
      <label className="flex items-center gap-1 text-2xs text-ink-3">
        auto
        {num("auto at", current.autoAt, (n) => onZones({ ...current, autoAt: n }), !own)}
      </label>
      <label className="flex items-center gap-1 text-2xs text-ink-3">
        improve
        {num("improve at", current.improveAt, (n) => onZones({ ...current, improveAt: n }), !own)}
      </label>
      <label className="flex items-center gap-1 text-2xs text-ink-3">
        margin
        {num(
          "minimum margin",
          current.minMargin ?? null,
          (n) => {
            const next: JevZoneThresholds = {
              autoAt: current.autoAt,
              improveAt: current.improveAt,
            };
            if (n !== null) next.minMargin = n;
            onZones(next);
          },
          !own,
        )}
      </label>
    </>
  );
}
