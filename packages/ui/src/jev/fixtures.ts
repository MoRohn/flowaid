/**
 * Realistic sample data for the jev gallery and tests: the Intelligent Support
 * Triage workflow after its Jev upgrade (JEV_ENGINEERING.md §4.7, §9.8) —
 * `support.router@4`, a draft `@5`, the high-consequence reply-safety
 * contract, a live agent menu, receipts, a shadow study of
 * `support.ticket_router@1` beside the LLM classifier, and calibration.
 * Not exported from the package index.
 */
import type {
  JevCalibrationMetrics,
  JevContractBody,
  JevDeploymentChip,
  JevDriftAlarm,
  JevOptionSet,
  JevPacketReport,
  JevPathEconomics,
  JevReceipt,
  JevReliabilityBin,
  JevShadowComparison,
  JevStatePacket,
  JevThresholdRecommendation,
} from "./types";

export const FIXTURE_NOW = Date.parse("2026-09-23T09:14:30Z");
const HASH = (seed: string) => seed.repeat(64).slice(0, 64);

export const ROUTER_HASH = HASH("7c1e9a04");
export const QUEUE_LABELS: Record<string, string> = {
  billing: "Billing",
  account_access: "Account access",
  technical: "Technical",
  general: "General",
  none: "None of these",
};

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const SUPPORT_ROUTER_V4: JevContractBody = {
  key: "support.router",
  version: 4,
  title: "Support ticket router",
  purpose:
    "Routes inbound support tickets to one team queue. Internal routing only; no customer-visible action.",
  owner: "team:support-ops",
  question: {
    kind: "choice",
    instructions:
      "Which team queue should receive this support ticket? Judge only from the customer's message and the account facts; the queue must be able to resolve the request without handing it on.",
    menu: {
      source: "static",
      outcomes: {
        billing: {
          description:
            "Invoices, charges, refunds or subscription changes on an account the customer can already access.",
          automatable: true,
        },
        account_access: {
          description:
            "The customer cannot sign in, lost 2FA, or reports a takeover; any request whose resolution needs identity verification.",
          automatable: true,
        },
        technical: {
          description:
            "A product defect, error message, outage or integration failure with observable symptoms.",
          automatable: true,
        },
        general: {
          description:
            "A clear request that fits none of the teams above but needs no specialist (how-to, feedback).",
          automatable: true,
        },
        none: {
          description:
            "The message is not a support request, is empty, or no listed queue can act on it.",
          escape: "none",
          automatable: true,
        },
      },
    },
  },
  fallbackOutcome: "none",
  state: {
    goal: "Route the ticket to the queue that can resolve it without a hand-off.",
    fields: {
      message: {
        role: "evidence",
        description: "Customer message as received (the evidence being judged).",
        schema: { type: "array" },
        required: true,
        dataClass: "pii",
        redact: "error",
        overflow: "error",
        selection: { maxItems: 1, order: "as_bound" },
      },
      tier: {
        role: "fact",
        description:
          "Plan tier: context for billing and access questions (exact tier rules stay in code).",
        schema: { type: "string" },
        required: false,
        dataClass: "internal",
        redact: "error",
        overflow: "error",
      },
      channel: {
        role: "fact",
        description: "Inbound channel; chat messages are shorter and less formal than email.",
        schema: { type: "string", enum: ["email", "chat", "api"] },
        required: false,
        dataClass: "internal",
        redact: "error",
        overflow: "error",
      },
    },
    maxTokens: 2000,
    privacyClass: "pii",
    latencyClass: "interactive",
    consistency: "record",
  },
  routing: {
    consequenceClass: "low",
    thresholds: { low: { autoAt: 0.9, improveAt: 0.7, minMargin: 0.2 } },
    governance: {
      owner: "team:support-ops",
      rationale:
        "Shadow window: auto precision 0.974 (Wilson 95 % lower bound 0.961) at 0.90 on 1 212 labeled tickets; 8 % of traffic within ±0.03 of the boundary.",
      evaluationWindow: {
        from: "2026-08-01T00:00:00Z",
        to: "2026-08-29T00:00:00Z",
        source: "shadow",
        labeled: 1212,
        calibrationSnapshotIds: [],
      },
      rollbackCondition: {
        metric: "override_rate",
        op: ">",
        value: 0.05,
        window: "24h",
        minSamples: 100,
        action: "pause_candidate",
      },
      approvedBy: "u_7f3a",
      approvedAt: "2026-08-30T09:12:00Z",
    },
    escapeRoutes: { none: "human", other: "human", stop: "auto" },
    improve: {
      actions: [
        {
          kind: "collect_evidence",
          description:
            "Fetch the last three invoices and the sign-in log summary for the account, then ask again.",
        },
      ],
      maxRounds: 1,
    },
    uncalibratedProviders: "human",
    onModelChange: "continue",
  },
  allowedAction: {
    kinds: ["internal_routing"],
    capabilities: [],
    maxConsequence: "low",
    externalSideEffects: false,
  },
  escalation: {
    assignees: ["role:support_lead"],
    mode: "choice",
    onExpire: "route",
    rubric:
      "Pick the queue that can resolve the ticket end to end. Use none when no queue can act.",
  },
  model: {
    primary: { provider: "typesafe", model: "jev-latest" },
    failover: [],
    expectResolved: "jev-1.13.0",
  },
  tests: {
    requiredCategories: [
      "normal",
      "ambiguous",
      "missing_evidence",
      "adversarial",
      "stale_options",
      "rare_class",
      "no_fit",
    ],
    minPerCategory: 3,
    minAccuracy: 0.9,
    requireMonotonicity: true,
  },
  changelog:
    "@4: thresholds per consequence class with governance from the August shadow window (was one global 0.8 in @3). @3 split account_access out of billing. @2 added the none escape.",
  tags: ["support", "routing"],
};

