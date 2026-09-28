# FlowAId V2 code review — 2026-09-28

The engineering assessment that opens the V2.0 programme. It covers the whole repository at
`55297df` (the `main` head the `v2.0` branch started from): 5 apps and 33 packages, about
200,000 lines of TypeScript excluding tests. It was produced from five parallel review lenses
(API and security; data, runtime and worker; web and UI; AI and ML; DevOps, testing and
documentation). Every finding below was read in the code; where a claim could not be verified,
it says so.

It builds on the September system review in [`archive/review-2026-09/`](archive/review-2026-09/),
whose 165 findings produced [UPGRADE_PLAN.md](UPGRADE_PLAN.md) (phases P0–P6, now complete).
This review looks at what that work left behind and at what V2 needs.

## Baseline

Measured on 2026-09-28 before any V2 change:

| check                                                                   | result                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm check` (audit, boundaries, generators, lint, types, build, tests) | pass, 144/144 turbo tasks, 0 lint errors, 19 warnings          |
| PostgreSQL suites (`FLOWAID_TEST_DATABASE_URL` set)                     | database 56, workflow-runtime 89, api 117, worker 47: all pass |
| `TODO` / `FIXME` / `HACK` markers                                       | 0                                                              |
| `as any` / `@ts-ignore`                                                 | 0 / 0 (2 justified `@ts-expect-error`)                         |
| `as unknown as` casts                                                   | 123 (clusters in the worker's plugin host and evaluation job)  |
| `eslint-disable` comments                                               | 18, each with a stated reason                                  |

Not measured: runtime latency under load, bundle size budgets (only one observation: the builder
page loads a 2.98 MB chunk, about 718 KB gzipped), test coverage percentages (no coverage tool is
configured).

## What FlowAId is

An open-source, backend-first AI agent and workflow platform that runs on one person's computer
by default (`FLOWAID_AUTH_MODE=auto`: loopback without sign-in) and scales to a Compose
deployment. Workflows are typed graphs compiled by an 8-pass compiler, executed by an
event-sourced durable runtime on PostgreSQL, and edited on an XYFlow canvas. Its distinctive
capabilities are TypeSafe Jev decisions (calibrated yes/no, choice and score) as first-class
nodes, human approval with durable suspension, replay/restart/fork of runs, evaluations with a
publish gate, and "Download code" (a flow leaves as a runnable package).

The user is a developer or AI engineer building and operating automations; one person on their
own machine is the default, a small team on a server the exception.

## Architecture

**Current shape.** A pnpm/turbo monorepo with strict layering enforced by `boundaries.json` and
a boundaries test: `shared` → `workflow-core` (contracts) → `workflow-compiler` /
`workflow-runtime` → providers, nodes, tools → `apps/api` (Fastify), `apps/worker`, `apps/web`
(Next 16). LangChain is quarantined in `packages/langchain` and `packages/nodes-langchain`.

**Strengths.**

- Contracts first: frozen Zod contracts in `workflow-core` with RFC-governed changes.
- The runtime is the product: fenced single-writer event append (`last_seq` + `lease_owner` in
  one transaction), projections in the same transaction, provable reprojection, DB-authoritative
  timers.
- Every API route declares its auth mode, scope, audit action, rate limit and CLI verb; a guard
  refuses to boot on a missing declaration (`apps/api/src/plugins/guard.ts`).
- Generated artifacts (OpenAPI, SDK types, CLI operations, env docs, UI inventory) are checked
  for drift in CI.

**Weaknesses.**

| #   | severity              | finding                                                                                                                                                                                                                                                                                      | evidence                                                                                       |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A1  | Critical (Redis mode) | Durable commit notices go out on Postgres `pg_notify('run_events')`, but with `REDIS_URL` set the API and worker subscribe to `run_events` on the Redis bus, which nothing publishes. SSE stalls after the first page; worker terminal bookkeeping never fires, so parents of subflows hang. | `PgRunStore.ts` (notify), `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `orchestrator.ts` |
| A2  | High                  | Composition hubs churn: `apps/api/src/server.ts` (15 changes in a week), `context.ts` (11), `apps/worker/src/worker.ts` (12). Route registration and dependency wiring are hand-maintained lists.                                                                                            | `git log --name-only`                                                                          |
| A3  | Medium                | A few handlers carry business rules inline (publish with the evaluation gate ~120 lines, SSE ~127 lines).                                                                                                                                                                                    | `apps/api/src/routes/workflows.ts:628`, `runs.ts:856`                                          |
| A4  | Medium                | In-memory state does not survive restarts or span replicas: rate limiter, login throttles, webhook replay cache. Fine for the local-first default; wrong for the scale profile.                                                                                                              | `apps/api/src/plugins/rateLimit.ts`, `routes/auth.ts`, `routes/ingress.ts:60,90`               |

