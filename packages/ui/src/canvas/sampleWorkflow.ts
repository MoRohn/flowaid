/**
 * Sample data for the canvas gallery and tests: a support-triage workflow
 * (intent, urgency, escalation → router → tools → generative reply → safety →
 * confidence gate → review or approval → send) projected the way UI.md §4.2
 * describes it: contract node kinds and canonical `flowaid.*` type ids, port
 * schemas, control edges (`ctl:<port>` → `ctl-in`) from `definition.edges`
 * and data edges (`out:<port>` → `in:<port>`) from the bindings, plus a
 * simulated run that advances node by node.
 */
import { toFlowNode } from "@/node";
import type {
  ContractJsonSchema,
  DecisionResult,
  Diagnostic,
  NodeRunView,
  PortView,
  RunView,
  WorkflowEdgeView,
  WorkflowNodeView,
} from "@/types";
import { makeBooleanDecision, makeChoiceDecision, makeScoreDecision } from "@/lib/decisionBuilders";
import { toCanvasEdge } from "./edgeTypes";
import type { CanvasEdge, CanvasNode, NodeDefinitionView } from "./types";

/** The ticket the webhook delivers (the workflow's `inputs` schema). */
export const TICKET_SCHEMA: ContractJsonSchema = {
  type: "object",
  title: "Ticket",
  required: ["id", "subject", "body", "customer_id"],
  properties: {
    id: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    customer_id: { type: "string" },
    tier: { enum: ["free", "pro", "enterprise"] },
  },
};