/** A draft @5 with review findings: a refund outcome above the authority ceiling, a thin description, no changelog. */
export const SUPPORT_ROUTER_V5_DRAFT: JevContractBody = {
  ...SUPPORT_ROUTER_V4,
  version: 5,
  changelog: "",
  question: {
    kind: "choice",
    instructions: SUPPORT_ROUTER_V4.question.instructions,
    menu: {
      source: "static",
      outcomes: {
        billing: {
          description:
            "Invoices, charges or subscription changes on an account the customer can already access.",
          automatable: true,
        },
        refund: { description: "Refund requests.", consequenceClass: "high", automatable: false },
        account_access: {
          description:
            "The customer cannot sign in, lost 2FA, or reports a takeover; any request whose resolution needs identity verification.",
          automatable: true,
        },
        technical: {
          description:
            "A product defect, error message, outage or integration failure with observable symptoms.",
          automatable: true,
        },
        general: {
          description:
            "A clear request that fits none of the teams above but needs no specialist (how-to, feedback).",
          automatable: true,
        },
        none: {
          description:
            "The message is not a support request, is empty, or no listed queue can act on it.",
          escape: "none",
          automatable: true,
        },
      },
    },
  },
};

export const REPLY_SAFETY_V1: JevContractBody = {
  key: "support.reply_safety",
  version: 1,
  title: "Reply safe to send",
  purpose:
    "Gates the auto-send of a drafted customer reply: an external message that represents the company.",
  owner: "team:support-ops",
  question: {
    kind: "boolean",
    instructions:
      "Does the draft reply answer the customer's question using only facts present in the ticket and account evidence, make no commitment about refunds, credits or timelines, and contain no personal data beyond the customer's own?",
    outcomes: {
      true: {
        description:
          "Every claim is supported by the ticket or account evidence and no commitment or third-party data appears.",
        automatable: true,
      },
      false: {
        description:
          "An unsupported claim, a refund/credit/timeline commitment, or another person's data appears.",
        automatable: true,
      },
    },
    yesAt: 0.5,
  },
  fallbackOutcome: null,
  state: {
    fields: {
      draft: {
        role: "artifact",
        description: "The generated reply being judged.",
        schema: { type: "array" },
        required: true,
        dataClass: "pii",
        redact: "error",
        overflow: "error",
      },
      ticket: {
        role: "evidence",
        description: "The customer's message the reply must answer.",
        schema: { type: "array" },
        required: true,
        dataClass: "pii",
        redact: "error",
        overflow: "error",
      },
    },
    maxTokens: 6000,
    privacyClass: "pii",
    latencyClass: "interactive",
    consistency: "record",
  },
  routing: {
    consequenceClass: "high",
    thresholds: { high: { autoAt: 0.95, improveAt: 0.8 } },
    escapeRoutes: { none: "human", other: "human", stop: "auto" },
    uncalibratedProviders: "human",
    onModelChange: "human",
  },
  allowedAction: {
    kinds: ["external_message"],
    capabilities: ["email.send"],
    maxConsequence: "high",
    externalSideEffects: true,
  },
  escalation: {
    assignees: ["role:support_agent"],
    mode: "approval",
    onExpire: "escalate",
    rubric: "Approve only replies you would send unchanged.",
  },
  model: {
    primary: { provider: "typesafe", model: "jev-latest" },
    failover: [],
    expectResolved: "jev-1.13.0",
  },
  tests: {
    requiredCategories: ["normal", "ambiguous", "missing_evidence", "adversarial"],
    minPerCategory: 3,
    minAccuracy: 0.95,
    requireMonotonicity: true,
  },
  changelog: "",
  tags: ["support", "safety"],
};

