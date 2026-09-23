/**
 * Realistic sample data for the trace gallery and tests: one run of the
 * support-triage workflow (Intent choice → Urgency score → Escalation noul →
 * Router → HTTP tools with a retry → a 3-iteration enrichment loop →
 * generative reply with a provider failover → PII noul → confidence gate →
 * human approval). Timestamps are absolute so the layout is deterministic.
 *
 * The events are spec-exact `RunEvent`s (they parse with `RunEventSchema`);
 * the node-run views keep short ids (`nr_03`) for readability and map onto
 * the events' uuids through `sampleNodeRunUuid`.
 */
import type {
  HumanRequest,
  LogLineView,
  NodeRunView,
  RunEvent,
  RunEventOf,
  RunView,
} from "@/types";
import type { NodeRunEvent } from "./summarizeEvent";
import type { RunStatus } from "@/lib/categories";
import { makeBooleanDecision, makeChoiceDecision, makeScoreDecision } from "@/lib/decisionBuilders";
import type { RunTransitionView } from "./RunStatusTimeline";
import type { EventLogNodeInfo } from "./EventLog";

export const SAMPLE_T0 = Date.parse("2026-09-22T14:03:22.000Z");
export const SAMPLE_RUN_ID = "0192f0a1-5b3c-4d4e-8f60-1a2b3c4d5e6f";
const WORKFLOW_VERSION_ID = "0192f0a1-5b3c-4d4e-8f60-00000000ee01";
const ENVIRONMENT_ID = "0192f0a1-5b3c-4d4e-8f60-00000000ee02";
const HUMAN_TASK_ID = "0192f0a1-5b3c-4d4e-8f60-00000000c001";
const RETRY_TIMER_ID = "0192f0a1-5b3c-4d4e-8f60-00000000d001";

const at = (offsetMs: number): string => new Date(SAMPLE_T0 + offsetMs).toISOString();

/** Deterministic uuid for a sample node run id (`nr_07b` → `…-0000000007b0`). */
export function sampleNodeRunUuid(shortId: string): string {
  const hex = shortId
    .replace(/^nr_/, "")
    .replace(/[^0-9a-f]/gi, "0")
    .toLowerCase();
  return `0192f0a1-5b3c-4d4e-8f60-${hex.padStart(12, "0").slice(-12)}`;
}

interface Span {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  category: NodeRunView["category"];
  start: number;
  end?: number;
  status?: NodeRunView["status"];
  attempt?: number;
  iteration?: number[];
  parentNodeRunId?: string;
  extra?: Partial<NodeRunView>;
}

function span(s: Span): NodeRunView {
  const status = s.status ?? "completed";
  const ended =
    s.end !== undefined && status !== "running" && status !== "waiting" && status !== "retry_wait";
  const base: NodeRunView = {
    id: s.id,
    nodeId: s.nodeId,
    nodeName: s.nodeName,
    nodeType: s.nodeType,
    category: s.category,
    status,
    attempt: s.attempt ?? 1,
    startedAt: at(s.start),
  };
  if (s.iteration) {
    base.iteration = s.iteration;
    base.scope = `enrich#${s.iteration[0] ?? 0}`;
  }
  if (s.parentNodeRunId) base.parentNodeRunId = s.parentNodeRunId;
  if (ended && s.end !== undefined) {
    base.endedAt = at(s.end);
    base.durationMs = s.end - s.start;
  }
  return { ...base, ...s.extra };
}

export const SAMPLE_NODES: Record<string, EventLogNodeInfo> = {
  start: { name: "Start", category: "flow" },
  parse: { name: "Parse ticket", category: "data" },
  intent: { name: "Intent", category: "decision" },
  urgency: { name: "Urgency", category: "decision" },
  escalate: { name: "Escalate?", category: "decision" },
  route: { name: "Route", category: "flow" },
  lookup_account: { name: "Lookup account", category: "tool" },
  lookup_history: { name: "Ticket history", category: "tool" },
  enrich: { name: "Enrich findings", category: "flow" },
  fetch_finding: { name: "Fetch finding", category: "tool" },
  classify: { name: "Classify severity", category: "decision" },
  draft: { name: "Draft reply", category: "generation" },
  pii: { name: "PII check", category: "safety" },
  gate: { name: "Confidence gate", category: "flow" },
  approve: { name: "Approve reply", category: "human" },
  send: { name: "Send reply", category: "tool" },
  end: { name: "End", category: "flow" },
};

export const SAMPLE_NODE_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SAMPLE_NODES).map(([k, v]) => [k, v.name]),
);

const TICKET = {
  id: "TCK-48213",
  subject: "Unknown login from new device, 2FA codes not arriving",
  customer: "cus_9Yt3LqA8",
  channel: "email",
};

const INTENT = makeChoiceDecision({
  probabilities: { security: 0.81, technical: 0.12, billing: 0.04, sales: 0.03 },
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 84,
  usage: { inputTokens: 412, outputTokens: 0 },
  costUsd: 0.000082,
  requestId: "ts_req_01J8Q4Z6A1",
});
const URGENCY = makeScoreDecision({
  levels: ["low", "normal", "elevated", "high", "critical"],
  value: 3.72,
  confidence: 0.77,
  probabilities: [0.01, 0.05, 0.22, 0.48, 0.24],
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 61,
  usage: { inputTokens: 398, outputTokens: 0 },
  costUsd: 0.00008,
});
const ESCALATE = makeBooleanDecision({
  pYes: 0.87,
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 63,
  usage: { inputTokens: 421, outputTokens: 0 },
  costUsd: 0.000084,
});
const PII = makeBooleanDecision({
  pYes: 0.04,
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 58,
  usage: { inputTokens: 512, outputTokens: 0 },
  costUsd: 0.0001,
});

