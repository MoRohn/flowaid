/**
 * Deterministic sample data for the data gallery and tests: a support-triage
 * workflow (Intent choice → Urgency score → Escalation → Router → HTTP tools →
 * generative reply → safety → confidence gate → approval) and its neighbours.
 * Decisions are spec-exact `DecisionResult`s, approvals carry `HumanRequest`s
 * and environments are workspace data. Not exported from the package index.
 */
import type { RunOrigin, RunStatus } from "@/lib/categories";
import { makeBooleanDecision, makeChoiceDecision, makeScoreDecision } from "@/lib/decisionBuilders";
import type {
  DecisionKind,
  DecisionResult,
  EnvironmentView,
  ErrorInfo,
  NodeRunView,
  RunView,
} from "@/types";
import type { PendingApprovalView } from "./ApprovalsTable";
import type { CredentialListItemView } from "./CredentialsTable";
import type { FilterBarOptions } from "./FilterBar";
import type { WorkflowListItemView } from "./WorkflowCard";

/** mulberry32: small seeded PRNG so galleries and tests agree. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  const item = list[Math.floor(rand() * list.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

function base32(rand: () => number, n: number): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(rand() * alphabet.length)] ?? "0";
  return s;
}

/** The sample workspace's environments (`{ id, name, protected }[]`, UI.md §3). */
export const SAMPLE_ENVIRONMENTS: EnvironmentView[] = [
  { id: "env_dev", name: "Development", protected: false },
  { id: "env_stg", name: "Staging", protected: false },
  { id: "env_prod", name: "Production", protected: true },
];

function environment(id: string): EnvironmentView {
  const env = SAMPLE_ENVIRONMENTS.find((e) => e.id === id);
  if (!env) throw new Error(`unknown sample environment ${id}`);
  return env;
}

interface WorkflowSeed {
  id: string;
  name: string;
  version: number | "draft";
  environment: EnvironmentView;
}

const WORKFLOWS: readonly WorkflowSeed[] = [
  {
    id: "wf_support_triage",
    name: "Support triage",
    version: 12,
    environment: environment("env_prod"),
  },
  {
    id: "wf_refund_eligibility",
    name: "Refund eligibility",
    version: 4,
    environment: environment("env_prod"),
  },
  {
    id: "wf_lead_scoring",
    name: "Lead scoring",
    version: "draft",
    environment: environment("env_dev"),
  },
  {
    id: "wf_content_moderation",
    name: "Content moderation",
    version: 7,
    environment: environment("env_stg"),
  },
];

const STATUS_WEIGHTS: ReadonlyArray<[RunStatus, number]> = [
  ["completed", 34],
  ["failed", 7],
  ["running", 5],
  ["waiting_for_human", 6],
  ["queued", 2],
  ["cancelled", 2],
  ["timed_out", 2],
  ["retrying", 1],
  ["starting", 1],
];

function weightedStatus(rand: () => number): RunStatus {
  const total = STATUS_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [s, w] of STATUS_WEIGHTS) {
    r -= w;
    if (r <= 0) return s;
  }
  return "completed";
}

const ORIGINS: readonly RunOrigin[] = [
  "api",
  "api",
  "api",
  "webhook",
  "webhook",
  "schedule",
  "ui",
  "replay",
  "evaluation",
  "mcp",
];
const PROVIDERS = [
  { provider: "typesafe", model: "jev-1.13.0" },
  { provider: "typesafe", model: "jev-mini-1.2.0" },
  { provider: "llm", model: "gpt-5-mini" },
] as const;

const INTENTS = ["billing", "technical", "account", "other"] as const;