export const URGENCY_V1: JevContractBody = {
  key: "support.urgency",
  version: 1,
  title: "Ticket urgency",
  purpose: "Orders the queue: how soon a ticket needs a human. Internal prioritisation only.",
  owner: "team:support-ops",
  question: {
    kind: "score",
    instructions:
      "How soon does this ticket need a human response, judged from the observable impact the customer describes?",
    levels: [
      "No impact described; a question or feedback.",
      "One user is inconvenienced but has a workaround.",
      "Work is blocked for the customer or a team, no workaround.",
      "Production outage, data loss or security exposure is described.",
    ],
    bands: [
      { port: "routine", minLevel: 0, maxLevel: 1, automatable: true },
      { port: "priority", minLevel: 2, maxLevel: 3, automatable: true },
    ],
  },
  fallbackOutcome: null,
  state: {
    fields: {
      message: {
        role: "evidence",
        description: "Customer message as received.",
        schema: { type: "array" },
        required: true,
        dataClass: "pii",
        redact: "error",
        overflow: "error",
      },
    },
    maxTokens: 2000,
    privacyClass: "pii",
    latencyClass: "interactive",
    consistency: "record",
  },
  routing: {
    consequenceClass: "low",
    thresholds: {},
    escapeRoutes: { none: "human", other: "human", stop: "auto" },
    uncalibratedProviders: "human",
    onModelChange: "continue",
  },
  allowedAction: {
    kinds: ["internal_routing", "annotate"],
    capabilities: [],
    maxConsequence: "low",
    externalSideEffects: false,
  },
  escalation: { assignees: [], mode: "choice", onExpire: "route", rubric: "" },
  model: {
    primary: { provider: "typesafe", model: "jev-latest" },
    failover: [],
    expectResolved: "jev-1.13.0",
  },
  tests: {
    requiredCategories: ["normal", "ambiguous", "ladder"],
    minPerCategory: 3,
    minAccuracy: 0.85,
    requireMonotonicity: true,
  },
  changelog: "",
  tags: ["support"],
};

export const AGENT_ROUTER_V2: JevContractBody = {
  key: "support.agent_router",
  version: 2,
  title: "On-shift agent",
  purpose:
    "Assigns an account-access ticket to one on-shift agent from the live roster. Internal assignment only.",
  owner: "team:support-ops",
  question: {
    kind: "choice",
    instructions:
      "Which on-shift agent should own this account-access ticket? Prefer the agent whose listed skills match the verification the ticket needs and whose language matches the customer's.",
    menu: {
      source: "dynamic",
      escapes: {
        review: {
          description: "Two or more agents fit equally, or the ticket needs a lead's judgment.",
          escape: "review",
          automatable: false,
        },
        none: {
          description: "No listed agent has the skill or language the ticket needs.",
          escape: "none",
          automatable: true,
        },
      },
      maxOptions: 12,
      keyStrategy: "ordinal",
      maxAgeMs: 60_000,
    },
  },
  fallbackOutcome: "review",
  state: {
    fields: {
      message: {
        role: "evidence",
        description: "Customer message as received.",
        schema: { type: "array" },
        required: true,
        dataClass: "pii",
        redact: "error",
        overflow: "error",
      },
      language: {
        role: "fact",
        description: "Detected customer language (code, not a model).",
        schema: { type: "string" },
        required: true,
        dataClass: "internal",
        redact: "error",
        overflow: "error",
      },
    },
    maxTokens: 4000,
    privacyClass: "pii",
    latencyClass: "interactive",
    consistency: "record",
  },
  routing: {
    consequenceClass: "low",
    thresholds: { low: { autoAt: 0.85, improveAt: 0.6, minMargin: 0.15 } },
    escapeRoutes: { none: "human", other: "human", stop: "auto" },
    improve: {
      actions: [
        {
          kind: "narrow_options",
          description: "Filter the roster to agents with the verification skill, then ask again.",
        },
      ],
      maxRounds: 1,
    },
    uncalibratedProviders: "human",
    onModelChange: "continue",
  },
  allowedAction: {
    kinds: ["select_worker"],
    capabilities: [],
    maxConsequence: "low",
    externalSideEffects: false,
  },
  escalation: {
    assignees: ["role:support_lead"],
    mode: "choice",
    onExpire: "route",
    rubric: "Pick the agent who can verify identity in the customer's language.",
  },
  model: {
    primary: { provider: "typesafe", model: "jev-latest" },
    failover: [],
    expectResolved: "jev-1.13.0",
  },
  tests: {
    requiredCategories: ["normal", "stale_options", "no_fit"],
    minPerCategory: 3,
    minAccuracy: 0.9,
    requireMonotonicity: false,
  },
  changelog: "@2: added the review escape for ties.",
  tags: ["support", "routing"],
};

