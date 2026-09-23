import { useEffect, useState, type ReactNode } from "react";
import type {
  CriticFindingView,
  EvaluationCaseResultView,
  EvaluationMetricView,
  WorkflowDiff,
  WorkflowVersionView,
} from "@/types";
import { Button, ToggleGroup, ToggleGroupItem } from "@/primitives";
import {
  AIBuilderPanel,
  BUILDER_SAMPLE_TEMPLATES,
  CostOptimizerPanel,
  EvaluationReport,
  ImportDialog,
  MetricsDeltaStrip,
  MiniGraph,
  SideBySideDiff,
  TemplateGallery,
  ThresholdMeter,
  VersionCompare,
  WorkflowCriticPanel,
  type AIBuilderStatus,
  type BuilderPlan,
  type CostOptimizationView,
  type EvaluationGate,
  type ImportMigrationReport,
  type ImportDialogStatus,
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

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-2xs font-medium text-ink-3">{children}</p>;
}

// ---------------------------------------------------------------------------
// Sample data: support-triage workflow
// ---------------------------------------------------------------------------

const PROMPT =
  "Triage inbound support tickets: work out the intent and urgency, escalate anything that looks like a security incident or a legal threat, draft a reply for the common cases, and never send a refund or account deletion without a person approving it.";

const FULL_PLAN: BuilderPlan = {
  outcome:
    "Every inbound ticket is classified, routed to the right queue and answered or escalated within the SLA, with a person approving anything irreversible.",
  decisions: [
    {
      id: "intent",
      kind: "choice",
      question: "What is the customer asking for?",
      options: ["billing", "technical", "account", "security", "other"],
    },
    {
      id: "urgency",
      kind: "score",
      question: "How urgent is this ticket?",
      options: ["low", "normal", "high", "critical"],
    },
    {
      id: "escalate",
      kind: "boolean",
      question: "Does this ticket require a human before any reply is sent?",
    },
    {
      id: "safe",
      kind: "boolean",
      question: "Is the drafted reply free of commitments the company cannot make?",
    },
  ],
  steps: [
    "Strip signatures and quoted history from the ticket body",
    "Redact PII before any model call",
    "Look up the customer's plan and open incidents by account id",
    "Pick the reply template for the intent and fill the account facts",
  ],
  tools: [
    {
      id: "crm",
      name: "Customer lookup",
      kind: "HTTP · GET /customers/{id}",
      credential: { type: "crm_api_key", configured: true },
    },
    {
      id: "zendesk",
      name: "Ticket update",
      kind: "HTTP · PATCH /tickets/{id}",
      credential: { type: "zendesk_oauth", configured: false },
    },
    {
      id: "refund",
      name: "Issue refund",
      kind: "HTTP · POST /refunds",
      credential: { type: "stripe_secret", configured: false },
    },
  ],
  risks: [
    { id: "r1", action: "Issue a refund", gate: "Finance approval" },
    { id: "r2", action: "Delete the customer account", gate: "Account manager approval" },
    { id: "r3", action: "Send a reply on a security-tagged ticket", gate: "Security review" },
  ],
  approvalGates: [
    "Finance approval",
    "Account manager approval",
    "Security review",
    "Low-confidence review",
  ],
  thresholds: [
    { nodeId: "intent", label: "Intent", thresholds: { review: 0.6, auto: 0.85 } },
    { nodeId: "urgency", label: "Urgency", thresholds: { review: 0.55, auto: 0.8 } },
    { nodeId: "escalate", label: "Escalate?", thresholds: { review: 0.7, auto: 0.92 } },
  ],
  dataRequirements: [
    "Ticket subject, body and channel (email, chat, form)",
    "Customer id, plan tier and region",
    "Open incident list from the status page",
    "Reply templates per intent, versioned",
  ],
  workflow: {
    nodes: [
      { id: "start", name: "Ticket received", type: "flow.start", category: "flow" },
      { id: "pii", name: "PII guard", type: "safety.pii", category: "safety" },
      { id: "lookup", name: "Customer lookup", type: "tool.http", category: "tool" },
      { id: "intent", name: "Intent", type: "decision.choice", category: "decision" },
      { id: "urgency", name: "Urgency", type: "decision.score", category: "decision" },
      { id: "escalate", name: "Escalate?", type: "decision.boolean", category: "decision" },
      { id: "router", name: "Router", type: "flow.router", category: "flow" },
      { id: "reply", name: "Draft reply", type: "generation.text", category: "generation" },
      { id: "safety", name: "Reply safe?", type: "decision.boolean", category: "decision" },
      { id: "gate", name: "Confidence gate", type: "flow.gate", category: "flow" },
      { id: "approval", name: "Agent approval", type: "human.approval", category: "human" },
      { id: "send", name: "Ticket update", type: "tool.http", category: "tool" },
    ],
    edges: [
      { source: "start", target: "pii" },
      { source: "pii", target: "lookup" },
      { source: "lookup", target: "intent" },
      { source: "intent", target: "urgency" },
      { source: "urgency", target: "escalate" },
      { source: "escalate", target: "router" },
      { source: "router", target: "reply", label: "auto" },
      { source: "router", target: "approval", label: "escalate" },
      { source: "reply", target: "safety" },
      { source: "safety", target: "gate" },
      { source: "gate", target: "send", label: "≥ 0.85" },
      { source: "gate", target: "approval", label: "< 0.85" },
      { source: "approval", target: "send" },
    ],
  },
  missingCredentials: ["zendesk_oauth", "stripe_secret"],
};