function decision(rand: () => number, kind: DecisionKind, confidence: number): DecisionResult {
  const pm = pick(rand, PROVIDERS);
  const common = {
    provider: pm.provider,
    model: pm.model,
    latencyMs: 180 + Math.round(rand() * 900),
    usage: {
      inputTokens: 220 + Math.round(rand() * 400),
      outputTokens: 12 + Math.round(rand() * 40),
    },
    costUsd: 0.0004 + rand() * 0.002,
  };
  if (kind === "choice") {
    const chosen = pick(rand, INTENTS);
    const rest = 1 - confidence;
    const others = INTENTS.filter((i) => i !== chosen);
    const cuts = others.map(() => rand());
    const sum = cuts.reduce((a, b) => a + b, 0) || 1;
    const probabilities: Record<string, number> = { [chosen]: confidence };
    others.forEach((o, i) => {
      probabilities[o] = Number((rest * ((cuts[i] ?? 0) / sum)).toFixed(3));
    });
    return makeChoiceDecision({ ...common, probabilities, value: chosen });
  }
  if (kind === "score") {
    const level = Math.floor(rand() * 4);
    return makeScoreDecision({
      ...common,
      levels: ["Low", "Medium", "High", "Critical"],
      value: level,
      confidence,
      probabilities: [0.1, 0.2, 0.5, 0.2],
    });
  }
  // boolean: `confidence = max(pYes, 1 − pYes)`; pick the side at random
  return makeBooleanDecision({ ...common, pYes: rand() > 0.5 ? confidence : 1 - confidence });
}

const LOOKUP_ERROR: ErrorInfo = {
  code: "TOOL_EXECUTION_ERROR",
  message: "accounts-api returned 503 after 3 attempts",
  retryable: true,
};

function nodeRuns(
  rand: () => number,
  runId: string,
  status: RunStatus,
  startedAt: number,
): NodeRunView[] {
  const stamp = (offsetMs: number) => new Date(startedAt + offsetMs).toISOString();
  const lowest = 0.48 + rand() * 0.5; // the run's weakest decision
  const intentConf = Math.min(0.99, lowest + rand() * 0.3);
  const urgencyConf = Math.min(0.99, lowest + rand() * 0.2);
  const escalationConf = lowest;
  const safetyConf = Math.min(0.99, 0.9 + rand() * 0.09);
  const humanWaiting = status === "waiting_for_human";
  const failed = status === "failed" || status === "timed_out";
  const running = status === "running" || status === "retrying" || status === "starting";
  const mk = (
    i: number,
    n: Omit<NodeRunView, "id" | "attempt" | "startedAt" | "endedAt" | "durationMs">,
    ms: number,
  ): NodeRunView => ({
    id: `${runId}_n${i}`,
    attempt: 1,
    startedAt: stamp(i * 700),
    endedAt: n.status === "completed" || n.status === "failed" ? stamp(i * 700 + ms) : undefined,
    durationMs: n.status === "completed" || n.status === "failed" ? ms : undefined,
    ...n,
  });
  const list: NodeRunView[] = [
    mk(
      0,
      {
        nodeId: "intent",
        nodeName: "Intent",
        nodeType: "flowaid.decision.choice",
        category: "decision",
        status: "completed",
        decision: decision(rand, "choice", intentConf),
        decisionQuestion: "What does the customer need?",
      },
      620,
    ),
    mk(
      1,
      {
        nodeId: "urgency",
        nodeName: "Urgency",
        nodeType: "flowaid.decision.score",
        category: "decision",
        status: "completed",
        decision: decision(rand, "score", urgencyConf),
        decisionQuestion: "How urgent is this?",
      },
      540,
    ),
    mk(
      2,
      {
        nodeId: "escalation",
        nodeName: "Escalation",
        nodeType: "flowaid.decision.boolean",
        category: "decision",
        status: "completed",
        decision: decision(rand, "boolean", escalationConf),
        decisionQuestion: "Should a human handle this?",
      },
      410,
    ),
    mk(
      3,
      {
        nodeId: "router",
        nodeName: "Router",
        nodeType: "flowaid.decision.router",
        category: "flow",
        status: "completed",
        routeTaken: "standard",
      },
      3,
    ),
    mk(
      4,
      {
        nodeId: "lookup",
        nodeName: "Lookup account",
        nodeType: "flowaid.tools.http",
        category: "tool",
        status: failed ? "failed" : "completed",
        toolCall: {
          name: "GET /accounts/{id}",
          args: { id: "acc_9F2K" },
          ok: !failed,
          statusCode: failed ? 503 : 200,
          durationMs: 212,
        },
        error: failed ? LOOKUP_ERROR : undefined,
      },
      failed ? 4100 : 212,
    ),
  ];
  if (!failed) {
    list.push(
      mk(
        5,
        {
          nodeId: "reply",
          nodeName: "Draft reply",
          nodeType: "flowaid.ai.generate",
          category: "generation",
          status: running ? "running" : "completed",
          usage: { inputTokens: 1400, outputTokens: 310 },
          costUsd: 0.0041,
        },
        2900,
      ),
      mk(
        6,
        {
          nodeId: "safety",
          nodeName: "Safety check",
          nodeType: "flowaid.safety.output_guard",
          category: "safety",
          status: running ? "pending" : "completed",
          decision: running ? undefined : decision(rand, "boolean", safetyConf),
        },
        380,
      ),
      mk(
        7,
        {
          nodeId: "gate",
          nodeName: "Confidence gate",
          nodeType: "flowaid.decision.confidence_gate",
          category: "flow",
          status: running ? "pending" : "completed",
          routeTaken: humanWaiting ? "review" : lowest >= 0.9 ? "pass" : "fail",
        },
        2,
      ),
      mk(
        8,
        {
          nodeId: "approval",
          nodeName: "Approve reply",
          nodeType: "flowaid.human.approval",
          category: "human",
          status: humanWaiting ? "waiting" : running ? "pending" : "skipped",
        },
        0,
      ),
    );
  }
  return list;
}