export const ROUTER_DEPLOYMENTS: JevDeploymentChip[] = [
  {
    environment: "dev",
    protected: false,
    active: { version: 4, stage: "active" },
    candidate: { version: 5, stage: "shadow" },
  },
  {
    environment: "staging",
    protected: false,
    active: { version: 4, stage: "active" },
    candidate: null,
  },
  {
    environment: "production",
    protected: true,
    active: { version: 3, stage: "active" },
    candidate: { version: 4, stage: "canary" },
  },
];

// ---------------------------------------------------------------------------
// Packet
// ---------------------------------------------------------------------------

export const TICKET_MESSAGE =
  "Hi, since Tuesday I can't log in — the 2FA code from my old phone doesn't work and I switched numbers. I also see a charge of $49 on Sep 20 I don't recognise. Can someone help me get back in? — Priya";

export const ROUTER_PACKET: JevStatePacket = {
  goal: "Route the ticket to the queue that can resolve it without a hand-off.",
  facts: { tier: "business", channel: "email" },
  evidence: [
    {
      id: "msg",
      kind: "customer_message",
      supports: ["sign_in", "2fa", "charge"],
      summary: TICKET_MESSAGE,
      observedAt: "2026-09-23T09:12:04Z",
      source: { ref: "zendesk:ticket/88213" },
    },
  ],
  stateVersion: "0199a3c1-7e2f-7c55-9d1e-3f4b8a2c6d10:@12",
};

/** The same ticket after the improve round collected invoices and the sign-in log. */
export const ROUTER_PACKET_IMPROVED: JevStatePacket = {
  goal: ROUTER_PACKET.goal,
  facts: { tier: "business", channel: "email", account_age_days: 812, open_tickets: 0 },
  evidence: [
    ...(ROUTER_PACKET.evidence ?? []),
    {
      id: "inv_2291",
      kind: "invoice",
      supports: ["charge"],
      summary: "Invoice INV-2291, Sep 20, $49.00, Business plan renewal, paid by card ending 4417.",
      observedAt: "2026-09-23T09:13:40Z",
      version: "inv_2291@3",
      verified: true,
    },
    {
      id: "signin_log",
      kind: "tool_result",
      supports: ["sign_in", "2fa"],
      summary:
        "14 failed 2FA attempts since Sep 21 from the customer's usual region; no password change; no new device enrolled.",
      observedAt: "2026-09-23T09:02:10Z",
      version: "auth-log:9f41",
      verified: true,
    },
  ],
  constraints: { customer_visible: false },
  options: { queues: ["billing", "account_access", "technical", "general"] },
  stateVersion: "0199a3c1-7e2f-7c55-9d1e-3f4b8a2c6d10:@18",
};

export const ROUTER_PACKET_REPORT: JevPacketReport = {
  included: ["message", "tier", "channel"],
  excluded: [
    { field: "transcript", reason: "undeclared" },
    { field: "customer_email", reason: "undeclared" },
  ],
  redacted: [],
  truncated: [],
  droppedEvidence: [],
  stale: [{ id: "signin_log", ageMs: 740_000 }],
  tokens: 412,
  effectiveDataClass: "pii",
  provenance: {
    message: ["start.message"],
    tier: ["fetch_account.body.plan.tier"],
    channel: ["start.channel"],
    account_age_days: ["fetch_account.body.age_days"],
    open_tickets: ["fetch_account.body.open_tickets"],
  },
};

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

const RUN_ID = "0199a3c1-7e2f-7c55-9d1e-3f4b8a2c6d10";

