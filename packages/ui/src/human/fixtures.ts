/**
 * Realistic sample data for the human gallery: a support-triage workflow
 * (Intent choice → Urgency score → Escalation noul → Router → HTTP tools →
 * generative reply → safety noul → confidence gate → approval). The requests
 * are spec-exact `HumanRequest`s (CONTRACTS.ts §9) joined into
 * `ApprovalRequestView`s the way `humanTaskToApproval` builds them.
 * Not exported from the package index.
 */
import type { ApprovalRequestView, DecisionResult, HumanRequest, NodeRunView } from "@/types";
import { makeBooleanDecision, makeChoiceDecision, makeScoreDecision } from "@/lib/decisionBuilders";
import type { EscalationTarget } from "./EscalationDialog";
import type { ReviewQueueItem } from "./ReviewQueue";

export const FIXTURE_NOW = Date.parse("2026-09-22T14:06:00Z");
const at = (offsetMs: number) => new Date(FIXTURE_NOW + offsetMs).toISOString();
const MIN = 60_000;

export const WORKFLOW_NAME = "Support triage";

export const INTENT_DECISION: DecisionResult = makeChoiceDecision({
  probabilities: { security: 0.71, billing: 0.18, technical: 0.08, sales: 0.03 },
  model: "jev-1.13.0",
  latencyMs: 84,
  usage: { inputTokens: 412, outputTokens: 6 },
  costUsd: 0.00021,
});

export const REFUND_DECISION: DecisionResult = makeBooleanDecision({
  pYes: 0.78,
  model: "jev-1.13.0",
  latencyMs: 92,
  usage: { inputTokens: 388, outputTokens: 4 },
  costUsd: 0.0002,
});

export const SAFETY_DECISION: DecisionResult = makeBooleanDecision({
  pYes: 0.83,
  model: "jev-1.13.0",
  latencyMs: 71,
});

export const URGENCY_DECISION: DecisionResult = makeScoreDecision({
  levels: ["None", "Low", "Normal", "High", "Critical"],
  value: 3.72,
  confidence: 0.77,
  probabilities: [0.02, 0.05, 0.16, 0.49, 0.28],
  model: "jev-1.13.0",
  latencyMs: 61,
});

export const TICKET_CONTEXT = {
  message:
    "Hi, I was charged twice for my Pro subscription this month (invoices #48211 and #48212). I only have one workspace. Can you refund the duplicate? I also can't log in on my phone since yesterday.",
  customer: "Amara Okafor",
  plan: "Pro (annual)",
  channel: "email",
  accountAgeDays: 412,
  priorTickets: 2,
  region: "eu-west-1",
  ticketId: "tkt_01J8XM4Q7R",
};

export const PROPOSED_REPLY =
  "Hi Amara,\n\nThanks for flagging this, and sorry for the trouble. I can see the duplicate charge on invoice #48212 and have issued a full refund of $180.00 to your original payment method. It should appear within 5 to 7 business days.\n\nFor the mobile login problem, could you try signing out and back in? If it still fails, reply with the error you see and we'll dig in.\n\nBest,\nSupport";

export const TEAM_OPTIONS = [
  {
    id: "security",
    label: "Security",
    probability: 0.71,
    description: "Account access, auth, suspicious activity",
  },
  {
    id: "billing",
    label: "Billing",
    probability: 0.18,
    description: "Invoices, refunds, plan changes",
  },
  {
    id: "technical",
    label: "Technical",
    probability: 0.08,
    description: "Bugs, integrations, API",
  },
  { id: "sales", label: "Sales", probability: 0.03, description: "Upgrades, quotes, enterprise" },
];

export const ESCALATION_TARGETS: EscalationTarget[] = [
  {
    id: "team-support-leads",
    name: "Support leads",
    kind: "team",
    description: "3 online · avg 6 min",
  },
  { id: "team-billing", name: "Billing team", kind: "team", description: "2 online · avg 14 min" },
  { id: "team-trust", name: "Trust & safety", kind: "team", description: "On call" },
  { id: "user-priya", name: "Priya Shah", kind: "person", description: "Support lead · Europe" },
  { id: "user-daniel", name: "Daniel Reyes", kind: "person", description: "Billing specialist" },
  { id: "user-mei", name: "Mei Tanaka", kind: "person", description: "Trust & safety · APAC" },
];

