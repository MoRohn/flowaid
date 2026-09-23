/**
 * Realistic sample data for the node gallery and tests: a support-triage
 * workflow (intent choice, urgency score, escalation noul, router, HTTP
 * tools, generative reply, safety guard, confidence gate, approval, join,
 * wait and a note). Nodes use the contract kinds and canonical
 * `flowaid.*` type ids (CONTRACTS.ts §2, §5).
 */
import type { NodeRunView, WorkflowNodeView } from "@/types";
import { makeBooleanDecision, makeChoiceDecision, makeScoreDecision } from "@/lib/decisionBuilders";

type NodeInput = Omit<WorkflowNodeView, "inputs" | "outputs"> &
  Partial<Pick<WorkflowNodeView, "inputs" | "outputs">>;

export function mkNode(input: NodeInput): WorkflowNodeView {
  return {
    inputs: [{ id: "in", label: "input", type: "ticket", required: true }],
    outputs: [{ id: "out", label: "output", type: "any" }],
    ...input,
  };
}

export function mkRun(node: WorkflowNodeView, over: Partial<NodeRunView> = {}): NodeRunView {
  return {
    id: `nr_${node.id}`,
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.nodeType ?? node.kind,
    category: node.category,
    status: "completed",
    attempt: 1,
    startedAt: "2026-09-22T14:02:11.000Z",
    endedAt: "2026-09-22T14:02:11.412Z",
    durationMs: 412,
    ...over,
  };
}