## Code quality

High overall: exact dependency pins with no divergent versions across 38 workspaces, consistent
error envelope, typed DTOs, no suppressed type errors. Weak spots:

- 123 `as unknown as` casts, concentrated at process boundaries (plugin host IPC, evaluation job).
- Unused dependencies: `@flowaid/shared` declared in 14 packages that never import it; `zustand`
  (ui), `openapi-types` (api), `@flowaid/providers` (nodes-langchain).
- Doc drift in hand-maintained status files (STATUS.md says migrations 0000–0008; 0009 exists).

## Frontend

| #   | severity | finding                                                                                                                                                                             | evidence                                                             |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| F1  | High     | The Overview reports totals but nothing actionable: tiles do not link, no pending approvals, no failing workflows, no "what changed".                                               | `apps/web/src/dashboard/Dashboard.tsx:146-198,289-305`               |
| F2  | High     | Run detail (node inputs/outputs, restart) is `max-lg:hidden` with no fallback: below 1024px selecting a node shows nothing.                                                         | `apps/web/src/runs/TraceViewer.tsx:200`                              |
| F3  | High     | The AI builder hides its provenance: model, tokens, cost, iterations and diagnostics are returned but only the rationale is shown; "streaming" labels a blocking POST and the save. | `apps/web/src/builder/aiPlan.ts:9-17`, `workflows/new/page.tsx:145`  |
| F4  | Medium   | Critic findings drop their source (rule vs AI judge) and fix title; fixes apply without a preview (they are undoable and staleness-checked).                                        | `apps/web/src/builder/advisor.tsx:72-82`                             |
| F5  | Medium   | No pending-approval count in the navigation although `SideNav` supports counts.                                                                                                     | `apps/web/src/shell/AppFrame.tsx:52-58`                              |
| F6  | Medium   | Every tab is titled "FlowAId" (WCAG 2.4.2); breadcrumbs and list rows are buttons, not links.                                                                                       | `app/layout.tsx:6`, `AppFrame.tsx:73-77`                             |
| F7  | Medium   | Startup request chain: `/v1/me` then `/v1/environments` in series, `/v1/me` fetched twice under two cache keys; no `error.tsx`.                                                     | `apps/web/src/session.tsx:42-58`                                     |
| F8  | Medium   | Builder bundle 2.98 MB (718 KB gzip) with no lazy loading of CodeMirror, the compiler or the AI panels.                                                                             | `.next` build output                                                 |
| F9  | Low      | No skip link; invisible focus on the import file picker; three similar blues for decision/agent/tool categories.                                                                    | `AppShell.tsx:333`, `workflows/new/page.tsx:246`, `tokens.css:95-98` |

Strengths: `QueryView`/`ErrorPanel` give consistent loading and error states; every animated
component honours reduced motion; dialogs are Radix; a brand lint test forbids off-palette hues;
the shell becomes a drawer and sheet under 900px; advisor fixes are staleness-checked and
undoable; the UI gallery is gated by axe in CI.

## Backend and API

