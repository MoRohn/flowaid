/**
 * The cost optimizer (UPGRADE_PLAN P6-02): reads a workflow, its compiled plan and 30 days of
 * per-node run statistics and proposes cheaper equivalents, each with an estimated saving per
 * run, a risk and — when the change can be made mechanically — an RFC 6902 fix.
 *
 * - `cheaper_model`: a generation node on a model of the same provider that costs at most 70 %
 *   as much for the node's observed token mix and has the capabilities the node needs.
 * - `batch_decisions`: independent TypeSafe decisions over the same state that the runtime does
 *   not already batch; one batch request pays for the shared state once.
 * - `cache_safe_node`: an idempotent, deterministic node whose inputs repeat often.
 * - `tighten_bounds`: a loop or for-each whose `maxIterations` is far above what runs use.
 *
 * Estimates come from the statistics and the catalog's list prices; nothing is called.
 */
import { jsonPatch } from "@flowaid/workflow-compiler";
import type {
  Binding,
  ExecutionPlan,
  JsonObject,
  JsonValue,
  WorkflowDefinition,
  WorkflowNode,
} from "@flowaid/workflow-core";
import { stableStringify } from "@flowaid/shared";
import type {
  EvalSignal,
  ManifestLookup,
  NodeStats,
  PriceCatalog,
  Risk,
  Suggestion,
} from "./types.js";

export interface OptimizeInput {
  definition: WorkflowDefinition;
  plan: ExecutionPlan;
  stats: readonly NodeStats[];
  catalog: PriceCatalog;
  manifests: ManifestLookup;
  evaluation?: EvalSignal | null;
  /** runs a node needs before its statistics count (default 20) */
  minRuns?: number;
}

const GENERATION_TYPES = new Set(["flowaid.ai.generate", "flowaid.ai.structured_generate"]);
const DECISION_TYPES = new Set([
  "flowaid.decision.boolean",
  "flowaid.decision.choice",
  "flowaid.decision.score",
]);
const BATCH_TYPE = "flowaid.decision.batch";
/** a cheaper model must cost at most this share of the current one */
const MAX_PRICE_RATIO = 0.7;
const MIN_REPEAT_RATE = 0.25;

const round = (n: number, digits = 8) => Number(n.toFixed(digits));

function lower(risk: Risk): Risk {
  return risk === "high" ? "medium" : "low";
}

/** Risk adjusted by the linked evaluation: a strong set lowers it, a weak one raises it. */
function withEvaluation(risk: Risk, evaluation: EvalSignal | null | undefined): Risk {
  if (!evaluation || evaluation.cases < 10) return risk;
  if (evaluation.passRate < 0.9) return "high";
  if (evaluation.passRate >= 0.98 && evaluation.cases >= 20) return lower(risk);
  return risk;
}

function nodeIndex(def: WorkflowDefinition, id: string): number {
  return def.nodes.findIndex((n) => n.id === id);
}

function cloneDef(def: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
}

function patchFor(before: WorkflowDefinition, after: WorkflowDefinition) {
  return jsonPatch(before, after);
}

// ─── cheaper_model ───────────────────────────────────────────────────────────────────────────

function priceOf(
  pricing: { inputPerMTok: number; outputPerMTok: number },
  stats: NodeStats,
): number {
  const tokens = stats.avgInputTokens + stats.avgOutputTokens;
  // without token counts, compare list prices for an even mix
  const inTok = tokens > 0 ? stats.avgInputTokens : 1;
  const outTok = tokens > 0 ? stats.avgOutputTokens : 1;
  return (inTok * pricing.inputPerMTok + outTok * pricing.outputPerMTok) / 1e6;
}