const RUN_ID = "0192f0a1-5b3c-4d4e-8f60-0000000f3a01";

function request(
  partial: Partial<HumanRequest> & Pick<HumanRequest, "title" | "mode">,
): HumanRequest {
  return {
    context: TICKET_CONTEXT,
    assignees: [],
    expiresAt: null,
    externalReview: false,
    origin: "human_node",
    ...partial,
  };
}

/** Approval mode: approve or reject a proposed refund. */
export const APPROVE_REJECT_REQUEST: ApprovalRequestView = {
  id: "apr_01J8XM6A1Z",
  runId: RUN_ID,
  nodeId: "approve_refund",
  nodeName: "Approve refund",
  request: request({
    title: "Refund $180.00 to Amara Okafor",
    mode: { type: "approval" },
    context: {
      ...TICKET_CONTEXT,
      action: "POST /v1/refunds { charge: ch_3Q8x2Lk, amount: 18000, reason: duplicate }",
    },
    assignees: ["Priya Shah"],
    expiresAt: at(26 * MIN),
  }),
  requestedAt: at(-4 * MIN - 12_000),
  reason: "Confidence 0.78 is below the pass threshold 0.90",
  decision: REFUND_DECISION,
};

/** Review mode: edit the generated reply before it is sent. */
export const EDIT_OUTPUT_REQUEST: ApprovalRequestView = {
  id: "apr_01J8XM6B7Q",
  runId: RUN_ID,
  nodeId: "review_reply",
  nodeName: "Review reply",
  request: request({
    title: "Customer reply before sending",
    mode: { type: "review", value: PROPOSED_REPLY, schema: { type: "string", minLength: 1 } },
    assignees: ["Priya Shah"],
    expiresAt: at(13 * MIN),
  }),
  requestedAt: at(-2 * MIN - 40_000),
  reason: "Safety check confidence 0.83 is below the pass threshold 0.90",
  decision: SAFETY_DECISION,
};

/** Choice mode: pick the team; the decision's probabilities annotate the options. */
export const SELECT_REQUEST: ApprovalRequestView = {
  id: "apr_01J8XM6C2M",
  runId: RUN_ID,
  nodeId: "route_team",
  nodeName: "Route to team",
  request: request({
    title: "Which team should take this ticket?",
    mode: { type: "choice", options: TEAM_OPTIONS.map(({ id, label }) => ({ id, label })) },
    assignees: ["Daniel Reyes"],
    expiresAt: at(4 * MIN),
  }),
  requestedAt: at(-11 * MIN),
  reason: "Confidence 0.71 is below the review floor 0.75",
  decision: INTENT_DECISION,
};

/** Form mode: a small JSON Schema the reviewer fills in. */
export const FORM_REQUEST: ApprovalRequestView = {
  id: "apr_01J8XM6D9T",
  runId: RUN_ID,
  nodeId: "refund_details",
  nodeName: "Refund details",
  request: request({
    title: "Confirm the refund terms",
    mode: {
      type: "form",
      schema: {
        type: "object",
        properties: {
          amountUsd: {
            type: "number",
            title: "Amount (USD)",
            default: 180,
            minimum: 0,
            maximum: 180,
            description: "Up to the duplicate charge.",
          },
          method: {
            type: "string",
            title: "Refund method",
            enum: ["original_payment", "account_credit"],
            default: "original_payment",
            "x-ui-ext": { widget: "radio" },
          },
          notifyCustomer: { type: "boolean", title: "Email the customer", default: true },
          note: {
            type: "string",
            title: "Internal note",
            "x-ui": { widget: "textarea", placeholder: "Visible to the billing team only" },
          },
        },
        required: ["amountUsd", "method"],
      },
    },
    context: { customer: "Amara Okafor", invoice: "#48212", chargedUsd: 180, plan: "Pro (annual)" },
    expiresAt: at(58 * MIN),
  }),
  requestedAt: at(-40_000),
  reason: "Refund amount exceeds the $100 auto-approve limit",
  decision: REFUND_DECISION,
};