const FINDINGS = [
  {
    id: "fnd_01",
    kind: "new_device_login",
    start: 2015,
    end: 2310,
    cStart: 2315,
    cEnd: 2380,
    severity: "high",
    probs: { high: 0.74, critical: 0.19, medium: 0.05, low: 0.02 },
  },
  {
    id: "fnd_02",
    kind: "mfa_delivery_failure",
    start: 2400,
    end: 2690,
    cStart: 2695,
    cEnd: 2760,
    severity: "medium",
    probs: { medium: 0.62, high: 0.31, low: 0.05, critical: 0.02 },
  },
  {
    id: "fnd_03",
    kind: "geo_anomaly",
    start: 2780,
    end: 3060,
    cStart: 3065,
    cEnd: 3130,
    severity: "critical",
    probs: { critical: 0.68, high: 0.27, medium: 0.04, low: 0.01 },
  },
];

function classifyDecision(f: (typeof FINDINGS)[number]) {
  return makeChoiceDecision({
    probabilities: f.probs,
    value: f.severity,
    provider: "typesafe",
    model: "jev-1.13.0",
    latencyMs: f.cEnd - f.cStart,
    usage: { inputTokens: 240, outputTokens: 0 },
    costUsd: 0.000048,
  });
}

const LOOKUP_ERROR = {
  code: "TOOL_EXECUTION_ERROR" as const,
  message: "GET /v1/customers/cus_9Yt3LqA8 → 503 Service Unavailable (upstream: accounts-api)",
  retryable: true,
};
const LOOKUP_ARGS = { id: "cus_9Yt3LqA8", expand: ["devices", "mfa"] };
const LOOKUP_RESULT = {
  id: "cus_9Yt3LqA8",
  plan: "team",
  mfa: {
    method: "sms",
    phoneVerified: true,
    lastCodeSentAt: "2026-09-22T13:58:41Z",
    deliveryFailures: 3,
  },
  devices: [
    {
      id: "dev_3f9a",
      ua: "Chrome 141 / macOS",
      lastSeen: "2026-09-22T13:51:07Z",
      trusted: true,
      geo: "Berlin, DE",
    },
    {
      id: "dev_b71c",
      ua: "Safari iOS 19",
      lastSeen: "2026-09-22T13:57:30Z",
      trusted: false,
      geo: "Lagos, NG",
    },
  ],
};
const DRAFT_OUTPUT = {
  subject: "Re: Unknown login from new device",
  body: "Hi Priya — thanks for flagging this. We've locked the unrecognised device (Safari on iOS, Lagos) and reset your SMS delivery route, so codes should arrive again within a minute. Please reset your password at…",
};
const DRAFT_USAGE = { inputTokens: 1284, outputTokens: 312 };

/** The redacted request stored on the human task (CONTRACTS.ts §9). */
export const SAMPLE_HUMAN_REQUEST: HumanRequest = {
  title: "Approve the reply to TCK-48213",
  context: { ticket: TICKET.id, intent: "security", confidence: 0.81, reply: DRAFT_OUTPUT.body },
  mode: { type: "approval" },
  assignees: ["support-leads"],
  expiresAt: at(4470 + 24 * 3_600_000),
  externalReview: false,
  origin: "human_node",
};