| #   | severity | finding                                                                                                                                                  | evidence                                                                                         |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| B1  | Medium   | Environment-pinned API keys can deploy, roll back, bind secrets and list credentials for other environments (runs enforce the pin; these routes do not). | `routes/versions.ts:250-265,374`, `routes/workflows.ts:712-723`, `routes/credentials.ts:163-178` |
| B2  | Low      | Eight list endpoints have no pagination although a shared list query exists.                                                                             | `routes/credentials.ts:150`, `triggers.ts:101`, tools, MCP servers, agents …                     |
| B3  | Low      | No `statement_timeout` on the pool and no Fastify request timeout.                                                                                       | `packages/database/src/db.ts:66`, `apps/api/src/server.ts`                                       |
| B4  | Low      | Audit rows are written after commit in `onSend`, best effort.                                                                                            | `apps/api/src/plugins/audit.ts:41`                                                               |
| B5  | Low      | `/v1/ready` returns raw database error text and ignores Redis.                                                                                           | `apps/api/src/routes/health.ts:41-43`                                                            |

## Database and data

| #   | severity | finding                                                                                                                                                                                                                               | evidence                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | High     | The retention sweep is never scheduled or consumed: `run_events`, `node_runs`, checkpoints, jobs, deliveries, tokens and idempotency keys grow without bound, and the documented 7-day erasure of sensitive node I/O does not happen. | `packages/database/src/retention.ts:35`, `apps/worker/src/worker.ts:535-538` |
| D2  | High     | Inside the sweep: the PII step re-picks the same unfiltered batch and can stall; the checkpoint step is unbounded; several steps are unbatched; `queue_jobs` and `alert_deliveries` are never swept.                                  | `retention.ts:70,76`                                                         |
| D3  | High     | Multi-worker: a trigger answered `busy` is acknowledged and lost; timers are marked fired and delegated results deleted before the orchestrator handles them. A crash or lease conflict at that point hangs the run.                  | `orchestrator.ts:217,539`, `delegation.ts:68`, `worker.ts:490-527`           |
| D4  | High     | The PostgreSQL queue never enforces `max_attempts` at claim: a job that crashes the process is redelivered forever.                                                                                                                   | `PgQueueDriver.ts` `claim()`                                                 |
| D5  | Medium   | Metrics count replays, evaluations and forks as traffic, and use wall-clock duration (human waits dominate p95).                                                                                                                      | `apps/api/src/services/metrics.ts` `runFilter`                               |
| D6  | Medium   | Queue drivers disagree on retries (BullMQ 1 attempt, Postgres 5); handler failures are not logged; `queueDepth` and `workerActiveRuns` metrics are defined but never recorded.                                                        | `BullMqQueueDriver.ts:48`, `observability/src/metrics.ts:134,141`            |
| D7  | Low      | Missing foreign keys on lineage columns (`parent_run_id`, `source_run_id`, …); `expiredLeases` compares the DB lease with the process clock; shutdown does not release leases.                                                        | `schema.ts`, `PgRunStore.ts`, `orchestrator.ts:629`                          |

Analytics readiness is good: `runs` carries status, cost, usage, origin, version and
environment with `(workflow_id, created_at)` indexes; `node_runs` carries latency, queue latency,
attempt and decision confidence. This is enough for statistically grounded change detection
without new collection (see the product strategy).

## AI

