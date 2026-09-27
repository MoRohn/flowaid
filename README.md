<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/readme/lockup-dark.svg">
    <img alt="FlowAId" src="brand/readme/lockup-light.svg" width="360">
  </picture>
</p>

<p align="center">
  <strong>The open-source runtime for AI agents and workflows, with typed decisions you can inspect, verify and trust.</strong>
</p>

<p align="center">
  <a href="https://github.com/MoRohn/flowaid/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MoRohn/flowaid/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/MoRohn/flowaid/actions/workflows/e2e.yml"><img alt="E2E" src="https://github.com/MoRohn/flowaid/actions/workflows/e2e.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-2f5be8"></a>
  <img alt="Status: beta" src="https://img.shields.io/badge/status-beta-2f5be8">
  <img alt="TypeScript 5.9 strict" src="https://img.shields.io/badge/TypeScript-5.9%20strict-17171c">
  <img alt="Node.js 24+" src="https://img.shields.io/badge/node-%E2%89%A524-17171c">
  <img alt="Tests: 5,008 passing" src="https://img.shields.io/badge/tests-5%2C008%20passing-1f9d64">
</p>

---

FlowAId is a self-hosted platform for building, running and evaluating AI agents and
workflows. It treats the **runtime** as the product. Every workflow is a typed document that is
compiled, versioned and executed over an append-only event log. The visual builder, the REST
API, the TypeScript SDK, the CLI and the MCP server are all clients of that same runtime.