export const ROUTER_RECEIPT: JevReceipt = {
  receiptId: "0199a3c2-11d0-7a3e-8f55-2b7c9e40d1a8",
  runId: RUN_ID,
  nodeRunId: "0199a3c2-10f4-7b12-9a6e-5d3c1f8e2b77",
  nodeId: "route_ticket",
  question: "route_ticket",
  bundleId: `${RUN_ID}:@18`,
  batchId: `${RUN_ID}:@18#1`,
  mode: "live",
  contract: { key: "support.router", version: 4, hash: ROUTER_HASH, origin: "registry" },
  kind: "choice",
  stateReference: {
    stateVersion: ROUTER_PACKET_IMPROVED.stateVersion,
    packetHash: HASH("b476e21c"),
    snapshotId: "snap_0199a3c2",
    fidelity: "redacted",
  },
  evidenceScope: {
    fields: ["message", "tier", "channel"],
    evidenceIds: ["msg", "inv_2291", "signin_log"],
  },
  optionSet: {
    version: HASH("51d0aa73"),
    source: "static",
    size: 5,
    escapeKeys: ["none"],
    counts: null,
    ageMs: null,
  },
  rubric: null,
  outcome: "account_access",
  escape: null,
  distribution: {
    account_access: 0.93,
    billing: 0.041,
    technical: 0.017,
    general: 0.008,
    none: 0.004,
  },
  bandMass: null,
  value: "account_access",
  confidence: 0.93,
  model: { provider: "typesafe", requested: "jev-latest", resolved: "jev-1.13.0" },
  requestId: "req_8f2a41c7",
  latencyMs: 84,
  costUsd: 0.0000173,
  reused: false,
  staleness: { optionSetAgeMs: null, staleEvidence: [], raceRecorded: false },
  routings: [
    {
      routedBy: { nodeId: "route_ticket", nodeRunId: "0199a3c2-10f4-7b12-9a6e-5d3c1f8e2b77" },
      consequenceClass: "low",
      threshold: {
        consequenceClass: "low",
        autoAt: 0.9,
        improveAt: 0.7,
        minMargin: 0.2,
        confidence: 0.93,
        margin: 0.889,
        illustrative: false,
        source: "support.router@4#/routing/thresholds/low",
      },
      route: "auto",
      reasons: ["zone_auto"],
      disposition: "canary",
      policy: {
        id: "jev.default@1",
        verdict: "allow",
        checks: [
          { name: "allowed_action_proof", ok: true, detail: "internal_routing only" },
          { name: "rollout_guardrails", ok: true, detail: "canary 5% · outcomes account_access" },
          { name: "consequence_ceiling", ok: true, detail: "low ≤ low" },
          { name: "budget", ok: true, detail: "$0.41 remaining" },
          { name: "escalation_available", ok: true, detail: "human → lead_review" },
        ],
        proofId: HASH("e03f9d12"),
      },
      authorizedAction: { kind: "fire_port", port: "account_access" },
      at: "2026-09-23T09:13:41.206Z",
    },
  ],
  at: "2026-09-23T09:13:41.122Z",
  executedAction: {
    kind: "node",
    nodeId: "queue_account_access",
    nodeRunId: "0199a3c2-1204-7cc1-b3a9-7e0d6c5f4a21",
    toolCallId: null,
    humanTaskId: null,
    status: "completed",
    failure: null,
    at: "2026-09-23T09:13:41.690Z",
  },
  overrides: [],
};

