/**
 * What the Guide says about each part of the app, and the words FlowAId uses. Plain language
 * first; the technical name follows where people will meet it on screen.
 */

export interface Term {
  term: string;
  meaning: string;
}

export const GLOSSARY: Readonly<Record<string, Term>> = {
  workflow: {
    term: "Workflow",
    meaning:
      "A set of steps that handles one kind of request from start to finish, like an expense claim or a refund.",
  },
  step: {
    term: "Step (node)",
    meaning:
      "One box on the canvas. Each step does one job: ask a question, apply a rule, ask a person, or finish.",
  },
  decision: {
    term: "Decision",
    meaning:
      "A question answered by TypeSafe, such as “is this within policy?”. The answer is one of fixed options, never free text.",
  },
  confidence: {
    term: "Confidence (how sure)",
    meaning:
      "How sure a decision is, from 0% to 100%. FlowAId uses it to decide whether to act on its own or ask a person.",
  },
  rule: {
    term: "Rule (branch)",
    meaning:
      "A plain check, like “the amount is at most the limit”, that sends the run down one path or another.",
  },
  setting: {
    term: "Setting",
    meaning:
      "A value the steps share, like an approval limit. Change it once in the workflow panel and every step uses the new value.",
  },
  human: {
    term: "Human task",
    meaning:
      "A request the workflow hands to a person, such as an approval. The run waits safely until someone answers.",
  },
  run: {
    term: "Run",
    meaning:
      "One request going through the workflow, with a record of every step, answer and cost.",
  },
  draft: {
    term: "Draft",
    meaning:
      "The version you are editing. It saves as you go; running it tries your changes without affecting anything live.",
  },
  publish: {
    term: "Publish",
    meaning:
      "Freezes the draft as a numbered version so other systems can call it. Your draft stays editable.",
  },
  environment: {
    term: "Environment",
    meaning:
      "Where a published version runs: dev for trying, staging for checking, prod for real work.",
  },
  key: {
    term: "Key (credential)",
    meaning:
      "The secret that lets FlowAId use a service, such as your TypeSafe or OpenAI key. It is stored encrypted.",
  },
  trace: {
    term: "Trace",
    meaning:
      "The detailed record of a run: every step, how long it took, what it cost, and each decision's full answer.",
  },
  template: {
    term: "Template",
    meaning: "A ready-made workflow to start from. Creating one gives you your own copy to change.",
  },
};

export interface PageAction {
  label: string;
  /** a path inside the workspace ("templates"), or an absolute URL */
  to: string;
}

export interface PageGuide {
  title: string;
  purpose: string;
  steps: string[];
  actions: PageAction[];
  terms: (keyof typeof GLOSSARY)[];
}

/** The guide for a section of the app, by the first path segment after the workspace. */
export const PAGE_GUIDES: Readonly<Record<string, PageGuide>> = {
  "": {
    title: "Overview",
    purpose:
      "Your starting point: what needs your attention, how your workflows are doing, and what to set up next.",
    steps: [
      "New here? Follow the Get started checklist; each step ticks itself off.",
      "Needs attention lists approvals waiting for you and workflows that failed.",
      "The numbers below show runs, success rate, speed and cost over the chosen period.",
    ],
    actions: [
      { label: "Start from a business flow", to: "templates" },
      { label: "See what waits for you", to: "human-tasks" },
    ],
    terms: ["workflow", "run", "human"],
  },
  templates: {
    title: "Templates",
    purpose: "Ready-made workflows to start from. Business flows run as soon as you create them.",
    steps: [
      "Read what a flow does and what it needs; “Ready to run” means everything is set up.",
      "Use template checks what it needs against your workspace, then names your copy. Missing keys are warnings, not blockers.",
      "In the builder, press Run draft to try it with an example.",
    ],
    actions: [{ label: "Or start from a blank workflow", to: "workflows/new" }],
    terms: ["template", "workflow", "key"],
  },
  workflows: {
    title: "Workflows",
    purpose: "Every workflow in this workspace. Open one to see its steps, try it, and change it.",
    steps: [
      "Open a workflow to see its steps on the canvas.",
      "New workflow walks you through naming it and choosing how to start: describe it, blank, a template, or an import.",
      "Each workflow's Versions, Deployments and Settings pages explain what publishing and deploying change.",
    ],
    actions: [
      { label: "New workflow", to: "workflows/new" },
      { label: "Browse templates", to: "templates" },
    ],
    terms: ["workflow", "draft", "publish"],
  },
  runs: {
    title: "Runs",
    purpose: "Every request your workflows handled, newest first, with how each one ended.",
    steps: [
      "Open a run to see, in plain words, what happened and why.",
      "Filter by status to find the ones that failed or are waiting for a person.",
    ],
    actions: [{ label: "See what waits for a person", to: "human-tasks" }],
    terms: ["run", "trace", "confidence"],
  },
  "human-tasks": {
    title: "Human tasks",
    purpose:
      "Requests your workflows handed to a person. Each run waits here, safely, until someone answers.",
    steps: [
      "Open a task to see why it came to you and what the workflow found so far.",
      "Approve or reject it, with an optional comment for the record. The run then carries on.",
    ],
    actions: [{ label: "Back to the Overview", to: "" }],
    terms: ["human", "confidence", "run"],
  },
  credentials: {
    title: "Credentials",
    purpose:
      "The keys FlowAId uses to reach other services, stored encrypted and never shown again.",
    steps: [
      "New credential walks through the service, the secret, where it may be used, and a review.",
      "Choose the environments and workflows it may be used in; narrower is safer.",
      "Workflows use it through a step's key slot and Settings → Secrets, per environment.",
    ],
    actions: [],
    terms: ["key", "environment"],
  },
  triggers: {
    title: "Triggers",
    purpose:
      "Ways to start workflows automatically: web addresses other systems call, schedules, and tools for MCP clients.",
    steps: [
      "Add a webhook or schedule step by step; it is written into the workflow's draft.",
      "It goes live in an environment only when a version with it is published and deployed there.",
      "Each tab's lists explain signing secrets, replay protection, missed runs and Run now.",
    ],
    actions: [],
    terms: ["publish", "environment"],
  },
  settings: {
    title: "Settings",
    purpose:
      "Workspace settings: API keys for your code, environments, notifications and the audit log.",
    steps: [
      "Each tab starts with what it is for and what is already set up.",
      "New API key walks through what it may do, where and for how long; the key is shown once.",
      "Notifications are only sent for real events, or when you press Send a test.",
    ],
    actions: [],
    terms: ["environment", "key"],
  },
  evaluations: {
    title: "Evaluations",
    purpose:
      "Test sets that check a workflow still answers correctly before you publish a new version.",
    steps: [
      "New set names what it checks and which workflow it belongs to.",
      "Add cases by hand or from real runs with Add to evaluation; cover typical, edge and must-escalate requests.",
      "Starting an evaluation runs the workflow once per case and costs what those runs cost; the report separates finished runs from passed cases.",
    ],
    actions: [],
    terms: ["publish", "confidence"],
  },
  knowledge: {
    title: "Knowledge",
    purpose: "Documents and pages your workflows can search and cite.",
    steps: [
      "New source walks through where documents come from and how they are searched.",
      "Add documents, check each shows Indexed, then try a search on the source's page.",
      "Use it from a Knowledge base or Hybrid search step in a workflow.",
    ],
    actions: [],
    terms: ["workflow"],
  },
  integrations: {
    title: "Integrations",
    purpose: "Connect tool servers, APIs and model providers your workflows and agents can use.",
    steps: [
      "Each tab says when to use it: MCP servers, OpenAPI tools, providers or plugins.",
      "Connecting a server or importing an API is step by step; nothing is contacted until you press Test connection or Discover tools.",
      "Connected tools appear in the Agents tool list and in MCP and OpenAPI steps.",
    ],
    actions: [],
    terms: ["key"],
  },
  agents: {
    title: "Agents",
    purpose: "Reusable AI helpers that can use tools within limits you set.",
    steps: [
      "New agent walks through its job, model, instructions, tools and limits, then a review.",
      "Add an Agent step to a workflow and choose the agent under Agent preset.",
      "Run the draft; the trace shows each model turn and tool call.",
    ],
    actions: [],
    terms: ["step"],
  },
};