/** `n` runs spread over the last 30 days, newest first, with realistic numbers. */
export function makeSampleRuns(n = 60, now: number = Date.now(), seed = 7): RunView[] {
  const rand = seeded(seed);
  const runs: RunView[] = [];
  for (let i = 0; i < n; i++) {
    const wf = i % 5 === 0 ? pick(rand, WORKFLOWS) : (WORKFLOWS[0] ?? pick(rand, WORKFLOWS));
    const status =
      i < 3
        ? ((["running", "waiting_for_human", "queued"] as const)[i] ?? "running")
        : weightedStatus(rand);
    // Denser recently: exponential-ish spread over 30 days.
    const ageMs =
      i < 6 ? i * 90_000 + rand() * 60_000 : Math.pow(rand(), 1.6) * 30 * 24 * 60 * 60 * 1000;
    const createdAt = now - ageMs;
    const id = `run_01K${base32(rand, 11)}`;
    const startedAt = createdAt + 120 + rand() * 600;
    const terminal =
      status === "completed" ||
      status === "failed" ||
      status === "cancelled" ||
      status === "timed_out";
    const durationMs = terminal
      ? status === "timed_out"
        ? 120_000
        : 3200 + rand() * 9000
      : undefined;
    const nodes = nodeRuns(rand, id, status, startedAt);
    const tokensIn = 1800 + Math.round(rand() * 2200);
    const tokensOut = 260 + Math.round(rand() * 400);
    const escalationConfidence =
      nodes.find((x) => x.nodeId === "escalation")?.decision?.confidence ?? 0.7;
    runs.push({
      id,
      workflowId: wf.id,
      workflowName: wf.name,
      version: wf.version,
      environment: wf.environment,
      status,
      origin: pick(rand, ORIGINS),
      createdAt: new Date(createdAt).toISOString(),
      startedAt: status === "queued" ? undefined : new Date(startedAt).toISOString(),
      endedAt:
        terminal && durationMs !== undefined
          ? new Date(startedAt + durationMs).toISOString()
          : undefined,
      durationMs,
      costUsd: status === "queued" ? undefined : Number((0.004 + rand() * 0.02).toFixed(5)),
      usage: status === "queued" ? undefined : { inputTokens: tokensIn, outputTokens: tokensOut },
      nodeRuns: status === "queued" ? [] : nodes,
      error:
        status === "failed"
          ? {
              code: "NODE_EXECUTION_ERROR",
              message: "Lookup account: accounts-api returned 503 after 3 attempts",
              retryable: false,
              nodeId: "lookup",
            }
          : status === "timed_out"
            ? {
                code: "TIMEOUT_ERROR",
                message: "Run exceeded 120 s budget at Draft reply",
                retryable: false,
                nodeId: "reply",
              }
            : undefined,
      pendingApproval:
        status === "waiting_for_human"
          ? {
              id: `apr_${base32(rand, 8)}`,
              runId: id,
              nodeId: "approval",
              nodeName: "Approve reply",
              request: {
                title: "Approve the drafted reply",
                context: { ticket: `TCK-${base32(rand, 5)}` },
                mode: { type: "approval" },
                assignees: [],
                expiresAt: new Date(createdAt + 8000 + 4 * 60 * 60 * 1000).toISOString(),
                externalReview: false,
                origin: "human_node",
              },
              requestedAt: new Date(createdAt + 8000).toISOString(),
              reason: `Confidence ${escalationConfidence.toFixed(2)} below the pass threshold 0.90`,
            }
          : undefined,
    });
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const SAMPLE_FILTER_OPTIONS: FilterBarOptions = {
  workflow: WORKFLOWS.map((w) => ({ value: w.id, label: w.name })),
  version: ["v12", "v11", "v7", "v4", "draft"].map((v) => ({
    value: v.replace(/^v/, ""),
    label: v,
  })),
  provider: [
    { value: "typesafe", label: "TypeSafe", hint: "Jev" },
    { value: "llm", label: "LLM" },
  ],
  model: [
    { value: "jev-1.13.0", label: "jev-1.13.0" },
    { value: "jev-mini-1.2.0", label: "jev-mini-1.2.0" },
    { value: "gpt-5-mini", label: "gpt-5-mini" },
  ],
};

function hours(
  rand: () => number,
  scale: number,
  shape: "steady" | "spiky" | "rising" | "quiet",
): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    const daytime = 0.35 + 0.65 * Math.max(0, Math.sin(((h - 5) / 24) * Math.PI));
    let v = scale * daytime * (0.7 + rand() * 0.6);
    if (shape === "spiky" && (h === 9 || h === 15)) v *= 2.6;
    if (shape === "rising") v *= 0.4 + h / 24;
    if (shape === "quiet") v = h % 7 === 0 ? 1 : 0;
    return Math.round(v);
  });
}