export const SAFETY_RECEIPT: JevReceipt = {
  receiptId: "0199a3c3-02aa-7d61-a4f0-8c2e5b19d3f6",
  runId: RUN_ID,
  nodeRunId: "0199a3c3-0290-71e4-8b2d-4a6f3c9e1d05",
  nodeId: "reply_safety",
  question: "reply_safety",
  bundleId: `${RUN_ID}:@27`,
  batchId: `${RUN_ID}:@27#1`,
  mode: "live",
  contract: { key: "support.reply_safety", version: 1, hash: HASH("c9a0413e"), origin: "registry" },
  kind: "boolean",
  stateReference: {
    stateVersion: `${RUN_ID}:@27`,
    packetHash: HASH("0d77f2a9"),
    snapshotId: "snap_0199a3c3",
    fidelity: "redacted",
  },
  evidenceScope: { fields: ["draft", "ticket"], evidenceIds: ["msg"] },
  optionSet: null,
  rubric: null,
  outcome: "true",
  escape: null,
  distribution: { true: 0.88, false: 0.12 },
  bandMass: null,
  value: true,
  confidence: 0.88,
  model: { provider: "typesafe", requested: "jev-latest", resolved: "jev-1.13.0" },
  requestId: "req_8f2a4d02",
  latencyMs: 97,
  costUsd: 0.0000402,
  reused: false,
  staleness: { optionSetAgeMs: null, staleEvidence: [], raceRecorded: false },
  routings: [
    {
      routedBy: { nodeId: "safety_route", nodeRunId: "0199a3c3-03b1-7f02-9e4c-1d8a6b2f7c30" },
      consequenceClass: "high",
      threshold: {
        consequenceClass: "high",
        autoAt: 0.95,
        improveAt: 0.8,
        minMargin: null,
        confidence: 0.88,
        margin: null,
        illustrative: true,
        source: "support.reply_safety@1#/routing/thresholds/high",
      },
      route: "human",
      reasons: ["zone_improve", "thresholds_illustrative", "improve_budget_exhausted"],
      disposition: "active",
      policy: {
        id: "jev.default@1",
        verdict: "review",
        checks: [
          { name: "allowed_action_proof", ok: true, detail: "external_message · email.send" },
          { name: "consequence_ceiling", ok: true, detail: "high ≤ high (dev guardrails)" },
          { name: "escalation_available", ok: true, detail: "human → approve_reply" },
        ],
        proofId: HASH("41be70c5"),
      },
      authorizedAction: { kind: "human_review", port: "human", inline: false },
      at: "2026-09-23T09:14:02.511Z",
    },
  ],
  at: "2026-09-23T09:14:02.388Z",
  executedAction: {
    kind: "human_task",
    nodeId: "approve_reply",
    nodeRunId: null,
    toolCallId: null,
    humanTaskId: "0199a3c3-2e10-7aa0-8d3b-6c1f0e9b5a44",
    status: "completed",
    failure: null,
    at: "2026-09-23T09:21:47.000Z",
  },
  overrides: [
    {
      by: "u_31c9 (support agent)",
      at: "2026-09-23T09:21:47.000Z",
      from: "true",
      to: "false",
      route: "human",
      reason:
        "Draft promised a refund of the $49 charge within 24 hours; refunds need a billing review first.",
      source: "human_task",
    },
  ],
};

export const URGENCY_SHADOW_RECEIPT: JevReceipt = {
  ...ROUTER_RECEIPT,
  receiptId: "0199a3c2-11d0-7a3e-8f55-2b7c9e40d1b2",
  nodeId: "urgency",
  question: "urgency",
  mode: "shadow",
  contract: { key: "support.urgency", version: 1, hash: HASH("aa19c0de"), origin: "registry" },
  kind: "score",
  optionSet: null,
  rubric: URGENCY_V1.question.kind === "score" ? URGENCY_V1.question.levels : null,
  outcome: "priority",
  distribution: { "0": 0.04, "1": 0.21, "2": 0.61, "3": 0.14 },
  bandMass: { routine: 0.25, priority: 0.75 },
  value: 1.85,
  confidence: 0.75,
  routings: [
    {
      routedBy: { nodeId: "urgency", nodeRunId: "0199a3c2-10f4-7b12-9a6e-5d3c1f8e2b99" },
      consequenceClass: "low",
      threshold: {
        consequenceClass: "low",
        autoAt: 0.9,
        improveAt: 0.7,
        minMargin: null,
        confidence: 0.75,
        margin: 0.5,
        illustrative: true,
        source: "support.urgency@1#/routing/thresholds/low (Table V)",
      },
      route: "human",
      reasons: ["zone_improve", "thresholds_illustrative", "improve_budget_exhausted"],
      disposition: "shadow",
      policy: {
        id: "jev.default@1",
        verdict: "review",
        checks: [{ name: "rollout_guardrails", ok: true, detail: "shadow: receipts only" }],
        proofId: null,
      },
      authorizedAction: { kind: "none", reason: "shadow" },
      at: "2026-09-23T09:13:41.210Z",
    },
  ],
  executedAction: null,
  overrides: [],
};

// ---------------------------------------------------------------------------
// Live agent menu
// ---------------------------------------------------------------------------

const AGENTS: [string, string, string][] = [
  [
    "agent:mhernandez",
    "Marta Hernández",
    "Identity verification and 2FA resets; Spanish and English; 3 open tickets.",
  ],
  [
    "agent:okim",
    "Oliver Kim",
    "Account takeover investigations; English; security clearance for credential resets.",
  ],
  [
    "agent:pnair",
    "Priya Nair",
    "2FA and SSO lockouts for business plans; English and Hindi; 5 open tickets.",
  ],
  ["agent:lduval", "Léa Duval", "Identity verification; French and English; new-device enrolment."],
  ["agent:tbrandt", "Tobias Brandt", "SSO configuration for business plans; German and English."],
  ["agent:asato", "Aiko Sato", "Password and recovery email changes; Japanese and English."],
  [
    "agent:jokafor",
    "James Okafor",
    "Billing-linked access holds (failed payment lockouts); English.",
  ],
  ["agent:rsilva", "Rafael Silva", "Identity verification; Portuguese and Spanish."],
  ["agent:ewong", "Emily Wong", "2FA device migration; English and Cantonese; 1 open ticket."],
  [
    "agent:nabadi",
    "Nadia Abadi",
    "Account recovery for deceased or incapacitated owners; English and Arabic.",
  ],
  ["agent:gross", "Greta Ross", "Enterprise SSO and SCIM access; English."],
  [
    "agent:dkowalski",
    "Dawid Kowalski",
    "Identity verification; Polish and English; phone-number changes.",
  ],
];

