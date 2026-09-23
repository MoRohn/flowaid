import { forwardRef, useEffect, useId, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CircleX, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLatestRef } from "@/lib/useLatestRef";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { FieldError, FieldRow } from "@/primitives/Field";
import { IconButton } from "@/primitives/IconButton";
import { Input } from "@/primitives/Input";
import { NumberInput } from "@/primitives/NumberInput";
import { Select, SelectItem } from "@/primitives/Select";
import { Switch } from "@/primitives/Switch";
import { Textarea } from "@/primitives/Textarea";
import { useControllableState } from "@/primitives/useControllableState";
import { ConsequenceBadge, ContractRefChip } from "./badges";
import { escapeKeys, issuesAt, menuSize, validateContract, type ContractIssue } from "./contract";
import { RoutingPolicyEditor } from "./RoutingPolicyEditor";
import type {
  ActionKind,
  ConsequenceClass,
  EscapeKind,
  JevContractBody,
  JevDataClass,
  JevOutcomeSpec,
  JevPacketFieldSpec,
  LatencyClass,
  PacketRole,
} from "./types";
import { CONSEQUENCE_ORDER, DATA_CLASS_ORDER, JEV_LIMITS } from "./vocabulary";

const ESCAPES: readonly EscapeKind[] = ["none", "other", "stop", "review", "escalate"];
const ROLES: readonly PacketRole[] = [
  "goal",
  "fact",
  "artifact",
  "evidence",
  "constraint",
  "option",
];
const LATENCY: readonly LatencyClass[] = ["interactive", "standard", "batch"];
const ACTION_KINDS: readonly ActionKind[] = [
  "internal_routing",
  "select_model",
  "select_worker",
  "retrieval_filter",
  "annotate",
  "tool_call",
  "external_message",
  "publish",
  "purchase",
  "delete",
  "permission_change",
  "data_write",
  "money_movement",
  "represent_user",
];
const INHERIT = "inherit";
const NO_FALLBACK = "__human__";
const NOT_ESCAPE = "__outcome__";

export interface DecisionContractEditorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  value?: JevContractBody;
  defaultValue: JevContractBody;
  onChange?: (next: JevContractBody) => void;
  /** Called with the current issues whenever they change. */
  onValidate?: (issues: ContractIssue[]) => void;
  readOnly?: boolean;
  /** The key is fixed once version 1 exists; allow editing it for a new contract. */
  keyEditable?: boolean;
}

function pick<T extends string>(options: readonly T[], v: string): T | undefined {
  return options.find((o) => o === v);
}

/** Renames/updates one entry of a record while keeping insertion order. */
function replaceEntry<V>(
  record: Record<string, V>,
  oldKey: string,
  newKey: string,
  value: V,
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === oldKey) out[newKey] = value;
    else if (k !== newKey) out[k] = v;
  }
  return out;
}

function withoutEntry<V>(record: Record<string, V>, key: string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(record)) if (k !== key) out[k] = v;
  return out;
}

function freeKey(record: Record<string, unknown>, base: string): string {
  if (!(base in record)) return base;
  let i = 2;
  while (`${base}_${i}` in record) i += 1;
  return `${base}_${i}`;
}

function Section({
  title,
  description,
  meta,
  children,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-sm font-semibold tracking-tight text-ink">{title}</h3>
          {description ? <p className="m-0 max-w-2xl text-xs text-ink-3">{description}</p> : null}
        </div>
        {meta}
      </header>
      {children}
    </section>
  );
}

/** Error and warning lines for one path (errors are announced). */
function Issues({
  issues,
  path,
  exact = true,
}: {
  issues: readonly ContractIssue[];
  path: string;
  exact?: boolean;
}) {
  const list = exact ? issues.filter((i) => i.path === path) : issuesAt(issues, path);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {list.map((i, n) =>
        i.severity === "error" ? (
          <FieldError key={n}>{i.message}</FieldError>
        ) : (
          <p key={n} className="m-0 flex items-start gap-1 text-xs leading-normal text-warn">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span>
              {i.message} <span className="font-mono text-2xs text-ink-4">{i.code}</span>
            </span>
          </p>
        ),
      )}
    </div>
  );
}

