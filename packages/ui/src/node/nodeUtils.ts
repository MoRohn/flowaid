/**
 * Pure helpers shared by the node renderers: card-variant resolution, handle
 * ids, meta lookup, handle geometry and the small type guards the cards use
 * to read run output.
 */
import type {
  CardManifest,
  ControlPortView,
  NodeCategory,
  NodeRunView,
  PortView,
  WorkflowNodeView,
} from "@/types";

/**
 * Card variants: which renderer draws a node. They are derived from the
 * CONTRACTS `NodeKind` and, for `task` nodes, the manifest id and category
 * (`cardVariantFor`); they are not node kinds.
 */
export const NODE_CARD_VARIANTS = [
  "start",
  "end",
  "decision",
  "generation",
  "tool",
  "http",
  "human",
  "branch",
  "join",
  "router",
  "gate",
  "container",
  "subflow",
  "wait",
  "code",
  "agent",
  "safety",
  "state",
  "retrieval",
  "note",
  "default",
] as const;
export type NodeCardVariant = (typeof NODE_CARD_VARIANTS)[number];

/** Structural kinds map straight to a card; `task` goes through the type-id table. */
const KIND_VARIANT: Record<Exclude<WorkflowNodeView["kind"], "task">, NodeCardVariant> = {
  input: "start",
  output: "end",
  branch: "branch",
  join: "join",
  loop: "container",
  foreach: "container",
  subflow: "subflow",
  wait: "wait",
  human: "human",
  note: "note",
};

/**
 * Task nodes by the tail of their canonical `NodeTypeId` (the id without its
 * package: `flowaid.decision.choice` → `decision.choice`). Exact tails first,
 * then `<group>.*` prefixes.
 */
const TYPE_TAIL_VARIANT: Record<string, NodeCardVariant> = {
  "decision.choice": "decision",
  "decision.score": "decision",
  "decision.boolean": "decision",
  "decision.batch": "decision",
  "decision.confidence_gate": "gate",
  "decision.router": "router",
  "tools.http": "http",
  "tools.mcp": "tool",
  "tools.openapi": "tool",
  "tools.code": "code",
  "tools.shell": "code",
  "ai.agent": "agent",
};
const TYPE_GROUP_VARIANT: Record<string, NodeCardVariant> = {
  ai: "generation",
  safety: "safety",
  state: "state",
  retrieval: "retrieval",
};

const DECISION_KIND_VARIANT: Partial<
  Record<NonNullable<CardManifest["decision"]>["kind"], NodeCardVariant>
> = {
  gate: "gate",
  router: "router",
};

/** Manifest category fallback for task nodes whose id the table does not know (third-party packages). */
const CATEGORY_VARIANT: Record<NodeCategory, NodeCardVariant> = {
  flow: "default",
  decision: "decision",
  generation: "generation",
  agent: "agent",
  tool: "tool",
  data: "default",
  retrieval: "retrieval",
  state: "state",
  human: "default",
  safety: "safety",
  developer: "code",
};