export const BUILDER_GUIDE: PageGuide = {
  title: "The workflow builder",
  purpose:
    "Where you see and change a workflow. Each box is a step; lines show how a request moves from one step to the next.",
  steps: [
    "Click a step to see what it does and to change it.",
    "Click the empty canvas to rename the workflow and change its settings.",
    "Fill in the Run tab and press Run draft to try it; the steps light up as it runs.",
    "When you are happy, Publish makes it callable from other systems.",
  ],
  actions: [],
  terms: ["step", "decision", "rule", "setting", "draft", "publish"],
};

export const RUN_GUIDE: PageGuide = {
  title: "A run",
  purpose: "One request and everything that happened to it, step by step.",
  steps: [
    "Read What happened for the story in plain words.",
    "The Timeline shows each step's time and cost; click a decision to see every answer it considered.",
    "Replay, Fork or Retry try it again without losing this record.",
  ],
  actions: [],
  terms: ["run", "trace", "confidence", "decision"],
};

/** A workflow's own pages ("/ws/workflows/<id>/<page>"), which the Workflows guide does not cover. */
export const WORKFLOW_PAGE_GUIDES: Readonly<Record<string, PageGuide>> = {
  runs: {
    title: "This workflow's runs",
    purpose: "Every request this workflow handled, newest first, in every environment.",
    steps: [
      "Filter by environment or status to find a run.",
      "Open a run to read what happened, step by step, and what it cost.",
      "A failed run can be retried or forked onto a fixed draft from its page.",
    ],
    actions: [],
    terms: ["run", "trace", "environment"],
  },
  versions: {
    title: "Versions",
    purpose:
      "Each published, frozen copy of this workflow. Deployments run a version, never the draft.",
    steps: [
      "Publish from the builder to add a version.",
      "Compare two versions to see what changed between them.",
      "Restoring a version copies it into the draft; nothing is deployed until you deploy.",
    ],
    actions: [],
    terms: ["publish", "draft", "environment"],
  },
  deployments: {
    title: "Deployments",
    purpose: "Which version each environment runs. API calls, webhooks and schedules use it.",
    steps: [
      "Deploy a published version to an environment; its secrets must be bound there first.",
      "A protected environment (usually prod) accepts deploys only from an admin; on your own computer that is you.",
      "Roll back by deploying an earlier version.",
    ],
    actions: [],
    terms: ["environment", "publish", "key"],
  },
  settings: {
    title: "Workflow settings",
    purpose: "Its name and description, secrets per environment, triggers and evaluation gate.",
    steps: [
      "Secrets: bind a saved credential to each secret the workflow declares, per environment.",
      "Triggers: webhooks and schedules are part of the draft and go live when deployed.",
      "Changes in one tab are kept while you look at another; leaving the page asks first.",
    ],
    actions: [],
    terms: ["key", "environment", "draft"],
  },
};

/** The section a path is in: "/ws/templates/…" → "templates", "/ws" → "". */
export function sectionOf(pathname: string): string {
  return pathname.split("/")[2] ?? "";
}