function cheaperModel(
  input: OptimizeInput,
  node: WorkflowNode,
  stats: NodeStats,
): Suggestion | null {
  if (node.kind !== "task" || !GENERATION_TYPES.has(node.type)) return null;
  const ref = node.config.model as { provider?: unknown; model?: unknown } | undefined;
  if (typeof ref?.provider !== "string" || typeof ref.model !== "string") return null;
  const models = input.catalog.list({ provider: ref.provider, kind: "chat" });
  const currentId = input.catalog.resolveAlias(ref.provider, ref.model);
  const current = models.find((m) => m.model === currentId);
  if (!current?.pricing) return null;
  const needs = node.type === "flowaid.ai.structured_generate" ? ["jsonSchema"] : [];
  const currentCost = priceOf(current.pricing, stats);
  if (currentCost <= 0) return null;
  const candidates = models
    .flatMap((m) =>
      m.model !== current.model &&
      !m.deprecated &&
      m.pricing &&
      needs.every((c) => m.capabilities[c])
        ? [{ model: m.model, cost: priceOf(m.pricing, stats) }]
        : [],
    )
    .filter((m) => m.cost <= currentCost * MAX_PRICE_RATIO)
    // the strongest (most expensive) model that still saves enough
    .sort((a, b) => b.cost - a.cost);
  const pick = candidates[0];
  if (!pick) return null;
  const ratio = pick.cost / currentCost;
  const next = cloneDef(input.definition);
  const target = next.nodes[nodeIndex(next, node.id)];
  if (target?.kind !== "task") return null;
  target.config = { ...target.config, model: { provider: ref.provider, model: pick.model } };
  const risk = withEvaluation(ratio >= 0.3 ? "medium" : "high", input.evaluation);
  return {
    id: `cheaper_model:${node.id}`,
    kind: "cheaper_model",
    nodeIds: [node.id],
    title: `Use ${pick.model} for “${node.name}”`,
    rationale: `${current.model} costs about ${Math.round((1 / ratio) * 10) / 10}× as much as ${pick.model} for this node's average of ${Math.round(stats.avgInputTokens)} input and ${Math.round(stats.avgOutputTokens)} output tokens over ${stats.runs} runs.`,
    estimatedSavingsUsdPerRun: round(stats.avgCostUsd * (1 - ratio)),
    currentCostUsdPerRun: round(stats.avgCostUsd),
    latencyDeltaMs: 0,
    risk,
    qualityImpact: input.evaluation
      ? `Smaller model: the linked evaluation passes ${Math.round(input.evaluation.passRate * 100)} % today; run it again on the change before publishing.`
      : "Smaller model: link an evaluation set and run it on the change before publishing.",
    fix: patchFor(input.definition, next),
  };
}

// ─── batch_decisions ─────────────────────────────────────────────────────────────────────────

function controlAncestors(plan: ExecutionPlan, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const dep of plan.nodes[cur]?.controlIn ?? [])
      if (!seen.has(dep.from.node)) {
        seen.add(dep.from.node);
        stack.push(dep.from.node);
      }
  }
  return seen;
}

function questionOf(node: Extract<WorkflowNode, { kind: "task" }>): JsonObject | null {
  const c = node.config;
  const instructions = c.instructions;
  if (typeof instructions !== "string") return null;
  switch (node.type) {
    case "flowaid.decision.boolean":
      return { kind: "boolean", instructions, ...(c.criteria ? { criteria: c.criteria } : {}) };
    case "flowaid.decision.choice":
      return c.options ? { kind: "choice", instructions, options: c.options } : null;
    case "flowaid.decision.score":
      return c.levels ? { kind: "score", instructions, levels: c.levels } : null;
    default:
      return null;
  }
}

/** Mentions of `id.` in free text (templates, expressions, conditions). */
function mentions(text: string, ids: ReadonlySet<string>): boolean {
  for (const id of ids) if (new RegExp(`(^|[^\\w.$])${id}\\.`).test(text)) return true;
  return false;
}

/**
 * Rewrites every port ref into the group onto the batch node's `answers`; null when something
 * refers to a group node in a way that cannot be rewritten mechanically.
 */
function rewriteRefs(
  value: JsonValue,
  group: ReadonlySet<string>,
  batchId: string,
): JsonValue | null {
  if (typeof value === "string") return mentions(value, group) ? null : value;
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value) {
      const r = rewriteRefs(item, group, batchId);
      if (r === null && item !== null) return null;
      out.push(r);
    }
    return out;
  }
  if (value === null || typeof value !== "object") return value;
  const obj = value;
  if (obj.kind === "ref" && typeof obj.ref === "object" && obj.ref !== null) {
    const ref = obj.ref as { kind?: string; node?: string; port?: string; path?: string };
    if (ref.kind === "port" && ref.node && group.has(ref.node)) {
      if (ref.port !== "decision") return null;
      return {
        ...obj,
        ref: {
          kind: "port",
          node: batchId,
          port: "answers",
          path: `/${ref.node}${ref.path ?? ""}`,
        },
      };
    }
    return obj;
  }
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "id" || k === "name" || k === "description") {
      out[k] = v;
      continue;
    }
    const r = rewriteRefs(v, group, batchId);
    if (r === null && v !== null) return null;
    out[k] = r;
  }
  return out;
}

function uniqueId(def: WorkflowDefinition, stem: string): string {
  const taken = new Set(def.nodes.map((n) => n.id));
  for (let i = 1; ; i++) if (!taken.has(`${stem}_${i}`)) return `${stem}_${i}`;
}

