# FlowAId status — 2026-09-27

This file records where everything stands so work can restart from a known state. The
repository is published at [github.com/MoRohn/flowaid](https://github.com/MoRohn/flowaid); CI
and E2E run on every push to `main`.

## Gates

| gate                                               | result                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm check`                                       | pass: audit, boundaries, env/SDK/UI-inventory generators current, format, lint, types, build, tests |
| PostgreSQL suites (database, runtime, api, worker) | pass (CI job `integration`, pgvector pg16 + Redis)                                                  |
| Acceptance journey (`e2e/acceptance`)              | pass against the production builds with recorded provider replay and secret-canary log checks       |
| UI accessibility gallery                           | pass (axe checks over the `@flowaid/ui` gallery and the web pages, CI job `ui-gallery`)             |
| Docker images (`docker/Dockerfile`)                | api, worker and web build and boot; `docker compose up` reaches healthy on every service            |
| Tests                                              | 5,399 (including the PostgreSQL and isolated-vm suites that run in CI) plus the browser journey     |

## Apps

| app           | state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | tests |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `apps/api`    | Auth (sessions, API keys, CSRF, rate limits, audit), workspaces, environments, workflows, drafts, versions, deployments, runs with SSE and replay/restart/fork/retry-node, human tasks and review links, credentials, tools, MCP servers and exposures, plugins (registry, install, allow-list), triggers and ingress with event correlation, knowledge, agents, the advisor, metrics, Prometheus and alerts, notification channels with test sends, evaluations with the publish gate, code export, the importer, OpenAPI 3.1 | 110   |
| `apps/worker` | Orchestrator over the PostgreSQL run store, core nodes, plugin nodes in a plugin host process, delegated pools (the `code` pool on the `worker-code` sandbox host), providers with failover and routing, MCP/OpenAPI tools, agents, local or S3 artifacts, the scheduler, knowledge ingestion, trace reviews, alerts, evaluation and export jobs, heartbeat health check                                                                                                                                                       | 47    |
| `apps/web`    | Builder with the AI builder and critic, runs with run actions and the trace viewer, human tasks, agents, knowledge, triggers (schedules, webhooks, MCP exposures and tokens), the dashboard, credentials, integrations and plugins, evaluations, templates, versions, compare, deployments, settings with notifications                                                                                                                                                                                                        | 116   |
| `apps/docs`   | Documentation site: getting started, importing external flow exports                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 7     |

## Packages

| package                                                              | state                                                                                              | tests |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| `workflow-core`                                                      | contracts, FlowExpr, templates, schema checker (0.3.8, RFC-0021)                                   | 2,665 |
| `workflow-compiler`                                                  | 8 passes, 94 diagnostics, diff, migrate                                                            | 177   |
| `workflow-runtime`                                                   | scheduler, orchestrator, replay, run actions, drivers                                              | 89    |
| `database`                                                           | 47 tables, migrations 0000–0008 with RLS, run store, queue, event bus                              | 56    |
| `nodes-core`                                                         | 60 nodes and the templates                                                                         | 153   |
| `providers`, `provider-typesafe`, `-openai`, `-anthropic`, `-ollama` | registry, pricing, failover, routing, rerank, record/replay; TypeSafe Jev and generation providers | 163   |
| `advisor`                                                            | cost optimiser, AI builder, AI critic                                                              | 22    |
| `knowledge`                                                          | ingestion, chunking, pgvector hybrid search                                                        | 33    |
| `mcp`, `openapi-tools`                                               | MCP client pool and exposure; OpenAPI tools                                                        | 75    |
| `plugins`, `create-flowaid-node`                                     | registry discovery, install, plugin host; scaffold                                                 | 25    |
| `importer`                                                           | the FlowAId importer and migration report                                                          | 20    |
| `sandbox`, `credentials`, `storage`                                  | isolated-vm and container executors; envelope encryption; local and S3 artifacts                   | 87    |
| `observability`                                                      | logs, tracing, metrics, Prometheus, OTel, trace reviews, alerts                                    | 71    |
| `evaluation`, `jev`                                                  | evaluation runner and reports; Jev decision-contract library                                       | 209   |
| `workflow-sdk`, `cli`                                                | typed client with resumable SSE and builders; the `flowaid` CLI                                    | 43    |
| `codegen`                                                            | code export packages, npm and vendored                                                             | 29    |
| `langchain`, `nodes-langchain`                                       | adapters, callback handler, bundled nodes and the RAG template                                     | 53    |
| `node-sdk`, `shared`, `env`                                          | node authoring kit; primitives; environment schema                                                 | 165   |
| `ui`                                                                 | component library, playground and accessibility gallery                                            | 899   |

Workspace packages export `types` and `development` conditions to their sources and `default`
to `dist`: tests, `tsx --conditions=development` and the web build read sources, while the
compiled API, worker and Docker images run plain `node` on `dist`.

## Upgrade plan (`docs/UPGRADE_PLAN.md`)

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
