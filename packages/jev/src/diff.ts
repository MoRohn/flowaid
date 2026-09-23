/**
 * Semantic diff between two contract versions (JEV_ENGINEERING.md §4.6 step 2, handbook §III.C–D):
 * *"A semantic edit can alter production behavior even when no application code changes."*
 * Every change a reviewer must explain is listed, including instruction shortening
 * (*"A shorter prompt is not automatically a safer or more maintainable contract"*).
 */
import { deepEqual } from "@flowaid/shared";
import {
  escapeOutcomes,
  interfaceHash,
  labelOf,
  type AllowedAction,
  type ContractModel,
  type DecisionContractBody,
  type ZoneThresholds,
} from "./contract.js";
import type { ConsequenceClass } from "./wire.js";

/** Before/after of a changed value. */
export interface Change<T> {
  before: T;
  after: T;
}

/** The semantic diff of two versions of one contract. */
export interface ContractDiff {
  from: string;
  to: string;
  /** The compiled wiring changes (ports, escapes, levels, bands, menu source, state fields). */
  interfaceChanged: boolean;
  kindChanged: Change<string> | null;
  instructions: (Change<string> & { shortened: boolean }) | null;
  outcomes: {
    added: string[];
    removed: string[];
    descriptionChanged: string[];
    traitsChanged: string[];
  };
  escapes: { added: string[]; removed: string[]; kindChanged: string[] };
  levels: { added: number; removed: number; textChanged: number[] } | null;
  bands: Change<unknown> | null;
  thresholds: Partial<
    Record<Exclude<ConsequenceClass, "irreversible">, Change<ZoneThresholds | null>>
  >;
  consequenceClass: Change<ConsequenceClass> | null;
  governanceChanged: boolean;
  escapeRoutes: Change<unknown> | null;
  improve: Change<unknown> | null;
  allowedAction: Change<AllowedAction> | null;
  fallbackOutcome: Change<string | null> | null;
  state: {
    added: string[];
    removed: string[];
    changed: {
      field: string;
      changes: (
        | "role"
        | "schema"
        | "required"
        | "dataClass"
        | "redact"
        | "maxChars"
        | "freshness"
        | "selection"
        | "description"
      )[];
    }[];
    budget: Change<number> | null;
    privacyClass: Change<string> | null;
  };
  model: Change<ContractModel> | null;
  /** One line per change, in review order. */
  summary: string[];
}

function outcomeMap(
  body: DecisionContractBody,
): Record<string, { description: string; traits: unknown }> {
  const q = body.question;
  const out: Record<string, { description: string; traits: unknown }> = {};
  if (q.kind === "choice") {
    const specs = q.menu.source === "static" ? q.menu.outcomes : q.menu.escapes;
    for (const [k, s] of Object.entries(specs)) {
      out[k] = {
        description: s.description,
        traits: { consequenceClass: s.consequenceClass ?? null, automatable: s.automatable },
      };
    }
  } else if (q.kind === "boolean") {
    for (const k of ["true", "false"] as const) {
      const s = q.outcomes[k];
      out[k] = {
        description: s.description,
        traits: { consequenceClass: s.consequenceClass ?? null, automatable: s.automatable },
      };
    }
  }
  return out;
}

function changed<T>(before: T, after: T): Change<T> | null {
  return deepEqual(before, after) ? null : { before, after };
}