function batchFix(
  input: OptimizeInput,
  group: Extract<WorkflowNode, { kind: "task" }>[],
): WorkflowDefinition | null {
  const def = input.definition;
  const batch = input.manifests(BATCH_TYPE);
  if (!batch) return null;
  const ids = new Set(group.map((n) => n.id));
  if (def.edges.some((e) => ids.has(e.from.node) && e.from.port !== "done")) return null;
  const questions: JsonObject = {};
  for (const n of group) {
    const q = questionOf(n);
    if (!q) return null;
    questions[n.id] = q;
  }
  const first = group[0] as (typeof group)[number];
  const batchId = uniqueId(def, "decisions");
  const nodes: WorkflowNode[] = [];
  for (const n of def.nodes) {
    if (n.id === first.id)
      nodes.push({
        id: batchId,
        kind: "task",
        name: "Decisions",
        description: `One TypeSafe request for ${group.map((g) => g.name).join(", ")}.`,
        type: BATCH_TYPE,
        typeVersion: batch.version,
        config: { questions },
        inputs: { state: first.inputs.state as Binding },
        credentials: { ...first.credentials },
        disabled: false,
        ...(first.parent ? { parent: first.parent } : {}),
      });
    if (ids.has(n.id)) continue;
    const rewritten = rewriteRefs(n as unknown as JsonValue, ids, batchId);
    if (rewritten === null) return null;
    nodes.push(rewritten as unknown as WorkflowNode);
  }
  const edges: WorkflowDefinition["edges"] = [];
  const seen = new Set<string>();
  const push = (from: { node: string; port: string }, to: string) => {
    const key = `${from.node}.${from.port}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: `e_${from.node}_${from.port}_${to}`.slice(0, 120), from, to: { node: to } });
  };
  for (const e of def.edges) {
    const fromIn = ids.has(e.from.node);
    const toIn = ids.has(e.to.node);
    if (fromIn && toIn) continue;
    if (!fromIn && !toIn) {
      edges.push(e);
      seen.add(`${e.from.node}.${e.from.port}>${e.to.node}`);
    } else if (toIn) push(e.from, batchId);
    else push({ node: batchId, port: "done" }, e.to.node);
  }
  const next: WorkflowDefinition = { ...cloneDef(def), nodes, edges };
  if (def.layout?.nodes[first.id]) {
    const layout = cloneDef(def).layout as NonNullable<WorkflowDefinition["layout"]>;
    layout.nodes[batchId] = layout.nodes[first.id] as { x: number; y: number };
    for (const id of ids) delete layout.nodes[id];
    next.layout = layout;
  }
  return next;
}

function batchDecisions(
  input: OptimizeInput,
  byId: Map<string, NodeStats>,
  minRuns: number,
): Suggestion[] {
  const { definition: def, plan } = input;
  const groups = new Map<string, Extract<WorkflowNode, { kind: "task" }>[]>();
  for (const n of def.nodes) {
    if (n.kind !== "task" || !DECISION_TYPES.has(n.type) || n.disabled) continue;
    if (plan.nodes[n.id]?.batchGroup) continue; // the runtime already batches it
    const state = n.inputs.state;
    if (!state) continue;
    const key = `${n.parent ?? ""}|${stableStringify(state)}|${stableStringify(n.credentials)}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const out: Suggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ids = new Set(group.map((g) => g.id));
    // independent: no member reads another's output
    const dependent = group.some((g) =>
      (plan.nodes[g.id]?.dataIn ?? []).some((d) => ids.has(d.from.node)),
    );
    if (dependent) continue;
    const stats = group.map((g) => byId.get(g.id));
    const counted = stats.filter((s): s is NodeStats => s !== undefined && s.runs >= minRuns);
    const typesafe = input.catalog.list({ provider: "typesafe" })[0]?.pricing;
    const inputCost = (s: NodeStats) =>
      typesafe && s.avgInputTokens > 0
        ? (s.avgInputTokens * typesafe.inputPerMTok) / 1e6
        : s.avgCostUsd * 0.8;
    const costs = counted.map(inputCost);
    const savings =
      costs.length === group.length ? costs.reduce((a, b) => a + b, 0) - Math.max(...costs) : 0;
    const sequential = group.some((g) => {
      const anc = controlAncestors(plan, g.id);
      return group.some((o) => o.id !== g.id && anc.has(o.id));
    });
    const latencies = counted.map((s) => s.avgLatencyMs);
    const latencyDelta =
      sequential && latencies.length === group.length
        ? -(latencies.reduce((a, b) => a + b, 0) - Math.max(...latencies))
        : 0;
    const next = batchFix(input, group);
    const names = group.map((g) => `“${g.name}”`).join(", ");
    out.push({
      id: `batch_decisions:${group.map((g) => g.id).join("+")}`,
      kind: "batch_decisions",
      nodeIds: group.map((g) => g.id),
      title: `Ask ${names} in one TypeSafe request`,
      rationale: `These ${group.length} decisions read the same state and do not depend on each other; a batch request sends the state once${sequential ? " and answers them together instead of one after another" : ""}.${next ? "" : " Other nodes refer to them in templates or expressions, so change those references to the batch node's answers by hand."}`,
      estimatedSavingsUsdPerRun: round(Math.max(0, savings)),
      currentCostUsdPerRun: round(counted.reduce((a, s) => a + s.avgCostUsd, 0)),
      latencyDeltaMs: Math.round(latencyDelta),
      risk: "low",
      qualityImpact: "No change: the same model answers the same questions over the same state.",
      fix: next ? patchFor(def, next) : [],
    });
  }
  return out;
}

