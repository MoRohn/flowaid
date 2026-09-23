import { useMemo, useState, type ReactNode } from "react";
import { ListTree, SquareArrowOutUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { JsonSchema, NodeRunView, WorkflowDiff, WorkflowNodeView } from "@/types";
import { makeChoiceDecision } from "@/lib/decisionBuilders";
import { DiffView, JsonView } from "@/data";
import {
  IconButton,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  toast,
  Toaster,
} from "@/primitives";
import {
  CodeBlock,
  Inspector,
  KeyValueList,
  NodeSummaryStrip,
  PortTypeLabel,
  SchemaTree,
  TimingBreakdown,
  WorkflowDiffSummary,
  type InspectorTabId,
} from "./index";

// ---------------------------------------------------------------------------
// Gallery scaffolding
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        {caption ? <p className="max-w-2xl text-xs text-ink-3">{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Frame({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {label ? <p className="text-2xs font-medium text-ink-3">{label}</p> : null}
      <div
        className={cn(
          "min-w-0 overflow-hidden rounded-md border border-border bg-surface shadow-1",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sample data: support-triage workflow
// ---------------------------------------------------------------------------

const TICKET = {
  id: "tk_8f31c2",
  channel: "email",
  subject: "Charged twice for the Team plan this month",
  body: "Hi, my card statement shows two charges of $96.00 on Sept 14 for the Team plan. Only one invoice (INV-20419) appears in the billing page. Can you refund the duplicate?",
  customer: {
    id: "cu_51h9w",
    plan: "team",
    region: "eu-west-1",
    seats: 12,
    mrrUsd: 96,
    accountManager: null,
  },
  attachments: [
    { name: "statement-sept.pdf", bytes: 184_233, mime: "application/pdf" },
    { name: "invoice-20419.pdf", bytes: 61_020, mime: "application/pdf" },
  ],
  receivedAt: "2026-09-21T08:14:02.311Z",
  language: "en",
};

const INTENT_NODE: WorkflowNodeView = {
  id: "n_intent",
  kind: "task",
  nodeType: "flowaid.decision.choice",
  category: "decision",
  name: "Classify intent",
  description: "Routes the ticket to the team that owns the problem.",
  provider: "jev-latest",
  inputs: [
    {
      id: "ticket",
      label: "ticket",
      type: "message",
      required: true,
      description: "The inbound ticket",
    },
    {
      id: "history",
      label: "history",
      type: "message[]",
      description: "Prior messages on the thread",
    },
  ],
  outputs: [
    { id: "decision", label: "decision", type: "decision", required: true },
    { id: "intent", label: "intent", type: "string", required: true },
    { id: "confidence", label: "confidence", type: "number", required: true },
  ],
  routes: [
    { id: "billing", label: "Billing" },
    { id: "technical", label: "Technical" },
    { id: "account", label: "Account" },
    { id: "other", label: "Other" },
  ],
};

const INTENT_RUN: NodeRunView = {
  id: "nr_01j8x4",
  nodeId: "n_intent",
  nodeName: "Classify intent",
  nodeType: "decision.choice",
  category: "decision",
  status: "completed",
  attempt: 1,
  startedAt: "2026-09-21T08:14:03.048Z",
  endedAt: "2026-09-21T08:14:03.460Z",
  durationMs: 412,
  routeTaken: "billing",
  decisionQuestion: "Which team should handle this ticket?",
  decision: makeChoiceDecision({
    probabilities: { billing: 0.81, technical: 0.12, account: 0.04, other: 0.03 },
    provider: "jev",
    model: "jev-latest",
    latencyMs: 388,
    usage: { inputTokens: 638, outputTokens: 12 },
    costUsd: 0.00041,
  }),
  usage: { inputTokens: 638, outputTokens: 12 },
  costUsd: 0.00041,
  input: { ticket: TICKET, history: [] },
  output: {
    decision: {
      kind: "choice",
      value: "billing",
      confidence: 0.81,
      probabilities: { billing: 0.81, technical: 0.12, account: 0.04, other: 0.03 },
    },
    intent: "billing",
    confidence: 0.81,
  },
  logs: [
    {
      at: "2026-09-21T08:14:03.049Z",
      level: "debug",
      message: "Resolved provider jev (model jev-latest) from workflow defaults",
    },
    {
      at: "2026-09-21T08:14:03.051Z",
      level: "info",
      message: "Prepared 4 options: billing, technical, account, other",
    },
    {
      at: "2026-09-21T08:14:03.052Z",
      level: "debug",
      message: "Prompt assembled",
      data: { inputTokens: 638, truncated: false },
    },
    {
      at: "2026-09-21T08:14:03.055Z",
      level: "info",
      message: "Calling jev-latest (timeout 8000 ms)",
    },
    { at: "2026-09-21T08:14:03.442Z", level: "debug", message: "Provider responded in 388 ms" },
    {
      at: "2026-09-21T08:14:03.443Z",
      level: "debug",
      message: "Calibrated probabilities",
      data: {
        raw: { billing: 0.79, technical: 0.13, account: 0.05, other: 0.03 },
        temperature: 0.96,
      },
    },
    {
      at: "2026-09-21T08:14:03.444Z",
      level: "info",
      message: "Chose billing with confidence 0.81",
    },
    {
      at: "2026-09-21T08:14:03.445Z",
      level: "info",
      message: "Confidence 0.81 is below auto threshold 0.90; routing through secondary review",
    },
    { at: "2026-09-21T08:14:03.446Z", level: "debug", message: "Emitted DECISION_COMPLETED" },
    {
      at: "2026-09-21T08:14:03.448Z",
      level: "debug",
      message: "Usage recorded",
      data: { inputTokens: 638, outputTokens: 12, costUsd: 0.00041 },
    },
    { at: "2026-09-21T08:14:03.455Z", level: "debug", message: "Checkpoint saved (1.2 kB)" },
    { at: "2026-09-21T08:14:03.460Z", level: "info", message: "Completed in 412 ms" },
  ],
};

const INTENT_STATE = {
  calibration: { temperature: 0.96, samples: 1_240, lastFitAt: "2026-09-19T22:10:00Z" },
  recentIntents: ["billing", "billing", "technical", "account", "billing"],
  driftScore: 0.03,
};

const ACCOUNT_NODE: WorkflowNodeView = {
  id: "n_account",
  kind: "task",
  nodeType: "flowaid.tools.http",
  category: "tool",
  name: "Fetch account",
  description: "Loads the customer's billing account from the billing service.",
  inputs: [
    { id: "customerId", label: "customerId", type: "string", required: true },
    { id: "region", label: "region", type: "string" },
  ],
  outputs: [
    { id: "account", label: "account", type: "object", required: true },
    { id: "status", label: "status", type: "integer" },
  ],
  diagnostics: [
    {
      code: "W_LOOSE_BOUNDS",
      severity: "warning",
      message:
        "Timeout 2000 ms is below this endpoint's p95 latency (2 340 ms over the last 7 days).",
      location: { nodeId: "n_account", path: "/nodes/2/policy/timeoutMs" },
      fix: {
        title: "Raise to 3000 ms",
        patch: [{ op: "replace", path: "/nodes/2/policy/timeoutMs", value: 3000 }],
      },
    },
  ],
};

const ACCOUNT_RUN: NodeRunView = {
  id: "nr_01j8x7",
  nodeId: "n_account",
  nodeName: "Fetch account",
  nodeType: "tool.http",
  category: "tool",
  status: "failed",
  attempt: 3,
  startedAt: "2026-09-21T08:14:03.470Z",
  endedAt: "2026-09-21T08:14:07.522Z",
  durationMs: 4052,
  toolCall: {
    name: "http.get",
    args: { url: "https://billing.internal/api/accounts/cu_51h9w", timeoutMs: 2000 },
    statusCode: 502,
    durationMs: 1842,
  },
  error: {
    code: "TOOL_EXECUTION_ERROR",
    message:
      "GET https://billing.internal/api/accounts/cu_51h9w returned 502 Bad Gateway on all 3 attempts (backoff 250 ms, 500 ms). Check the billing service health or raise the timeout.",
    retryable: true,
  },
  input: {
    customerId: "cu_51h9w",
    region: "eu-west-1",
    request: {
      method: "GET",
      url: "https://billing.internal/api/accounts/cu_51h9w",
      headers: { accept: "application/json", "x-request-id": "req_7c1e9d" },
    },
  },
  logs: [
    {
      at: "2026-09-21T08:14:03.471Z",
      level: "info",
      message: "GET https://billing.internal/api/accounts/cu_51h9w",
    },
    {
      at: "2026-09-21T08:14:05.312Z",
      level: "warn",
      message: "Attempt 1 failed: 502 Bad Gateway (1 842 ms); retrying in 250 ms",
    },
    {
      at: "2026-09-21T08:14:06.420Z",
      level: "warn",
      message: "Attempt 2 failed: 502 Bad Gateway (858 ms); retrying in 500 ms",
    },
    {
      at: "2026-09-21T08:14:07.522Z",
      level: "error",
      message: "Attempt 3 failed: 502 Bad Gateway (602 ms); giving up",
      data: { statusCode: 502, upstream: "billing-api-eu-west-1c" },
    },
  ],
};

const REPLY_NODE: WorkflowNodeView = {
  id: "n_reply",
  kind: "task",
  nodeType: "flowaid.ai.generate",
  category: "generation",
  name: "Draft reply",
  description: "Writes a first reply for the agent to review.",
  provider: "gpt-5-mini",
  inputs: [
    { id: "ticket", label: "ticket", type: "message", required: true },
    { id: "intent", label: "intent", type: "string", required: true },
    {
      id: "account",
      label: "account",
      type: "object",
      description: "Billing account, when available",
    },
  ],
  outputs: [{ id: "reply", label: "reply", type: "string", required: true }],
  bounds: { timeoutMs: 20_000, maxCostUsd: 0.05 },
};

const REPLY_CONFIG_SCHEMA: JsonSchema = {
  type: "object",
  required: ["model", "instructions"],
  properties: {
    model: { type: "string", description: "Generation model", default: "gpt-5-mini" },
    instructions: {
      type: "string",
      description: "System instructions for the drafting model.",
      minLength: 1,
      maxLength: 4000,
    },
    temperature: { type: "number", minimum: 0, maximum: 2, default: 0.4 },
    tone: { type: "string", enum: ["neutral", "warm", "formal"], default: "warm" },
    maxOutputTokens: { type: "integer", minimum: 64, maximum: 4096, default: 600 },
  },
};

const REPLY_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["reply"],
  properties: {
    reply: { type: "string", description: "Markdown body of the drafted reply" },
    citations: {
      type: "array",
      description: "Knowledge-base articles the draft relied on",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const INTENT_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["ticket"],
  $defs: {
    Message: {
      type: "object",
      required: ["role", "content"],
      properties: {
        role: { type: "string", enum: ["customer", "agent", "system"] },
        content: { type: "string" },
        at: { type: "string", format: "date-time" },
      },
    },
  },
  properties: {
    ticket: { $ref: "#/$defs/Message", description: "The inbound ticket" },
    history: { type: "array", items: { $ref: "#/$defs/Message" }, maxItems: 50 },
  },
};

const RUN_PAYLOAD = {
  run: {
    id: "run_01j8x3q",
    workflow: { id: "wf_triage", name: "Support triage", version: 4 },
    status: "waiting_for_human",
    trigger: "webhook",
    startedAt: "2026-09-21T08:14:02.900Z",
    costUsd: 0.00318,
    tokens: { input: 2_914, output: 611 },
  },
  nodes: [
    {
      id: "n_intent",
      name: "Classify intent",
      status: "completed",
      durationMs: 412,
      output: {
        intent: "billing",
        confidence: 0.81,
        probabilities: { billing: 0.81, technical: 0.12, account: 0.04, other: 0.03 },
      },
    },
    {
      id: "n_urgency",
      name: "Score urgency",
      status: "completed",
      durationMs: 356,
      output: {
        level: 2,
        label: "high",
        confidence: 0.74,
        probabilities: { "0": 0.03, "1": 0.19, "2": 0.74, "3": 0.04 },
      },
    },
    {
      id: "n_account",
      name: "Fetch account",
      status: "failed",
      durationMs: 4052,
      error: { code: "UPSTREAM_502", retryable: true },
    },
    {
      id: "n_gate",
      name: "Confidence gate",
      status: "completed",
      durationMs: 3,
      output: { outcome: "review", thresholds: { review: 0.6, auto: 0.9 }, confidence: 0.81 },
    },
    {
      id: "n_approval",
      name: "Agent approval",
      status: "waiting_for_human",
      assignee: "billing-queue",
      requestedAt: "2026-09-21T08:14:09.101Z",
    },
  ],
  pendingApproval: {
    id: "ap_44d1",
    nodeId: "n_approval",
    reason: "Confidence 0.81 below auto threshold 0.90",
    expiresAt: "2026-09-21T12:14:09.101Z",
  },
};

/** ~5 000 JSON nodes: 200 tickets × 25 leaves. Deterministic so the gallery is stable. */
function buildLargePayload(): unknown {
  const regions = ["eu-west-1", "us-east-1", "ap-southeast-2"];
  const intents = ["billing", "technical", "account", "other"];
  const tickets = Array.from({ length: 200 }, (_, i) => {
    const n = i + 1;
    const p = 0.55 + ((n * 37) % 45) / 100;
    return {
      id: `tk_${(1000 + n).toString(16)}`,
      subject: `Ticket ${n}: ${intents[n % 4] ?? "other"} question`,
      customer: {
        id: `cu_${(5000 + n).toString(36)}`,
        plan: n % 3 === 0 ? "team" : "starter",
        region: regions[n % 3] ?? "eu-west-1",
        seats: (n % 40) + 1,
      },
      decision: {
        intent: intents[n % 4] ?? "other",
        confidence: Number(p.toFixed(2)),
        probabilities: {
          billing: Number((n % 4 === 0 ? p : (1 - p) / 3).toFixed(3)),
          technical: Number((n % 4 === 1 ? p : (1 - p) / 3).toFixed(3)),
          account: Number((n % 4 === 2 ? p : (1 - p) / 3).toFixed(3)),
          other: Number((n % 4 === 3 ? p : (1 - p) / 3).toFixed(3)),
        },
      },
      timing: {
        queueMs: (n * 7) % 90,
        executionMs: 300 + ((n * 53) % 400),
        retryMs: n % 9 === 0 ? 900 : 0,
      },
      tags: [`region:${regions[n % 3] ?? "eu-west-1"}`, `plan:${n % 3 === 0 ? "team" : "starter"}`],
      resolved: n % 5 !== 0,
      assignee: n % 7 === 0 ? null : `agent_${(n % 12) + 1}`,
    };
  });
  return { workflow: "wf_triage", window: "7d", count: tickets.length, tickets };
}

const WORKFLOW_V3 = {
  id: "wf_triage",
  name: "Support triage",
  version: 3,
  nodes: [
    {
      id: "n_intent",
      type: "decision.choice",
      name: "Classify intent",
      config: {
        model: "jev-latest",
        options: ["billing", "technical", "account", "other"],
        thresholds: { review: 0.6, auto: 0.85 },
      },
    },
    {
      id: "n_urgency",
      type: "decision.score",
      name: "Score urgency",
      config: { model: "jev-latest", levels: ["low", "normal", "high", "critical"] },
    },
    {
      id: "n_escalate",
      type: "decision.boolean",
      name: "Escalation",
      config: { model: "jev-latest", question: "Does this need a manager?" },
    },
    {
      id: "n_account",
      type: "tool.http",
      name: "Fetch account",
      config: {
        method: "GET",
        url: "https://billing.internal/api/accounts/{{customerId}}",
        timeoutMs: 2000,
        retries: 2,
      },
    },
    {
      id: "n_reply",
      type: "generation.text",
      name: "Draft reply",
      config: { model: "gpt-5-mini", temperature: 0.4, tone: "warm" },
    },
    { id: "n_log", type: "developer.log", name: "Debug log", config: { level: "debug" } },
    {
      id: "n_approval",
      type: "human.approval",
      name: "Agent approval",
      config: { assignee: "billing-queue", expiresInMinutes: 240 },
    },
  ],
  edges: [
    { id: "e1", source: "n_intent", target: "n_urgency" },
    { id: "e2", source: "n_urgency", target: "n_escalate" },
    { id: "e3", source: "n_escalate", target: "n_account" },
    { id: "e4", source: "n_account", target: "n_reply" },
    { id: "e5", source: "n_reply", target: "n_log" },
    { id: "e6", source: "n_log", target: "n_approval" },
  ],
};

const WORKFLOW_V4 = {
  id: "wf_triage",
  name: "Support triage",
  version: 4,
  nodes: [
    {
      id: "n_intent",
      type: "decision.choice",
      name: "Classify intent",
      config: {
        model: "jev-latest",
        options: ["billing", "technical", "account", "other"],
        thresholds: { review: 0.6, auto: 0.9 },
      },
    },
    {
      id: "n_urgency",
      type: "decision.score",
      name: "Score urgency",
      config: { model: "jev-latest", levels: ["low", "normal", "high", "critical"] },
    },
    {
      id: "n_escalate",
      type: "decision.boolean",
      name: "Needs manager",
      config: { model: "jev-latest", question: "Does this need a manager?" },
    },
    {
      id: "n_account",
      type: "tool.http",
      name: "Fetch account",
      config: {
        method: "GET",
        url: "https://billing.internal/api/accounts/{{customerId}}",
        timeoutMs: 3500,
        retries: 2,
      },
    },
    {
      id: "n_reply",
      type: "generation.text",
      name: "Draft reply",
      config: { model: "gpt-5-mini", temperature: 0.4, tone: "warm" },
    },
    {
      id: "n_pii",
      type: "safety.pii",
      name: "Redact PII",
      config: { entities: ["card", "iban", "email"], action: "mask" },
    },
    {
      id: "n_approval",
      type: "human.approval",
      name: "Agent approval",
      config: { assignee: "billing-queue", expiresInMinutes: 240 },
    },
  ],
  edges: [
    { id: "e1", source: "n_intent", target: "n_urgency" },
    { id: "e2", source: "n_urgency", target: "n_escalate" },
    { id: "e3", source: "n_escalate", target: "n_account" },
    { id: "e4", source: "n_account", target: "n_reply" },
    { id: "e5", source: "n_reply", target: "n_pii" },
    { id: "e6", source: "n_pii", target: "n_approval" },
  ],
};

const TRANSFORM_JS = `// Shape the ticket for the intent decision.
export default function transform({ ticket, history }) {
  const recent = history.slice(-5).map((m) => \`\${m.role}: \${m.content}\`);
  return {
    question: "Which team should handle this ticket?",
    context: [ticket.subject, ticket.body, ...recent].join("\\n"),
    metadata: {
      plan: ticket.customer.plan,
      seats: ticket.customer.seats,
      hasAttachments: ticket.attachments.length > 0,
    },
  };
}
`;

const CONFIG_YAML = `# Confidence gate for "Classify intent"
thresholds:
  review: 0.60   # below → human
  auto: 0.90     # at/above → automatic
fallback:
  provider: openai
  model: gpt-5-mini
  on: [timeout, rate_limit]
retries: 2
timeoutMs: 8000
`;

const INTENT_CONFIG_ROWS = [
  { label: "Model", value: "jev-latest", mono: true },
  { label: "Options", value: "billing, technical, account, other", mono: true },
  { label: "Review threshold", value: "0.60", mono: true },
  { label: "Auto threshold", value: "0.90", mono: true },
  { label: "Fallback", value: "openai / gpt-5-mini", mono: true },
  { label: "Timeout", value: "8 000 ms", mono: true },
];

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function InspectorExamples() {
  const [name, setName] = useState(INTENT_NODE.name);
  const [tab, setTab] = useState<InspectorTabId>("decision");
  const node = useMemo(() => ({ ...INTENT_NODE, name }), [name]);
  const run = useMemo(() => ({ ...INTENT_RUN, nodeName: name }), [name]);
  const common = {
    onClose: () => toast.info("Inspector closed"),
    onRunFromHere: () => toast.success("Queued a run from this node"),
    onOpenTrace: () => toast.info("Opening trace"),
  };
  return (
    <div className="flex flex-wrap gap-4">
      <Frame label="Decision node after a run (rename by clicking the name)" className="h-[640px]">
        <Inspector
          node={node}
          nodeRun={run}
          inputSchema={INTENT_INPUT_SCHEMA}
          state={INTENT_STATE}
          timing={{ queueMs: 38, executionMs: 412, retryMs: 0, humanMs: 0 }}
          thresholds={{ review: 0.6, auto: 0.9 }}
          tab={tab}
          onTabChange={setTab}
          onRename={(next) => {
            setName(next);
            toast.success(`Renamed to “${next}”`);
          }}
          {...common}
        >
          <div className="flex flex-col gap-3">
            <p className="text-2xs text-ink-3">
              The Config tab is a slot; forms/ injects the SchemaForm.
            </p>
            <KeyValueList items={INTENT_CONFIG_ROWS} dense divided />
          </div>
        </Inspector>
      </Frame>
      <Frame label="Tool node with an error (retryable, attempt 3)" className="h-[640px]">
        <Inspector
          node={ACCOUNT_NODE}
          nodeRun={ACCOUNT_RUN}
          timing={{ queueMs: 12, executionMs: 1842, retryMs: 2210 }}
          defaultTab="errors"
          hideEmptyTabs
          {...common}
        >
          <KeyValueList
            items={[
              { label: "Method", value: "GET", mono: true },
              {
                label: "URL",
                value: "https://billing.internal/api/accounts/{{customerId}}",
                mono: true,
              },
              { label: "Timeout", value: "2 000 ms", mono: true },
              { label: "Retries", value: "2", mono: true },
            ]}
            dense
            divided
          />
        </Inspector>
      </Frame>
      <Frame label="Unrun node (every tab shows what a run will fill in)" className="h-[640px]">
        <Inspector
          node={REPLY_NODE}
          inputSchema={REPLY_CONFIG_SCHEMA}
          outputSchema={REPLY_OUTPUT_SCHEMA}
          onRename={() => undefined}
          {...common}
        />
      </Frame>
    </div>
  );
}

function ResizableInspectorExample() {
  return (
    <Frame label="Resizable: drag the handle (280–520 px)" className="h-[520px]">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="70%" minSize={200}>
          <div className="canvas-grid flex h-full items-center justify-center text-2xs font-mono text-ink-3">
            canvas
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={360} minSize={280} maxSize={520}>
          <Inspector
            node={INTENT_NODE}
            nodeRun={INTENT_RUN}
            state={INTENT_STATE}
            timing={{ queueMs: 38, executionMs: 412, retryMs: 0, humanMs: 0 }}
            width="fill"
            defaultTab="output"
            onClose={() => toast.info("Inspector closed")}
            onRunFromHere={() => toast.success("Queued a run from this node")}
            onOpenTrace={() => toast.info("Opening trace")}
            className="border-l border-border"
          >
            <KeyValueList items={INTENT_CONFIG_ROWS} dense divided />
          </Inspector>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Frame>
  );
}

function JsonViewExamples() {
  const large = useMemo(() => buildLargePayload(), []);
  const [rows, setRows] = useState(0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Frame label="Run payload, 3 levels deep, search pre-filled" className="p-3">
        <JsonView
          value={RUN_PAYLOAD}
          expandDepth={2}
          search="confidence"
          onSearchChange={() => undefined}
        />
      </Frame>
      <Frame label="Without the toolbar, expandDepth 1" className="p-3">
        <JsonView value={RUN_PAYLOAD} expandDepth={1} toolbar={false} />
      </Frame>
      <Frame
        label={`Large payload (~5 000 nodes), expandDepth 1 — ${rows} rows rendered`}
        className="p-3 lg:col-span-2"
      >
        <JsonView
          value={large}
          expandDepth={1}
          onRowsChange={setRows}
          className="max-h-[360px] [&>[role=tree]]:overflow-y-auto"
        />
      </Frame>
    </div>
  );
}

/** The compiler's `diff(v3, v4)` for the two documents below (ARCHITECTURE.md §4.7). */
const WORKFLOW_V3_TO_V4: WorkflowDiff = {
  nodes: {
    added: ["n_pii"],
    removed: ["n_debug"],
    changed: [
      { id: "n_intent", patch: [{ op: "replace", path: "/config/threshold", value: 0.9 }] },
      { id: "n_escalate", patch: [{ op: "replace", path: "/name", value: "Needs manager" }] },
    ],
  },
  edges: { added: ["e_pii"], removed: ["e_debug"] },
  inputs: [],
  outputs: [],
  variables: [],
  secrets: [],
  execution: [{ op: "replace", path: "/timeoutMs", value: 120000 }],
  layoutOnly: false,
};
const NODE_NAMES: Record<string, string> = {
  n_intent: "Classify intent",
  n_escalate: "Needs manager",
  n_debug: "Debug log",
  n_pii: "Redact PII",
};

function DiffExamples() {
  const [selected, setSelected] = useState<string | undefined>("n_intent");
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <DiffView
          oldValue={WORKFLOW_V3}
          newValue={WORKFLOW_V4}
          oldLabel="v3 · production"
          newLabel="v4 · draft"
          defaultMode="split"
          maxHeight={520}
        />
        <WorkflowDiffSummary
          diff={WORKFLOW_V3_TO_V4}
          nodeName={(id) => NODE_NAMES[id]}
          selectedNodeId={selected}
          onSelectNode={setSelected}
          className="self-start"
        />
      </div>
      <Frame label="Inline mode, plain strings">
        <DiffView
          oldValue={CONFIG_YAML}
          newValue={CONFIG_YAML.replace("auto: 0.90", "auto: 0.92").replace(
            "retries: 2",
            "retries: 3\nbackoffMs: 250",
          )}
          oldLabel="gate.yaml (v3)"
          newLabel="gate.yaml (v4)"
          defaultMode="inline"
          className="rounded-none border-0"
        />
      </Frame>
      <Frame label="No differences">
        <DiffView
          oldValue={WORKFLOW_V4}
          newValue={WORKFLOW_V4}
          oldLabel="v4"
          newLabel="v4"
          className="rounded-none border-0"
        />
      </Frame>
    </div>
  );
}

function CodeBlockExamples() {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <CodeBlock
        title="workflow.json"
        language="json"
        code={JSON.stringify(WORKFLOW_V4, null, 2)}
        maxHeight={320}
        foldable
      />
      <div className="flex flex-col gap-6">
        <CodeBlock title="transform.js" language="javascript" code={TRANSFORM_JS} defaultWrap />
        <CodeBlock language="yaml" code={CONFIG_YAML} header={false} maxHeight={200} />
      </div>
    </div>
  );
}

function SmallPartsExamples() {
  const families = [
    "decision",
    "string",
    "number",
    "integer",
    "boolean",
    "object",
    "array",
    "message[]",
    "message",
    "any",
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Frame label="KeyValueList (mono values, copy on hover)" className="p-3">
        <KeyValueList
          mono
          divided
          items={[
            { label: "Run id", value: "run_01j8x3q" },
            { label: "Node id", value: "n_intent" },
            { label: "Provider", value: "jev / jev-latest" },
            { label: "Latency", value: "388 ms" },
            { label: "Cost", value: "$0.00041" },
            { label: "Assignee", value: "unassigned", muted: true, copyValue: "" },
            { label: "Reason", value: "Confidence 0.81 below auto threshold 0.90", mono: false },
          ]}
        />
      </Frame>
      <Frame label="TimingBreakdown" className="flex flex-col gap-5 p-3">
        <TimingBreakdown timing={{ queueMs: 38, executionMs: 412, retryMs: 0, humanMs: 0 }} />
        <TimingBreakdown timing={{ queueMs: 12, executionMs: 1842, retryMs: 2210 }} />
        <TimingBreakdown timing={{ queueMs: 220, executionMs: 3, humanMs: 14_120_000 }} compact />
      </Frame>
      <Frame label="PortTypeLabel by family · SchemaTree" className="flex flex-col gap-4 p-3">
        <div className="flex flex-wrap gap-1.5">
          {families.map((t) => (
            <PortTypeLabel key={t} type={t} required={t === "decision"} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {families.slice(0, 5).map((t) => (
            <PortTypeLabel key={t} type={t} size="sm" plain />
          ))}
        </div>
        <SchemaTree schema={INTENT_INPUT_SCHEMA} />
      </Frame>
    </div>
  );
}

function StripExamples() {
  const actions = (
    <>
      <IconButton label="Open inspector" size="sm">
        <SquareArrowOutUpRight strokeWidth={1.75} />
      </IconButton>
      <IconButton label="Open trace" size="sm">
        <ListTree strokeWidth={1.75} />
      </IconButton>
    </>
  );
  const waiting: NodeRunView = {
    id: "nr_01j8xb",
    nodeId: "n_approval",
    nodeName: "Agent approval",
    nodeType: "human.approval",
    category: "human",
    status: "waiting",
    attempt: 1,
    startedAt: "2026-09-21T08:14:09.101Z",
  };
  const pending: NodeRunView = {
    id: "nr_01j8xc",
    nodeId: "n_reply",
    nodeName: "Draft reply",
    nodeType: "generation.text",
    category: "generation",
    status: "pending",
    attempt: 1,
  };
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <NodeSummaryStrip nodeRun={INTENT_RUN} actions={actions} selected />
      <NodeSummaryStrip nodeRun={ACCOUNT_RUN} actions={actions} onSelect={() => undefined} />
      <NodeSummaryStrip
        nodeRun={waiting}
        provider="billing-queue"
        actions={actions}
        onSelect={() => undefined}
      />
      <NodeSummaryStrip nodeRun={pending} provider="gpt-5-mini" />
    </div>
  );
}

export default function InspectorGallery() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Inspector</h1>
        <p className="max-w-2xl text-sm text-ink-2">
          The right-hand inspector and the data viewers behind it: JSON tree, code, diff, schema,
          timing and the bottom-panel summary strip. Sample data is one support-triage run.
        </p>
      </header>

      <Section
        id="inspector"
        title="Inspector"
        caption="Header with category dot, inline rename, mono kind and provider. Tabs carry counts (Logs 12, Errors 1) and can hide when empty. Footer: node id with copy, Run from here, Open trace."
      >
        <InspectorExamples />
      </Section>

      <Section
        id="resizable"
        title="Inspector in a resizable panel"
        caption='width="fill" lets the parent ResizablePanel own the width.'
      >
        <ResizableInspectorExample />
      </Section>

      <Section
        id="strip"
        title="NodeSummaryStrip"
        caption="One row for the bottom panel: status, duration, cost, tokens, provider. Selected, clickable, waiting and pending states."
      >
        <StripExamples />
      </Section>

      <Section
        id="json"
        title="JsonView"
        caption="Keys in ink-2, strings in the data hue, numbers in the accent, booleans in the human hue, null muted. Search auto-expands to matches; hover a row for copy value / copy path; arrows move and expand."
      >
        <JsonViewExamples />
      </Section>

      <Section
        id="diff"
        title="DiffView + WorkflowDiffSummary"
        caption="LCS line diff of two workflow versions (DiffView lives in the data group). Added lines ok-soft, removed danger-soft, changed tokens emphasised, unchanged regions collapsed. The node-level summary reads the compiler's WorkflowDiff."
      >
        <DiffExamples />
      </Section>

      <Section
        id="code"
        title="CodeBlock"
        caption="Read-only CodeMirror 6 with the FlowAId theme: line numbers, wrap toggle, copy, max height. JSON and JavaScript are full grammars; YAML is a light tokenizer."
      >
        <CodeBlockExamples />
      </Section>

      <Section id="parts" title="KeyValueList · TimingBreakdown · PortTypeLabel · SchemaTree">
        <SmallPartsExamples />
      </Section>
      <Toaster />
    </div>
  );
}
