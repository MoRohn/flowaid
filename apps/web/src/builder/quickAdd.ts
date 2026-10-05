/**
 * Quick add: which steps to suggest next, where a new step goes and what it connects to.
 *
 * Suggestions need no AI model. They come from what usually follows the step you are adding
 * after (the patterns in the built-in templates: a decision is followed by a confidence gate or
 * a branch, generated text by a validator or a guard, retrieval by generation…), from gaps in
 * the workflow (no Output yet, a decision with nobody to review it) and from the steps you added
 * recently. Every suggestion carries a short reason so it never feels arbitrary.
 */
import type { WorkflowDefinition, WorkflowNode } from "@flowaid/workflow-core";
import { NODE_WIDTH, type NodeDefinitionView } from "@flowaid/ui";

export interface Suggestion {
  kind: string;
  /** Why it is suggested, in a few words ("Check how sure the decision is"). */
  reason: string;
}

type Next = readonly (readonly [kind: string, reason: string])[];

/** What typically follows a step, by node type (task nodes) or kind (runtime nodes). */
const AFTER: Record<string, Next> = {
  input: [
    ["flowaid.decision.batch", "Ask several questions about the request at once"],
    ["flowaid.decision.choice", "Sort the request into one of a few kinds"],
    ["flowaid.safety.guard", "Check the input before anything else runs"],
    ["flowaid.safety.pii_detector", "Find or redact personal data first"],
    ["flowaid.data.transform", "Reshape or compute from the input"],
    ["flowaid.ai.generate", "Write text from the input"],
  ],
  "flowaid.decision.batch": [
    ["flowaid.data.transform", "Combine the answers into limits or scores"],
    ["branch", "Send the run down a path by the answers"],
    ["flowaid.decision.confidence_gate", "Act only when the answers are sure enough"],
    ["human", "Let a person review unclear cases"],
  ],
  "flowaid.decision.choice": [
    ["flowaid.decision.confidence_gate", "Act only when the choice is sure enough"],
    ["branch", "Route by the chosen option"],
    ["human", "Let a person review unclear cases"],
  ],
  "flowaid.decision.boolean": [
    ["flowaid.decision.confidence_gate", "Act only when the answer is sure enough"],
    ["branch", "Route on yes or no"],
    ["human", "Let a person review unclear cases"],
  ],
  "flowaid.decision.score": [
    ["branch", "Route by the score"],
    ["flowaid.decision.confidence_gate", "Act only when the score is sure enough"],
  ],
  "flowaid.decision.router": [
    ["flowaid.ai.generate", "Write the reply for the chosen route"],
    ["human", "Let a person handle a route"],
    ["output", "Finish the run"],
  ],
  "flowaid.decision.confidence_gate": [
    ["human", "Let a person review what did not pass"],
    ["output", "Finish the run"],
    ["flowaid.ai.generate", "Write the reply for confident cases"],
  ],
  "flowaid.decision.validator": [
    ["output", "Return the checked value"],
    ["human", "Let a person fix what is invalid"],
  ],
  branch: [
    ["output", "Finish one of the paths"],
    ["human", "Ask a person on one of the paths"],
    ["flowaid.ai.generate", "Write the reply for a path"],
    ["join", "Bring the paths back together"],
  ],
  human: [
    ["output", "Finish the run with the person's answer"],
    ["branch", "Route by what the person decided"],
    ["flowaid.tools.http", "Tell another system what was decided"],
  ],
  "flowaid.ai.generate": [
    ["flowaid.decision.validator", "Check the text against a rubric"],
    ["flowaid.safety.guard", "Screen the text before it goes out"],
    ["flowaid.data.extract", "Pull structured fields out of the text"],
    ["output", "Return the text"],
  ],
  "flowaid.ai.structured_generate": [
    ["flowaid.data.schema_validate", "Validate the structured result"],
    ["branch", "Route by a field of the result"],
    ["output", "Return the result"],
  ],
  "flowaid.ai.agent": [
    ["flowaid.decision.validator", "Check the agent's answer"],
    ["flowaid.safety.guard", "Screen the answer before it goes out"],
    ["output", "Return the answer"],
  ],
  "flowaid.retrieval.retriever": [
    ["flowaid.retrieval.rerank", "Keep the most relevant hits"],
    ["flowaid.ai.generate", "Answer from what was found"],
  ],
  "flowaid.retrieval.hybrid_search": [
    ["flowaid.retrieval.rerank", "Keep the most relevant hits"],
    ["flowaid.ai.generate", "Answer from what was found"],
  ],
  "flowaid.retrieval.knowledge_base": [
    ["flowaid.ai.generate", "Answer from the cited context"],
    ["flowaid.pageindex.cite", "Check the answer's citations"],
  ],
  "flowaid.retrieval.rerank": [["flowaid.ai.generate", "Answer from the best hits"]],
  "flowaid.retrieval.loader": [["flowaid.retrieval.chunker", "Split the documents into chunks"]],
  "flowaid.retrieval.chunker": [["flowaid.retrieval.embed", "Embed the chunks"]],
  "flowaid.retrieval.embed": [
    ["flowaid.retrieval.upsert", "Store the chunks in a knowledge source"],
  ],
  "flowaid.pageindex.retrieve": [
    ["flowaid.ai.generate", "Answer from the evidence"],
    ["flowaid.pageindex.cite", "Check the answer's citations"],
  ],
  "flowaid.pageindex.cite": [
    ["output", "Return the checked answer"],
    ["human", "Let a person review weak citations"],
  ],
  "flowaid.data.transform": [
    ["branch", "Route on the computed value"],
    ["output", "Return the value"],
  ],
  "flowaid.tools.http": [
    ["flowaid.data.transform", "Pick what you need from the response"],
    ["branch", "Route on the response"],
  ],
  "flowaid.safety.guard": [
    ["flowaid.decision.batch", "Ask about the request once it passed"],
    ["flowaid.ai.generate", "Write text once the input passed"],
    ["output", "Finish when the input is blocked"],
  ],
  "flowaid.safety.pii_detector": [
    ["flowaid.ai.generate", "Write text from the redacted input"],
    ["flowaid.decision.batch", "Ask about the redacted request"],
  ],
  loop: [["output", "Return what the loop carried"]],
  foreach: [["flowaid.data.merge", "Combine the results of every item"]],
  join: [["output", "Finish the run"]],
  wait: [["flowaid.tools.http", "Check again after the wait"]],
};