export function makeSampleWorkflows(now: number = Date.now(), seed = 11): WorkflowListItemView[] {
  const rand = seeded(seed);
  const iso = (agoMs: number) => new Date(now - agoMs).toISOString();
  return [
    {
      id: "wf_support_triage",
      name: "Support triage",
      description:
        "Classifies inbound tickets, scores urgency and drafts a reply behind a confidence gate.",
      version: 12,
      versionStatus: "production",
      lastRunStatus: "running",
      lastRunAt: iso(40_000),
      runs24h: hours(rand, 42, "steady"),
      updatedAt: iso(2 * 60 * 60 * 1000),
      deployments: [
        { environment: "env_dev", version: 13 },
        { environment: "env_stg", version: 12 },
        { environment: "env_prod", version: 12 },
      ],
      owner: "Priya N.",
    },
    {
      id: "wf_refund_eligibility",
      name: "Refund eligibility",
      description:
        "Checks order history and policy, then decides whether a refund can be issued automatically.",
      version: 4,
      versionStatus: "production",
      lastRunStatus: "completed",
      lastRunAt: iso(9 * 60 * 1000),
      runs24h: hours(rand, 14, "spiky"),
      updatedAt: iso(3 * 24 * 60 * 60 * 1000),
      deployments: [
        { environment: "env_stg", version: 4 },
        { environment: "env_prod", version: 4 },
      ],
      owner: "Marcus L.",
    },
    {
      id: "wf_content_moderation",
      name: "Content moderation",
      description:
        "Flags policy violations in user posts with a PII guard before anything reaches a model.",
      version: 7,
      versionStatus: "published",
      lastRunStatus: "failed",
      lastRunAt: iso(26 * 60 * 1000),
      runs24h: hours(rand, 25, "rising"),
      updatedAt: iso(6 * 60 * 60 * 1000),
      deployments: [
        { environment: "env_dev", version: 7 },
        { environment: "env_stg", version: 7 },
      ],
      owner: "Ana R.",
    },
    {
      id: "wf_lead_scoring",
      name: "Lead scoring",
      description: "Scores inbound leads from form submissions and routes hot ones to sales.",
      versionStatus: "draft",
      runs24h: hours(rand, 3, "quiet"),
      updatedAt: iso(35 * 60 * 1000),
      deployments: [{ environment: "env_dev", version: 1 }],
      owner: "Priya N.",
    },
    {
      id: "wf_invoice_extraction",
      name: "Invoice extraction",
      description:
        "Pulls line items out of PDF invoices and validates totals against the purchase order.",
      version: 2,
      versionStatus: "published",
      lastRunStatus: "completed",
      lastRunAt: iso(4 * 60 * 60 * 1000),
      runs24h: hours(rand, 6, "steady"),
      updatedAt: iso(9 * 24 * 60 * 60 * 1000),
      deployments: [{ environment: "env_dev", version: 2 }],
      owner: "Marcus L.",
    },
    {
      id: "wf_churn_signals",
      name: "Churn signals",
      description:
        "Nightly scan of usage events for accounts that look like they are about to leave.",
      version: 9,
      versionStatus: "production",
      lastRunStatus: "completed",
      lastRunAt: iso(13 * 60 * 60 * 1000),
      runs24h: hours(rand, 1, "quiet"),
      updatedAt: iso(18 * 24 * 60 * 60 * 1000),
      deployments: [
        { environment: "env_dev", version: 9 },
        { environment: "env_stg", version: 9 },
        { environment: "env_prod", version: 9 },
      ],
      owner: "Ana R.",
    },
  ];
}