/** A `DecisionResult` as decision nodes emit it (trimmed to the fields ports rely on). */
export const DECISION_SCHEMA: ContractJsonSchema = {
  type: "object",
  title: "DecisionResult",
  required: ["kind", "value", "confidence"],
  properties: {
    kind: { enum: ["boolean", "choice", "score"] },
    value: {},
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

const OBJECT_SCHEMA: ContractJsonSchema = { type: "object" };
const STRING_SCHEMA: ContractJsonSchema = { type: "string" };
const RESPONSE_SCHEMA: ContractJsonSchema = {
  type: "object",
  title: "HttpResponse",
  required: ["status", "body"],
  properties: { status: { type: "integer", minimum: 100, maximum: 599 }, body: {} },
};

const port = (
  id: string,
  label: string,
  type: string,
  schema: ContractJsonSchema,
  required?: boolean,
): PortView =>
  required === undefined ? { id, label, type, schema } : { id, label, type, schema, required };
const decisionOut = port("decision", "decision", "decision", DECISION_SCHEMA);
const stateIn = port("state", "state", "object", OBJECT_SCHEMA, true);

export const SAMPLE_NODES: WorkflowNodeView[] = [
  {
    id: "start",
    kind: "input",
    category: "flow",
    name: "Ticket received",
    description: "Webhook from the help desk",
    inputs: [],
    outputs: [port("ticket", "ticket", "object", TICKET_SCHEMA)],
    meta: [{ label: "trigger", value: "webhook" }],
  },
  {
    id: "intent",
    kind: "task",
    nodeType: "flowaid.decision.choice",
    category: "decision",
    name: "Intent",
    description: "Which team should handle this?",
    provider: "jev-latest",
    inputs: [stateIn],
    outputs: [decisionOut],
    meta: [{ label: "options", value: "4" }],
  },
  {
    id: "urgency",
    kind: "task",
    nodeType: "flowaid.decision.score",
    category: "decision",
    name: "Urgency",
    description: "How urgent is this request?",
    provider: "jev-latest",
    inputs: [stateIn],
    outputs: [decisionOut],
    meta: [{ label: "levels", value: "5" }],
  },
  {
    id: "escalation",
    kind: "task",
    nodeType: "flowaid.decision.boolean",
    category: "decision",
    name: "Escalation",
    description: "Does this need a senior agent?",
    provider: "jev-latest",
    inputs: [stateIn],
    outputs: [decisionOut],
  },
  {
    id: "router",
    kind: "task",
    nodeType: "flowaid.decision.router",
    category: "decision",
    name: "Router",
    description: "Route by intent once urgency and escalation are known",
    inputs: [port("decision", "intent", "decision", DECISION_SCHEMA, true)],
    outputs: [decisionOut],
    routes: [
      { id: "security", label: "security" },
      { id: "billing", label: "billing" },
      { id: "account", label: "account" },
      { id: "other", label: "other" },
    ],
  },
  {
    id: "incident",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    name: "Check incident",
    description: "GET /incidents?account={id}",
    provider: "statuspage_prod",
    inputs: [port("body", "ticket", "object", OBJECT_SCHEMA)],
    outputs: [port("response", "incident", "object", RESPONSE_SCHEMA)],
    meta: [
      { label: "retry", value: "×3" },
      { label: "timeout", value: "8 s" },
    ],
  },
  {
    id: "account",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    name: "Lookup account",
    description: "GET /customers/{id}",
    provider: "stripe_prod",
    inputs: [port("body", "ticket", "object", OBJECT_SCHEMA)],
    outputs: [port("response", "customer", "object", RESPONSE_SCHEMA)],
    meta: [{ label: "retry", value: "×3" }],
  },
  {
    id: "draft",
    kind: "task",
    nodeType: "flowaid.ai.generate",
    category: "generation",
    name: "Draft reply",
    description: "Write the response for the chosen team",
    provider: "gpt-5-mini",
    inputs: [
      port("ticket", "ticket", "object", OBJECT_SCHEMA, true),
      port("context", "context", "string", STRING_SCHEMA),
    ],
    outputs: [port("text", "reply", "string", STRING_SCHEMA)],
    meta: [
      { label: "temp", value: "0.3" },
      { label: "max", value: "600 tok" },
    ],
  },
  {
    id: "safety",
    kind: "task",
    nodeType: "flowaid.safety.guard",
    category: "safety",
    name: "Safety check",
    description: "No PII, no promises of refunds",
    provider: "jev-latest",
    inputs: [port("text", "reply", "string", STRING_SCHEMA, true)],
    outputs: [decisionOut],
  },
  {
    id: "gate",
    kind: "task",
    nodeType: "flowaid.decision.confidence_gate",
    category: "decision",
    name: "Confidence gate",
    description: "pass ≥ 0.90 · review ≥ 0.70 · else fail",
    inputs: [port("decision", "decision", "decision", DECISION_SCHEMA, true)],
    outputs: [decisionOut],
    routes: [
      { id: "pass", label: "pass", condition: "≥ 0.90" },
      { id: "review", label: "review", condition: "0.70–0.90" },
      { id: "fail", label: "fail", condition: "< 0.70" },
    ],
  },
  {
    id: "review",
    kind: "task",
    nodeType: "flowaid.decision.boolean",
    category: "decision",
    name: "Secondary review",
    description: "Is the reply safe to send as is?",
    provider: "jev-large",
    inputs: [port("state", "reply", "string", STRING_SCHEMA, true)],
    outputs: [decisionOut],
  },
  {
    id: "approve",
    kind: "human",
    category: "human",
    name: "Approve reply",
    description: "Confidence below 0.70",
    inputs: [port("value", "reply", "string", STRING_SCHEMA, true)],
    outputs: [port("value", "reply", "string", STRING_SCHEMA)],
    meta: [{ label: "assignee", value: "support-leads" }],
  },
  {
    id: "send",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    name: "Send reply",
    description: "POST /tickets/{id}/reply",
    provider: "zendesk_prod",
    inputs: [port("body", "reply", "string", STRING_SCHEMA, true)],
    outputs: [port("response", "response", "object", RESPONSE_SCHEMA)],
  },
];

const ctl = (
  id: string,
  source: string,
  target: string,
  route = "done",
  extra: Partial<WorkflowEdgeView> = {},
): WorkflowEdgeView => ({
  id,
  kind: "control",
  source,
  sourceHandle: `ctl:${route}`,
  target,
  targetHandle: "ctl-in",
  route,
  ...extra,
});

const data = (
  id: string,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
  extra: Partial<WorkflowEdgeView> = {},
): WorkflowEdgeView => ({
  id,
  kind: "data",
  source,
  sourceHandle: `out:${sourcePort}`,
  target,
  targetHandle: `in:${targetPort}`,
  via: "ref",
  ...extra,
});

/** Control edges: the workflow's `edges[]` (activation). */
export const SAMPLE_CONTROL_EDGES: WorkflowEdgeView[] = [
  ctl("c-start-intent", "start", "intent"),
  ctl("c-start-urgency", "start", "urgency"),
  ctl("c-start-escalation", "start", "escalation"),
  ctl("c-intent-router", "intent", "router"),
  ctl("c-urgency-router", "urgency", "router"),
  ctl("c-escalation-router", "escalation", "router"),
  ctl("c-router-security", "router", "incident", "security", {
    label: "security 0.81",
    probability: 0.81,
  }),
  ctl("c-router-billing", "router", "account", "billing", {
    label: "billing 0.12",
    probability: 0.12,
  }),
  ctl("c-router-account", "router", "draft", "account", {
    label: "account 0.04",
    probability: 0.04,
  }),
  ctl("c-router-other", "router", "draft", "other", { label: "other 0.03", probability: 0.03 }),
  ctl("c-incident-draft", "incident", "draft"),
  ctl("c-account-draft", "account", "draft"),
  ctl("c-draft-safety", "draft", "safety"),
  ctl("c-safety-gate", "safety", "gate"),
  ctl("c-gate-pass", "gate", "send", "pass", { label: "confidence ≥ 0.90" }),
  ctl("c-gate-review", "gate", "approve", "review", { label: "0.70 ≤ confidence < 0.90" }),
  ctl("c-gate-fail", "gate", "review", "fail", { label: "confidence < 0.70" }),
  ctl("c-review-send", "review", "send"),
  ctl("c-approve-send", "approve", "send", "approved"),
];

/** Data edges: the plan's `dataEdges` (bindings). Template and expression references are implicit. */
export const SAMPLE_DATA_EDGES: WorkflowEdgeView[] = [
  data("d-start-intent", "start", "ticket", "intent", "state", { schema: TICKET_SCHEMA }),
  data("d-start-urgency", "start", "ticket", "urgency", "state", { schema: TICKET_SCHEMA }),
  data("d-start-escalation", "start", "ticket", "escalation", "state", { schema: TICKET_SCHEMA }),
  data("d-intent-router", "intent", "decision", "router", "decision", { schema: DECISION_SCHEMA }),
  data("d-start-incident", "start", "ticket", "incident", "body", { schema: TICKET_SCHEMA }),
  data("d-start-account", "start", "ticket", "account", "body", { schema: TICKET_SCHEMA }),
  data("d-start-draft", "start", "ticket", "draft", "ticket", { schema: TICKET_SCHEMA }),
  data("d-incident-draft", "incident", "response", "draft", "context", {
    via: "template",
    optional: true,
    path: "/body",
    schema: {},
  }),
  data("d-account-draft", "account", "response", "draft", "context", {
    via: "template",
    optional: true,
    path: "/body",
    schema: {},
  }),
  data("d-draft-safety", "draft", "text", "safety", "text", { schema: STRING_SCHEMA }),
  data("d-safety-gate", "safety", "decision", "gate", "decision", { schema: DECISION_SCHEMA }),
  data("d-draft-review", "draft", "text", "review", "state", { schema: STRING_SCHEMA }),
  data("d-draft-approve", "draft", "text", "approve", "value", { schema: STRING_SCHEMA }),
  data("d-draft-send", "draft", "text", "send", "body", { via: "expr", schema: STRING_SCHEMA }),
  data("d-approve-send", "approve", "value", "send", "body", {
    via: "expr",
    optional: true,
    schema: STRING_SCHEMA,
  }),
];

export const SAMPLE_EDGES: WorkflowEdgeView[] = [...SAMPLE_CONTROL_EDGES, ...SAMPLE_DATA_EDGES];

/** Canvas nodes without positions (run `applyAutoLayout` or set positions yourself). */
export function toCanvasNodes(nodes: WorkflowNodeView[] = SAMPLE_NODES): CanvasNode[] {
  return nodes.map((node) => toFlowNode(node, { x: 0, y: 0 }));
}

/** The projected edges as xyflow edges (`type: "control" | "data"`). */
export function toCanvasEdges(edges: WorkflowEdgeView[] = SAMPLE_EDGES): CanvasEdge[] {
  return edges.map(toCanvasEdge);
}

export const SAMPLE_DIAGNOSTICS: Diagnostic[] = [
  {
    code: "E_CREDENTIAL_SLOT_UNBOUND",
    severity: "error",
    message: "Credential zendesk_prod is not configured for the staging environment",
    location: { nodeId: "send", path: "/nodes/11/credentials/http" },
  },
  {
    code: "W_NULLABLE_INPUT",
    severity: "warning",
    message: "Input context is undefined when the router takes account or other",
    location: { nodeId: "draft", port: "context", bindingPath: "/context" },
    related: [{ nodeId: "router", message: "Routes account and other never reach Draft reply" }],
  },
  {
    code: "W_LOOSE_BOUNDS",
    severity: "warning",
    message: "No timeout set; the default of 30 s applies",
    location: { nodeId: "account", path: "/nodes/6/policy/timeoutMs" },
    fix: {
      title: "Set 5 s timeout",
      patch: [{ op: "add", path: "/nodes/6/policy/timeoutMs", value: 5000 }],
    },
  },
  {
    code: "W_UNREACHABLE_ROUTE",
    severity: "info",
    message: "Route review is never taken in the last 200 runs",
    location: { edgeId: "c-gate-review" },
  },
];

export const SAMPLE_CATALOG: NodeDefinitionView[] = [
  {
    kind: "input",
    name: "Start",
    category: "flow",
    description: "Entry point: API, webhook or schedule",
  },
  {
    kind: "branch",
    name: "Branch",
    category: "flow",
    description: "Deterministic cases over expressions",
  },
  {
    kind: "join",
    name: "Join",
    category: "flow",
    description: "Wait for all, any, n or the first arrival",
  },
  {
    kind: "loop",
    name: "Loop",
    category: "flow",
    description: "Iterate with bounds on count, time and cost",
  },
  {
    kind: "wait",
    name: "Wait",
    category: "flow",
    description: "Delay, timestamp or an external event",
  },
  {
    kind: "flowaid.decision.router",
    name: "Router",
    category: "decision",
    description: "One exit per option of a choice decision",
  },
  {
    kind: "flowaid.decision.confidence_gate",
    name: "Confidence gate",
    category: "decision",
    description: "pass / review / fail by confidence",
  },
  {
    kind: "flowaid.decision.boolean",
    name: "Yes / no",
    category: "decision",
    description: "Typed boolean with P(yes)",
    provider: "jev-latest",
  },
  {
    kind: "flowaid.decision.choice",
    name: "Choice",
    category: "decision",
    description: "Pick one option with a distribution",
    provider: "jev-latest",
  },
  {
    kind: "flowaid.decision.score",
    name: "Score",
    category: "decision",
    description: "Rate on a labelled scale",
    provider: "jev-latest",
  },
  {
    kind: "flowaid.ai.generate",
    name: "Generate text",
    category: "generation",
    description: "Draft, summarise or rewrite",
    provider: "gpt-5-mini",
  },
  {
    kind: "flowaid.ai.structured_generate",
    name: "Generate JSON",
    category: "generation",
    description: "Schema-constrained output",
    provider: "gpt-5-mini",
  },
  {
    kind: "flowaid.ai.agent",
    name: "Agent",
    category: "agent",
    description: "Tool-using loop with a goal",
  },
  {
    kind: "flowaid.tools.http",
    name: "HTTP request",
    category: "tool",
    description: "Call a REST endpoint with retries",
  },
  {
    kind: "flowaid.tools.mcp",
    name: "MCP tool",
    category: "tool",
    description: "Invoke a tool from an MCP server",
  },
  {
    kind: "flowaid.tools.code",
    name: "Code",
    category: "tool",
    description: "Run a sandboxed TypeScript function",
  },
  {
    kind: "flowaid.data.transform",
    name: "Transform",
    category: "data",
    description: "Map, pick and rename fields",
  },
  {
    kind: "flowaid.data.template",
    name: "Template",
    category: "data",
    description: "Render a string from inputs",
  },
  {
    kind: "flowaid.retrieval.retriever",
    name: "Vector search",
    category: "retrieval",
    description: "Top-k over an index",
  },
  {
    kind: "flowaid.state.memory",
    name: "Memory",
    category: "state",
    description: "Read or write conversation memory",
  },
  {
    kind: "human",
    name: "Approval",
    category: "human",
    description: "Pause for a person to approve or edit",
  },
  {
    kind: "flowaid.safety.guard",
    name: "Guard",
    category: "safety",
    description: "Policy, PII and injection checks",
    provider: "jev-latest",
  },
  {
    kind: "flowaid.dev.log",
    name: "Log",
    category: "developer",
    description: "Write a line to the run log",
  },
  {
    kind: "note",
    name: "Note",
    category: "flow",
    description: "Annotate the canvas; ignored when the workflow runs",
  },
];

// ---------------------------------------------------------------------------
// Simulated run
// ---------------------------------------------------------------------------

const INTENT: DecisionResult = makeChoiceDecision({
  probabilities: { security: 0.81, billing: 0.12, account: 0.04, other: 0.03 },
  model: "jev-1.13.0",
  latencyMs: 84,
  usage: { inputTokens: 412, outputTokens: 6 },
  costUsd: 0.000021,
});
const URGENCY: DecisionResult = makeScoreDecision({
  levels: ["none", "low", "normal", "high", "critical"],
  value: 3,
  confidence: 0.77,
  probabilities: [0.01, 0.04, 0.11, 0.61, 0.23],
  model: "jev-1.13.0",
  latencyMs: 91,
});
const ESCALATION: DecisionResult = makeBooleanDecision({
  pYes: 0.14,
  model: "jev-1.13.0",
  latencyMs: 62,
});
const SAFETY: DecisionResult = makeBooleanDecision({
  pYes: 0.64,
  model: "jev-1.13.0",
  latencyMs: 73,
});

interface Step {
  nodeId: string;
  durationMs: number;
  decision?: DecisionResult;
  routeTaken?: string;
  waits?: boolean;
  toolCall?: NodeRunView["toolCall"];
  usage?: NodeRunView["usage"];
  costUsd?: number;
}

export const SAMPLE_RUN_STEPS: Step[] = [
  { nodeId: "start", durationMs: 2 },
  {
    nodeId: "intent",
    durationMs: 84,
    decision: INTENT,
    usage: INTENT.usage,
    costUsd: INTENT.costUsd,
  },
  { nodeId: "urgency", durationMs: 91, decision: URGENCY },
  { nodeId: "escalation", durationMs: 62, decision: ESCALATION },
  { nodeId: "router", durationMs: 1, routeTaken: "security" },
  {
    nodeId: "incident",
    durationMs: 412,
    toolCall: {
      name: "GET /incidents",
      args: { account: "acct_9f3k" },
      ok: true,
      statusCode: 200,
      durationMs: 402,
    },
  },
  {
    nodeId: "draft",
    durationMs: 1840,
    usage: { inputTokens: 1210, outputTokens: 188 },
    costUsd: 0.00071,
  },
  { nodeId: "safety", durationMs: 73, decision: SAFETY },
  { nodeId: "gate", durationMs: 1, routeTaken: "review" },
  { nodeId: "approve", durationMs: 0, waits: true },
];

const RUN_STARTED = Date.parse("2026-09-22T14:03:11.000Z");

/**
 * Builds the run after `progress` steps have finished (0 = queued, steps.length
 * = every step done). The step at `progress` is running, or waiting when it is
 * the human node.
 */
export function buildSampleRun(progress: number, steps: Step[] = SAMPLE_RUN_STEPS): RunView {
  const done = Math.max(0, Math.min(progress, steps.length));
  const nodeRuns: NodeRunView[] = [];
  let clock = RUN_STARTED;
  const byId = new Map(SAMPLE_NODES.map((n) => [n.id, n]));
  steps.forEach((s, i) => {
    const node = byId.get(s.nodeId);
    if (!node) return;
    const base: NodeRunView = {
      id: `nr_${String(i + 1).padStart(2, "0")}`,
      nodeId: s.nodeId,
      nodeName: node.name,
      nodeType: node.nodeType ?? node.kind,
      category: node.category,
      status: "pending",
      attempt: 1,
    };
    if (i < done && s.waits) {
      // A human step never completes on its own: it stays waiting.
      nodeRuns.push({ ...base, status: "waiting", startedAt: new Date(clock).toISOString() });
    } else if (i < done) {
      nodeRuns.push({
        ...base,
        status: "completed",
        startedAt: new Date(clock).toISOString(),
        endedAt: new Date(clock + s.durationMs).toISOString(),
        durationMs: s.durationMs,
        decision: s.decision,
        routeTaken: s.routeTaken,
        toolCall: s.toolCall,
        usage: s.usage,
        costUsd: s.costUsd,
      });
      clock += s.durationMs;
    } else if (i === done) {
      nodeRuns.push({
        ...base,
        status: s.waits ? "waiting" : "running",
        startedAt: new Date(clock).toISOString(),
      });
    }
  });
  const current = steps[done];
  const waiting = current?.waits === true || nodeRuns.some((r) => r.status === "waiting");
  const status: RunView["status"] =
    done === 0
      ? "queued"
      : waiting
        ? "waiting_for_human"
        : done >= steps.length
          ? "completed"
          : "running";
  const cost = nodeRuns.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  return {
    id: "run_01j8k2v9",
    workflowId: "wf_support_triage",
    workflowName: "Support triage",
    version: 12,
    environment: { id: "env_prod", name: "Production", protected: true },
    status,
    origin: "webhook",
    createdAt: new Date(RUN_STARTED - 40).toISOString(),
    startedAt: new Date(RUN_STARTED).toISOString(),
    durationMs: clock - RUN_STARTED,
    costUsd: Math.round(cost * 1e6) / 1e6,
    nodeRuns,
    pendingApproval: waiting
      ? {
          id: "apr_7c2d",
          runId: "run_01j8k2v9",
          nodeId: "approve",
          nodeName: "Approve reply",
          request: {
            title: "Approve the drafted reply",
            context: { ticket: "TCK-48213" },
            mode: {
              type: "review",
              value: "Hi — we have locked the unrecognised device…",
              schema: { type: "string" },
            },
            assignees: ["support-leads"],
            expiresAt: null,
            externalReview: false,
            origin: "human_node",
          },
          reason: "Safety confidence 0.64 below the review floor 0.70",
          requestedAt: new Date(clock).toISOString(),
          decision: SAFETY,
        }
      : undefined,
  };
}