/** For task types without their own entry: what follows their category. */
const AFTER_CATEGORY: Record<string, Next> = {
  decision: AFTER["flowaid.decision.choice"] ?? [],
  generation: AFTER["flowaid.ai.generate"] ?? [],
  agent: AFTER["flowaid.ai.agent"] ?? [],
  retrieval: AFTER["flowaid.retrieval.retriever"] ?? [],
  tool: AFTER["flowaid.tools.http"] ?? [],
  data: AFTER["flowaid.data.transform"] ?? [],
  safety: AFTER["flowaid.safety.guard"] ?? [],
  human: AFTER.human ?? [],
};

/** A key into `AFTER`: the task type, else the runtime kind. */
export function stepKey(node: WorkflowNode): string {
  return node.kind === "task" ? node.type : node.kind;
}

const DECISION = /^flowaid\.decision\.(batch|choice|boolean|score)$/;

/**
 * Up to `limit` suggestions for the step to add, best first. `after` is the step it will follow
 * (the selected one), if any; `recent` the kinds added lately, most recent first.
 */
export function suggestNext(
  def: WorkflowDefinition,
  after: WorkflowNode | undefined,
  palette: readonly NodeDefinitionView[],
  recent: readonly string[] = [],
  limit = 5,
): Suggestion[] {
  const offered = new Map(palette.map((p) => [p.kind, p]));
  const scores = new Map<string, { score: number; reason: string }>();
  const add = (kind: string, score: number, reason: string) => {
    if (!offered.has(kind) || kind === "input" || kind === "note") return;
    const prev = scores.get(kind);
    if (!prev) scores.set(kind, { score, reason });
    else prev.score += score / 2; // a second signal strengthens, the first reason stays
  };

  // 1. what usually follows the step it will follow, in order of how common it is
  if (after) {
    const key = stepKey(after);
    const category = offered.get(key)?.category;
    const next = AFTER[key] ?? (category ? AFTER_CATEGORY[category] : undefined) ?? [];
    next.forEach(([kind, reason], i) => add(kind, 10 - i, reason));
  }

  // 2. gaps in the workflow as a whole
  const types = new Set(def.nodes.map(stepKey));
  const hasDecision = def.nodes.some((n) => n.kind === "task" && DECISION.test(n.type));
  if (!def.nodes.some((n) => n.kind === "output"))
    add("output", 6, "The workflow has no end yet: return a result");
  if (hasDecision && !types.has("human") && !types.has("flowaid.decision.confidence_gate"))
    add("human", 4, "Nobody reviews unclear decisions yet");
  if (def.nodes.filter((n) => n.kind !== "note").length <= 1)
    add("flowaid.decision.batch", 5, "Start by asking questions about the request");

  // 3. what you used lately
  recent.slice(0, 5).forEach((kind, i) => add(kind, 3 - i * 0.5, "Added recently"));

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([kind, { reason }]) => ({ kind, reason }));
}

// ── placement ───────────────────────────────────────────────────────────────────────────────