const PLAN_KEYS = Object.keys(FULL_PLAN) as Array<keyof BuilderPlan>;

function partialPlan(sections: number): BuilderPlan {
  const out: BuilderPlan = {};
  for (const key of PLAN_KEYS.slice(0, sections)) {
    Object.assign(out, { [key]: FULL_PLAN[key] });
  }
  return out;
}

const NODE_NAMES: Record<string, string> = Object.fromEntries(
  FULL_PLAN.workflow?.nodes.map((n) => [n.id, n.name]) ?? [],
);

const FINDINGS: CriticFindingView[] = [
  {
    id: "f1",
    severity: "error",
    category: "safety",
    title: "Refund tool reachable without an approval gate",
    detail:
      "The auto route from Router reaches Ticket update with a refund payload when intent = billing and urgency ≥ high. Insert Finance approval before the tool call, or drop the refund fields from the auto path.",
    nodeIds: ["router", "send"],
    fixAvailable: true,
  },
  {
    id: "f2",
    severity: "warning",
    category: "safety",
    title: "PII guard runs after the customer lookup writes to the log",
    detail:
      "Customer lookup logs its request body before PII guard has redacted the ticket. Move PII guard ahead of the lookup or disable request logging on the node.",
    nodeIds: ["pii", "lookup"],
    fixAvailable: true,
  },
  {
    id: "f3",
    severity: "error",
    category: "correctness",
    title: 'Router exit "escalate" has no edge',
    detail:
      "Escalate? returns true on 6.2% of the evaluation set but the escalate exit of Router is unconnected, so those runs end without a reply or a review.",
    nodeIds: ["router"],
    fixAvailable: false,
  },
  {
    id: "f4",
    severity: "warning",
    category: "reliability",
    title: "Ticket update has no retry policy",
    detail:
      "PATCH /tickets/{id} returned 429 on 1.8% of calls last week. Add exponential backoff (3 attempts, 500 ms base) and mark 429 and 503 as retryable.",
    nodeIds: ["send"],
    savings: { calls: 41 },
    fixAvailable: true,
  },
  {
    id: "f5",
    severity: "warning",
    category: "reliability",
    title: "Draft reply has no fallback provider",
    detail:
      "Generation nodes without a failover model fail the run on provider outage. Configure a fallback with the same prompt version.",
    nodeIds: ["reply"],
    fixAvailable: true,
  },
  {
    id: "f6",
    severity: "suggestion",
    category: "cost",
    title: "Urgency can use the compact decision model",
    detail:
      "Urgency accuracy on the 1,240-case dataset is 0.947 with jev-compact against 0.951 with jev-latest, at 22% of the cost. Confidence calibration is within 0.01 ECE.",
    nodeIds: ["urgency"],
    savings: { costUsd: 0.34, latencyMs: 180 },
    fixAvailable: true,
  },
  {
    id: "f7",
    severity: "suggestion",
    category: "cost",
    title: "Customer lookup result can be cached for 10 minutes",
    detail:
      "31% of tickets arrive within 10 minutes of another ticket from the same account. Caching the lookup by account id removes those calls.",
    nodeIds: ["lookup"],
    savings: { costUsd: 0.06, calls: 310 },
    fixAvailable: true,
  },
  {
    id: "f8",
    severity: "suggestion",
    category: "performance",
    title: "Intent and Urgency can run in parallel",
    detail:
      "Urgency reads only the ticket body, not the intent result. Fan out both decisions from Customer lookup and join before Escalate? to save the sequential wait.",
    nodeIds: ["intent", "urgency"],
    savings: { latencyMs: 640 },
    fixAvailable: true,
  },
  {
    id: "f9",
    severity: "suggestion",
    category: "style",
    title: 'Two nodes share the name "Ticket update"',
    detail:
      "Ticket update appears twice in the tool list. Distinct names make traces and approvals easier to read.",
    nodeIds: ["send"],
    fixAvailable: false,
  },
];