| #   | severity | finding                                                                                                                                                                                                                 | evidence                                                                                                                                   |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AI1 | High     | Streamed generations are priced at $0: the Generate node streams by default and the stream path emits no `GENERATION_COMPLETED` or cost. Run cost limits, the optimiser's statistics and the dashboard all under-count. | `nodes-core/src/ai/generate.ts:55,81-104`, `workflow-runtime/src/providers.ts:203-212`                                                     |
| AI2 | Medium   | Tool results and retrieved passages enter agent prompts unmarked and, for MCP and OpenAPI, uncapped; the knowledge context block can exceed its token budget with the first hit.                                        | `nodes-core/src/ai/agent.ts:310,332`, `mcp/src/caller.ts:104`, `openapi-tools/src/execute.ts:280`, `knowledge/src/retrieval/search.ts:177` |
| AI3 | Medium   | Agent cost and token caps are checked after each turn, so one turn can overshoot.                                                                                                                                       | `agent.ts:398-405`                                                                                                                         |
| AI4 | Medium   | Advisor spend (builder: up to 4 attempts × 16k output tokens with a ~34k-character prompt) is recorded only in audit details; the monthly budget is advice, not a limit; unpriced models cost $0 silently.              | `routes/ai.ts:159-181`, `providers/src/catalog/index.ts:217`                                                                               |
| AI5 | Medium   | The AI features have no evaluation sets and no prompt versioning; prompts are inline strings.                                                                                                                           | `advisor/src/builder.ts:150-176`, `critic.ts:55`                                                                                           |
| AI6 | Medium   | Uncalibrated LLM decision probabilities flow through the same confidence thresholds as calibrated Jev ones during failover.                                                                                             | `providers/src/llm-decision.ts:1-11`                                                                                                       |
| AI7 | Medium   | Agent tool calls record `capability: null`; tools are workspace-wide with only the node's allow-list.                                                                                                                   | `apps/worker/src/services/tools.ts:150-173`                                                                                                |
| AI8 | Low      | Builder output that compiles is not checked against the critic rubric; the response parser treats a whole object as the definition when `definition` is missing.                                                        | `builder.ts:184-201,282`                                                                                                                   |
| AI9 | —        | There is no assistant that answers questions about the workspace (runs, failures, costs). The AI builder is reachable only from "New workflow", not to refine an open workflow.                                         | `apps/web/app/(app)/[ws]/workflows/new/page.tsx:91`                                                                                        |

Strengths: the compiler is ground truth for the AI builder (structured output against the
catalog, compiler-diagnostic repair, nothing persisted without acceptance); the critic is
deterministic with RFC 6902 patches; agents have step, tool, token, cost and time limits with
durable approval; provider failover with circuit breakers and a dated price catalog; record/replay
keyed by request hash; MCP metadata sanitised.

## ML and data science

The statistical work is concentrated in `@flowaid/jev` (calibration: Horvitz–Thompson weighting,
ECE/ACE/MCE, Brier, RPS, PSI drift, Wilson bounds) and `@flowaid/evaluation`.