/** An agent suspended before a tool call: the origin is `task_suspend`. */
export const TOOL_APPROVAL_REQUEST: ApprovalRequestView = {
  id: "apr_01J8XM6E4H",
  runId: RUN_ID,
  nodeId: "support_agent",
  nodeName: "Support agent",
  request: request({
    title: "Allow the agent to call helpdesk.close_ticket?",
    mode: { type: "approval" },
    context: {
      tool: "helpdesk.close_ticket",
      args: { ticket: "tkt_01J8XM4Q7R", resolution: "refunded" },
    },
    assignees: ["Mei Tanaka"],
    origin: "task_suspend",
  }),
  requestedAt: at(-6 * MIN),
  reason: "The agent needs approval before calling this tool",
};

export const NODE_RUNS: NodeRunView[] = [
  {
    id: "nr_01",
    nodeId: "start",
    nodeName: "Start",
    nodeType: "flowaid.flow.start",
    category: "flow",
    status: "completed",
    attempt: 1,
    durationMs: 1,
  },
  {
    id: "nr_02",
    nodeId: "parse",
    nodeName: "Parse ticket",
    nodeType: "flowaid.data.transform",
    category: "data",
    status: "completed",
    attempt: 1,
    durationMs: 7,
  },
  {
    id: "nr_03",
    nodeId: "intent",
    nodeName: "Intent",
    nodeType: "flowaid.decision.choice",
    category: "decision",
    status: "completed",
    attempt: 1,
    durationMs: 84,
    decision: INTENT_DECISION,
  },
  {
    id: "nr_04",
    nodeId: "urgency",
    nodeName: "Urgency",
    nodeType: "flowaid.decision.score",
    category: "decision",
    status: "completed",
    attempt: 1,
    durationMs: 61,
    decision: URGENCY_DECISION,
  },
  {
    id: "nr_05",
    nodeId: "escalate",
    nodeName: "Escalation",
    nodeType: "flowaid.decision.boolean",
    category: "decision",
    status: "completed",
    attempt: 1,
    durationMs: 58,
    decision: makeBooleanDecision({ pYes: 0.09, model: "jev-1.13.0", latencyMs: 58 }),
  },
  {
    id: "nr_06",
    nodeId: "router",
    nodeName: "Router",
    nodeType: "flowaid.decision.router",
    category: "flow",
    status: "completed",
    attempt: 1,
    durationMs: 0,
    routeTaken: "billing",
  },
  {
    id: "nr_07",
    nodeId: "lookup",
    nodeName: "Lookup account",
    nodeType: "flowaid.tools.http",
    category: "tool",
    status: "completed",
    attempt: 2,
    durationMs: 212,
    toolCall: {
      name: "GET /customers/{id}",
      args: { id: "cus_9x2" },
      ok: true,
      statusCode: 200,
      durationMs: 212,
    },
  },
  {
    id: "nr_08",
    nodeId: "invoices",
    nodeName: "List invoices",
    nodeType: "flowaid.tools.http",
    category: "tool",
    status: "completed",
    attempt: 1,
    durationMs: 148,
    toolCall: {
      name: "GET /invoices",
      args: { customer: "cus_9x2" },
      ok: true,
      statusCode: 200,
      durationMs: 148,
    },
  },
  {
    id: "nr_09",
    nodeId: "draft",
    nodeName: "Draft reply",
    nodeType: "flowaid.ai.generate",
    category: "generation",
    status: "completed",
    attempt: 1,
    durationMs: 1240,
    usage: { inputTokens: 1830, outputTokens: 142 },
    costUsd: 0.0031,
  },
  {
    id: "nr_10",
    nodeId: "safety",
    nodeName: "Safety check",
    nodeType: "flowaid.safety.output_guard",
    category: "safety",
    status: "completed",
    attempt: 1,
    durationMs: 71,
    decision: SAFETY_DECISION,
  },
  {
    id: "nr_11",
    nodeId: "gate",
    nodeName: "Confidence gate",
    nodeType: "flowaid.decision.confidence_gate",
    category: "flow",
    status: "completed",
    attempt: 1,
    durationMs: 0,
    routeTaken: "review",
  },
  {
    id: "nr_12",
    nodeId: "review_reply",
    nodeName: "Review reply",
    nodeType: "flowaid.human.approval",
    category: "human",
    status: "waiting",
    attempt: 1,
    startedAt: at(-2 * MIN - 40_000),
  },
];

