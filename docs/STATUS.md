# FlowAId status — 2026-09-29

This file records where everything stands so work can restart from a known state. **0.4.0** is
released (V2: insights, Ask FlowAId, PageIndex, the desktop app); its audit, with what was
verified and what is open, is [project/FLOWAID_V2_FINAL_AUDIT.md](project/FLOWAID_V2_FINAL_AUDIT.md).
On `main` for the next release: the first-run experience (the Message triage starter, keys added
from the builder, run feedback) and the four business flows with the builder's workflow panel.
The repository is published at [github.com/MoRohn/flowaid](https://github.com/MoRohn/flowaid);
CI, E2E and the desktop checks run on every push to `main`.

## Gates

| gate                                                           | result                                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                   | pass: audit, boundaries, env/SDK/UI-inventory generators current, format, lint, types, build, tests |
| PostgreSQL suites (database, runtime, nodes-core, api, worker) | pass (CI job `integration`, pgvector pg16 + Redis)                                                  |
| Acceptance journey (`e2e/acceptance`)                          | pass against the production builds with recorded provider replay and secret-canary log checks       |
| UI accessibility gallery                                       | pass (axe checks over the `@flowaid/ui` gallery and the web pages, CI job `ui-gallery`)             |
| Docker images (`docker/Dockerfile`)                            | api, worker and web build and boot; `docker compose up` reaches healthy on every service            |
| Tests                                                          | all pass locally and in CI; the per-package counts below are from the V2 audit (2026-09-28)         |

## Apps

| app           | state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | tests |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `apps/api`    | Auth (sessions, API keys, CSRF, rate limits, audit), workspaces, environments, workflows, drafts, versions, deployments, runs with SSE and replay/restart/fork/retry-node, human tasks and review links, credentials, tools, MCP servers and exposures, plugins (registry, install, allow-list), triggers and ingress with event correlation, knowledge, agents, the advisor, metrics, Prometheus and alerts, notification channels with test sends, evaluations with the publish gate, code export, the importer, OpenAPI 3.1 | 110   |
| `apps/worker` | Orchestrator over the PostgreSQL run store, core nodes, plugin nodes in a plugin host process, delegated pools (the `code` pool on the `worker-code` sandbox host), providers with failover and routing, MCP/OpenAPI tools, agents, local or S3 artifacts, the scheduler, knowledge ingestion, trace reviews, alerts, evaluation and export jobs, heartbeat health check                                                                                                                                                       | 47    |
| `apps/web`    | Builder with the AI builder and critic, runs with run actions and the trace viewer, human tasks, agents, knowledge, triggers (schedules, webhooks, MCP exposures and tokens), the dashboard, credentials, integrations and plugins, evaluations, templates, versions, compare, deployments, settings with notifications                                                                                                                                                                                                        | 116   |
| `apps/docs`   | Documentation site: getting started, importing external flow exports                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 7     |

## Packages

| package                                                              | state                                                                                                        | tests |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----- |
| `workflow-core`                                                      | contracts, FlowExpr, templates, schema checker (0.3.8, RFC-0021)                                             | 2,665 |
| `workflow-compiler`                                                  | 8 passes, 94 diagnostics, diff, migrate                                                                      | 177   |
| `workflow-runtime`                                                   | scheduler, orchestrator, replay, run actions, drivers                                                        | 89    |
| `database`                                                           | 50 tables, migrations 0000–0012 with RLS (bypass gated on `flowaid_rls_bypass`), run store, queue, event bus | 56    |
| `nodes-core`                                                         | 60 nodes and the templates                                                                                   | 153   |
| `providers`, `provider-typesafe`, `-openai`, `-anthropic`, `-ollama` | registry, pricing, failover, routing, rerank, record/replay; TypeSafe Jev and generation providers           | 163   |
| `advisor`                                                            | cost optimiser, AI builder, AI critic, Ask FlowAId loop and its evaluation set                               | 40    |
| `insights`                                                           | change detection: Fisher, Mann–Whitney, Benjamini–Hochberg, version attribution                              | 20    |
| `knowledge`                                                          | ingestion, chunking, pgvector hybrid search                                                                  | 33    |
| `mcp`, `openapi-tools`                                               | MCP client pool and exposure; OpenAPI tools                                                                  | 75    |
| `plugins`, `create-flowaid-node`                                     | registry discovery, install, plugin host; scaffold                                                           | 25    |
| `importer`                                                           | the FlowAId importer and migration report                                                                    | 20    |
| `sandbox`, `credentials`, `storage`                                  | isolated-vm and container executors; envelope encryption; local and S3 artifacts                             | 87    |
| `observability`                                                      | logs, tracing, metrics, Prometheus, OTel, trace reviews, alerts                                              | 71    |
| `evaluation`, `jev`                                                  | evaluation runner and reports; Jev decision-contract library                                                 | 209   |
| `workflow-sdk`, `cli`                                                | typed client with resumable SSE and builders; the `flowaid` CLI                                              | 43    |
| `codegen`                                                            | code export packages, npm and vendored                                                                       | 29    |
| `langchain`, `nodes-langchain`                                       | adapters, callback handler, bundled nodes and the RAG template                                               | 53    |
| `node-sdk`, `shared`, `env`                                          | node authoring kit; primitives; environment schema                                                           | 165   |
| `ui`                                                                 | component library, playground and accessibility gallery                                                      | 899   |

Workspace packages export `types` and `development` conditions to their sources and `default`
to `dist`: tests, `tsx --conditions=development` and the web build read sources, while the
compiled API, worker and Docker images run plain `node` on `dist`.

## Hardening after V2 (2026-10-01)

- **P3-3:** with `REDIS_URL`, request rate limits, sign-in throttles and the webhook replay cache
  live in Redis and hold across api replicas; without it they stay in process memory.
- **P3-4:** `app.bypass_rls` lifts row-level security only for members of `flowaid_rls_bypass`
  (`flowaid_app` and the owner; never the sandbox host's `flowaid_code`), migration 0012.
- **P3-6:** a mutation's audit row is written inside the transaction that makes the change.
- **P3-7:** `flowaid keys rotate-master` (`pnpm keys`, or `node dist/keys.js` in the api image)
  rotates the master key; procedure in [operations/RUNBOOK.md](operations/RUNBOOK.md#key-rotation).
- `PgRunStore.dueTimers` decides what is due by the database clock.

What stays open is in [security/THREAT_MODEL.md](security/THREAT_MODEL.md#accepted-risks-and-open-items).

## Upgrade plan (`docs/project/UPGRADE_PLAN.md`)

- **Phases 0–2:** complete, including release automation (changesets, `release.yml` publishing
  multi-arch images to GHCR, lefthook).
- **Phase 3:** complete. FlowAId is local-first (`FLOWAID_AUTH_MODE=auto`: on your own computer
  it opens without a sign-in; behind public URLs it uses email and password), so OIDC,
  invitations and password-reset flows are out of scope by decision. Code nodes run
  on the `worker-code` sandbox host, plugin nodes in a plugin host process, and artifacts go to
  S3 when `S3_*` is set.
- **Phase 4:** complete; P4-02's UI items shipped with the web app.
- **Phase 5:** complete: the journey runs against the production builds with provider-fixture
  replay and secret-canary log checks, and the UI accessibility gallery gates every push.
- **Phase 6:** complete; of P6-07 only the Azure/GCP key services shipped (identity is out of
  scope for a local-first app).
- **Track J:** J-01 to J-07 in `@flowaid/jev`. **Track L:** designed, not started.

## Known gaps

- AWS KMS and Secrets Manager need an AWS SDK client the apps do not wire yet; the other master key
  providers (`local`, `vault-transit`, `azure-keyvault`, `gcp-kms`) and external references
  (`env:`, `vault:`, `azure-kv:`, `gcp-sm:`) are configured from the environment.
- V2's open items (live-model evaluation of Ask FlowAId, browser specs for the insights panels
  and the assistant, dashboard filters in the URL, the P2-6 and P3 refactors, a manual
  screen-reader pass) are listed in [project/FLOWAID_V2_FINAL_AUDIT.md](project/FLOWAID_V2_FINAL_AUDIT.md).
- A run does not start while a workflow's _required_ secret is unbound in its environment, even
  when the server has that provider's key (`apps/api/src/services/runs.ts`, `E_SECRET_UNBOUND`);
  the worker falls back to the server key only for optional secrets. So the built-in templates,
  which declare `TYPESAFE_API_KEY` as required, need the key saved as a credential and bound per
  environment. The Message triage starter declares it optional, and keys added from the builder
  are optional when the server has the key. The smallest backend change: let the run-start check
  accept an unbound required secret whose `credentialType` the server has a key for.
- Workspace retention settings (`settings.retention.runsDays` / `auditDays` / `artifactsDays`) are
  saved but not read: the retention sweep (`packages/database/src/retention.ts`) uses the per-class
  `RETENTION_DAYS` (standard 90, short 7, long 400). `settings.budgets.monthlyCostUsd` is read only
  by the workflow advisor; nothing stops runs or alerts when it is passed. Settings → Workspace
  says so next to the fields.
- ⌘K opens the node palette only while focus is inside the canvas (elsewhere it opens the
  command menu); the Add node button is reachable with Tab.