export function makeSampleCredentials(now: number = Date.now()): CredentialListItemView[] {
  const iso = (agoMs: number) => new Date(now - agoMs).toISOString();
  return [
    {
      id: "cred_openai_prod",
      name: "OpenAI production",
      type: "api_key",
      provider: "openai",
      environment: "production",
      scopes: ["chat.completions", "embeddings"],
      status: "active",
      lastUsedAt: iso(12_000),
      createdAt: iso(120 * 24 * 60 * 60 * 1000),
      rotatedAt: iso(30 * 24 * 60 * 60 * 1000),
      createdBy: "Priya N.",
    },
    {
      id: "cred_jev_prod",
      name: "TypeSafe decisions",
      type: "api_key",
      provider: "typesafe",
      environment: "production",
      scopes: ["decide", "calibrate", "batch"],
      status: "active",
      lastUsedAt: iso(3_000),
      createdAt: iso(200 * 24 * 60 * 60 * 1000),
      createdBy: "Priya N.",
    },
    {
      id: "cred_zendesk",
      name: "Zendesk support",
      type: "oauth2",
      provider: "zendesk",
      environment: "production",
      scopes: ["tickets:read", "tickets:write", "users:read", "macros:read", "search:read"],
      status: "expiring",
      lastUsedAt: iso(41 * 60 * 1000),
      expiresAt: iso(-5 * 24 * 60 * 60 * 1000),
      createdBy: "Marcus L.",
    },
    {
      id: "cred_accounts_api",
      name: "Accounts API",
      type: "bearer_token",
      provider: "internal",
      environment: "staging",
      scopes: ["accounts:read"],
      status: "active",
      lastUsedAt: iso(26 * 60 * 1000),
      createdBy: "Ana R.",
    },
    {
      id: "cred_slack_alerts",
      name: "Slack alerts",
      type: "webhook",
      provider: "slack",
      scopes: ["chat:write"],
      status: "active",
      lastUsedAt: iso(2 * 24 * 60 * 60 * 1000),
      createdBy: "Ana R.",
    },
    {
      id: "cred_pg_readonly",
      name: "Warehouse read-only",
      type: "postgres",
      provider: "postgres",
      environment: "development",
      scopes: ["SELECT"],
      status: "active",
      createdBy: "Marcus L.",
    },
    {
      id: "cred_stripe_test",
      name: "Stripe test",
      type: "api_key",
      provider: "stripe",
      environment: "development",
      scopes: ["refunds:write", "charges:read"],
      status: "expired",
      lastUsedAt: iso(40 * 24 * 60 * 60 * 1000),
      expiresAt: iso(3 * 24 * 60 * 60 * 1000),
      createdBy: "Priya N.",
    },
  ];
}