function baseNodeRuns(): NodeRunView[] {
  const runs: NodeRunView[] = [
    span({
      id: "nr_01",
      nodeId: "start",
      nodeName: "Start",
      nodeType: "flowaid.flow.start",
      category: "flow",
      start: 0,
      end: 1,
      extra: { output: TICKET },
    }),
    span({
      id: "nr_02",
      nodeId: "parse",
      nodeName: "Parse ticket",
      nodeType: "flowaid.data.transform",
      category: "data",
      start: 12,
      end: 19,
      extra: {
        output: {
          text: "Hi, I got an alert about a login from Lagos which wasn't me, and now my 2FA codes never arrive…",
          language: "en",
          words: 84,
        },
      },
    }),
    span({
      id: "nr_03",
      nodeId: "intent",
      nodeName: "Intent",
      nodeType: "flowaid.decision.choice",
      category: "decision",
      start: 31,
      end: 115,
      extra: {
        decision: INTENT,
        decisionQuestion: "Which team should handle this ticket?",
        usage: INTENT.usage,
        costUsd: INTENT.costUsd,
      },
    }),
    span({
      id: "nr_04",
      nodeId: "urgency",
      nodeName: "Urgency",
      nodeType: "flowaid.decision.score",
      category: "decision",
      start: 116,
      end: 177,
      extra: {
        decision: URGENCY,
        decisionQuestion: "How urgent is this request?",
        usage: URGENCY.usage,
        costUsd: URGENCY.costUsd,
      },
    }),
    span({
      id: "nr_05",
      nodeId: "escalate",
      nodeName: "Escalate?",
      nodeType: "flowaid.decision.boolean",
      category: "decision",
      start: 178,
      end: 241,
      extra: {
        decision: ESCALATE,
        decisionQuestion: "Should this ticket skip tier 1?",
        usage: ESCALATE.usage,
        costUsd: ESCALATE.costUsd,
      },
    }),
    span({
      id: "nr_06",
      nodeId: "route",
      nodeName: "Route",
      nodeType: "flowaid.decision.router",
      category: "flow",
      start: 242,
      end: 243,
      extra: { routeTaken: "security", firedPorts: ["security"] },
    }),
    span({
      id: "nr_07a",
      nodeId: "lookup_account",
      nodeName: "Lookup account",
      nodeType: "flowaid.tools.http",
      category: "tool",
      start: 245,
      end: 1060,
      status: "failed",
      attempt: 1,
      extra: {
        error: LOOKUP_ERROR,
        toolCall: {
          name: "accounts.getCustomer",
          args: LOOKUP_ARGS,
          ok: false,
          statusCode: 503,
          durationMs: 815,
        },
      },
    }),
    span({
      id: "nr_07b",
      nodeId: "lookup_account",
      nodeName: "Lookup account",
      nodeType: "flowaid.tools.http",
      category: "tool",
      start: 1560,
      end: 1772,
      attempt: 2,
      extra: {
        toolCall: {
          name: "accounts.getCustomer",
          args: LOOKUP_ARGS,
          result: LOOKUP_RESULT,
          ok: true,
          statusCode: 200,
          durationMs: 212,
        },
      },
    }),
    span({
      id: "nr_08",
      nodeId: "lookup_history",
      nodeName: "Ticket history",
      nodeType: "flowaid.tools.http",
      category: "tool",
      start: 1780,
      end: 1998,
      extra: {
        toolCall: {
          name: "helpdesk.listTickets",
          args: { customer: "cus_9Yt3LqA8", limit: 5 },
          result: {
            tickets: [{ id: "TCK-41077", subject: "Invoice for August", status: "closed" }],
            total: 1,
          },
          ok: true,
          statusCode: 200,
          durationMs: 218,
        },
      },
    }),
    span({
      id: "nr_09",
      nodeId: "enrich",
      nodeName: "Enrich findings",
      nodeType: "flowaid.flow.foreach",
      category: "flow",
      start: 2010,
      end: 3140,
      extra: { output: { findings: 3 } },
    }),
  ];

  FINDINGS.forEach((f, i) => {
    runs.push(
      span({
        id: `nr_10_${i}`,
        nodeId: "fetch_finding",
        nodeName: "Fetch finding",
        nodeType: "flowaid.tools.http",
        category: "tool",
        start: f.start,
        end: f.end,
        iteration: [i],
        parentNodeRunId: "nr_09",
        extra: {
          toolCall: {
            name: "security.getFinding",
            args: { id: f.id },
            result: { id: f.id, kind: f.kind, evidence: 2 },
            ok: true,
            statusCode: 200,
            durationMs: f.end - f.start,
          },
        },
      }),
      span({
        id: `nr_11_${i}`,
        nodeId: "classify",
        nodeName: "Classify severity",
        nodeType: "flowaid.decision.choice",
        category: "decision",
        start: f.cStart,
        end: f.cEnd,
        iteration: [i],
        parentNodeRunId: "nr_09",
        extra: {
          decision: classifyDecision(f),
          decisionQuestion: "How severe is this finding?",
          usage: { inputTokens: 240, outputTokens: 0 },
          costUsd: 0.000048,
        },
      }),
    );
  });

  runs.push(
    span({
      id: "nr_12",
      nodeId: "draft",
      nodeName: "Draft reply",
      nodeType: "flowaid.ai.generate",
      category: "generation",
      start: 3150,
      end: 4390,
      extra: { usage: DRAFT_USAGE, costUsd: 0.00091, output: DRAFT_OUTPUT },
    }),
    span({
      id: "nr_13",
      nodeId: "pii",
      nodeName: "PII check",
      nodeType: "flowaid.safety.pii",
      category: "safety",
      start: 4395,
      end: 4460,
      extra: {
        decision: PII,
        decisionQuestion: "Does the reply leak personal data that the customer did not share?",
        usage: PII.usage,
        costUsd: PII.costUsd,
      },
    }),
    span({
      id: "nr_14",
      nodeId: "gate",
      nodeName: "Confidence gate",
      nodeType: "flowaid.decision.confidence_gate",
      category: "flow",
      start: 4461,
      end: 4462,
      extra: {
        routeTaken: "review",
        firedPorts: ["review"],
        output: { confidence: 0.81, outcome: "review", passed: false },
      },
    }),
    span({
      id: "nr_15",
      nodeId: "approve",
      nodeName: "Approve reply",
      nodeType: "flowaid.human.approval",
      category: "human",
      start: 4470,
      status: "waiting",
    }),
  );
  return runs;
}

export const SAMPLE_LOOP_TOTALS: Record<string, number> = { nr_09: 3 };

const APPROVAL_END = 4470 + 4 * 60_000 + 12_000; // 4 m 12 s of review

function completedTail(): NodeRunView[] {
  return [
    span({
      id: "nr_16",
      nodeId: "send",
      nodeName: "Send reply",
      nodeType: "flowaid.tools.http",
      category: "tool",
      start: APPROVAL_END + 40,
      end: APPROVAL_END + 290,
      extra: {
        toolCall: {
          name: "helpdesk.reply",
          args: { ticket: TICKET.id, bodyRef: "nr_12.output.body" },
          result: { messageId: "msg_7Ka2", status: "sent" },
          ok: true,
          statusCode: 202,
          durationMs: 250,
        },
      },
    }),
    span({
      id: "nr_17",
      nodeId: "end",
      nodeName: "End",
      nodeType: "flowaid.flow.end",
      category: "flow",
      start: APPROVAL_END + 295,
      end: APPROVAL_END + 296,
    }),
  ];
}