/** Room a new step takes, and the gaps kept around it. */
const W = NODE_WIDTH;
const H = 96;
const GAP_X = 72;
const GAP_Y = 32;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOf(def: WorkflowDefinition, parent: string | undefined): Rect[] {
  return def.nodes
    .filter((n) => (n.parent ?? undefined) === parent)
    .map((n) => {
      const l = def.layout?.nodes[n.id];
      return l ? { x: l.x, y: l.y, w: l.w ?? W, h: l.h ?? H } : null;
    })
    .filter((r): r is Rect => r !== null);
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP_Y &&
  b.x < a.x + a.w + GAP_Y &&
  a.y < b.y + b.h + GAP_Y &&
  b.y < a.y + a.h + GAP_Y;

/**
 * A free spot for a new step: right of `after` when given (below its other followers), else
 * `wanted` moved down until it covers nothing.
 */
export function placeNewStep(
  def: WorkflowDefinition,
  wanted: { x: number; y: number },
  after?: WorkflowNode,
): { x: number; y: number } {
  const rects = rectsOf(def, after?.parent ?? undefined);
  const anchor = after ? def.layout?.nodes[after.id] : undefined;
  const start = anchor ? { x: anchor.x + (anchor.w ?? W) + GAP_X, y: anchor.y } : wanted;
  const free = (y: number, x: number) => !rects.some((r) => overlaps({ x, y, w: W, h: H }, r));
  // try below, then above, stepping by one row, before giving up on the spot
  for (let i = 0; i < 40; i += 1) {
    const down = start.y + i * (H + GAP_Y);
    if (free(down, start.x)) return { x: Math.round(start.x), y: Math.round(down) };
    const up = start.y - (i + 1) * (H + GAP_Y);
    if (anchor && free(up, start.x)) return { x: Math.round(start.x), y: Math.round(up) };
  }
  return { x: Math.round(start.x), y: Math.round(start.y) };
}

/**
 * What a step picked in the palette follows, and where it goes. With one step selected it follows
 * that step. With nothing selected it follows the step the palette's suggestions were for (the
 * last step, as its "Suggested after …" heading says), so it does not start unconnected. It sits
 * beside the step it follows, unless the palette opened at a right-click: then it goes where the
 * pointer was. Several selected steps leave it unconnected at `wanted`.
 */
export function quickAddPlan(
  def: WorkflowDefinition,
  selection: readonly string[],
  wanted: { x: number; y: number },
  origin: "pointer" | "view",
): { after: WorkflowNode | undefined; position: { x: number; y: number } } {
  const selected =
    selection.length === 1 ? def.nodes.find((n) => n.id === selection[0]) : undefined;
  const after = selected ?? (selection.length === 0 ? lastStep(def) : undefined);
  const beside = selected !== undefined || origin === "view";
  return { after, position: placeNewStep(def, wanted, beside ? after : undefined) };
}

/**
 * The condition of the first case of a Branch added after a yes/no decision: its answer, so "yes"
 * means yes. The new Branch's own default ("true") would always take the first path.
 */
export function branchConditionAfter(
  after: WorkflowNode | undefined,
  decisionKind: string | undefined,
): string | undefined {
  if (after?.kind !== "task" || decisionKind !== "boolean") return undefined;
  return `${after.id}.decision.value`;
}

/**
 * Where to centre the view so a step at `rect` (flow coordinates) is fully visible, keeping the
 * zoom; null when it already is. `margin` is the room kept from the edges, in screen pixels
 * (panels such as the minimap and the controls sit there).
 */
export function centreToShow(
  rect: { x: number; y: number; w: number; h: number },
  view: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
  margin = 48,
): { x: number; y: number } | null {
  const left = rect.x * view.zoom + view.x;
  const top = rect.y * view.zoom + view.y;
  const right = left + rect.w * view.zoom;
  const bottom = top + rect.h * view.zoom;
  const inside =
    left >= margin &&
    top >= margin &&
    right <= size.width - margin &&
    bottom <= size.height - margin;
  return inside ? null : { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * The control port a new step following `after` hangs off: the first one nothing follows yet,
 * else the first. None for steps that cannot lead anywhere.
 */
export function freeControlPort(
  def: WorkflowDefinition,
  after: WorkflowNode,
  ports: readonly string[],
): string | undefined {
  if (after.kind === "output" || after.kind === "note" || ports.length === 0) return undefined;
  const used = new Set(def.edges.filter((e) => e.from.node === after.id).map((e) => e.from.port));
  return ports.find((p) => !used.has(p)) ?? ports[0];
}

/** The rightmost step that can lead somewhere: what a new step most likely follows. */
export function lastStep(def: WorkflowDefinition): WorkflowNode | undefined {
  let best: WorkflowNode | undefined;
  let bestX = -Infinity;
  for (const n of def.nodes) {
    if (n.kind === "output" || n.kind === "note" || n.parent) continue;
    const x = def.layout?.nodes[n.id]?.x ?? 0;
    if (x > bestX) {
      best = n;
      bestX = x;
    }
  }
  return best;
}

// ── recently added kinds, remembered per browser ────────────────────────────────────────────

const RECENT_KEY = "flowaid:recent-node-kinds";

export function readRecentKinds(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return []; // storage blocked or garbled: no recent steps
  }
}

export function rememberRecentKind(prev: readonly string[], kind: string): string[] {
  const next = [kind, ...prev.filter((k) => k !== kind)].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: remembered for this page only
  }
  return next;
}