export function makeSampleApprovals(now: number = Date.now()): PendingApprovalView[] {
  const iso = (agoMs: number) => new Date(now - agoMs).toISOString();
  const H = 60 * 60 * 1000;
  const M = 60 * 1000;
  const dec = (confidence: number, model = "jev-1.13.0"): DecisionResult =>
    makeBooleanDecision({ pYes: confidence, model, latencyMs: 420 });
  const approval = (
    id: string,
    wf: { id: string; name: string; version: number },
    node: { id: string; name: string },
    title: string,
    reason: string,
    requestedAgo: number,
    expiresAgo: number | undefined,
    extra: {
      assignee?: string;
      assigneeName?: string;
      decision?: DecisionResult;
      mode?: PendingApprovalView["request"]["mode"];
    } = {},
  ): PendingApprovalView => ({
    id,
    runId: `run_${id.slice(4)}`,
    workflowId: wf.id,
    workflowName: wf.name,
    workflowVersion: wf.version,
    nodeId: node.id,
    nodeName: node.name,
    request: {
      title,
      context: {},
      mode: extra.mode ?? { type: "approval" },
      assignees: extra.assignee ? [extra.assignee] : [],
      expiresAt: expiresAgo === undefined ? null : iso(expiresAgo),
      externalReview: false,
      origin: "human_node",
    },
    requestedAt: iso(requestedAgo),
    reason,
    decision: extra.decision,
    assigneeName: extra.assigneeName,
  });
  const triage = { id: "wf_support_triage", name: "Support triage", version: 12 };
  return [
    approval(
      "apr_01K7Q2V8",
      triage,
      { id: "approval", name: "Approve reply" },
      "Approve the drafted reply",
      "Confidence 0.71 below the pass threshold 0.90",
      3 * H + 40 * M,
      -20 * M,
      { assignee: "u_priya", assigneeName: "Priya N.", decision: dec(0.71) },
    ),
    approval(
      "apr_01K7Q3A1",
      triage,
      { id: "approval", name: "Approve reply" },
      "Approve the drafted reply",
      "Confidence 0.64 below the pass threshold 0.90",
      2 * H + 5 * M,
      -1 * H - 55 * M,
      { decision: dec(0.64) },
    ),
    approval(
      "apr_01K7Q4C2",
      { id: "wf_refund_eligibility", name: "Refund eligibility", version: 4 },
      { id: "review", name: "Review refund" },
      "Choose the refund outcome",
      "Refund above $500 always needs a reviewer",
      48 * M,
      -8 * H - 12 * M,
      {
        assignee: "u_marcus",
        assigneeName: "Marcus L.",
        mode: {
          type: "choice",
          options: [
            { id: "full", label: "Full refund" },
            { id: "partial", label: "Partial refund" },
            { id: "deny", label: "Deny" },
          ],
        },
      },
    ),
    approval(
      "apr_01K7Q5D3",
      { id: "wf_content_moderation", name: "Content moderation", version: 7 },
      { id: "escalate", name: "Escalate to trust & safety" },
      "Confirm the moderation note",
      "Safety guard flagged possible self-harm language",
      17 * M,
      -13 * M,
      {
        decision: dec(0.55, "jev-mini-1.2.0"),
        mode: {
          type: "review",
          value: "Possible self-harm language; route to T&S.",
          schema: { type: "string" },
        },
      },
    ),
    approval(
      "apr_01K7Q6E4",
      triage,
      { id: "approval", name: "Approve reply" },
      "Approve the drafted reply",
      "Confidence 0.83 in the review band (0.70 – 0.90)",
      6 * M,
      -3 * H - 54 * M,
      { assignee: "u_ana", assigneeName: "Ana R.", decision: dec(0.83) },
    ),
    approval(
      "apr_01K7Q7F5",
      { id: "wf_invoice_extraction", name: "Invoice extraction", version: 2 },
      { id: "totals", name: "Confirm totals" },
      "Totals do not match the purchase order",
      "Extracted total $12,480.00 differs from PO $12,840.00",
      29 * H,
      undefined,
      {
        assignee: "u_marcus",
        assigneeName: "Marcus L.",
        mode: {
          type: "form",
          schema: { type: "object", properties: { total: { type: "number", title: "Total" } } },
        },
      },
    ),
  ];
}