/** ISO timestamp `minutes` minutes before now (for live timers). */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const triage = {
  start: mkNode({
    id: "start",
    kind: "input",
    category: "flow",
    name: "Start",
    inputs: [],
    outputs: [{ id: "out", label: "ticket", type: "ticket" }],
  }),
  parse: mkNode({
    id: "parse",
    kind: "task",
    nodeType: "flowaid.data.transform",
    category: "data",
    name: "Parse ticket",
    description: "Normalise subject, body and customer id",
    meta: [{ label: "fields", value: "4" }],
    inputs: [{ id: "in", label: "raw", type: "any" }],
    outputs: [{ id: "out", label: "ticket", type: "ticket" }],
  }),
  intent: mkNode({
    id: "intent",
    kind: "task",
    nodeType: "flowaid.decision.choice",
    category: "decision",
    name: "Intent",
    description: "Which team should handle this?",
    provider: "jev-latest",
    outputs: [{ id: "out", label: "decision", type: "decision" }],
  }),
  urgency: mkNode({
    id: "urgency",
    kind: "task",
    nodeType: "flowaid.decision.score",
    category: "decision",
    name: "Urgency",
    description: "How urgent is this request?",
    provider: "jev-latest",
    outputs: [{ id: "out", label: "decision", type: "decision" }],
  }),
  escalation: mkNode({
    id: "escalation",
    kind: "task",
    nodeType: "flowaid.decision.boolean",
    category: "decision",
    name: "Escalation",
    description: "Does this need a manager?",
    provider: "jev-latest",
    outputs: [{ id: "out", label: "decision", type: "decision" }],
  }),
  lookup: mkNode({
    id: "lookup",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    name: "Lookup account",
    meta: [
      { label: "method", value: "GET" },
      { label: "path", value: "/customers/{id}" },
      { label: "credential", value: "stripe-prod" },
      { label: "timeout", value: "5 s" },
    ],
    outputs: [{ id: "out", label: "customer", type: "customer" }],
  }),
  refund: mkNode({
    id: "refund",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    name: "Issue refund",
    meta: [
      { label: "method", value: "POST" },
      { label: "path", value: "/refunds" },
      { label: "credential", value: "stripe-prod" },
    ],
    outputs: [{ id: "out", label: "refund", type: "refund" }],
  }),
  purge: mkNode({
    id: "purge",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    name: "Purge session",
    meta: [
      { label: "method", value: "DELETE" },
      { label: "path", value: "/sessions/{id}" },
      { label: "credential", value: "auth-admin" },
    ],
  }),
  ticket: mkNode({
    id: "ticket",
    kind: "task",
    nodeType: "flowaid.tools.mcp",
    category: "tool",
    name: "Create ticket",
    description: "Open an issue for engineering",
    meta: [
      { label: "tool", value: "linear.create_issue" },
      { label: "credential", value: "linear-oauth" },
    ],
  }),
  router: mkNode({
    id: "router",
    kind: "task",
    nodeType: "flowaid.decision.router",
    category: "decision",
    name: "Route by team",
    description: "intent.value",
    routes: [
      { id: "billing", label: "billing", condition: "== 'billing'" },
      { id: "technical", label: "technical", condition: "== 'technical'" },
      { id: "account", label: "account", condition: "== 'account'" },
      { id: "other", label: "other", condition: "else" },
    ],
    outputs: [],
  }),
  branch: mkNode({
    id: "branch",
    kind: "branch",
    category: "flow",
    name: "Large refund?",
    description: "refund.amount > 100",
    routes: [
      { id: "true", label: "true" },
      { id: "false", label: "false" },
    ],
    outputs: [],
  }),
  draft: mkNode({
    id: "draft",
    kind: "task",
    nodeType: "flowaid.ai.generate",
    category: "generation",
    name: "Draft reply",
    description: "Write the response for the chosen team",
    provider: "gpt-5-mini",
    meta: [
      { label: "temperature", value: "0.2" },
      { label: "max", value: "600 tok" },
    ],
    outputs: [{ id: "out", label: "reply", type: "message" }],
  }),
  safety: mkNode({
    id: "safety",
    kind: "task",
    nodeType: "flowaid.safety.guard",
    category: "safety",
    name: "Safety check",
    description: "Redact PII before anything leaves",
    meta: [{ label: "policy", value: "pii-redaction-v3" }],
    outputs: [{ id: "out", label: "reply", type: "message" }],
  }),
  gate: mkNode({
    id: "gate",
    kind: "task",
    nodeType: "flowaid.decision.confidence_gate",
    category: "decision",
    name: "Confidence gate",
    meta: [
      { label: "threshold", value: "0.90" },
      { label: "reviewBand", value: "0.20" },
    ],
    inputs: [{ id: "in", label: "decision", type: "decision", required: true }],
    outputs: [],
  }),
  approve: mkNode({
    id: "approve",
    kind: "human",
    category: "human",
    name: "Approve refund",
    description: "Confidence below 0.90",
    meta: [
      { label: "assignee", value: "Maya Chen" },
      { label: "expires", value: "4 h" },
    ],
    outputs: [{ id: "out", label: "approval", type: "approval" }],
  }),
  loop: mkNode({
    id: "loop",
    kind: "loop",
    category: "flow",
    name: "Retry lookup",
    description: "Until the account resolves",
    bounds: { maxIterations: 10, timeoutMs: 60_000, maxCostUsd: 0.5 },
  }),
  subflow: mkNode({
    id: "subflow",
    kind: "subflow",
    category: "flow",
    name: "Refund flow",
    description: "Runs the shared refund workflow",
    meta: [
      { label: "workflow", value: "billing / refund" },
      { label: "version", value: "12" },
    ],
  }),
  code: mkNode({
    id: "code",
    kind: "task",
    nodeType: "flowaid.tools.code",
    category: "tool",
    name: "Normalise email",
    description: "Lower-case and strip plus tags",
    meta: [{ label: "language", value: "typescript" }],
  }),
  agent: mkNode({
    id: "agent",
    kind: "task",
    nodeType: "flowaid.ai.agent",
    category: "agent",
    name: "Research agent",
    description: "Find prior tickets from this customer",
    provider: "claude-sonnet-4.5",
    meta: [{ label: "tools", value: "5" }],
    bounds: { maxIterations: 12, maxCostUsd: 0.5 },
  }),
  state: mkNode({
    id: "state",
    kind: "task",
    nodeType: "flowaid.state.memory",
    category: "state",
    name: "Conversation memory",
    description: "Last 20 turns for this customer",
    meta: [
      { label: "memory", value: "conversation" },
      { label: "ttl", value: "30 d" },
    ],
  }),
  retrieval: mkNode({
    id: "retrieval",
    kind: "task",
    nodeType: "flowaid.retrieval.search",
    category: "retrieval",
    name: "Search help centre",
    description: "Relevant articles for the reply",
    meta: [
      { label: "index", value: "help-center-v2" },
      { label: "top_k", value: "5" },
    ],
  }),
  join: mkNode({
    id: "join",
    kind: "join",
    category: "flow",
    name: "Merge lookups",
    description: "Continue once account and incident are in",
    meta: [
      { label: "mode", value: "all" },
      { label: "timeout", value: "30 s" },
    ],
    inputs: [
      { id: "account", label: "account", type: "customer" },
      { id: "incident", label: "incident", type: "object" },
    ],
    outputs: [
      { id: "values", label: "values", type: "object" },
      { id: "first", label: "first", type: "string" },
    ],
  }),
  wait: mkNode({
    id: "wait",
    kind: "wait",
    category: "flow",
    name: "Wait for payment",
    description: "Resume when the customer pays",
    meta: [
      { label: "event", value: "invoice.paid" },
      { label: "timeout", value: "24 h" },
    ],
    inputs: [],
    outputs: [{ id: "payload", label: "payload", type: "object" }],
  }),
  note: mkNode({
    id: "note",
    kind: "note",
    category: "flow",
    name: "Why two lookups?",
    description:
      "Billing tickets need the account; outage tickets need the incident. The join waits for both so the reply can cite either.",
    inputs: [],
    outputs: [],
  }),
  end: mkNode({
    id: "end",
    kind: "output",
    category: "flow",
    name: "End",
    inputs: [{ id: "in", label: "result", type: "any" }],
    outputs: [],
  }),
} satisfies Record<string, WorkflowNodeView>;