| #   | severity | finding                                                                                                                                                                                      | evidence                                  |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| M1  | High     | `@flowaid/jev` has no consumer: calibration metrics, threshold recommendation and drift alarms never run in the product.                                                                     | no `package.json` depends on it           |
| M2  | Medium   | The Wilson lower bound for threshold recommendation uses the raw count with inverse-probability weights (should be Kish's effective n) and scans 50 thresholds without multiplicity control. | `jev/src/calibration/recommend.ts:99-112` |
| M3  | Low      | Evaluation regression warnings use fixed point drops: with 20 cases one flipped case (5 points) warns.                                                                                       | `evaluation/src/compare.ts:8-12`          |
| M4  | —        | No change detection over run history, although the data supports it (D5 must be fixed first).                                                                                                | —                                         |

## Security

Local-first is the threat model: one person, loopback. The controls are strong (ES256 sessions,
API-key scopes capped by role, SSRF-guarded fetch with connect-time checks, envelope encryption,
fail-closed isolated-vm sandbox, stdio MCP allow-lists, sha512-verified plugin installs, HMAC
webhooks with a replay window).

| #   | severity | finding                                                                                                                                                                                                                                                                        | evidence                                                                                         |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| S1  | High     | Started with `--host 0.0.0.0`, the app stays in local (no sign-in) mode; the web proxy forwards client-supplied `Host`/`X-Forwarded-*`, and the API's loopback sign-in trusts them. A machine on the LAN can obtain an owner session. The default (127.0.0.1) is not affected. | `scripts/start.ts:110,546`, `apps/web/src/server/proxy.ts:36`, `apps/api/src/routes/auth.ts:146` |
| S2  | Medium   | Credentials in custom headers (`X-API-Key` for HTTP and OpenAPI tools) are forwarded on cross-origin redirects; only `authorization` and `cookie` are stripped.                                                                                                                | `providers/src/safeFetch.ts:204-207`                                                             |
| S3  | Medium   | The database query node connects to any DSN host, including FlowAId's own Postgres, without the private-address guard.                                                                                                                                                         | `nodes-core/src/tools/db_query.ts:150`                                                           |
| S4  | Medium   | `CORS_ORIGINS=*` with credentials is accepted outside production.                                                                                                                                                                                                              | `apps/api/src/server.ts:77-79`                                                                   |
| S5  | Low      | stdio MCP maps credential fields to environment variables without a deny-list (`path` → `PATH`); IPv6 blocklist misses IPv4-compatible, 6to4 and Teredo forms; plugin hosts run without Node's permission model in dev mode (documented as admin-trusted).                     | `mcp/src/stdio.ts:157`, `safeFetch.ts:45-59`, `apps/worker/src/plugins/host.ts:159`              |
| S6  | Low      | Row-level-security bypass is a custom setting any role can set, including the sandbox host's role; `flowaid_run_visible()` is SECURITY DEFINER and blocks inlining. Low risk for local use.                                                                                    | `migrations/0001_rls.sql:36`                                                                     |

`pnpm audit --prod --audit-level=high` passes.

## DevOps and SRE

| #   | severity | finding                                                                                                                                            | evidence                                          |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| O1  | High     | Releases are not gated on CI or E2E: `release.yml` runs on every push to `main`. On 2026-09-28 an E2E run failed next to a successful Release run. | `.github/workflows/release.yml:9-13,108-128`      |
| O2  | High     | No backup, restore or disaster-recovery procedure: one sentence in the Compose README. Losing the master key makes every credential unreadable.    | `docker/README.md:35`                             |
| O3  | Medium   | Upgrades are forward-only with migrations at API boot and no documented rollback.                                                                  | `docker/README.md:186`, `apps/api/src/main.ts:40` |
| O4  | Medium   | ARCHITECTURE.md documents a `flowaid keys rotate-master` command that does not exist.                                                              | `ARCHITECTURE.md:1227`                            |
| O5  | Medium   | API.md, the env schema, `turbo.json` and the feature list still carry OIDC and invitation surfaces that the local-first decision removed.          | `API.md:69,73`, `env/src/schema.ts:509`           |
| O6  | Low      | Fixed sleeps in three browser tests hidden by `retries: 1`.                                                                                        | `e2e/acceptance/a11y.spec.ts:26` …                |

Strengths: digest-pinned images with SBOM and provenance attestation, segmented Compose networks,
loopback-only ports, `cap_drop ALL`, non-root images, a secret-canary scan over E2E logs.

## Testing

About 330 unit and component test files, 41 PostgreSQL integration files, 7 acceptance specs and
1 gallery spec. Thin relative to size: importer, langchain, evaluation, storage, plugins and
openapi-tools (one test file each); `packages/cli/src/commands` and
`apps/web/src/admin/settings` (none); `scripts/start.ts` (547 lines, none); the Postgres branch of
the database query node never runs in CI. No evaluation of the AI features themselves (AI5).

## Priorities for V2

The refactor plan ([FLOWAID_V2_REFACTOR_PLAN.md](FLOWAID_V2_REFACTOR_PLAN.md)) turns these into
P0–P3 work; the roadmap ([FLOWAID_V2_ROADMAP.md](FLOWAID_V2_ROADMAP.md)) sequences them with the
V2 capabilities. In short:

- **P0:** S1, A1, D1–D4, AI1, O1.
- **P1:** S2–S4, B1, D5–D6, AI2–AI4, AI8, O2–O5, F2.
- **V2 capabilities** built on the stabilised base: change detection and a "needs attention" view
  (M4, F1), a grounded workspace assistant with read-only typed tools (AI9), AI trust signals
  (F3, F4), evaluation of the AI features (AI5).