Its central idea is that **decisions are typed data, not prose**. Routing, classification, risk
scoring and approval gates run on [TypeSafe AI's Jev](https://docs.typesafe.ai), a decision model
that returns a constrained answer with a calibrated probability distribution. Confidence then
decides what happens next: act automatically, gather more evidence, or ask a person.

> [!NOTE]
> **FlowAId is in beta.** The builder, API, worker, SDK, CLI and MCP server run today, from one
> command on a laptop or from Docker Compose on a server, and every push is gated by the full
> test suite and a browser acceptance journey against the production builds. Interfaces may
> still change before 1.0; see [Roadmap](#roadmap) for what is next.

## Why FlowAId

Most agent frameworks let a generative model make every decision inside a prompt. That is
expensive, hard to audit, and impossible to calibrate. FlowAId separates the jobs:

| Owner              | Does                                                            | In FlowAId                                                            |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Generative LLM** | Writes: replies, summaries, code, plans                         | Generation nodes (OpenAI, Anthropic, Ollama, any compatible endpoint) |
| **Jev**            | Judges: which option, how severe, yes or no, with probabilities | Decision nodes bound to versioned **decision contracts**              |
| **Code**           | Enforces: permissions, budgets, exact rules, side effects       | Branches, the expression language, policies, human approvals          |

What that makes possible:

- **Confidence drives automation.** Thresholds belong to the consequence of an action, not to
  the model. Irreversible actions always reach a person.
- **Every run can be inspected and replayed.** One event log is the source of truth. Receipts
  record the state, the contract version, the full distribution and the route of every decision.
- **Workflows are checked before they run.** A compiler type-checks every connection, finds
  unreachable nodes and ambiguous branches, and emits an immutable, hashed execution plan. The
  builder runs the same compiler in your browser as you edit.
- **Quality is measured, not assumed.** Evaluation sets score decisions, branches and outputs,
  report calibration, and can gate publishing a new version.
- **Nothing is locked in.** Self-hosted on PostgreSQL, every AI provider optional, a flow can be
  downloaded as a runnable code package, workflows are served as MCP tools, and LangChain is
  supported behind a strict boundary.

## Product tour

Screenshots of the running application, following your GitHub theme (light or dark). The
workflow is a two-minute refund triage: a TypeSafe decision asks whether a support ticket is a
refund request, and refunds go to a person.

**The builder.** Nodes, typed ports and control edges on the canvas; the inspector edits a
node's configuration from its schema; the draft compiles as you type and runs from the Run tab,
with each node's status, the decision's probability and a live trace.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/builder-dark.webp">
  <img alt="The FlowAId builder with a refund triage workflow: the Refund request decision shows yes at 0.99, the run waits at the Approve refund node, the inspector shows the decision's criteria and instructions, and the trace lists every node" src="docs/assets/screenshots/builder-light.webp">
</picture>

**Every run, inspectable.** The trace viewer has a timeline, the graph, the event log, output,
logs and cost. A decision expands into the full distribution TypeSafe returned, with the model,
latency, confidence, tokens and cost.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/run-trace-dark.webp">
  <img alt="A completed refund triage run: the Refund request decision is expanded to show NO/YES with 0.99 yes from jev-1.13.0, the approval took 16 seconds, and the node detail panel shows the decision and its input" src="docs/assets/screenshots/run-trace-light.webp">
</picture>

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>Human review.</strong> Runs pause durably for approvals, reviews, forms and
      choices. Reviewers see why they were asked and the run so far, and can hand a single-use
      link to someone outside the workspace.<br><br>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/review-dark.webp">
        <img alt="A human task for a refund request with Approve, Reject and Escalate, the run so far with the decision at yes 0.99, and the option to create an external review link" src="docs/assets/screenshots/review-light.webp">
      </picture>
    </td>
    <td width="50%" valign="top">
      <strong>Evaluations.</strong> Sets of tickets with known answers, run against any version:
      pass rate, branch correctness, accuracy and calibration per decision, latency, cost and
      regressions against a baseline.<br><br>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/evaluation-dark.webp">
        <img alt="An evaluation report: 100% pass rate over 8 cases, p95 latency 552 ms, cost per case, 50% human review rate, calibration ECE 0.014 and the list of cases" src="docs/assets/screenshots/evaluation-light.webp">
      </picture>
    </td>
  </tr>
</table>

**Templates.** Tested starting points that compile and run as shipped: GitHub issue triage over
MCP, support triage with safety checks and a confidence gate, a bounded research agent, and a
LangChain retrieval-augmented knowledge assistant.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/templates-dark.webp">
  <img alt="The template gallery with GitHub Issue Triage, Intelligent Support Triage, Knowledge Assistant (LangChain RAG) and Research Agent, each with a graph preview and node counts" src="docs/assets/screenshots/templates-light.webp">
</picture>

## Quick start

### 1. Prerequisites

| Tool    | Version                   | Install                                                                                    |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| Node.js | 24 or newer (`.nvmrc`)    | [nodejs.org](https://nodejs.org) or `nvm install` in the repository                        |
| pnpm    | 12.5.1 (`packageManager`) | `corepack enable && corepack prepare pnpm@12.5.1 --activate`                               |
| Docker  | any recent version        | Runs the database. Or bring your own PostgreSQL 16 with pgvector and pass `--database-url` |
| Git     | any recent version        | [git-scm.com](https://git-scm.com)                                                         |

A [TypeSafe API key](https://api.typesafe.ai) enables decision nodes; OpenAI, Anthropic or a
local Ollama enable generation. Everything else runs without any key.

### 2. Start FlowAId

```sh
git clone https://github.com/MoRohn/flowaid.git
cd flowaid
echo "TYPESAFE_API_KEY=ts_…" >> .env.local   # optional: enables decision nodes
pnpm start
```

`pnpm start` takes a fresh clone to a running platform in one command:

1. **Checks your machine**: Node.js, pnpm, dependencies, free ports, and Docker (unless you pass
   a database). Anything wrong is reported with the command that fixes it.
2. **Installs dependencies** from the lockfile when they are missing or stale.
3. **Generates local secrets** once into `.flowaid/dev.env` (the credential master key and the
   owner's password) and reads provider keys from `.env` and `.env.local`.
4. **Starts PostgreSQL 16 with pgvector** in a Docker container bound to loopback, with its data
   in a named volume, or uses `--database-url`.
5. **Builds** what the apps need (cached by Turborepo), then **starts the API, the worker and the
   web app**, waits until they are ready, and prints where to sign in. Ctrl+C stops everything.

```text
FlowAId · local stack

[1/6] Preflight
  ✓ Node.js          v24.21.0 (requires >=24.0.0)
  ✓ pnpm             12.5.1
  ✓ Dependencies     installed and in sync with pnpm-lock.yaml
  ✓ Web port         127.0.0.1:3001 is free
  ✓ API port         127.0.0.1:3000 is free
  · Docker           Compose 5.3.0; daemon running

[2/6] Dependencies
✓ already installed

[3/6] Configuration
✓ generated local secrets in .flowaid/dev.env
✓ provider keys: TYPESAFE_API_KEY

[4/6] Database
✓ started Postgres (flowaid-dev-db, 127.0.0.1:54329)

[5/6] Build
✓ Workspace packages built (0.1 s)

[6/6] Start
✓ API ready on http://127.0.0.1:3000

→ http://127.0.0.1:3001   (Ctrl+C to stop)
  sign in as owner@flowaid.local / ••••••••••••••••   (also in .flowaid/dev.env)
  API http://127.0.0.1:3000 · docs http://127.0.0.1:3000/docs
```

Open <http://127.0.0.1:3001> and sign in. The API reference (OpenAPI 3.1) is at
<http://127.0.0.1:3000/docs>.

### 3. Build and run your first workflow

1. **Add your TypeSafe key as a credential.** _Credentials → New credential → TypeSafe API key._
   Credentials are encrypted with a per-credential key under the master key and never leave the
   worker.
2. **Start a workflow.** _Workflows → New workflow → Blank_ (an input wired to an output), or
   _Templates → Use template_.
3. **Add a decision.** Press **+** (or ⌘K) and add **Boolean** from _Decision_. Connect the input's
   `message` port to its `state` input, write the question in _Instructions_, and wire its
   control output onward. The compiler checks every connection as you edit, and the Problems tab
   lists anything left to fix.
4. **Bind the secret.** _Settings → Secrets_ on the workflow maps the node's `TYPESAFE_API_KEY`
   slot to your credential for each environment.
5. **Run the draft.** In the Run tab, fill in the input and press **Run draft**. Nodes light up as
   they run; select one to see its decision, input, output and timing.
6. **Publish.** **Publish** shows what changed since the last version and any warnings, and can
   deploy to `dev`, `staging` or `prod`, optionally gated on an evaluation.

### 4. Call it from anywhere

Create an API key under _Settings → API keys_ (pin it to an environment), then:

```sh
curl -X POST http://localhost:3000/v1/workflows/<workflow-id>/run \
  -H "Authorization: Bearer fa_live_…" -H "Content-Type: application/json" \
  -d '{"input": {"message": "I was charged twice for order 1182"}, "mode": "sync"}'
```

A run that finishes answers `200` with its output, cost and usage; one that waits for a person
answers `202` with the human task. From TypeScript, with `@flowaid/workflow-sdk`:

```ts
import { Flowaid } from "@flowaid/workflow-sdk";

const fa = new Flowaid({ baseUrl: "http://localhost:3000", apiKey: process.env.FLOWAID_API_KEY });
const run = await fa.workflows.run(workflowId, { message: "Refund please" });
for await (const event of run.stream()) {
  if (event.type === "DECISION_COMPLETED") console.log(event.decision.confidence);
}
console.log(await run.output());
```

From a terminal, with the `flowaid` CLI (`packages/cli`; every API operation is a command, and
`pnpm flowaid` runs it from a checkout):

```sh
pnpm flowaid login --api-url http://localhost:3000 --api-key fa_live_…
pnpm flowaid workflow run <workflow-id> --input '{"message":"Refund please"}' --watch
pnpm flowaid workflow package <workflow-id> --version 1 --out refund-triage.zip   # runnable code
pnpm flowaid validate ./my-flow.json                                               # no server
```

**As MCP tools.** Under _Integrations → Workflows as MCP tools_, expose a workflow and mint an
MCP token; any MCP client can then list and call it at `http://localhost:3000/mcp/<workspace>`
(streamable HTTP, `Authorization: Bearer <token>`).

**From webhooks, schedules and events.** Triggers in a workflow's definition become live URLs,
cron schedules and event subscriptions when a version is deployed to an environment.

### 5. Options

| Command                                  | What it does                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm start --open`                      | Also opens the browser                                                               |
| `pnpm start --port 3101 --api-port 3100` | Serves the web app and the API on other ports                                        |
| `pnpm start --database-url postgres://…` | Uses your PostgreSQL 16 (with pgvector) instead of the Docker container              |
| `pnpm start --prod`                      | Runs the production builds (Next's standalone server, compiled API and worker)       |
| `pnpm start --host 0.0.0.0`              | Listens on every interface (put a TLS proxy in front before exposing it)             |
| `pnpm start --verify`                    | Runs every CI gate first (`pnpm check`), then starts                                 |
| `pnpm start --playground`                | Serves the `@flowaid/ui` component playground instead                                |
| `pnpm start -- --help`                   | Lists every option                                                                   |
| `pnpm preflight`                         | Only the machine checks                                                              |
| `pnpm check`                             | Every CI gate: audit, boundaries, generated files, format, lint, types, build, tests |
| `pnpm test:acceptance`                   | The browser acceptance journey against a running stack                               |

### 6. Troubleshooting

- **`Node.js … is older than the required >=24.0.0`**: run `nvm install` (it reads `.nvmrc`),
  then open a new terminal.
- **`Web port …` or `API port … is already in use`**: stop the other process, or pass `--port`
  and `--api-port`.
- **`no DATABASE_URL and the Docker daemon is not running`**: start Docker Desktop, or pass
  `--database-url`.
- **`secret TYPESAFE_API_KEY is not bound in this environment`** when running: bind the
  workflow's secret to a credential in the workflow's _Settings_ (step 3.4 above).
- **A reset**: stop FlowAId, then `docker rm -f flowaid-dev-db && docker volume rm flowaid-dev-db`
  and delete `.flowaid/` (this deletes every workflow, run and credential).

## Deploy with Docker Compose

The same images the release gate tests run the production stack: PostgreSQL 16 with pgvector,
the API, the worker and the web app. Queues and the event bus run over PostgreSQL; Redis and
worker replicas are an optional profile.

```sh
cp .env.example .env
for v in POSTGRES_PASSWORD POSTGRES_CODE_PASSWORD; do
  sed -i.bak "s/^$v=$/$v=$(openssl rand -hex 16)/" .env
done
# set FLOWAID_ADMIN_EMAIL / FLOWAID_ADMIN_PASSWORD and your provider keys in .env
docker compose up -d
```

Without `FLOWAID_ADMIN_PASSWORD`, the first boot generates the owner's password and prints it
once (`docker compose logs api`); the first sign-in asks for a new one.

The web app listens on port 3001 and the API on 3000, both on loopback by default. Before you
put it on a network:

- **Terminate TLS in front of both** (a reverse proxy or load balancer), set `FLOWAID_BASE_URL`
  and `FLOWAID_WEB_URL` to the public URLs and `CORS_ORIGINS` to the web URL, and publish on
  every interface only behind that proxy (`BIND_ADDRESS=0.0.0.0`). Session cookies are `Secure`
  and `SameSite`.
- **Back up the `flowaid-data` and `postgres-data` volumes.** The master key in `flowaid-data`
  (or `FLOWAID_MASTER_KEY`) decrypts every stored credential; without it they are lost.
- **Tell the API which proxies to trust** (`FLOWAID_TRUST_PROXY`) so rate limits and the audit
  log see real client addresses.
- **Scale out** with `docker compose --profile scale up -d` (Redis and `WORKER_REPLICAS`
  workers) when one worker is not enough.

Every variable is documented in [`packages/env/README.md`](packages/env/README.md); the
services, networks and secret scoping are described in [`docker/README.md`](docker/README.md).

## What is inside

| Area                                                                 | What it does                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                                                           | Next.js 16 app: builder with an in-browser compiler (Web Worker), undo/redo, autosave with conflict detection and a live run overlay; runs and trace viewer; human tasks and the external review page; credentials, integrations, evaluations, templates, versions, deployments and settings. 71 tests       |
| `apps/api`                                                           | Fastify 5 REST API with OpenAPI 3.1: auth (sessions, API keys, CSRF, rate limits, audit), workflows, versions and deployments, runs with SSE, human tasks and review links, credentials, tools and MCP servers, triggers and ingress, evaluations, code export and the `/mcp` server. 67 tests on PostgreSQL |
| `apps/worker`                                                        | Runs workflows: the orchestrator over the event store, core and bundled plugin nodes, providers, tools, sandboxed code, human waits, subflows, the scheduler, evaluations and the export job. 17 tests on PostgreSQL                                                                                         |
| `@flowaid/workflow-sdk`, `@flowaid/cli`                              | Typed client generated from the OpenAPI document with resumable SSE streams, total workflow builders; the `flowaid` command line with a command for every operation, local runs and validation. 37 tests                                                                                                     |
| `@flowaid/workflow-core`                                             | Workflow contracts, the FlowExpr expression language, templates and a JSON Schema compatibility checker. 2,665 tests                                                                                                                                                                                         |
| `@flowaid/workflow-compiler`                                         | Definition → content-hashed execution plan: 8 passes, 94 diagnostics, guard analysis, batching, redaction, diff and migrate. 167 tests                                                                                                                                                                       |
| `@flowaid/workflow-runtime`                                          | Event-sourced scheduler for all ten node kinds, orchestrator with fenced appends, leases and crash recovery, recorded replay, `runLocally()`, Postgres, BullMQ and Redis drivers. 78 tests                                                                                                                   |
| `@flowaid/database`                                                  | PostgreSQL 16 schema (45 tables), migrations with forced row-level security, event-sourced run store, Postgres queue and event bus, retention. 56 tests on PostgreSQL                                                                                                                                        |
| `@flowaid/nodes-core`                                                | 36 core nodes: typed decisions with human failover, generation and embeddings, HTTP, MCP and OpenAPI tools, sandboxed code and shell, data shaping, state, safety and developer nodes; the templates. 90 tests                                                                                               |
| `@flowaid/provider-*`, `@flowaid/providers`                          | TypeSafe Jev (exact distributions, batching, contract tests on recorded fixtures), OpenAI and compatible endpoints, Anthropic, Ollama; registry, pricing, failover and circuit breaking. 140 tests                                                                                                           |
| `@flowaid/mcp`, `@flowaid/openapi-tools`                             | MCP client pool with policy-gated stdio and workflows exposed as tools; OpenAPI import with SSRF-safe references and one tool per operation. 75 tests                                                                                                                                                        |
| `@flowaid/langchain`, `@flowaid/nodes-langchain`                     | LangChain adapters both ways, a callback handler with budgets, and a bundled node package (chat, agent, loaders, splitters, embeddings, vector stores, retrievers). 53 tests                                                                                                                                 |
| `@flowaid/codegen`                                                   | Download code: a flow as a runnable TypeScript package with its own tests and a recorded replay, in npm or vendored mode. 29 tests                                                                                                                                                                           |
| `@flowaid/evaluation`, `@flowaid/jev`                                | Evaluation sets, scoring, calibration and regression gates; the Jev decision-contract library (packets, routing, receipts, shadow comparison). 209 tests                                                                                                                                                     |
| `@flowaid/credentials`, `@flowaid/sandbox`, `@flowaid/observability` | Envelope encryption with rotatable master keys; isolated-vm and container executors; redacting logs, tracing, metrics and run timelines. 133 tests                                                                                                                                                           |
| `@flowaid/ui`                                                        | The React component library behind the web app: canvas, nodes, trace viewer, inspector, forms, decision visuals and dashboards, with a playground. 872 tests                                                                                                                                                 |
| Release gate                                                         | CI runs the audit, boundaries, generated-file, format, lint, typecheck, build and test gates and the PostgreSQL suites; E2E drives the acceptance journey in a browser against the production builds                                                                                                         |

The live snapshot is [`docs/STATUS.md`](docs/STATUS.md).

## How it works

```
 Builder · REST API · SDK · CLI · MCP · webhooks · schedules
                     │
                     ▼
            WorkflowDefinition ─────── typed JSON document; data flows through bindings,
                     │                  control flows through explicit edges
                     ▼
                 Compiler ───────────── schema, binding, type and guard checks → diagnostics
                     │                  (the same compiler in the browser, API, worker, CLI)
                     ▼
              ExecutionPlan ─────────── immutable, content-hashed, versioned, deployed per
                     │                  environment
                     ▼
     Runtime (pure reducer over an append-only event log, in the worker)
       ├─ Jev decisions     typed answer + distribution → auto / improve / human
       ├─ LLM generation    streamed, budgeted, cost-accounted
       ├─ Tools             HTTP, MCP, OpenAPI, sandboxed code
       └─ Humans            approval, review, form, choice; durable suspension
                     │
                     ▼
   Events · traces · human tasks · evaluations · code export
```

## Core concepts

- **Typed decisions.** Jev answers three kinds of question: _Noul_ (yes or no, with P(yes)),
  _Choice_ (one of up to 255 options, with a distribution) and _Score_ (a position on an ordered
  2–10 level rubric). Independent questions about one state go out in one request. The live
  API shape is recorded in [TYPESAFE_API.md](docs/design/TYPESAFE_API.md).
- **Decision contracts.** A decision is a versioned contract (`support.ticket_router@1`) that
  declares its state, outcomes, escape hatches, consequence class, thresholds, allowed actions
  and escalation. See the [Jev engineering guides](docs/jev/overview.md).
- **Bindings and control edges.** Data reaches a node only through typed bindings (references,
  templates, expressions). Control flows only along explicit edges. That is what makes a graph
  statically checkable.
- **Event-sourced runs.** The event log is the only source of truth. Replay, recovery, audit
  and the trace viewer all come from it.
- **Versions and environments.** Drafts autosave; publishing creates an immutable version;
  deployments pin a version per environment, with its own secret bindings and triggers.
- **Human in the loop.** Approval, review, form and choice nodes suspend a run durably, with
  typed requests and responses, an inbox, and single-use external review links.
- **Evaluation.** Datasets of expected decisions, branches and outputs; reports with
  calibration and regressions that can gate publishing.

## Use the libraries directly

The packages work on their own. Validate a workflow and evaluate an expression:

```ts
import { readFileSync } from "node:fs";
import {
  WorkflowDefinitionSchema,
  definitionHash,
  parseExpression,
  evaluateExpression,
  createEvalScope,
  isSubschema,
} from "@flowaid/workflow-core";

const def = WorkflowDefinitionSchema.parse(
  JSON.parse(readFileSync("packages/workflow-core/fixtures/support-triage.json", "utf8")),
);
definitionHash(def); // stable across key order and layout changes

const expr = parseExpression(
  "intent.decision.confidence >= 0.9 && intent.decision.value == 'security'",
);
if (expr.ok) {
  const scope = createEvalScope({
    ports: { intent: { decision: { value: "security", confidence: 0.93 } } },
  });
  evaluateExpression(expr.ast, scope); // true
}

isSubschema({ type: "integer", minimum: 0 }, { type: "number" }); // { ok: true, verified: true }
```

Route a Jev decision through a decision contract:

```ts
import { readFileSync } from "node:fs";
import type { ChoiceDecision } from "@flowaid/workflow-core";
import { parseContract, toDecisionQuestion, toSystemOneQuestion, route } from "@flowaid/jev";

const file = JSON.parse(
  readFileSync("packages/jev/templates/jev-classifier-rollout.contracts.json", "utf8"),
);
const contract = parseContract(file.decisionContracts[0].body); // support.ticket_router@1
const question = toSystemOneQuestion(toDecisionQuestion(contract)); // ready for POST /v1/systemone

const decision: ChoiceDecision = {
  kind: "choice",
  value: "billing",
  confidence: 0.93,
  probabilities: {
    billing: 0.93,
    account_access: 0.03,
    technical: 0.02,
    general: 0.01,
    none: 0.01,
  },
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 84,
  costUsd: 0.00002,
  attempts: [],
};

route({ contract, decision, calibrated: true });
// → { route: "auto", port: "billing", reasons: ["zone_auto"], consequenceClass: "low", … }
```

## Repository layout

```
apps/
  api/                  Fastify REST API, SSE, webhooks, the MCP server endpoint
  worker/               Orchestrator, node executors, scheduler, evaluation and export jobs
  web/                  Next.js web app: builder, runs, human tasks, evaluations, settings
brand/                  Identity: logo, design tokens, fonts (OFL), style guide
docker/                 Compose stack and the one Dockerfile (api, worker, web targets)
docs/                   Design, guides, research, plan and status (index: docs/README.md)
e2e/                    The browser acceptance journey (the release gate)
packages/
  config/               Shared TypeScript, ESLint and Prettier presets
  shared/  env/         JSON helpers, Result, uuidv7 · environment schema and loader
  workflow-core/        Portable contracts, FlowExpr, templates, schema checker
  workflow-compiler/    Definition → content-hashed execution plan, with diagnostics
  workflow-runtime/     Scheduler, orchestrator, executor, runLocally, queue drivers
  workflow-sdk/  cli/   TypeScript client and builders · the flowaid command line
  node-sdk/             Write nodes: schemas, manifests, scoped context, test harness
  nodes-core/           Built-in nodes and templates
  providers/            Provider registry, pricing catalog, failover, health, LLM client
  provider-typesafe/    TypeSafe Jev decisions (System One)
  provider-openai/  provider-anthropic/  provider-ollama/
  mcp/  openapi-tools/  MCP client and exposure · OpenAPI tools
  sandbox/              isolated-vm and container executors for code and shell nodes
  credentials/          Envelope encryption, master keys, external secrets, redaction
  database/             PostgreSQL schema, migrations, RLS, run store, queue, repositories
  evaluation/  jev/     Evaluation runner and reports · Jev decision-contract library
  codegen/              Download code: flows as runnable TypeScript packages
  langchain/  nodes-langchain/   LangChain adapters · bundled LangChain nodes
  observability/        Redacting logger, tracing, metrics, run timelines
  ui/                   React component library and playground
scripts/                pnpm start, preflight, generators and repository checks
boundaries.json         The allowed dependency graph between packages
```

## Documentation

|                                                                                     |                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Documentation index](docs/README.md)                                               | Every design document, guide and research source                         |
| [Product specification](docs/design/SPEC.md)                                        | What FlowAId is meant to be                                              |
| [Architecture](docs/design/ARCHITECTURE.md) · [API](docs/design/API.md)             | How it is built, and the REST, SSE, SDK and CLI surface                  |
| [Jev engineering](docs/jev/overview.md)                                             | Decision contracts, packets, routing, calibration, shadow mode, receipts |
| [Download code](docs/design/CODE_EXPORT.md) · [LangChain](docs/design/LANGCHAIN.md) | Code export and the LangChain boundary                                   |
| [Environment](packages/env/README.md) · [Docker](docker/README.md)                  | Every setting, and the production stack                                  |
| [Upgrade plan](docs/UPGRADE_PLAN.md) · [Status](docs/STATUS.md)                     | What is next, and where things stand                                     |

## Roadmap

Phases 0–5 of the [upgrade plan](docs/UPGRADE_PLAN.md) are complete: the compiler, runtime,
database, providers, API, worker, SDK and CLI, code export, the LangChain packages, the web app
and the acceptance gate. Next:

1. **Routing and advice:** generation failover and model routing, a cost optimiser, and an AI
   workflow builder and critic.
2. **Operations:** observability dashboards, notifications, retention controls in the UI, and a
   separate sandbox host for the `code` pool.
3. **Identity and extension:** OIDC single sign-on, invitations and password resets, installable
   plugins, knowledge sources, and agents.
4. **The FlowAId importer** for external flow exports, and more templates.
5. **Alongside:** track J (Jev decision contracts across the platform) and track L (a Lean 4
   checker that certifies run and evaluation results, see
   [LEAN_VERIFICATION.md](docs/design/LEAN_VERIFICATION.md)).

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in
[SECURITY.md](SECURITY.md).

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The bundled fonts are under
the SIL Open Font License.