/** `flowaid.decision.choice` → `decision.choice`; `@community/slack.post_message` → `post_message`. */
export function nodeTypeTail(nodeType: string): string {
  const unscoped = nodeType.replace(/^@[^/]+\//, "");
  const dot = unscoped.indexOf(".");
  return dot === -1 ? unscoped : unscoped.slice(dot + 1);
}

/**
 * Picks the card that draws a node: structural kinds first (input → start,
 * output → end, branch, join, loop/foreach → container, subflow, wait,
 * human, note), then task nodes by the tail of their canonical type id
 * (`decision.choice` → decision, `decision.confidence_gate` → gate, `tools.http`
 * → http, `ai.*` → generation, …), then the manifest's decision kind and
 * category, then the node's own category; else `default`.
 */
export function cardVariantFor(
  node: Pick<WorkflowNodeView, "kind" | "nodeType" | "category">,
  manifest?: CardManifest,
): NodeCardVariant {
  if (node.kind !== "task") return KIND_VARIANT[node.kind];
  if (node.nodeType) {
    const tail = nodeTypeTail(node.nodeType);
    const exact = TYPE_TAIL_VARIANT[tail];
    if (exact) return exact;
    const group = tail.split(".")[0];
    const byGroup =
      group !== undefined && tail.includes(".") ? TYPE_GROUP_VARIANT[group] : undefined;
    if (byGroup) return byGroup;
    if (group === "decision") return "decision";
    if (group === "tools") return "tool";
  }
  if (manifest?.decision) return DECISION_KIND_VARIANT[manifest.decision.kind] ?? "decision";
  return CATEGORY_VARIANT[manifest?.metadata.category ?? node.category];
}

/** Mono type label for the header: the last segment of the type id ("flowaid.decision.choice" → "choice"), else the kind. */
export function nodeTypeLabel(node: Pick<WorkflowNodeView, "kind" | "nodeType">): string {
  if (!node.nodeType) return node.kind;
  return node.nodeType.split(".").at(-1) ?? node.nodeType;
}

/** Full type id for labels and aria text: the manifest id of a task node, else its kind. */
export function nodeTypeId(node: Pick<WorkflowNodeView, "kind" | "nodeType">): string {
  return node.nodeType ?? node.kind;
}

// ---------------------------------------------------------------------------
// handle ids (UI.md §4.2)
// ---------------------------------------------------------------------------

/** Handle kinds: data in/out, control-out and the single control-in notch. */
export type HandleKind = "in" | "out" | "ctl" | "ctl-in";

/** The one handle id format: `out:<port>`, `in:<port>`, `ctl:<port>`, `ctl-in`. */
export const HANDLE_ID_PATTERN = /^(out|in|ctl):[a-z][a-z0-9_]*$|^ctl-in$/;

/** The control-in handle id. */
export const CONTROL_IN = "ctl-in";

/** Builds a handle id: `handleId("out", "reply")` → `out:reply`; `handleId("ctl-in")` → `ctl-in`. */
export function handleId(kind: "ctl-in"): typeof CONTROL_IN;
export function handleId(kind: Exclude<HandleKind, "ctl-in">, port: string): string;
export function handleId(kind: HandleKind, port?: string): string {
  if (kind === "ctl-in") return CONTROL_IN;
  return `${kind}:${port ?? ""}`;
}

/** Splits a handle id; `undefined` for anything that is not one of the four forms. */
export function parseHandleId(
  id: string | null | undefined,
): { kind: "ctl-in" } | { kind: Exclude<HandleKind, "ctl-in">; port: string } | undefined {
  if (!id || !HANDLE_ID_PATTERN.test(id)) return undefined;
  if (id === CONTROL_IN) return { kind: "ctl-in" };
  const i = id.indexOf(":");
  const kind = id.slice(0, i);
  const port = id.slice(i + 1);
  if (kind === "in" || kind === "out" || kind === "ctl") return { kind, port };
  return undefined;
}

/** `xyflow` handle type for a handle kind: data-ins and the control-in are targets. */
export function handleTypeOf(kind: HandleKind): "source" | "target" {
  return kind === "in" || kind === "ctl-in" ? "target" : "source";
}

const DONE: ControlPortView = { id: "done", label: "done" };
const BRANCH_DEFAULT: ControlPortView[] = [
  { id: "true", label: "true" },
  { id: "false", label: "false" },
];
const HUMAN_DEFAULT: ControlPortView[] = [
  { id: "approved", label: "approved" },
  { id: "rejected", label: "rejected" },
];

/**
 * The control-outs a card draws when `node.routes` is empty (ARCHITECTURE.md
 * §2.4): nothing for an output or a note, `true`/`false` for a branch,
 * `approved`/`rejected` for a human node, `done` for everything else. Gate and
 * router cards derive theirs from config (`gateRoutes`, `node.routes`).
 */
export function controlOutsFor(
  node: Pick<WorkflowNodeView, "routes">,
  variant: NodeCardVariant,
): ControlPortView[] {
  if (variant === "end" || variant === "note") return [];
  if (node.routes?.length) return node.routes;
  if (variant === "branch") return BRANCH_DEFAULT;
  if (variant === "human") return HUMAN_DEFAULT;
  if (variant === "router") return [];
  return [DONE];
}

/** Whether a variant has the control-in notch: every node but the workflow input and notes. */
export function hasControlIn(variant: NodeCardVariant): boolean {
  return variant !== "start" && variant !== "note";
}

/** Value of the first `node.meta` entry whose label matches one of `labels` (case-insensitive). */
export function metaValue(
  node: Pick<WorkflowNodeView, "meta">,
  ...labels: string[]
): string | undefined {
  if (!node.meta) return undefined;
  const wanted = labels.map((l) => l.toLowerCase());
  for (const entry of node.meta) {
    if (wanted.includes(entry.label.toLowerCase())) return entry.value;
  }
  return undefined;
}

/** `node.meta` without the entries a card renders in a dedicated slot. */
export function metaWithout(
  node: Pick<WorkflowNodeView, "meta">,
  ...labels: string[]
): Array<{ label: string; value: string }> {
  const drop = labels.map((l) => l.toLowerCase());
  return (node.meta ?? []).filter((m) => !drop.includes(m.label.toLowerCase()));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const v = value[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const v = value[key];
  return typeof v === "string" ? v : undefined;
}

/** Card width in px (matches the brand spec). */
export const NODE_WIDTH = 232;
/** Vertical centre of the first handle: header padding (10px) + half the 14px header line. */
export const HANDLE_TOP = 17;
/** Spacing between stacked handles on one side. */
export const HANDLE_GAP = 14;
export const HANDLE_SIZE = 8;

/** Top offset (px) of the n-th stacked handle on a card side. */
export function handleOffset(index: number): number {
  return HANDLE_TOP + index * HANDLE_GAP;
}

/** A port is "typed" when it carries a constraining schema or its type is a concrete or named type rather than `any`. */
export function isPortTyped(port: Pick<PortView, "type" | "schema">): boolean {
  if (port.schema && Object.keys(port.schema).some((k) => k !== "title" && k !== "description"))
    return true;
  const t = port.type.trim().toLowerCase();
  return t !== "" && t !== "any" && t !== "unknown";
}

/** Whether a run is in progress (drives live counters and the ring animation). */
export function runIsActive(run: NodeRunView | undefined): boolean {
  return run?.status === "running";
}

/** `data-*` attributes that drive the shared node state styling in node.css. */
export function nodeStateAttributes(input: {
  node: Pick<WorkflowNodeView, "id" | "category" | "disabled">;
  run?: Pick<NodeRunView, "status">;
  selected?: boolean;
  hovered?: boolean;
  dragging?: boolean;
  disabled?: boolean;
}): Record<string, string | undefined> {
  const disabled = input.disabled ?? input.node.disabled ?? false;
  return {
    "data-node-id": input.node.id,
    "data-category": input.node.category,
    "data-status": input.run?.status ?? "idle",
    "data-selected": input.selected ? "true" : "false",
    "data-hovered": input.hovered ? "true" : undefined,
    "data-dragging": input.dragging ? "true" : undefined,
    "data-disabled": disabled ? "true" : "false",
  };
}