const CHECKS = [
  "unreachable nodes",
  "unguarded tools",
  "missing retries",
  "PII ordering",
  "threshold sanity",
  "cost outliers",
  "naming",
];

const OPTIMIZATIONS: CostOptimizationView[] = [
  {
    id: "o1",
    title: "Replace LLM classification with a TypeSafe choice",
    rationale:
      "Intent is a closed set of 5 labels; a typed decision returns the label with a calibrated distribution instead of free text that is parsed afterwards.",
    kind: "model",
    nodeId: "intent",
    nodeName: "Intent",
    nodeCategory: "decision",
    beforeCostPer1k: 2.9,
    afterCostPer1k: 0.62,
    latencyDeltaMs: -840,
    confidenceImpact:
      "Calibrated probabilities become available; accuracy 0.951 → 0.958 on the dataset.",
  },
  {
    id: "o2",
    title: "Route empty-body tickets with a rule",
    rationale:
      'Deterministic first: tickets with no body and an attachment are always "other". A rule skips both decisions for 4.1% of traffic.',
    kind: "rule",
    nodeId: "router",
    nodeName: "Router",
    nodeCategory: "flow",
    beforeCostPer1k: 0.71,
    afterCostPer1k: 0.68,
    latencyDeltaMs: -60,
    confidenceImpact: "No change: the rule covers 100% of the matched cases.",
  },
  {
    id: "o3",
    title: "Cache customer lookup by account id",
    rationale: "31% of tickets repeat an account within 10 minutes.",
    kind: "cache",
    nodeId: "lookup",
    nodeName: "Customer lookup",
    nodeCategory: "tool",
    beforeCostPer1k: 0.19,
    afterCostPer1k: 0.13,
    latencyDeltaMs: -95,
    confidenceImpact: "None: decisions read the same fields.",
  },
  {
    id: "o4",
    title: "Use the compact model for Urgency",
    rationale: "Accuracy within 0.4 points of jev-latest at 22% of the cost.",
    kind: "model",
    nodeId: "urgency",
    nodeName: "Urgency",
    nodeCategory: "decision",
    beforeCostPer1k: 1.55,
    afterCostPer1k: 0.34,
    latencyDeltaMs: -180,
    confidenceImpact: "ECE 0.031 → 0.038; auto rate drops 1.2 points at the current threshold.",
  },
  {
    id: "o5",
    title: "Trim the reply prompt's example block",
    rationale:
      "Six of nine few-shot examples duplicate the template; prompt tokens fall from 2.4k to 1.1k.",
    kind: "prompt",
    nodeId: "reply",
    nodeName: "Draft reply",
    nodeCategory: "generation",
    beforeCostPer1k: 6.8,
    afterCostPer1k: 3.9,
    latencyDeltaMs: -210,
    confidenceImpact: "Reply-safe rate 0.982 → 0.981 on the dataset (within noise).",
  },
];

const METRICS: EvaluationMetricView[] = [
  {
    key: "accuracy",
    label: "Decision accuracy",
    base: 0.917,
    candidate: 0.958,
    unit: "ratio",
    higherIsBetter: true,
  },
  {
    key: "latency",
    label: "Median latency",
    base: 2140,
    candidate: 1755,
    unit: "ms",
    higherIsBetter: false,
  },
  {
    key: "cost",
    label: "Inference cost / run",
    base: 0.0121,
    candidate: 0.0088,
    unit: "usd",
    higherIsBetter: false,
  },
  {
    key: "regressions",
    label: "Regressions",
    base: 0,
    candidate: 2,
    unit: "count",
    higherIsBetter: false,
  },
  {
    key: "routing",
    label: "Changed routing outcomes",
    candidate: 3,
    unit: "count",
    higherIsBetter: false,
  },
];