function queueItem(
  id: string,
  nodeId: string,
  nodeName: string,
  title: string,
  reason: string,
  timing: { requested: number; expires?: number },
  extra: {
    assignees?: string[];
    workflowName?: string;
    risk: ReviewQueueItem["risk"];
    mode?: HumanRequest["mode"];
  },
): ReviewQueueItem {
  return {
    id,
    runId: `0192f0a1-5b3c-4d4e-8f60-${id
      .replace(/[^0-9a-f]/gi, "0")
      .padStart(12, "0")
      .slice(-12)
      .toLowerCase()}`,
    nodeId,
    nodeName,
    request: request({
      title,
      mode: extra.mode ?? { type: "approval" },
      assignees: extra.assignees ?? [],
      expiresAt: timing.expires === undefined ? null : at(timing.expires),
    }),
    requestedAt: at(timing.requested),
    reason,
    workflowName: extra.workflowName ?? WORKFLOW_NAME,
    risk: extra.risk,
  };
}

export const QUEUE_ITEMS: ReviewQueueItem[] = [
  { ...SELECT_REQUEST, workflowName: WORKFLOW_NAME, risk: "medium" },
  { ...EDIT_OUTPUT_REQUEST, workflowName: WORKFLOW_NAME, risk: "medium" },
  { ...APPROVE_REJECT_REQUEST, workflowName: WORKFLOW_NAME, risk: "high" },
  queueItem(
    "apr_01J8XM7A0C",
    "approve_credit",
    "Approve credit",
    "Apply $15.00 goodwill credit to Jonas Weber",
    "Confidence 0.86 is below the pass threshold 0.90",
    { requested: -19 * MIN, expires: 41 * MIN },
    { assignees: ["Daniel Reyes"], risk: "low" },
  ),
  queueItem(
    "apr_01J8XM7B2D",
    "approve_credit",
    "Approve credit",
    "Apply $10.00 goodwill credit to Sofia Lindqvist",
    "Confidence 0.88 is below the pass threshold 0.90",
    { requested: -27 * MIN, expires: 33 * MIN },
    { assignees: ["Daniel Reyes"], risk: "low" },
  ),
  queueItem(
    "apr_01J8XM7C5E",
    "publish_kb",
    "Publish article",
    "Knowledge-base article: resetting 2FA",
    "Publishing to the public help centre always requires sign-off",
    { requested: -2 * 60 * MIN, expires: 22 * 60 * MIN },
    {
      assignees: ["Mei Tanaka"],
      workflowName: "Knowledge base sync",
      risk: "low",
      mode: { type: "review", value: "# Resetting 2FA\n\n…", schema: { type: "string" } },
    },
  ),
  queueItem(
    "apr_01J8XM7D8F",
    "suspend",
    "Suspend account",
    "Suspend workspace acme-corp for suspected credential stuffing",
    "Escalation noul answered yes with confidence 0.94; suspensions always require a person",
    { requested: -90_000, expires: -30_000 },
    { workflowName: "Abuse response", risk: "high" },
  ),
  { ...TOOL_APPROVAL_REQUEST, workflowName: WORKFLOW_NAME, risk: "medium" },
];

/** Re-bases every timestamp so the fixtures read as if `FIXTURE_NOW` were `now` (live galleries). */
export function shiftQueueToNow(items: ReviewQueueItem[], now: number): ReviewQueueItem[] {
  const delta = now - FIXTURE_NOW;
  const shift = (iso: string) => new Date(Date.parse(iso) + delta).toISOString();
  return items.map((item) => ({
    ...item,
    requestedAt: shift(item.requestedAt),
    request: {
      ...item.request,
      expiresAt: item.request.expiresAt ? shift(item.request.expiresAt) : null,
    },
  }));
}
