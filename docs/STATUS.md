# FlowAId status — 2026-10-01

This file records where everything stands so work can restart from a known state. **0.8.0** is
released. On `main` for the next release: built-in agent tools and the agents' Active switch, and
the production-readiness pass below. V2's audit, with what was verified and what is open, is
[project/FLOWAID_V2_FINAL_AUDIT.md](project/FLOWAID_V2_FINAL_AUDIT.md). The repository is
published at [github.com/MoRohn/flowaid](https://github.com/MoRohn/flowaid); CI, E2E and the
desktop checks run on every push to `main`.

## Production-readiness pass (2026-10-01)

Fixed, each with tests:

- A required secret is satisfied by the server's own key for its type (run start, deploy, publish
  with `deployTo`, and node credential slots at run time).
- The workspace's monthly budget is enforced: new runs are refused once it is spent, with
  `budget.warning` (80%) and `budget.exceeded` alerts once a month; `GET /v1/workspaces/:id/budget`.
- Workspace retention settings (runs, audit, artifacts) are applied by the retention sweep.
- Evaluation judge checks run on the workspace's text model and are priced into the run's cost.
- Schedule catch-up `skip`, `one` and `all` differ as documented; a schedule's input is checked at
  deploy and at every fire.
- MCP exposures made by hand survive deploys and can be switched on and off; stdio MCP servers are
  tested and discovered by the worker; a server can be tested before it is saved.
- Rate limits, login throttles and the webhook replay cache are stored in Redis when `REDIS_URL`
  is set; `RATE_LIMIT_MAX` scales the session, API-key and unauthenticated limits.
- Audit rows are written in the same transaction as the change.
- The row-level-security bypass requires membership of `flowaid_rls_bypass` (migration 0012).
- `flowaid keys rotate-master` re-wraps every key and re-seals every credential, resumably.
- Timers fire on the database clock.
- AWS KMS master keys and Secrets Manager references work, signed with SigV4 and no AWS SDK.
- Plugin hosts run under Node's permission model in development as well as production, with
  network access only through the platform's guarded fetch (enforced by the runtime on Node 25+,
  in-process on Node 24).
- Measured capacity: [operations/PERFORMANCE.md](operations/PERFORMANCE.md).

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
- **Phase 6:** complete; of P6-07 the key services shipped (AWS KMS and Secrets Manager, Azure,
  GCP; identity is out of scope for a local-first app).
- **Track J:** J-01 to J-07 in `@flowaid/jev`. **Track L:** designed, not started.

## Known gaps

- V2's open items (live-model evaluation of Ask FlowAId, browser specs for the insights panels
  and the assistant, dashboard filters in the URL, the P2-6 and P3 refactors, a manual
  screen-reader pass) are listed in [project/FLOWAID_V2_FINAL_AUDIT.md](project/FLOWAID_V2_FINAL_AUDIT.md).
- Not run: the live-model evaluation of Ask FlowAId (needs a provider key in the environment:
  `ANTHROPIC_API_KEY=… pnpm eval:assistant`) and a manual screen-reader pass (automated axe
  checks gate every push).
- Accepted for a local-first app, listed in
  [security/THREAT_MODEL.md](security/THREAT_MODEL.md#accepted-risks-and-open-items): the API and
  the worker share one database role; on Node 24 the plugin network guard runs in-process;
  the global request limit fails open when Redis is down; master-key rotation needs the API and
  worker stopped. Single sign-on, invitations and MFA are out of scope by decision.