const V12: WorkflowVersionView = {
  id: "v12",
  version: 12,
  status: "production",
  createdAt: "2026-09-11T09:12:00Z",
  createdBy: "maya",
  message: "Raise auto threshold on Escalate?",
  nodeCount: 11,
};
const V13: WorkflowVersionView = {
  id: "v13",
  version: 13,
  status: "draft",
  createdAt: "2026-09-21T16:40:00Z",
  createdBy: "rohn",
  message: "Add reply safety check, parallelise decisions",
  nodeCount: 12,
};

/** The compiler's `diff(v12, v13)`: gate rewired behind a new safety check, urgency parallelised and switched to jev-compact. */
const V12_TO_V13: WorkflowDiff = {
  nodes: {
    added: ["safety"],
    removed: [],
    changed: [
      { id: "urgency", patch: [{ op: "replace", path: "/config/provider", value: "jev-compact" }] },
      { id: "reply", patch: [{ op: "add", path: "/config/fallback", value: "claude-haiku" }] },
    ],
  },
  edges: { added: ["e3b", "e5b", "e9b"], removed: ["e4"] },
  inputs: [],
  outputs: [],
  variables: [],
  secrets: [],
  execution: [],
  layoutOnly: false,
};
const V13_NODE_NAMES: Record<string, string> = {
  start: "Ticket received",
  pii: "PII guard",
  lookup: "Customer lookup",
  intent: "Intent",
  urgency: "Urgency",
  escalate: "Escalate?",
  router: "Router",
  reply: "Draft reply",
  gate: "Confidence gate",
  approval: "Agent approval",
  send: "Ticket update",
  safety: "Reply safe?",
};
const V12_SOURCE = JSON.stringify(
  {
    nodes: [
      "start",
      "pii",
      "lookup",
      "intent",
      "urgency",
      "escalate",
      "router",
      "reply",
      "gate",
      "approval",
      "send",
    ],
    urgency: { provider: "jev-latest" },
  },
  null,
  2,
);
const V13_SOURCE = JSON.stringify(
  {
    nodes: [
      "start",
      "pii",
      "lookup",
      "intent",
      "urgency",
      "escalate",
      "router",
      "reply",
      "safety",
      "gate",
      "approval",
      "send",
    ],
    urgency: { provider: "jev-compact" },
    reply: { fallback: "claude-haiku" },
  },
  null,
  2,
);

const CASES: EvaluationCaseResultView[] = [
  {
    id: "c-0417",
    name: "Refund request, annual plan, polite",
    passed: true,
    branch: { expected: "auto", actual: "auto" },
    durationMs: 1620,
    costUsd: 0.0081,
  },
  {
    id: "c-0418",
    name: "Password reset loop on mobile",
    passed: true,
    branch: { expected: "auto", actual: "auto" },
    durationMs: 1490,
    costUsd: 0.0074,
  },
  {
    id: "c-0421",
    name: "Threatens chargeback, mentions lawyer",
    passed: false,
    regression: true,
    expected: { intent: "billing", escalate: true },
    actual: { intent: "billing", escalate: false },
    branch: { expected: "escalate", actual: "auto" },
    durationMs: 1710,
    costUsd: 0.0087,
  },
  {
    id: "c-0433",
    name: "Leaked API key in ticket body",
    passed: true,
    branch: { expected: "escalate", actual: "escalate" },
    durationMs: 1902,
    costUsd: 0.0093,
  },
  {
    id: "c-0436",
    name: "Asks to delete account and all data",
    passed: false,
    regression: true,
    expected: { intent: "account", urgency: "high" },
    actual: { intent: "account", urgency: "normal" },
    branch: { expected: "escalate", actual: "escalate" },
    durationMs: 1655,
    costUsd: 0.0079,
  },
  {
    id: "c-0440",
    name: "Invoice PDF missing VAT number",
    passed: true,
    branch: { expected: "auto", actual: "auto" },
    durationMs: 1380,
    costUsd: 0.0069,
  },
  {
    id: "c-0442",
    name: "Outage report from enterprise admin",
    passed: true,
    branch: { expected: "escalate", actual: "escalate" },
    durationMs: 2210,
    costUsd: 0.0102,
  },
  {
    id: "c-0451",
    name: "Empty body with screenshot attached",
    passed: false,
    expected: { intent: "other" },
    actual: { intent: "technical" },
    branch: { expected: "auto", actual: "auto" },
    durationMs: 1210,
    costUsd: 0.0064,
  },
];