/** The run in a given status. `waiting_for_human` is the canonical one. */
export function buildSampleRun(status: RunStatus = "waiting_for_human"): RunView {
  const nodeRuns = baseNodeRuns();
  const base: RunView = {
    id: SAMPLE_RUN_ID,
    workflowId: "0192f0a1-5b3c-4d4e-8f60-00000000aa01",
    workflowName: "Support triage",
    version: 14,
    environment: { id: ENVIRONMENT_ID, name: "production", protected: true },
    status,
    origin: "webhook",
    createdAt: at(-1450),
    startedAt: at(0),
    nodeRuns,
    input: TICKET,
    costUsd: 0.00164,
    usage: { inputTokens: 4707, outputTokens: 312 },
    pendingApproval: {
      id: HUMAN_TASK_ID,
      runId: SAMPLE_RUN_ID,
      nodeId: "approve",
      nodeName: "Approve reply",
      request: SAMPLE_HUMAN_REQUEST,
      requestedAt: at(4470),
      reason: "Intent confidence 0.81 is below the pass threshold 0.90",
      decision: INTENT,
    },
  };
  switch (status) {
    case "completed": {
      const approve = nodeRuns.find((n) => n.id === "nr_15");
      if (approve) {
        approve.status = "completed";
        approve.endedAt = at(APPROVAL_END);
        approve.durationMs = APPROVAL_END - 4470;
        approve.firedPorts = ["approved"];
        approve.routeTaken = "approved";
        approve.output = {
          decision: {
            action: "approve",
            option: null,
            by: "m.okafor",
            at: at(APPROVAL_END),
            comment: "Good catch on the SMS route.",
          },
        };
      }
      nodeRuns.push(...completedTail());
      return {
        ...base,
        pendingApproval: undefined,
        endedAt: at(APPROVAL_END + 296),
        durationMs: APPROVAL_END + 296,
        costUsd: 0.00164,
      };
    }
    case "failed": {
      const idx = nodeRuns.findIndex((n) => n.id === "nr_07b");
      const second = nodeRuns[idx];
      if (second) {
        nodeRuns[idx] = {
          ...second,
          status: "failed",
          endedAt: at(2380),
          durationMs: 820,
          error: {
            code: "TOOL_EXECUTION_ERROR",
            message:
              "GET /v1/customers/cus_9Yt3LqA8 → 503 Service Unavailable after 2 attempts (upstream: accounts-api)",
            retryable: false,
          },
          toolCall: {
            name: "accounts.getCustomer",
            args: LOOKUP_ARGS,
            ok: false,
            statusCode: 503,
            durationMs: 820,
          },
        };
      }
      const kept = nodeRuns.filter((n) => Date.parse(n.startedAt ?? "") <= SAMPLE_T0 + 2380);
      return {
        ...base,
        nodeRuns: kept,
        pendingApproval: undefined,
        endedAt: at(2390),
        durationMs: 2390,
        costUsd: 0.00025,
        usage: { inputTokens: 1231, outputTokens: 0 },
        error: {
          code: "NODE_EXECUTION_ERROR",
          message:
            "Lookup account failed after 2 attempts: accounts-api returned 503. Check the accounts-api status page, then replay from this node.",
          retryable: false,
          nodeId: "lookup_account",
          nodeRunId: sampleNodeRunUuid("nr_07b"),
        },
      };
    }
    case "running": {
      const kept = nodeRuns.filter((n) => Date.parse(n.startedAt ?? "") <= SAMPLE_T0 + 3150);
      const draft = kept.find((n) => n.id === "nr_12");
      if (draft) {
        draft.status = "running";
        delete draft.endedAt;
        delete draft.durationMs;
        delete draft.output;
        delete draft.usage;
        delete draft.costUsd;
      }
      return {
        ...base,
        nodeRuns: kept,
        pendingApproval: undefined,
        costUsd: 0.00073,
        usage: { inputTokens: 3423, outputTokens: 0 },
      };
    }
    case "queued":
      return {
        ...base,
        nodeRuns: [],
        pendingApproval: undefined,
        startedAt: undefined,
        costUsd: undefined,
        usage: undefined,
      };
    case "cancelled": {
      const kept = nodeRuns.filter((n) => Date.parse(n.startedAt ?? "") <= SAMPLE_T0 + 2010);
      const loop = kept.find((n) => n.id === "nr_09");
      if (loop) {
        loop.status = "cancelled";
        loop.endedAt = at(2600);
        loop.durationMs = 590;
      }
      return {
        ...base,
        nodeRuns: kept,
        pendingApproval: undefined,
        endedAt: at(2600),
        durationMs: 2600,
        costUsd: 0.0004,
        usage: { inputTokens: 1471, outputTokens: 0 },
      };
    }
    case "starting":
    case "retrying":
    case "waiting":
    case "timed_out":
    case "waiting_for_human":
      return base;
  }
}

/** Run state transitions for the completed run. */
export const SAMPLE_TRANSITIONS: RunTransitionView[] = [
  { status: "queued", at: at(-1450) },
  { status: "starting", at: at(-180) },
  { status: "running", at: at(0) },
  { status: "waiting_for_human", at: at(4470), note: "Approve reply" },
  { status: "running", at: at(APPROVAL_END) },
  { status: "completed", at: at(APPROVAL_END + 296) },
];

export const SAMPLE_LIVE_TRANSITIONS: RunTransitionView[] = SAMPLE_TRANSITIONS.slice(0, 4);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** `Omit` that distributes over the event union so each member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<RunEvent, "runId" | "seq" | "at">;
type NodeEventBody = DistributiveOmit<
  NodeRunEvent,
  "runId" | "seq" | "at" | "nodeRunId" | "nodeId" | "scope" | "attempt"
>;

let seq = 0;

function ev(offset: number, body: EventBody): RunEvent {
  seq += 1;
  return { runId: SAMPLE_RUN_ID, seq, at: at(offset), ...body };
}

function nev(
  offset: number,
  node: { id: string; nodeRun: string; attempt?: number; scope?: string },
  body: NodeEventBody,
): RunEvent {
  seq += 1;
  return {
    runId: SAMPLE_RUN_ID,
    seq,
    at: at(offset),
    nodeRunId: sampleNodeRunUuid(node.nodeRun),
    nodeId: node.id,
    scope: node.scope ?? "",
    attempt: node.attempt ?? 1,
    ...body,
  };
}

/** A generation delta: ephemeral, `seq` 0, never persisted. */
function delta(
  offset: number,
  nodeRun: string,
  index: number,
  text: string,
): RunEventOf<"GENERATION_DELTA"> {
  return {
    runId: SAMPLE_RUN_ID,
    seq: 0,
    at: at(offset),
    type: "GENERATION_DELTA",
    nodeRunId: sampleNodeRunUuid(nodeRun),
    nodeId: "draft",
    scope: "",
    attempt: 1,
    ephemeral: true,
    channel: "text",
    delta: text,
    index,
  };
}

const LOOKUP_CALL_ID = "call_lookup_01";
const DECISION_USAGE_INTENT = INTENT.usage ?? { inputTokens: 0, outputTokens: 0 };