export const triageRuns = {
  start: mkRun(triage.start, { durationMs: 1 }),
  parse: mkRun(triage.parse, { durationMs: 7 }),
  intent: mkRun(triage.intent, {
    durationMs: 412,
    decisionQuestion: "Which team should handle this?",
    decision: makeChoiceDecision({
      probabilities: { billing: 0.81, technical: 0.12, account: 0.04, other: 0.03 },
      model: "jev-latest",
      latencyMs: 412,
      usage: { inputTokens: 612, outputTokens: 4 },
      costUsd: 0.00031,
    }),
    usage: { inputTokens: 612, outputTokens: 4 },
    costUsd: 0.00031,
  }),
  urgency: mkRun(triage.urgency, {
    durationMs: 388,
    decisionQuestion: "How urgent is this request?",
    decision: makeScoreDecision({
      levels: ["Low", "Medium", "High", "Critical"],
      value: 2,
      confidence: 0.58,
      probabilities: [0.06, 0.21, 0.58, 0.15],
      model: "jev-latest",
      latencyMs: 388,
    }),
  }),
  escalation: mkRun(triage.escalation, {
    durationMs: 301,
    decisionQuestion: "Does this need a manager?",
    decision: makeBooleanDecision({ pYes: 0.13, model: "jev-latest", latencyMs: 301 }),
  }),
  lookup: mkRun(triage.lookup, {
    durationMs: 184,
    toolCall: { name: "http.get", args: { id: "cus_9f2k" }, statusCode: 200, durationMs: 184 },
  }),
  refund: mkRun(triage.refund, {
    status: "failed",
    durationMs: 1290,
    toolCall: { name: "http.post", args: { amount: 4900 }, statusCode: 502, durationMs: 1290 },
    error: {
      code: "TOOL_EXECUTION_ERROR",
      message: "Upstream returned 502 from /refunds; retry after the gateway recovers",
      retryable: true,
    },
  }),
  purge: mkRun(triage.purge, {
    durationMs: 96,
    toolCall: { name: "http.delete", args: { id: "ses_1" }, statusCode: 204, durationMs: 96 },
  }),
  ticket: mkRun(triage.ticket, {
    durationMs: 640,
    toolCall: { name: "linear.create_issue", args: {}, statusCode: 201, durationMs: 640 },
  }),
  router: mkRun(triage.router, { durationMs: 2, routeTaken: "billing" }),
  branch: mkRun(triage.branch, { durationMs: 1, routeTaken: "false" }),
  draftRunning: mkRun(triage.draft, {
    status: "running",
    endedAt: undefined,
    durationMs: undefined,
  }),
  draft: mkRun(triage.draft, {
    durationMs: 2840,
    usage: { inputTokens: 1420, outputTokens: 312 },
    costUsd: 0.0041,
  }),
  safety: mkRun(triage.safety, { durationMs: 38, routeTaken: "pass" }),
  safetyBlocked: mkRun(triage.safety, { durationMs: 41, routeTaken: "block" }),
  gate: mkRun(triage.gate, {
    durationMs: 1,
    routeTaken: "review",
    input: { confidence: 0.81 },
  }),
  approveWaiting: mkRun(triage.approve, {
    status: "waiting",
    startedAt: minutesAgo(4),
    endedAt: undefined,
    durationMs: undefined,
  }),
  approved: mkRun(triage.approve, { durationMs: 512_000, routeTaken: "approved" }),
  loop: mkRun(triage.loop, {
    status: "running",
    endedAt: undefined,
    durationMs: undefined,
    output: { iterations: 3 },
  }),
  subflow: mkRun(triage.subflow, { durationMs: 4210 }),
  code: mkRun(triage.code, { durationMs: 3 }),
  agent: mkRun(triage.agent, {
    status: "running",
    endedAt: undefined,
    durationMs: undefined,
    output: { steps: 4 },
    costUsd: 0.021,
  }),
  state: mkRun(triage.state, { durationMs: 12, output: { keys: 14 } }),
  retrieval: mkRun(triage.retrieval, { durationMs: 220, output: { hits: 4 } }),
  join: mkRun(triage.join, {
    durationMs: 3,
    output: { values: { account: { id: "cus_9f2k" }, incident: null }, first: "account" },
  }),
  waitWaiting: mkRun(triage.wait, {
    status: "waiting",
    startedAt: minutesAgo(12),
    endedAt: undefined,
    durationMs: undefined,
  }),
  end: mkRun(triage.end, { durationMs: 1 }),
} satisfies Record<string, NodeRunView>;

export const sampleCode = `export function normaliseEmail(input: string): string {
  const [local, domain] = input.trim().toLowerCase().split("@");
  return \`\${local?.split("+")[0]}@\${domain}\`;
}`;

export const sampleReply =
  "Hi Jordan, thanks for flagging the duplicate charge on your September invoice. I've confirmed both transactions on our side and issued a refund for the second one; it should appear on your statement within 3 to 5 business days.";