function firstError(issues: readonly ContractIssue[], path: string): string | undefined {
  return issues.find((i) => i.path === path && i.severity === "error")?.message;
}

/**
 * Editor for a decision contract draft (JEV_ENGINEERING.md §4.2, UI addendum
 * §17 `ContractEditor`): identity, question and outcomes/rubric with escape
 * hatches, fallback, state spec, confidence × consequence routing, allowed
 * action, escalation and model. Validation runs on every change with the
 * limits of the live Jev API (≤ 255 choice options, 2–10 score levels, 32k
 * state + question) and the contract lints; messages sit next to the field
 * and in the summary at the top.
 */
export const DecisionContractEditor = forwardRef<HTMLDivElement, DecisionContractEditorProps>(
  function DecisionContractEditor(
    {
      value,
      defaultValue,
      onChange,
      onValidate,
      readOnly = false,
      keyEditable = false,
      className,
      ...rest
    },
    ref,
  ) {
    const id = useId();
    const [body, setBody] = useControllableState<JevContractBody>(value, defaultValue, onChange);
    const issues = useMemo(() => validateContract(body), [body]);
    const onValidateRef = useLatestRef(onValidate);
    useEffect(() => {
      onValidateRef.current?.(issues);
    }, [issues, onValidateRef]);

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    const q = body.question;
    const set = (patch: Partial<JevContractBody>) => setBody({ ...body, ...patch });

    const outcomeRows = (
      record: Record<string, JevOutcomeSpec>,
      base: string,
      onRecord: (next: Record<string, JevOutcomeSpec>) => void,
      escapeOnly: boolean,
    ) => (
      <ul
        className="m-0 flex list-none flex-col gap-3 p-0"
        aria-label={escapeOnly ? "Escape outcomes" : "Outcomes"}
      >
        {Object.entries(record).map(([key, spec], index) => {
          const path = `${base}/${key}`;
          return (
            <li
              key={`${index}`}
              className="grid gap-2 rounded-sm border border-border bg-surface-2 p-3 md:grid-cols-[180px_1fr]"
            >
              <div className="flex flex-col gap-2">
                <Input
                  mono
                  size="sm"
                  aria-label={`Outcome key ${index + 1}`}
                  value={key}
                  readOnly={readOnly}
                  invalid={Boolean(firstError(issues, path))}
                  onChange={(e) => {
                    const next = e.target.value.trim();
                    if (next !== key && next in record) return;
                    onRecord(replaceEntry(record, key, next, spec));
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    size="sm"
                    aria-label={`Escape kind of ${key}`}
                    value={spec.escape ?? NOT_ESCAPE}
                    disabled={readOnly}
                    onValueChange={(v) => {
                      const next: JevOutcomeSpec = { ...spec };
                      const kind = pick(ESCAPES, v);
                      if (kind) next.escape = kind;
                      else if (!escapeOnly) delete next.escape;
                      onRecord(replaceEntry(record, key, key, next));
                    }}
                  >
                    {escapeOnly ? null : <SelectItem value={NOT_ESCAPE}>Outcome</SelectItem>}
                    {ESCAPES.map((k) => (
                      <SelectItem key={k} value={k}>
                        Escape: {k}
                      </SelectItem>
                    ))}
                  </Select>
                  <Select
                    size="sm"
                    aria-label={`Consequence of ${key}`}
                    value={spec.consequenceClass ?? INHERIT}
                    disabled={readOnly}
                    onValueChange={(v) => {
                      const next: JevOutcomeSpec = { ...spec };
                      const cc = pick(CONSEQUENCE_ORDER, v);
                      if (cc) next.consequenceClass = cc;
                      else delete next.consequenceClass;
                      onRecord(replaceEntry(record, key, key, next));
                    }}
                  >
                    <SelectItem value={INHERIT}>Contract class</SelectItem>
                    {CONSEQUENCE_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-2xs text-ink-3">
                  <Switch
                    size="sm"
                    checked={spec.automatable}
                    disabled={readOnly}
                    aria-label={`${key} automatable`}
                    onCheckedChange={(on) =>
                      onRecord(replaceEntry(record, key, key, { ...spec, automatable: on }))
                    }
                  />
                  automatable
                </label>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <Textarea
                    autoGrow
                    minRows={2}
                    maxRows={6}
                    aria-label={`Description of ${key}`}
                    placeholder="Evidence conditions under which this outcome is the correct branch."
                    value={spec.description}
                    readOnly={readOnly}
                    invalid={Boolean(firstError(issues, `${path}/description`))}
                    onChange={(e) =>
                      onRecord(
                        replaceEntry(record, key, key, { ...spec, description: e.target.value }),
                      )
                    }
                  />
                  {readOnly ? null : (
                    <IconButton
                      size="sm"
                      label={`Remove ${key}`}
                      onClick={() => onRecord(withoutEntry(record, key))}
                    >
                      <Trash2 />
                    </IconButton>
                  )}
                </div>
                <Issues issues={issues} path={path} />
                <Issues issues={issues} path={`${path}/description`} />
              </div>
            </li>
          );
        })}
      </ul>
    );

    const setField = (name: string, next: JevPacketFieldSpec) =>
      set({ state: { ...body.state, fields: replaceEntry(body.state.fields, name, name, next) } });

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-5", className)} {...rest}>
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex flex-col gap-2 rounded-md border px-3 py-2.5",
            errors.length > 0
              ? "border-danger bg-danger-soft"
              : warnings.length > 0
                ? "border-warn bg-warn-soft"
                : "border-border bg-surface-2",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ContractRefChip contract={body} />
            <ConsequenceBadge value={body.routing.consequenceClass} verbose />
            <span className="ml-auto flex items-center gap-3 text-xs">
              <span className={errors.length > 0 ? "text-danger" : "text-ink-3"}>
                {errors.length} error{errors.length === 1 ? "" : "s"}
              </span>
              <span className={warnings.length > 0 ? "text-warn" : "text-ink-3"}>
                {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              </span>
            </span>
          </div>
          {issues.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Contract issues">
              {issues.map((i, n) => (
                <li key={n} className="flex items-start gap-1.5 text-xs text-ink">
                  {i.severity === "error" ? (
                    <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden="true" />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-warn"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="font-mono text-2xs text-ink-3">{i.code}</span>{" "}
                    <span className="font-mono text-2xs text-ink-4">{i.path}</span> {i.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-xs text-ok">Contract is lint clean.</p>
          )}
        </div>

        <Section
          title="Contract"
          description="Reviewable without reading the application: what branch it controls, who owns it, and what changed."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <FieldRow label="Title" required error={firstError(issues, "/title")}>
              <Input
                value={body.title}
                readOnly={readOnly}
                onChange={(e) => set({ title: e.target.value })}
              />
            </FieldRow>
            <FieldRow
              label="Key"
              hint={`Version ${body.version}; each semantic change is a new version.`}
              error={firstError(issues, "/key")}
            >
              <Input
                mono
                value={body.key}
                readOnly={readOnly || !keyEditable}
                onChange={(e) => set({ key: e.target.value })}
              />
            </FieldRow>
            <FieldRow label="Owner" required error={firstError(issues, "/owner")}>
              <Input
                value={body.owner}
                readOnly={readOnly}
                onChange={(e) => set({ owner: e.target.value })}
              />
            </FieldRow>
            <FieldRow
              label="Purpose"
              required
              error={firstError(issues, "/purpose")}
              className="md:col-span-2"
            >
              <Textarea
                autoGrow
                minRows={2}
                value={body.purpose}
                readOnly={readOnly}
                onChange={(e) => set({ purpose: e.target.value })}
              />
            </FieldRow>
            {body.version > 1 ? (
              <FieldRow
                label="Changelog"
                required
                hint="A shorter prompt is not automatically safer: explain every behaviour change."
                error={firstError(issues, "/changelog")}
                className="md:col-span-2"
              >
                <Textarea
                  autoGrow
                  minRows={2}
                  value={body.changelog}
                  readOnly={readOnly}
                  onChange={(e) => set({ changelog: e.target.value })}
                />
              </FieldRow>
            ) : null}
          </div>
        </Section>

        <Section
          title="Question"
          description="Identifiers are not instructions: write the operational definition the model will judge against."
          meta={
            <Badge tone="accent" mono>
              {q.kind === "boolean" ? "noul" : q.kind}
              {q.kind === "choice" ? ` · ${q.menu.source}` : ""}
            </Badge>
          }
        >
          <FieldRow label="Instructions" required>
            <Textarea
              autoGrow
              minRows={3}
              value={q.instructions}
              readOnly={readOnly}
              invalid={Boolean(firstError(issues, "/question/instructions"))}
              onChange={(e) => set({ question: { ...q, instructions: e.target.value } })}
            />
          </FieldRow>
          <Issues issues={issues} path="/question/instructions" />

          {q.kind === "choice" && q.menu.source === "static" ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-2xs text-ink-3 tabular">
                  {menuSize(q)} / {JEV_LIMITS.maxChoiceOptions} options · {escapeKeys(q).length}{" "}
                  escape
                  {escapeKeys(q).length === 1 ? "" : "s"}
                </span>
                {readOnly ? null : (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (q.menu.source !== "static") return;
                        const key = freeKey(q.menu.outcomes, "outcome");
                        set({
                          question: {
                            ...q,
                            menu: {
                              ...q.menu,
                              outcomes: {
                                ...q.menu.outcomes,
                                [key]: { description: "", automatable: true },
                              },
                            },
                          },
                        });
                      }}
                    >
                      <Plus /> Outcome
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (q.menu.source !== "static") return;
                        const key = freeKey(q.menu.outcomes, "none");
                        set({
                          question: {
                            ...q,
                            menu: {
                              ...q.menu,
                              outcomes: {
                                ...q.menu.outcomes,
                                [key]: { description: "", escape: "none", automatable: true },
                              },
                            },
                          },
                        });
                      }}
                    >
                      <Plus /> Escape hatch
                    </Button>
                  </div>
                )}
              </div>
              <Issues issues={issues} path="/question/menu/outcomes" />
              {outcomeRows(
                q.menu.outcomes,
                "/question/menu/outcomes",
                (outcomes) => {
                  if (q.menu.source === "static")
                    set({ question: { ...q, menu: { ...q.menu, outcomes } } });
                },
                false,
              )}
            </>
          ) : null}

          {q.kind === "choice" && q.menu.source === "dynamic" ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <FieldRow
                  label="Max live options"
                  hint={`+ escapes ≤ ${JEV_LIMITS.maxChoiceOptions}`}
                  error={firstError(issues, "/question/menu/maxOptions")}
                >
                  <NumberInput
                    value={q.menu.maxOptions}
                    min={1}
                    max={254}
                    step={1}
                    precision={0}
                    readOnly={readOnly}
                    onValueChange={(v) => {
                      if (v !== null && q.menu.source === "dynamic")
                        set({ question: { ...q, menu: { ...q.menu, maxOptions: v } } });
                    }}
                  />
                </FieldRow>
                <FieldRow label="Option keys" hint="Candidate ids never reach the model as keys.">
                  <Select
                    value={q.menu.keyStrategy}
                    disabled={readOnly}
                    onValueChange={(v) => {
                      const ks = pick(["ordinal", "slug"] as const, v);
                      if (ks && q.menu.source === "dynamic")
                        set({ question: { ...q, menu: { ...q.menu, keyStrategy: ks } } });
                    }}
                  >
                    <SelectItem value="ordinal">Ordinal (o1…oN)</SelectItem>
                    <SelectItem value="slug">Slug</SelectItem>
                  </Select>
                </FieldRow>
                <FieldRow
                  label="Stale after"
                  hint="Older option sets route improve (rebuild)."
                  error={firstError(issues, "/question/menu/maxAgeMs")}
                >
                  <NumberInput
                    value={q.menu.maxAgeMs}
                    min={1}
                    step={1000}
                    precision={0}
                    unit="ms"
                    readOnly={readOnly}
                    onValueChange={(v) => {
                      if (v !== null && q.menu.source === "dynamic")
                        set({ question: { ...q, menu: { ...q.menu, maxAgeMs: v } } });
                    }}
                  />
                </FieldRow>
              </div>
              <Issues issues={issues} path="/question/menu/escapes" />
              {outcomeRows(
                q.menu.escapes,
                "/question/menu/escapes",
                (escapes) => {
                  if (q.menu.source !== "dynamic") return;
                  const typed: Record<string, JevOutcomeSpec & { escape: EscapeKind }> = {};
                  for (const [k, spec] of Object.entries(escapes))
                    typed[k] = { ...spec, escape: spec.escape ?? "review" };
                  set({ question: { ...q, menu: { ...q.menu, escapes: typed } } });
                },
                true,
              )}
              {readOnly ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => {
                    if (q.menu.source !== "dynamic") return;
                    const key = freeKey(q.menu.escapes, "review");
                    set({
                      question: {
                        ...q,
                        menu: {
                          ...q.menu,
                          escapes: {
                            ...q.menu.escapes,
                            [key]: { description: "", escape: "review", automatable: false },
                          },
                        },
                      },
                    });
                  }}
                >
                  <Plus /> Escape hatch
                </Button>
              )}
            </>
          ) : null}

          {q.kind === "score" ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-2xs text-ink-3 tabular">
                {q.levels.length} levels · TypeSafe takes 2–10 ordered verbal anchors; prefer 3–5
              </span>
              <Issues issues={issues} path="/question/levels" />
              <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Levels">
                {q.levels.map((level, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right font-mono text-2xs text-ink-4">
                        {i}
                      </span>
                      <Input
                        size="sm"
                        aria-label={`Level ${i}`}
                        value={level}
                        readOnly={readOnly}
                        onChange={(e) =>
                          set({
                            question: {
                              ...q,
                              levels: q.levels.map((l, j) => (j === i ? e.target.value : l)),
                            },
                          })
                        }
                      />
                      {readOnly ? null : (
                        <IconButton
                          size="sm"
                          label={`Remove level ${i}`}
                          onClick={() =>
                            set({ question: { ...q, levels: q.levels.filter((_, j) => j !== i) } })
                          }
                        >
                          <Trash2 />
                        </IconButton>
                      )}
                    </div>
                    <Issues issues={issues} path={`/question/levels/${i}`} />
                  </li>
                ))}
              </ol>
              {readOnly ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => set({ question: { ...q, levels: [...q.levels, ""] } })}
                >
                  <Plus /> Level
                </Button>
              )}
              {q.bands ? (
                <div className="flex flex-col gap-1">
                  <Issues issues={issues} path="/question/bands" exact={false} />
                  <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Bands">
                    {q.bands.map((b) => (
                      <li key={b.port}>
                        <Badge tone="outline" mono>
                          {b.port} {b.minLevel}–{b.maxLevel}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {q.kind === "boolean" ? (
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px]">
              <FieldRow
                label="Yes means"
                required
                error={firstError(issues, "/question/outcomes/true/description")}
              >
                <Textarea
                  autoGrow
                  minRows={2}
                  value={q.outcomes.true.description}
                  readOnly={readOnly}
                  onChange={(e) =>
                    set({
                      question: {
                        ...q,
                        outcomes: {
                          ...q.outcomes,
                          true: { ...q.outcomes.true, description: e.target.value },
                        },
                      },
                    })
                  }
                />
              </FieldRow>
              <FieldRow
                label="No means"
                required
                error={firstError(issues, "/question/outcomes/false/description")}
              >
                <Textarea
                  autoGrow
                  minRows={2}
                  value={q.outcomes.false.description}
                  readOnly={readOnly}
                  onChange={(e) =>
                    set({
                      question: {
                        ...q,
                        outcomes: {
                          ...q.outcomes,
                          false: { ...q.outcomes.false, description: e.target.value },
                        },
                      },
                    })
                  }
                />
              </FieldRow>
              <FieldRow
                label="Yes at"
                hint="P(yes) band"
                error={firstError(issues, "/question/yesAt")}
              >
                <NumberInput
                  value={q.yesAt}
                  min={0}
                  max={1}
                  step={0.01}
                  precision={2}
                  readOnly={readOnly}
                  onValueChange={(v) => {
                    if (v !== null) set({ question: { ...q, yesAt: v } });
                  }}
                />
              </FieldRow>
            </div>
          ) : null}

          {q.kind === "choice" ? (
            <FieldRow
              label="Fallback outcome"
              hint="Used when evaluation cannot run (hops exhausted, over budget, stale menu). Must be an escape."
              error={firstError(issues, "/fallbackOutcome")}
            >
              <Select
                value={body.fallbackOutcome ?? NO_FALLBACK}
                disabled={readOnly}
                onValueChange={(v) => set({ fallbackOutcome: v === NO_FALLBACK ? null : v })}
              >
                <SelectItem value={NO_FALLBACK}>Human review</SelectItem>
                {escapeKeys(q).map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
          ) : null}
        </Section>

        <Section
          title="State"
          description="Least privilege: Jev sees only these declared fields, as a compact packet with evidence instead of conclusions."
          meta={
            <span className="font-mono text-2xs text-ink-3 tabular">
              {Object.keys(body.state.fields).length} fields
            </span>
          }
        >
          <Issues issues={issues} path="/state" />
          <Issues issues={issues} path="/state/fields" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr className="text-left text-2xs text-ink-3">
                  <th className="py-1 pr-2 font-medium">Field</th>
                  <th className="py-1 pr-2 font-medium">Role</th>
                  <th className="py-1 pr-2 font-medium">Data class</th>
                  <th className="py-1 pr-2 font-medium">Required</th>
                  <th className="py-1 font-medium">Why it is present</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(body.state.fields).map(([name, f]) => (
                  <tr key={name} className="border-t border-border align-top">
                    <td className="py-2 pr-2 font-mono text-ink">{name}</td>
                    <td className="py-2 pr-2">
                      <Select
                        size="sm"
                        aria-label={`${name} role`}
                        value={f.role}
                        disabled={readOnly}
                        onValueChange={(v) => {
                          const role = pick(ROLES, v);
                          if (role) setField(name, { ...f, role });
                        }}
                      >
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Select
                        size="sm"
                        aria-label={`${name} data class`}
                        value={f.dataClass}
                        disabled={readOnly}
                        onValueChange={(v) => {
                          const dc = pick(DATA_CLASS_ORDER, v);
                          if (dc) setField(name, { ...f, dataClass: dc });
                        }}
                      >
                        {DATA_CLASS_ORDER.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Switch
                        size="sm"
                        aria-label={`${name} required`}
                        checked={f.required}
                        disabled={readOnly}
                        onCheckedChange={(on) => setField(name, { ...f, required: on })}
                      />
                    </td>
                    <td className="py-2">
                      <Input
                        size="sm"
                        aria-label={`Why ${name} is present`}
                        value={f.description}
                        readOnly={readOnly}
                        invalid={Boolean(firstError(issues, `/state/fields/${name}/description`))}
                        onChange={(e) => setField(name, { ...f, description: e.target.value })}
                      />
                      <Issues issues={issues} path={`/state/fields/${name}/description`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <FieldRow
              label="Token budget"
              hint={`≤ ${JEV_LIMITS.maxPacketTokens.toLocaleString("en")} (32k state + longest question)`}
              error={firstError(issues, "/state/maxTokens")}
            >
              <NumberInput
                value={body.state.maxTokens}
                min={JEV_LIMITS.minPacketTokens}
                max={JEV_LIMITS.maxPacketTokens}
                step={500}
                precision={0}
                unit="tok"
                readOnly={readOnly}
                onValueChange={(v) => {
                  if (v !== null) set({ state: { ...body.state, maxTokens: v } });
                }}
              />
            </FieldRow>
            <FieldRow
              label="Privacy class"
              hint="Highest data class the packet may carry; also its batching class."
            >
              <Select
                value={body.state.privacyClass}
                disabled={readOnly}
                onValueChange={(v) => {
                  const dc = pick<JevDataClass>(DATA_CLASS_ORDER, v);
                  if (dc) set({ state: { ...body.state, privacyClass: dc } });
                }}
              >
                {DATA_CLASS_ORDER.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            <FieldRow label="Latency class" hint="Bundles never mix latency classes.">
              <Select
                value={body.state.latencyClass}
                disabled={readOnly}
                onValueChange={(v) => {
                  const lc = pick(LATENCY, v);
                  if (lc) set({ state: { ...body.state, latencyClass: lc } });
                }}
              >
                {LATENCY.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
          </div>
        </Section>

        <Section
          title="Routing"
          description="Consequence before confidence. Thresholds belong to the consequence class and are governed like production configuration."
          meta={
            <Select
              size="sm"
              aria-label="Contract consequence class"
              className="w-[140px]"
              value={body.routing.consequenceClass}
              disabled={readOnly}
              onValueChange={(v) => {
                const cc = pick<ConsequenceClass>(CONSEQUENCE_ORDER, v);
                if (cc) set({ routing: { ...body.routing, consequenceClass: cc } });
              }}
            >
              {CONSEQUENCE_ORDER.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </Select>
          }
        >
          <Issues issues={issues} path="/routing" exact={false} />
          <RoutingPolicyEditor
            value={body.routing}
            onChange={(routing) => set({ routing })}
            readOnly={readOnly}
          />
          {body.routing.governance ? (
            <p className="m-0 text-xs text-ink-3">
              Governed by <span className="text-ink">{body.routing.governance.owner}</span> on{" "}
              {body.routing.governance.evaluationWindow.labeled.toLocaleString("en")} labeled{" "}
              {body.routing.governance.evaluationWindow.source} decisions
              {body.routing.governance.approvedBy
                ? `, approved by ${body.routing.governance.approvedBy}`
                : ", not yet approved"}
              .
            </p>
          ) : null}
        </Section>

        <Section
          title="Allowed action"
          description="An upper bound on the authority this judgment may lead to — narrower than the judgment. The compiler proves it."
        >
          <div className="flex flex-wrap gap-1" role="group" aria-label="Allowed action kinds">
            {ACTION_KINDS.map((k) => {
              const on = body.allowedAction.kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  disabled={readOnly}
                  onClick={() =>
                    set({
                      allowedAction: {
                        ...body.allowedAction,
                        kinds: on
                          ? body.allowedAction.kinds.filter((x) => x !== k)
                          : [...body.allowedAction.kinds, k],
                      },
                    })
                  }
                  className={cn(
                    "h-6 rounded-xs border px-1.5 font-mono text-2xs transition-colors duration-(--dur-fast)",
                    on
                      ? "border-accent bg-accent-soft text-accent-text"
                      : "border-border bg-surface text-ink-3 hover:text-ink",
                  )}
                >
                  {k}
                </button>
              );
            })}
          </div>
          <Issues issues={issues} path="/allowedAction" exact={false} />
          <div className="grid gap-3 md:grid-cols-3">
            <FieldRow label="Consequence ceiling">
              <Select
                value={body.allowedAction.maxConsequence}
                disabled={readOnly}
                onValueChange={(v) => {
                  const cc = pick<ConsequenceClass>(CONSEQUENCE_ORDER, v);
                  if (cc) set({ allowedAction: { ...body.allowedAction, maxConsequence: cc } });
                }}
              >
                {CONSEQUENCE_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            <FieldRow
              label="Capabilities"
              hint="Tool capabilities an auto route may reach, comma separated."
            >
              <Input
                mono
                value={body.allowedAction.capabilities.join(", ")}
                readOnly={readOnly}
                onChange={(e) =>
                  set({
                    allowedAction: {
                      ...body.allowedAction,
                      capabilities: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </FieldRow>
            <FieldRow label="External side effects" align="center">
              <Switch
                checked={body.allowedAction.externalSideEffects}
                disabled={readOnly}
                onCheckedChange={(on) =>
                  set({ allowedAction: { ...body.allowedAction, externalSideEffects: on } })
                }
              />
            </FieldRow>
          </div>
        </Section>

        <Section
          title="Escalation"
          description="Where uncertain or consequential cases go, with the written rubric reviewers label against."
        >
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <FieldRow
              label="Assignees"
              hint={'User ids, "role:<r>" or "group:<id>"; empty = anyone with runs:approve.'}
            >
              <Input
                mono
                value={body.escalation.assignees.join(", ")}
                readOnly={readOnly}
                onChange={(e) =>
                  set({
                    escalation: {
                      ...body.escalation,
                      assignees: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </FieldRow>
            <FieldRow label="Mode">
              <Select
                value={body.escalation.mode}
                disabled={readOnly}
                onValueChange={(v) => {
                  const mode = pick(["choice", "approval"] as const, v);
                  if (mode) set({ escalation: { ...body.escalation, mode } });
                }}
              >
                <SelectItem value="choice">Reviewer picks the outcome</SelectItem>
                <SelectItem value="approval">Approve or reject</SelectItem>
              </Select>
            </FieldRow>
            <FieldRow
              label="Review rubric"
              className="md:col-span-2"
              error={firstError(issues, "/escalation/rubric")}
            >
              <Textarea
                autoGrow
                minRows={2}
                value={body.escalation.rubric}
                readOnly={readOnly}
                onChange={(e) =>
                  set({ escalation: { ...body.escalation, rubric: e.target.value } })
                }
              />
            </FieldRow>
          </div>
        </Section>

        <Section
          title="Model"
          description="The alias is requested; the resolved version is recorded on every receipt and is a drift source."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <FieldRow label="Primary" htmlFor={`${id}-model`}>
              <Input
                id={`${id}-model`}
                mono
                value={`${body.model.primary.provider}:${body.model.primary.model ?? ""}`}
                readOnly
              />
            </FieldRow>
            <FieldRow label="Calibrated on" hint="Resolved model the calibration was measured on.">
              <Input
                mono
                value={body.model.expectResolved ?? ""}
                placeholder="jev-1.13.0"
                readOnly={readOnly}
                onChange={(e) => {
                  const model = { ...body.model };
                  if (e.target.value) model.expectResolved = e.target.value;
                  else delete model.expectResolved;
                  set({ model });
                }}
              />
            </FieldRow>
          </div>
          <Issues issues={issues} path="/model" exact={false} />
        </Section>
      </div>
    );
  },
);