const IMPORT_REPORT: ImportMigrationReport = {
  fileName: "support-triage-chatflow.json",
  workflowName: "Support triage (imported)",
  counts: { imported: 3, converted: 4, needsConfig: 2, unsupported: 1 },
  nodes: [
    {
      id: "n1",
      sourceType: "chatOpenAI",
      name: "Classifier LLM",
      targetType: "decision.choice",
      category: "decision",
      status: "converted",
      message:
        "Prompt asked for one of 5 labels; converted to a TypeSafe choice with the same options.",
    },
    {
      id: "n2",
      sourceType: "ifElseFunction",
      name: "Route urgent",
      targetType: "flow.branch",
      category: "flow",
      status: "converted",
      message: "JavaScript condition kept as an expression.",
    },
    {
      id: "n3",
      sourceType: "chatOpenAI",
      name: "Reply writer",
      targetType: "generation.text",
      category: "generation",
      status: "imported",
    },
    {
      id: "n4",
      sourceType: "promptTemplate",
      name: "Reply prompt",
      targetType: "data.template",
      category: "data",
      status: "imported",
    },
    {
      id: "n5",
      sourceType: "requestsGet",
      name: "CRM lookup",
      targetType: "tool.http",
      category: "tool",
      status: "needs_config",
      message: "Bearer token was not exported. Add a credential of type http_bearer.",
    },
    {
      id: "n6",
      sourceType: "pinecone",
      name: "Ticket memory",
      targetType: "retrieval.vector",
      category: "retrieval",
      status: "needs_config",
      message: "Index name kept; API key missing.",
    },
    {
      id: "n7",
      sourceType: "bufferMemory",
      name: "Chat memory",
      targetType: "state.memory",
      category: "state",
      status: "converted",
      message: "Window of 10 turns preserved.",
    },
    {
      id: "n8",
      sourceType: "customTool",
      name: "Send email",
      targetType: "tool.code",
      category: "tool",
      status: "converted",
      message: "Function body imported; runs in the sandbox.",
    },
    {
      id: "n9",
      sourceType: "conversationChain",
      name: "Main chain",
      targetType: "agent.loop",
      category: "agent",
      status: "imported",
    },
    {
      id: "n10",
      sourceType: "zapierNLA",
      name: "Zapier actions",
      status: "unsupported",
      message: "Zapier NLA was retired; replace with an HTTP tool against the target API.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Demos
// ---------------------------------------------------------------------------

function BuilderDemo({ initial }: { initial: AIBuilderStatus }) {
  const [status, setStatus] = useState<AIBuilderStatus>(initial);
  const [sections, setSections] = useState(
    initial === "streaming" ? 3 : initial === "done" ? PLAN_KEYS.length : 0,
  );
  useEffect(() => {
    if (status !== "streaming") return;
    const t = setInterval(() => {
      setSections((s) => {
        if (s >= PLAN_KEYS.length) {
          setStatus("done");
          return s;
        }
        return s + 1;
      });
    }, 900);
    return () => clearInterval(t);
  }, [status]);
  const plan = status === "idle" ? null : partialPlan(status === "error" ? 0 : sections);
  return (
    <AIBuilderPanel
      status={status}
      plan={plan}
      prompt={status === "idle" ? undefined : PROMPT}
      error={
        status === "error"
          ? "Provider jev-latest timed out after 30 s while generating the plan."
          : undefined
      }
      onSubmit={() => {
        setSections(0);
        setStatus("streaming");
      }}
      onRefine={() => {
        setSections(0);
        setStatus("streaming");
      }}
      onRetry={() => {
        setSections(0);
        setStatus("streaming");
      }}
      onApply={() => setStatus("idle")}
      onDiscard={() => {
        setSections(0);
        setStatus("idle");
      }}
      className="min-h-[420px]"
    />
  );
}

function ImportDemo() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ImportDialogStatus>("ready");
  const [report, setReport] = useState<ImportMigrationReport | null>(IMPORT_REPORT);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={() => {
          setReport(IMPORT_REPORT);
          setStatus("ready");
          setOpen(true);
        }}
      >
        Open with sample report
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setReport(null);
          setStatus("idle");
          setOpen(true);
        }}
      >
        Open empty (drop zone)
      </Button>
      <ImportDialog
        open={open}
        onOpenChange={setOpen}
        report={report}
        status={status}
        onFile={(text, fileName) => {
          setStatus("analysing");
          setTimeout(() => {
            setReport({
              ...IMPORT_REPORT,
              fileName,
              workflowName: `${fileName.replace(/\.json$/i, "")} (${text.length} chars)`,
            });
            setStatus("ready");
          }, 600);
        }}
        onImport={() => {
          setStatus("importing");
          setTimeout(() => setOpen(false), 700);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

function EvaluationDemo() {
  const [gate, setGate] = useState<EvaluationGate>("warn");
  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        type="single"
        size="sm"
        value={gate}
        onValueChange={(v) => v && setGate(v as EvaluationGate)}
        aria-label="Gate state"
      >
        <ToggleGroupItem value="pass">pass</ToggleGroupItem>
        <ToggleGroupItem value="warn">warn</ToggleGroupItem>
        <ToggleGroupItem value="fail">fail</ToggleGroupItem>
      </ToggleGroup>
      <EvaluationReport
        datasetName="support-triage-golden"
        base={V12}
        candidate={V13}
        metrics={METRICS}
        cases={
          gate === "pass" ? CASES.map((c) => ({ ...c, passed: true, regression: false })) : CASES
        }
        gate={gate}
        calibrationNote="ECE 0.031 (was 0.052): stated confidence tracks accuracy within 3 points across all four urgency levels; the 0.80 auto threshold now sits above the 0.79 crossover."
      />
    </div>
  );
}

const PROMPT_BEFORE = [
  "You are a support agent for Acme.",
  "Answer the customer's question in two short paragraphs.",
  "Use the account facts below.",
  "Never promise refunds.",
  "Sign off as the Acme support team.",
  "Reply in the customer's language.",
  "Keep a friendly, direct tone.",
].join("\n");
const PROMPT_AFTER = [
  "You are a support agent for Acme.",
  "Answer the customer's question in at most three sentences.",
  "Use the account facts below.",
  "Never promise refunds; route refund requests to billing.",
  "Sign off as the Acme support team.",
  "Reply in the customer's language.",
  "Keep a friendly, direct tone.",
  "Cite the help-centre article when one applies.",
].join("\n");

export default function BuilderGallery() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Builder</h1>
        <p className="max-w-2xl text-sm text-ink-2">
          AI-assisted building, analysis and versioning. Everything here is props and callbacks;
          streaming is modelled as a plan object that gains sections.
        </p>
      </header>

      <Section
        id="ai-builder"
        title="AI builder panel"
        caption="Prompt composer with example chips and ⌘↵ to submit; the plan renders section by section as it streams. Idle, streaming (auto-advances), done and error states."
      >
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Caption>Idle</Caption>
            <BuilderDemo initial="idle" />
          </div>
          <div className="flex flex-col gap-2">
            <Caption>Streaming → done</Caption>
            <BuilderDemo initial="streaming" />
          </div>
          <div className="flex flex-col gap-2">
            <Caption>Done</Caption>
            <BuilderDemo initial="done" />
          </div>
          <div className="flex flex-col gap-2">
            <Caption>Error</Caption>
            <BuilderDemo initial="error" />
          </div>
        </div>
      </Section>

      <Section
        id="critic"
        title="Workflow critic"
        caption="Static-analysis findings grouped by category, safety first. Rows expand to their detail; node chips focus the canvas; fixable findings offer Apply fix."
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <WorkflowCriticPanel
            findings={FINDINGS}
            checks={CHECKS}
            nodeName={(id) => NODE_NAMES[id] ?? id}
            reviewedAt="2 min ago"
            onFocusNode={() => undefined}
            onApplyFix={() => undefined}
            onRerun={() => undefined}
          />
          <div className="flex flex-col gap-2">
            <Caption>Empty state</Caption>
            <WorkflowCriticPanel
              findings={[]}
              checks={CHECKS}
              reviewedAt="just now"
              className="min-h-40"
            />
          </div>
        </div>
      </Section>

      <Section
        id="cost"
        title="Cost optimizer"
        caption="Proposed optimisations with before/after cost per 1k runs, latency delta and the effect on confidence. Rule replacements come first because deterministic logic beats a model call."
      >
        <CostOptimizerPanel
          items={OPTIMIZATIONS}
          runsPerMonth={184_000}
          onApply={() => undefined}
        />
      </Section>

      <Section
        id="templates"
        title="Template gallery"
        caption="Search and category filter over starter workflows. Each card previews the graph with MiniGraph."
      >
        <TemplateGallery templates={BUILDER_SAMPLE_TEMPLATES} onUse={() => undefined} />
      </Section>

      <Section
        id="minigraph"
        title="MiniGraph"
        caption="Tiny SVG graph with deterministic layered layout in a 200 by 80 box; reusable in tables and cards."
      >
        <div className="flex flex-wrap items-end gap-4">
          {BUILDER_SAMPLE_TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3 shadow-1"
            >
              <MiniGraph
                nodes={t.nodes}
                edges={t.edges}
                highlight={t.nodes.filter((n) => n.category === "decision").map((n) => n.id)}
              />
              <span className="font-mono text-2xs text-ink-3">{t.name}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3 shadow-1">
            <MiniGraph
              nodes={BUILDER_SAMPLE_TEMPLATES[0]?.nodes ?? []}
              edges={BUILDER_SAMPLE_TEMPLATES[0]?.edges ?? []}
              width={120}
              height={48}
              nodeRadius={3}
            />
            <span className="font-mono text-2xs text-ink-3">120 × 48</span>
          </div>
        </div>
      </Section>

      <Section
        id="thresholds"
        title="Threshold meter and metrics strip"
        caption="Shared pieces: the confidence-gate ruler used in plans, and the metrics delta strip shared by VersionCompare and EvaluationReport."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 shadow-1">
            <ThresholdMeter thresholds={{ review: 0.6, auto: 0.85 }} />
            <ThresholdMeter thresholds={{ review: 0.6, auto: 0.85 }} value={0.71} />
            <ThresholdMeter
              thresholds={{ review: 0.7, auto: 0.92 }}
              value={0.96}
              showZones={false}
            />
          </div>
          <MetricsDeltaStrip metrics={METRICS} size="sm" />
        </div>
      </Section>

      <Section
        id="versions"
        title="Version compare"
        caption="v12 (production) against v13 (draft): metric deltas, node-level changes from the compiler's WorkflowDiff, and a side-by-side definition diff."
      >
        <VersionCompare
          base={V12}
          candidate={V13}
          diff={V12_TO_V13}
          nodeName={(id) => V13_NODE_NAMES[id]}
          baseSource={V12_SOURCE}
          candidateSource={V13_SOURCE}
          metrics={METRICS}
          onRollback={() => undefined}
          onPromote={() => undefined}
          onOpen={() => undefined}
        />
      </Section>

      <Section
        id="side-by-side"
        title="SideBySideDiff"
        caption="The two-column line diff on its own: removed lines tint the base column, added lines the candidate; unchanged stretches longer than the context fold into a count row. Below, a prompt edit with context 1 and a short max height."
      >
        <div className="flex flex-col gap-4">
          <SideBySideDiff
            before={V12_SOURCE}
            after={V13_SOURCE}
            beforeLabel="v12 · production"
            afterLabel="v13 · draft"
          />
          <SideBySideDiff
            before={PROMPT_BEFORE}
            after={PROMPT_AFTER}
            beforeLabel="prompt · before"
            afterLabel="prompt · after"
            context={1}
            maxHeight={200}
          />
        </div>
      </Section>

      <Section
        id="evaluation"
        title="Evaluation report"
        caption="Dataset run with two regressions. The gate decides the actions: pass publishes, warn and fail offer Publish anyway (danger) next to Block publish."
      >
        <EvaluationDemo />
      </Section>

      <Section
        id="import"
        title="Import a flow"
        caption="Drop zone reads the .json with FileReader; the migration report shows count tiles and a per-node table before importing."
      >
        <ImportDemo />
      </Section>
    </div>
  );
}