export const AGENT_MENU: JevOptionSet = {
  version: HASH("3e8d10f7"),
  entries: [
    ...AGENTS.map(([id, label, description], i) => ({
      key: `o${i + 1}`,
      sourceId: id,
      label,
      description,
      observedAt: "2026-09-23T09:13:52Z",
    })),
    {
      key: "review",
      sourceId: "escape:review",
      description: "Two or more agents fit equally, or the ticket needs a lead's judgment.",
      escape: "review",
    },
    {
      key: "none",
      sourceId: "escape:none",
      description: "No listed agent has the skill or language the ticket needs.",
      escape: "none",
    },
  ],
  counts: { original: 38, kept: 24, eligible: 19, shortlisted: 12, final: 14 },
  builtAt: "2026-09-23T09:13:52Z",
  builtAtSeq: 19,
};

export const AGENT_DISTRIBUTION: Record<string, number> = {
  o1: 0.07,
  o2: 0.05,
  o3: 0.71,
  o4: 0.02,
  o5: 0.01,
  o6: 0.01,
  o7: 0.01,
  o8: 0.01,
  o9: 0.06,
  o10: 0.005,
  o11: 0.015,
  o12: 0.01,
  review: 0.02,
  none: 0.01,
};

// ---------------------------------------------------------------------------
// Shadow study: support.ticket_router@1 beside the LLM classifier
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so the gallery and tests see the same study. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHADOW_OUTCOMES = ["billing", "account_access", "technical", "general", "none"] as const;
const SHADOW_MIX = [0.34, 0.22, 0.28, 0.12, 0.04];

function pickWeighted(r: number): (typeof SHADOW_OUTCOMES)[number] {
  let acc = 0;
  for (let i = 0; i < SHADOW_OUTCOMES.length; i++) {
    acc += SHADOW_MIX[i] ?? 0;
    const o = SHADOW_OUTCOMES[i];
    if (o && r < acc) return o;
  }
  return "general";
}

export function buildShadowComparisons(n = 240, seed = 1184): JevShadowComparison[] {
  const rand = prng(seed);
  const contract = {
    key: "support.ticket_router",
    version: 1,
    hash: HASH("5be7c2d4"),
    origin: "registry" as const,
  };
  const out: JevShadowComparison[] = [];
  for (let i = 0; i < n; i++) {
    const truth = pickWeighted(rand());
    const confusable =
      truth === "billing"
        ? "account_access"
        : truth === "account_access"
          ? "billing"
          : truth === "general"
            ? "technical"
            : "general";
    // LLM classifier: 86% right, and it never says "none" (no escape in its prompt).
    const prodRoll = rand();
    const production = prodRoll < 0.86 ? (truth === "none" ? "general" : truth) : confusable;
    // Jev shadow: 92% right; its errors carry lower confidence.
    const shadowRight = rand() < 0.92;
    const shadowOutcome = shadowRight ? truth : confusable;
    const confidence = Math.min(0.995, shadowRight ? 0.78 + rand() * 0.21 : 0.48 + rand() * 0.35);
    const rest = (1 - confidence) / (SHADOW_OUTCOMES.length - 1);
    const distribution: Record<string, number> = {};
    for (const o of SHADOW_OUTCOMES) distribution[o] = o === shadowOutcome ? confidence : rest;
    const wouldRoute = confidence >= 0.9 ? "auto" : confidence >= 0.7 ? "improve" : "human";
    const unmappable = rand() < 0.02;
    const labeled = rand() < 0.45;
    const day = 1 + Math.floor((i / n) * 28);
    out.push({
      id: `sc_${String(i).padStart(4, "0")}`,
      receiptId: `rc_${String(i).padStart(4, "0")}`,
      contract,
      runId: `run_${String(1000 + i)}`,
      question: "ticket_router",
      stateHash: HASH((0x10000000 + Math.floor(rand() * 0xefffffff)).toString(16)),
      jevModel: "jev-1.13.0",
      shadow: { outcome: shadowOutcome, confidence, distribution, wouldRoute },
      production: {
        source: "llm",
        nodeId: "classify_llm",
        answer: unmappable ? null : production,
        confidence: null,
      },
      agree: unmappable ? null : production === shadowOutcome,
      humanLabel: labeled ? truth : null,
      actionTaken: false,
      deferred: false,
      at: `2026-08-${String(day).padStart(2, "0")}T${String(8 + (i % 10)).padStart(2, "0")}:00:00Z`,
    });
  }
  return out;
}