// ─── cache_safe_node ─────────────────────────────────────────────────────────────────────────

function cacheSafe(
  input: OptimizeInput,
  node: WorkflowNode,
  stats: NodeStats,
  minRuns: number,
): Suggestion | null {
  if (node.kind !== "task" || stats.runs < minRuns || stats.avgCostUsd <= 0) return null;
  if (input.plan.nodes[node.id]?.idempotency !== "safe") return null;
  const repeat = 1 - stats.distinctInputs / stats.runs;
  if (repeat < MIN_REPEAT_RATE) return null;
  // only the model-backed nodes carry a cost worth memoising
  if (!DECISION_TYPES.has(node.type) && !GENERATION_TYPES.has(node.type)) return null;
  const temperature = node.config.temperature;
  const pct = Math.round(repeat * 100);
  return {
    id: `cache_safe_node:${node.id}`,
    kind: "cache_safe_node",
    nodeIds: [node.id],
    title: `Reuse “${node.name}” results for repeated inputs`,
    rationale: `${pct} % of the ${stats.runs} inputs this node saw in 30 days were repeats, and it has no side effects. Memoise it: a state.get keyed by the input before it, and a state.set of its output after it.`,
    estimatedSavingsUsdPerRun: round(stats.avgCostUsd * repeat),
    currentCostUsdPerRun: round(stats.avgCostUsd),
    latencyDeltaMs: -Math.round(stats.avgLatencyMs * repeat),
    risk:
      temperature === undefined || temperature === 0 || DECISION_TYPES.has(node.type)
        ? "low"
        : "medium",
    qualityImpact:
      temperature !== undefined && temperature !== 0 && !DECISION_TYPES.has(node.type)
        ? "Repeated inputs get the first answer instead of a fresh sample (temperature is above 0)."
        : "No change for a deterministic node.",
    fix: [],
  };
}

// ─── tighten_bounds ──────────────────────────────────────────────────────────────────────────

function tightenBounds(
  input: OptimizeInput,
  node: WorkflowNode,
  stats: NodeStats,
  minRuns: number,
): Suggestion | null {
  if (
    (node.kind !== "loop" && node.kind !== "foreach") ||
    !stats.iterations ||
    stats.runs < minRuns
  )
    return null;
  const bound = node.bounds.maxIterations;
  const proposed = Math.max(stats.iterations.max * 2, stats.iterations.max + 2, 3);
  if (bound < proposed * 2) return null;
  const next = cloneDef(input.definition);
  const target = next.nodes[nodeIndex(next, node.id)];
  if (target?.kind !== "loop" && target?.kind !== "foreach") return null;
  target.bounds = { ...target.bounds, maxIterations: proposed };
  return {
    id: `tighten_bounds:${node.id}`,
    kind: "tighten_bounds",
    nodeIds: [node.id],
    title: `Cap “${node.name}” at ${proposed} iterations`,
    rationale: `Runs used at most ${stats.iterations.max} iterations (p95 ${stats.iterations.p95}) of the ${bound} allowed. A tighter bound caps what a runaway run can spend.`,
    estimatedSavingsUsdPerRun: 0,
    currentCostUsdPerRun: round(stats.avgCostUsd),
    latencyDeltaMs: 0,
    risk: stats.runs >= 50 ? "low" : "medium",
    qualityImpact: `Runs that need more than ${proposed} iterations stop at the bound (none did in the last ${stats.runs}).`,
    fix: patchFor(input.definition, next),
  };
}

/** Every suggestion for the workflow, largest saving first. */
export function optimize(input: OptimizeInput): Suggestion[] {
  const minRuns = input.minRuns ?? 20;
  const byId = new Map(input.stats.map((s) => [s.nodeId, s]));
  const out: Suggestion[] = [];
  for (const node of input.definition.nodes) {
    const stats = byId.get(node.id);
    if (!stats) continue;
    if (stats.runs >= minRuns) {
      const cheaper = cheaperModel(input, node, stats);
      if (cheaper) out.push(cheaper);
    }
    const cache = cacheSafe(input, node, stats, minRuns);
    if (cache) out.push(cache);
    const bounds = tightenBounds(input, node, stats, minRuns);
    if (bounds) out.push(bounds);
  }
  out.push(...batchDecisions(input, byId, minRuns));
  return out.sort(
    (a, b) => b.estimatedSavingsUsdPerRun - a.estimatedSavingsUsdPerRun || a.id.localeCompare(b.id),
  );
}