/** About 60 events for the waiting run (through RUN_WAITING). */
export function buildSampleEvents(): RunEvent[] {
  seq = 0;
  const intent = { id: "intent", nodeRun: "nr_03" };
  const urgency = { id: "urgency", nodeRun: "nr_04" };
  const escalate = { id: "escalate", nodeRun: "nr_05" };
  const lookup1 = { id: "lookup_account", nodeRun: "nr_07a", attempt: 1 };
  const lookup2 = { id: "lookup_account", nodeRun: "nr_07b", attempt: 2 };
  const events: RunEvent[] = [
    ev(-1450, {
      type: "RUN_CREATED",
      workflowVersionId: WORKFLOW_VERSION_ID,
      environmentId: ENVIRONMENT_ID,
      origin: "webhook",
      mode: "async",
      input: TICKET,
      planHash: "sha256:9f2c4a7e",
      idempotencyKey: "helpdesk.ticket.created:TCK-48213",
      sourceRunId: null,
    }),
    ev(0, {
      type: "RUN_STARTED",
      workerId: "wrk-eu-3",
      leaseUntil: at(30_000),
      deadlineAt: at(3_600_000),
    }),
    nev(
      0,
      { id: "start", nodeRun: "nr_01" },
      { type: "NODE_STARTED", input: TICKET, pool: "general", workerId: "wrk-eu-3" },
    ),
    nev(
      1,
      { id: "start", nodeRun: "nr_01" },
      {
        type: "NODE_COMPLETED",
        output: TICKET,
        firedPorts: ["done"],
        usage: null,
        costUsd: 0,
        latencyMs: 1,
        reused: false,
      },
    ),
    nev(
      12,
      { id: "parse", nodeRun: "nr_02" },
      { type: "NODE_STARTED", input: TICKET, pool: "general", workerId: "wrk-eu-3" },
    ),
    nev(
      19,
      { id: "parse", nodeRun: "nr_02" },
      {
        type: "NODE_COMPLETED",
        output: { language: "en", words: 84 },
        firedPorts: ["done"],
        usage: null,
        costUsd: 0,
        latencyMs: 7,
        reused: false,
      },
    ),
    nev(31, intent, {
      type: "NODE_STARTED",
      input: { state: { subject: TICKET.subject } },
      pool: "general",
      workerId: "wrk-eu-3",
    }),
    nev(31, intent, {
      type: "DECISION_REQUESTED",
      batchId: "batch_intent_01",
      questionCount: 1,
      provider: "typesafe",
      model: "jev-1.13.0",
      stateHash: "sha256:11aa",
      questions: ["Which team should handle this ticket?"],
    }),
    nev(115, intent, {
      type: "DECISION_COMPLETED",
      batchId: "batch_intent_01",
      question: "Which team should handle this ticket?",
      decision: INTENT,
      priceSnapshot: { inputPerMTok: 0.2, outputPerMTok: 0 },
    }),
    nev(115, intent, {
      type: "NODE_COMPLETED",
      output: { decision: INTENT },
      firedPorts: ["done"],
      usage: DECISION_USAGE_INTENT,
      costUsd: INTENT.costUsd,
      latencyMs: 84,
      reused: false,
    }),
    nev(116, urgency, {
      type: "NODE_STARTED",
      input: { state: { subject: TICKET.subject } },
      pool: "general",
      workerId: "wrk-eu-3",
    }),
    nev(177, urgency, {
      type: "DECISION_COMPLETED",
      batchId: "batch_urgency_01",
      question: "How urgent is this request?",
      decision: URGENCY,
      priceSnapshot: null,
    }),
    nev(177, urgency, {
      type: "NODE_COMPLETED",
      output: { decision: URGENCY },
      firedPorts: ["done"],
      usage: URGENCY.usage ?? null,
      costUsd: URGENCY.costUsd,
      latencyMs: 61,
      reused: false,
    }),
    nev(178, escalate, {
      type: "NODE_STARTED",
      input: { state: { subject: TICKET.subject } },
      pool: "general",
      workerId: "wrk-eu-3",
    }),
    nev(241, escalate, {
      type: "DECISION_COMPLETED",
      batchId: "batch_escalate_01",
      question: "Should this ticket skip tier 1?",
      decision: ESCALATE,
      priceSnapshot: null,
    }),
    nev(241, escalate, {
      type: "NODE_COMPLETED",
      output: { decision: ESCALATE },
      firedPorts: ["done"],
      usage: ESCALATE.usage ?? null,
      costUsd: ESCALATE.costUsd,
      latencyMs: 63,
      reused: false,
    }),
    nev(
      242,
      { id: "route", nodeRun: "nr_06" },
      { type: "NODE_STARTED", input: { decision: INTENT }, pool: "general", workerId: "wrk-eu-3" },
    ),
    nev(
      243,
      { id: "route", nodeRun: "nr_06" },
      {
        type: "BRANCH_EVALUATED",
        taken: ["security"],
        evaluations: [
          { port: "security", result: true },
          { port: "technical", result: false },
          { port: "billing", result: false },
          { port: "sales", result: false },
        ],
      },
    ),
    nev(
      243,
      { id: "route", nodeRun: "nr_06" },
      {
        type: "NODE_COMPLETED",
        output: null,
        firedPorts: ["security"],
        usage: null,
        costUsd: 0,
        latencyMs: 1,
        reused: false,
      },
    ),
    nev(245, lookup1, {
      type: "NODE_STARTED",
      input: LOOKUP_ARGS,
      pool: "general",
      workerId: "wrk-eu-3",
    }),
    nev(245, lookup1, {
      type: "TOOL_CALLED",
      toolCallId: LOOKUP_CALL_ID,
      tool: "accounts.getCustomer",
      source: "http",
      args: LOOKUP_ARGS,
      capability: "http",
      coerced: false,
    }),
    nev(1060, lookup1, {
      type: "TOOL_RETURNED",
      toolCallId: LOOKUP_CALL_ID,
      tool: "accounts.getCustomer",
      ok: false,
      result: { status: 503 },
      error: LOOKUP_ERROR,
      latencyMs: 815,
    }),
    nev(1060, lookup1, {
      type: "NODE_FAILED",
      error: LOOKUP_ERROR,
      firedPorts: [],
      latencyMs: 815,
      terminal: false,
    }),
    nev(1060, lookup1, {
      type: "NODE_RETRIED",
      error: LOOKUP_ERROR,
      nextAttempt: 2,
      delayMs: 500,
      timerId: RETRY_TIMER_ID,
    }),
    nev(1060, lookup1, {
      type: "TIMER_SET",
      timerId: RETRY_TIMER_ID,
      fireAt: at(1560),
      purpose: "retry",
    }),
    nev(1560, lookup1, { type: "TIMER_FIRED", timerId: RETRY_TIMER_ID, purpose: "retry" }),
    nev(1560, lookup2, {
      type: "NODE_STARTED",
      input: LOOKUP_ARGS,
      pool: "general",
      workerId: "wrk-eu-3",
    }),
    nev(1560, lookup2, {
      type: "TOOL_CALLED",
      toolCallId: "call_lookup_02",
      tool: "accounts.getCustomer",
      source: "http",
      args: LOOKUP_ARGS,
      capability: "http",
      coerced: false,
    }),
    nev(1772, lookup2, {
      type: "TOOL_RETURNED",
      toolCallId: "call_lookup_02",
      tool: "accounts.getCustomer",
      ok: true,
      result: { status: 200, body: LOOKUP_RESULT },
      error: null,
      latencyMs: 212,
    }),
    nev(1772, lookup2, {
      type: "NODE_COMPLETED",
      output: LOOKUP_RESULT,
      firedPorts: ["done"],
      usage: null,
      costUsd: 0,
      latencyMs: 212,
      reused: false,
    }),
    nev(
      1780,
      { id: "lookup_history", nodeRun: "nr_08" },
      {
        type: "NODE_STARTED",
        input: { customer: "cus_9Yt3LqA8", limit: 5 },
        pool: "general",
        workerId: "wrk-eu-3",
      },
    ),
    nev(
      1780,
      { id: "lookup_history", nodeRun: "nr_08" },
      {
        type: "TOOL_CALLED",
        toolCallId: "call_history_01",
        tool: "helpdesk.listTickets",
        source: "openapi",
        args: { customer: "cus_9Yt3LqA8", limit: 5 },
        capability: "http",
        coerced: false,
      },
    ),
    nev(
      1998,
      { id: "lookup_history", nodeRun: "nr_08" },
      {
        type: "TOOL_RETURNED",
        toolCallId: "call_history_01",
        tool: "helpdesk.listTickets",
        ok: true,
        result: { status: 200, body: { total: 1 } },
        error: null,
        latencyMs: 218,
      },
    ),
    nev(
      1998,
      { id: "lookup_history", nodeRun: "nr_08" },
      {
        type: "NODE_COMPLETED",
        output: { total: 1 },
        firedPorts: ["done"],
        usage: null,
        costUsd: 0,
        latencyMs: 218,
        reused: false,
      },
    ),
    nev(
      2010,
      { id: "enrich", nodeRun: "nr_09" },
      {
        type: "NODE_STARTED",
        input: { items: FINDINGS.map((f) => f.id) },
        pool: "general",
        workerId: "wrk-eu-3",
      },
    ),
    nev(
      2010,
      { id: "enrich", nodeRun: "nr_09" },
      { type: "FOREACH_STARTED", itemCount: 3, concurrency: 1 },
    ),
  ];
  FINDINGS.forEach((f, i) => {
    const classify = { id: "classify", nodeRun: `nr_11_${i}`, scope: `enrich#${i}` };
    events.push(
      nev(
        f.start,
        { id: "enrich", nodeRun: "nr_09" },
        { type: "LOOP_ITERATION_STARTED", iteration: i, childScope: `enrich#${i}`, carry: null },
      ),
      nev(f.cEnd, classify, {
        type: "DECISION_COMPLETED",
        batchId: `batch_classify_0${i + 1}`,
        question: "How severe is this finding?",
        decision: classifyDecision(f),
        priceSnapshot: null,
      }),
      nev(
        f.cEnd + 2,
        { id: "enrich", nodeRun: "nr_09" },
        {
          type: "FOREACH_ITEM_COMPLETED",
          index: i,
          childScope: `enrich#${i}`,
          status: "completed",
          result: { id: f.id, severity: f.severity },
          error: null,
        },
      ),
    );
  });
  events.push(
    nev(
      3140,
      { id: "enrich", nodeRun: "nr_09" },
      { type: "LOOP_EXITED", iterations: 3, reason: "items_done" },
    ),
    nev(
      3140,
      { id: "enrich", nodeRun: "nr_09" },
      {
        type: "NODE_COMPLETED",
        output: { findings: 3 },
        firedPorts: ["done"],
        usage: { inputTokens: 720, outputTokens: 0 },
        costUsd: 0.000144,
        latencyMs: 1130,
        reused: false,
      },
    ),
    ev(3142, { type: "CHECKPOINT_CREATED", checkpointSeq: seq }),
    nev(
      3150,
      { id: "draft", nodeRun: "nr_12" },
      {
        type: "NODE_STARTED",
        input: { ticket: TICKET.id, findings: 3 },
        pool: "general",
        workerId: "wrk-eu-3",
      },
    ),
    nev(
      3150,
      { id: "draft", nodeRun: "nr_12" },
      {
        type: "GENERATION_STARTED",
        provider: "openai",
        model: "gpt-5-mini",
        promptHash: "sha256:7d1e",
        stream: true,
      },
    ),
    nev(
      3402,
      { id: "draft", nodeRun: "nr_12" },
      {
        type: "PROVIDER_FAILOVER",
        from: "openai:eu-west",
        to: "openai:us-east",
        error: {
          code: "PROVIDER_RATE_LIMITED",
          message: "429 rate limited, retry-after 30 s exceeds node budget",
          retryable: true,
        },
      },
    ),
    delta(
      3905,
      "nr_12",
      0,
      "Hi Priya — thanks for flagging this. We've locked the unrecognised device",
    ),
    delta(4210, "nr_12", 1, " (Safari on iOS, Lagos) and reset your SMS delivery route"),
    nev(
      4390,
      { id: "draft", nodeRun: "nr_12" },
      {
        type: "GENERATION_COMPLETED",
        provider: "openai",
        model: "gpt-5-mini",
        usage: DRAFT_USAGE,
        costUsd: 0.00091,
        priceSnapshot: { inputPerMTok: 0.25, outputPerMTok: 2 },
        finishReason: "stop",
        outputChars: DRAFT_OUTPUT.body.length,
        latencyMs: 1240,
      },
    ),
    nev(
      4390,
      { id: "draft", nodeRun: "nr_12" },
      {
        type: "NODE_COMPLETED",
        output: DRAFT_OUTPUT,
        firedPorts: ["done"],
        usage: DRAFT_USAGE,
        costUsd: 0.00091,
        latencyMs: 1240,
        reused: false,
      },
    ),
    nev(
      4395,
      { id: "pii", nodeRun: "nr_13" },
      {
        type: "NODE_STARTED",
        input: { text: DRAFT_OUTPUT.body },
        pool: "general",
        workerId: "wrk-eu-3",
      },
    ),
    nev(
      4460,
      { id: "pii", nodeRun: "nr_13" },
      {
        type: "DECISION_COMPLETED",
        batchId: "batch_pii_01",
        question: "Does the reply leak personal data that the customer did not share?",
        decision: PII,
        priceSnapshot: null,
      },
    ),
    nev(
      4460,
      { id: "pii", nodeRun: "nr_13" },
      {
        type: "NODE_COMPLETED",
        output: { decision: PII },
        firedPorts: ["done"],
        usage: PII.usage ?? null,
        costUsd: PII.costUsd,
        latencyMs: 58,
        reused: false,
      },
    ),
    nev(
      4461,
      { id: "gate", nodeRun: "nr_14" },
      { type: "NODE_STARTED", input: { decision: INTENT }, pool: "general", workerId: "wrk-eu-3" },
    ),
    nev(
      4461,
      { id: "gate", nodeRun: "nr_14" },
      {
        type: "BRANCH_EVALUATED",
        taken: ["review"],
        evaluations: [
          { port: "pass", result: false },
          { port: "review", result: true },
        ],
      },
    ),
    nev(
      4462,
      { id: "gate", nodeRun: "nr_14" },
      {
        type: "NODE_COMPLETED",
        output: { confidence: 0.81, outcome: "review", passed: false },
        firedPorts: ["review"],
        usage: null,
        costUsd: 0,
        latencyMs: 1,
        reused: false,
      },
    ),
    nev(
      4463,
      { id: "gate", nodeRun: "nr_14" },
      {
        type: "LOG",
        level: "info",
        message: "confidence 0.81 in [0.70, 0.90) → secondary review",
        data: { confidence: 0.81, threshold: 0.9, reviewBand: 0.2 },
      },
    ),
    nev(
      4463,
      { id: "gate", nodeRun: "nr_14" },
      { type: "METRIC", name: "gate.confidence", value: 0.81, labels: { outcome: "review" } },
    ),
    nev(
      4470,
      { id: "approve", nodeRun: "nr_15" },
      {
        type: "NODE_STARTED",
        input: { reply: DRAFT_OUTPUT.body },
        pool: "general",
        workerId: "wrk-eu-3",
      },
    ),
    nev(
      4470,
      { id: "approve", nodeRun: "nr_15" },
      {
        type: "HUMAN_APPROVAL_REQUESTED",
        humanTaskId: HUMAN_TASK_ID,
        request: SAMPLE_HUMAN_REQUEST,
      },
    ),
    nev(
      4470,
      { id: "approve", nodeRun: "nr_15" },
      { type: "NODE_WAITING", reason: "human", ref: HUMAN_TASK_ID, state: null },
    ),
    ev(4471, { type: "RUN_WAITING", reason: "human", nodeRunIds: [sampleNodeRunUuid("nr_15")] }),
  );
  return events;
}