export const SHADOW_ECONOMICS: { production: JevPathEconomics; shadow: JevPathEconomics } = {
  production: { decisions: 18_420, costUsdPerDecision: 0.00094, p50Ms: 1_140, p95Ms: 2_870 },
  shadow: { decisions: 18_420, costUsdPerDecision: 0.0000181, p50Ms: 88, p95Ms: 212 },
};

// ---------------------------------------------------------------------------
// Calibration: support.router@4, production, low class, rolling 7d
// ---------------------------------------------------------------------------

const BIN_ROWS: [number, number, number | null, number | null][] = [
  [0, 0, null, null],
  [0.1, 0, null, null],
  [0.2, 2, 0.27, 0.5],
  [0.3, 6, 0.36, 0.33],
  [0.4, 14, 0.46, 0.43],
  [0.5, 31, 0.55, 0.52],
  [0.6, 58, 0.66, 0.62],
  [0.7, 112, 0.76, 0.71],
  [0.8, 205, 0.86, 0.83],
  [0.9, 486, 0.955, 0.941],
];

export const ROUTER_BINS: JevReliabilityBin[] = BIN_ROWS.map(([lo, labeled, conf, acc]) => ({
  lo,
  hi: Math.round((lo + 0.1) * 10) / 10,
  weight: labeled,
  labeled,
  meanConfidence: conf,
  accuracy: acc,
}));

export const ROUTER_CALIBRATION: JevCalibrationMetrics = {
  decisions: 21_870,
  labeled: 914,
  accuracy: 0.874,
  ece: 0.034,
  ace: 0.031,
  mce: 0.06,
  brier: null,
  rps: null,
  classwise: {
    billing: { support: 318, ece: 0.028, accuracy: 0.9, meanConfidence: 0.91 },
    account_access: { support: 204, ece: 0.061, accuracy: 0.82, meanConfidence: 0.88 },
    technical: { support: 251, ece: 0.024, accuracy: 0.91, meanConfidence: 0.92 },
    general: { support: 117, ece: 0.047, accuracy: 0.8, meanConfidence: 0.84 },
    none: { support: 24, ece: 0.09, accuracy: 0.71, meanConfidence: 0.8 },
  },
  bins: ROUTER_BINS,
  routeShare: { auto: 0.62, improve: 0.24, human: 0.14 },
  autoPrecision: { value: 0.968, lower95: 0.951, n: 486 },
  routeCorrectness: 0.94,
  nearThreshold: { band: 0.03, above: 0.162, below: 0.071 },
  psi: 0.08,
  rates: {
    escape: 0.021,
    override: 0.018,
    staleOption: 0,
    blindRetryBlocked: 0.002,
    interRaterDisagreement: 0.06,
  },
};

export const ROUTER_ALARMS: JevDriftAlarm[] = [
  {
    kind: "model_version_changed",
    severity: "info",
    value: 1,
    baseline: null,
    threshold: 1,
    message:
      "jev-latest resolved to jev-1.13.1 on 3% of requests since Sep 22; new segments started.",
    inspectFirst: ["calibration"],
  },
  {
    kind: "near_threshold_mass",
    severity: "warning",
    value: 0.162,
    baseline: 0.08,
    threshold: 0.15,
    message:
      "16.2% of decisions sit in [0.90, 0.93): improve the contract or widen the review zone before increasing autonomy.",
    inspectFirst: ["evidence", "contract_wording"],
  },
];

export const ROUTER_RECOMMENDATION: JevThresholdRecommendation = {
  consequenceClass: "low",
  current: { autoAt: 0.9, improveAt: 0.7, minMargin: 0.2 },
  recommended: { autoAt: 0.92, improveAt: 0.68, minMargin: 0.2 },
  target: { precision: 0.95, minLabeled: 100, maxEce: 0.05 },
  achieved: { precision: 0.974, lower95: 0.957, coverage: 0.58, n: 421 },
  nearThresholdMass: 0.094,
  basis: { labeled: 914, window: "rolling 7d · Sep 16 – Sep 23" },
  warnings: [
    "account_access has classwise ECE 0.061: its auto region is measured on 204 labels only.",
  ],
};