/** Diffs version `a` (usually the latest approved) against `b` (the submitted one). */
export function diffContracts(a: DecisionContractBody, b: DecisionContractBody): ContractDiff {
  const summary: string[] = [];
  const kindChanged =
    a.question.kind === b.question.kind
      ? null
      : { before: a.question.kind, after: b.question.kind };
  if (kindChanged) summary.push(`question kind ${kindChanged.before} → ${kindChanged.after}`);

  let instructions: ContractDiff["instructions"] = null;
  if (a.question.instructions !== b.question.instructions) {
    const shortened = b.question.instructions.length < a.question.instructions.length;
    instructions = { before: a.question.instructions, after: b.question.instructions, shortened };
    summary.push(
      shortened
        ? "instructions shortened (a behaviour change that needs replay evidence)"
        : "instructions changed",
    );
  }

  const oa = outcomeMap(a);
  const ob = outcomeMap(b);
  const outcomes = {
    added: [] as string[],
    removed: [] as string[],
    descriptionChanged: [] as string[],
    traitsChanged: [] as string[],
  };
  for (const k of Object.keys(ob)) if (!(k in oa)) outcomes.added.push(k);
  for (const k of Object.keys(oa)) if (!(k in ob)) outcomes.removed.push(k);
  for (const [k, va] of Object.entries(oa)) {
    const vb = ob[k];
    if (!vb) continue;
    if (va.description !== vb.description) outcomes.descriptionChanged.push(k);
    if (!deepEqual(va.traits, vb.traits)) outcomes.traitsChanged.push(k);
  }
  if (outcomes.added.length > 0) summary.push(`outcomes added: ${outcomes.added.join(", ")}`);
  if (outcomes.removed.length > 0) summary.push(`outcomes removed: ${outcomes.removed.join(", ")}`);
  if (outcomes.descriptionChanged.length > 0)
    summary.push(`descriptions changed: ${outcomes.descriptionChanged.join(", ")}`);
  if (outcomes.traitsChanged.length > 0)
    summary.push(`consequence/automatable changed: ${outcomes.traitsChanged.join(", ")}`);

  const ea = escapeOutcomes(a);
  const eb = escapeOutcomes(b);
  const escapes = {
    added: Object.keys(eb).filter((k) => !(k in ea)),
    removed: Object.keys(ea).filter((k) => !(k in eb)),
    kindChanged: Object.keys(ea).filter((k) => k in eb && ea[k] !== eb[k]),
  };
  if (escapes.added.length > 0) summary.push(`escape hatches added: ${escapes.added.join(", ")}`);
  if (escapes.removed.length > 0)
    summary.push(`escape hatches removed: ${escapes.removed.join(", ")}`);

  let levels: ContractDiff["levels"] = null;
  let bands: ContractDiff["bands"] = null;
  if (a.question.kind === "score" && b.question.kind === "score") {
    const la = a.question.levels;
    const lb = b.question.levels;
    const textChanged: number[] = [];
    for (let i = 0; i < Math.min(la.length, lb.length); i += 1)
      if (la[i] !== lb[i]) textChanged.push(i);
    if (la.length !== lb.length || textChanged.length > 0) {
      levels = {
        added: Math.max(0, lb.length - la.length),
        removed: Math.max(0, la.length - lb.length),
        textChanged,
      };
      summary.push(
        `rubric changed (${la.length} → ${lb.length} levels, ${textChanged.length} anchors reworded)`,
      );
    }
    bands = changed<unknown>(a.question.bands ?? null, b.question.bands ?? null);
    if (bands) summary.push("score bands changed");
  }

  const thresholds: ContractDiff["thresholds"] = {};
  for (const cc of ["low", "medium", "high"] as const) {
    const c = changed<ZoneThresholds | null>(
      a.routing.thresholds[cc] ?? null,
      b.routing.thresholds[cc] ?? null,
    );
    if (c) {
      thresholds[cc] = c;
      const fmt = (t: ZoneThresholds | null): string =>
        t === null
          ? "illustrative"
          : `auto ≥ ${t.autoAt ?? "never"}, improve ≥ ${t.improveAt ?? "never"}`;
      summary.push(`thresholds[${cc}]: ${fmt(c.before)} → ${fmt(c.after)}`);
    }
  }
  const consequenceClass = changed(a.routing.consequenceClass, b.routing.consequenceClass);
  if (consequenceClass)
    summary.push(`consequence class ${consequenceClass.before} → ${consequenceClass.after}`);
  const governanceChanged = !deepEqual(a.routing.governance ?? null, b.routing.governance ?? null);
  if (governanceChanged) summary.push("threshold governance changed");
  const escapeRoutes = changed<unknown>(a.routing.escapeRoutes, b.routing.escapeRoutes);
  if (escapeRoutes) summary.push("escape routes changed");
  const improve = changed<unknown>(a.routing.improve ?? null, b.routing.improve ?? null);
  if (improve) summary.push("improve actions changed");
  const allowedAction = changed(a.allowedAction, b.allowedAction);
  if (allowedAction) summary.push("allowed action changed (authority boundary)");
  const fallbackOutcome = changed(a.fallbackOutcome, b.fallbackOutcome);
  if (fallbackOutcome)
    summary.push(
      `fallback outcome ${fallbackOutcome.before ?? "human"} → ${fallbackOutcome.after ?? "human"}`,
    );

  const fa = a.state.fields;
  const fb = b.state.fields;
  const state: ContractDiff["state"] = {
    added: Object.keys(fb).filter((k) => !(k in fa)),
    removed: Object.keys(fa).filter((k) => !(k in fb)),
    changed: [],
    budget: changed(a.state.maxTokens, b.state.maxTokens),
    privacyClass: changed<string>(a.state.privacyClass, b.state.privacyClass),
  };
  for (const [name, x] of Object.entries(fa)) {
    const y = fb[name];
    if (!y) continue;
    const changes: ContractDiff["state"]["changed"][number]["changes"] = [];
    if (x.role !== y.role) changes.push("role");
    if (!deepEqual(x.schema, y.schema)) changes.push("schema");
    if (x.required !== y.required) changes.push("required");
    if (x.dataClass !== y.dataClass) changes.push("dataClass");
    if (x.redact !== y.redact) changes.push("redact");
    if (x.maxChars !== y.maxChars || x.overflow !== y.overflow) changes.push("maxChars");
    if (!deepEqual(x.freshness ?? null, y.freshness ?? null)) changes.push("freshness");
    if (!deepEqual(x.selection ?? null, y.selection ?? null)) changes.push("selection");
    if (x.description !== y.description) changes.push("description");
    if (changes.length > 0) state.changed.push({ field: name, changes });
  }
  if (state.added.length > 0) summary.push(`state fields added: ${state.added.join(", ")}`);
  if (state.removed.length > 0) summary.push(`state fields removed: ${state.removed.join(", ")}`);
  for (const c of state.changed) summary.push(`state field ${c.field}: ${c.changes.join(", ")}`);
  if (state.budget)
    summary.push(`packet budget ${state.budget.before} → ${state.budget.after} tokens`);
  if (state.privacyClass)
    summary.push(`privacy class ${state.privacyClass.before} → ${state.privacyClass.after}`);

  const model = changed(a.model, b.model);
  if (model) summary.push("model chain changed (recompute calibration segments)");

  const interfaceChanged = interfaceHash(a) !== interfaceHash(b);
  if (interfaceChanged)
    summary.unshift(
      "INTERFACE CHANGED: workflows compiled against the old version must be recompiled",
    );

  return {
    from: labelOf(a),
    to: labelOf(b),
    interfaceChanged,
    kindChanged,
    instructions,
    outcomes,
    escapes,
    levels,
    bands,
    thresholds,
    consequenceClass,
    governanceChanged,
    escapeRoutes,
    improve,
    allowedAction,
    fallbackOutcome,
    state,
    model,
    summary,
  };
}