/** Events that complete the run after approval (appended for the completed variant). */
export function buildSampleCompletionEvents(): RunEvent[] {
  const start = seq;
  const approve = { id: "approve", nodeRun: "nr_15" };
  const send = { id: "send", nodeRun: "nr_16" };
  const out: RunEvent[] = [
    nev(APPROVAL_END, approve, {
      type: "HUMAN_APPROVAL_RECEIVED",
      humanTaskId: HUMAN_TASK_ID,
      response: { action: "approve", comment: "Good catch on the SMS route." },
      by: "m.okafor",
    }),
    ev(APPROVAL_END, {
      type: "RUN_RESUMED",
      reason: "human",
      nodeRunId: sampleNodeRunUuid("nr_15"),
    }),
    nev(APPROVAL_END + 1, approve, {
      type: "NODE_COMPLETED",
      output: {
        decision: {
          action: "approve",
          option: null,
          by: "m.okafor",
          at: at(APPROVAL_END),
          comment: "Good catch on the SMS route.",
        },
      },
      firedPorts: ["approved"],
      usage: null,
      costUsd: 0,
      latencyMs: APPROVAL_END - 4470,
      reused: false,
    }),
    nev(APPROVAL_END + 40, send, {
      type: "NODE_STARTED",
      input: { ticket: TICKET.id },
      pool: "general",
      workerId: "wrk-eu-3",
    }),
    nev(APPROVAL_END + 40, send, {
      type: "TOOL_CALLED",
      toolCallId: "call_send_01",
      tool: "helpdesk.reply",
      source: "openapi",
      args: { ticket: TICKET.id },
      capability: "http",
      coerced: false,
    }),
    nev(APPROVAL_END + 290, send, {
      type: "TOOL_RETURNED",
      toolCallId: "call_send_01",
      tool: "helpdesk.reply",
      ok: true,
      result: { status: 202, body: { messageId: "msg_7Ka2" } },
      error: null,
      latencyMs: 250,
    }),
    nev(APPROVAL_END + 290, send, {
      type: "NODE_COMPLETED",
      output: { messageId: "msg_7Ka2", status: "sent" },
      firedPorts: ["done"],
      usage: null,
      costUsd: 0,
      latencyMs: 250,
      reused: false,
    }),
    ev(APPROVAL_END + 296, {
      type: "RUN_OUTPUT",
      nodeRunId: sampleNodeRunUuid("nr_17"),
      nodeId: "end",
      output: { messageId: "msg_7Ka2" },
      outcome: "replied",
      earlyExit: false,
    }),
    ev(APPROVAL_END + 296, {
      type: "RUN_COMPLETED",
      output: { messageId: "msg_7Ka2" },
      outcome: "replied",
      usage: { inputTokens: 4707, outputTokens: 312 },
      costUsd: 0.00164,
      durationMs: APPROVAL_END + 296,
    }),
  ];
  seq = start;
  return out;
}

const L = (
  offset: number,
  level: LogLineView["level"],
  message: string,
  nodeId?: string,
  data?: unknown,
): LogLineView => {
  const l: LogLineView = { at: at(offset), level, message };
  if (nodeId) l.nodeId = nodeId;
  if (data !== undefined) l.data = data;
  return l;
};

/** About 30 log lines for the waiting run. */
export function buildSampleLogs(): LogLineView[] {
  return [
    L(-1450, "debug", "webhook received from helpdesk.ticket.created", undefined, {
      ticket: "TCK-48213",
      signature: "ok",
    }),
    L(-180, "info", "worker wrk-eu-3 claimed run", undefined, { concurrency: "4/8" }),
    L(0, "info", "run started · Support triage v14 · production"),
    L(12, "debug", "input schema validated (ticket.v2)", "parse"),
    L(19, "debug", "normalised text: 84 words, language=en", "parse"),
    L(31, "debug", "decision request → jev-1.13.0 (4 options)", "intent", {
      options: ["security", "technical", "billing", "sales"],
    }),
    L(115, "info", "intent=security p=0.81 (technical 0.12, billing 0.04, sales 0.03)", "intent"),
    L(177, "info", "urgency=3.72 (high) conf=0.77", "urgency"),
    L(241, "info", "escalate=true p=0.87", "escalate"),
    L(243, "info", "route → security", "route"),
    L(245, "debug", "GET /v1/customers/cus_9Yt3LqA8 (attempt 1, timeout 5 s)", "lookup_account"),
    L(
      1060,
      "warn",
      "upstream 503 from accounts-api, retrying in 500 ms (attempt 1/3)",
      "lookup_account",
      { statusCode: 503, retryAfter: null },
    ),
    L(1560, "debug", "GET /v1/customers/cus_9Yt3LqA8 (attempt 2, timeout 5 s)", "lookup_account"),
    L(1772, "info", "200 in 212 ms · 1.8 kB", "lookup_account"),
    L(1773, "warn", "customer has 3 recent MFA delivery failures", "lookup_account", {
      deliveryFailures: 3,
      method: "sms",
    }),
    L(1998, "info", "200 in 218 ms · 1 prior ticket", "lookup_history"),
    L(2010, "debug", "foreach over 3 findings (max 10, budget $0.02)", "enrich"),
    L(2380, "info", "iteration 1: new_device_login → high (0.74)", "classify"),
    L(2760, "info", "iteration 2: mfa_delivery_failure → medium (0.62)", "classify"),
    L(3130, "info", "iteration 3: geo_anomaly → critical (0.68)", "classify"),
    L(3142, "debug", "checkpoint created after enrich"),
    L(3150, "debug", "generation request → gpt-5-mini temp=0.3 max=600", "draft"),
    L(3402, "warn", "openai:eu-west 429 rate limited · failing over to openai:us-east", "draft", {
      retryAfter: 30,
      budgetMs: 2000,
    }),
    L(3905, "debug", "first token after 503 ms", "draft"),
    L(4390, "info", "generation complete · 312 tokens · $0.00091", "draft"),
    L(4460, "info", "pii=false p=0.96", "pii"),
    L(4462, "info", "confidence 0.81 in [0.70, 0.90) → review", "gate"),
    L(4470, "info", "approval requested from support-leads (expires in 24 h)", "approve"),
    L(4471, "debug", "run parked · waiting_for_human", "approve"),
    L(4472, "error", "notification to #support-leads failed: slack 502, will retry", "approve", {
      channel: "#support-leads",
      statusCode: 502,
    }),
  ];
}

const LONG_LOG_NODES = ["parse", "intent", "lookup_account", "draft_reply", "safety"] as const;
const LONG_LOG_LEVELS: readonly LogLineView["level"][] = [
  "debug",
  "info",
  "info",
  "info",
  "debug",
  "warn",
  "info",
  "debug",
  "info",
  "error",
];

/**
 * A long, deterministic LOG stream (`count` lines, 40 ms apart) for the virtualized
 * LogViewer: rotating levels and nodes, every 25th line carrying structured data.
 */
export function buildLongLogs(count: number): LogLineView[] {
  const out: LogLineView[] = [];
  for (let i = 0; i < count; i++) {
    const level = LONG_LOG_LEVELS[i % LONG_LOG_LEVELS.length] ?? "info";
    const nodeId = LONG_LOG_NODES[i % LONG_LOG_NODES.length];
    const data =
      i % 25 === 0
        ? { batch: Math.floor(i / 25), items: 25, cursor: `c_${i.toString(36)}` }
        : undefined;
    out.push(
      L(
        i * 40,
        level,
        `line ${i + 1} · ${level === "error" ? "upstream 503, retrying" : "processed chunk"} #${i}`,
        nodeId,
        data,
      ),
    );
  }
  return out;
}
