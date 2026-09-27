# FlowAId status — 2026-09-27

This file records where everything stands so work can restart from a known state. The
repository is published at [github.com/MoRohn/flowaid](https://github.com/MoRohn/flowaid); CI
and E2E run on every push to `main`.

## Gates

| gate                                               | result                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm check`                                       | pass: audit, boundaries, env/SDK/UI-inventory generators current, format, lint, types, build, tests |
| PostgreSQL suites (database, runtime, api, worker) | pass (CI job `integration`, pgvector pg16 + Redis)                                                  |
| Acceptance journey (`e2e/acceptance`)              | pass against the production builds (`.github/workflows/e2e.yml`) and against Docker Compose         |
| Docker images (`docker/Dockerfile`)                | api, worker and web build and boot; `docker compose up` reaches healthy on all four services        |
| Tests                                              | 5,008 (including the PostgreSQL and isolated-vm suites that run in CI) plus the browser journey     |

## Apps

| app           | state                                                                                                                                                                                                                                                                                                                                                                                                                                                          | tests |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `apps/api`    | Built (P3-01, most of P3-02): auth (sessions with refresh rotation, API keys, CSRF, rate limits, audit), workspaces, environments, workflows, drafts, versions, deployments, runs with SSE, human tasks and single-use external review links, credentials, tools, MCP servers and exposures, the `/mcp/:workspace` server, triggers and ingress, evaluations with the publish gate, code export jobs, plugin manifests from the worker's registry, OpenAPI 3.1 | 67    |
| `apps/worker` | Built (P3-03 core): orchestrator over the PostgreSQL run store, core and bundled plugin (LangChain) nodes, providers, MCP/OpenAPI tools, state, artifacts, isolated-vm code, the scheduler, evaluation and export jobs, heartbeat health check                                                                                                                                                                                                                 | 17    |
| `apps/web`    | Built (P5-01, P5-02): builder (zustand + immer store, compiler Web Worker, projection, autosave with If-Match, live run overlay, publish dialog), runs and trace viewer with SSE, human tasks and the external review page, credentials, integrations, settings, evaluations, templates, versions, compare, deployments; the API proxy forwards `/v1`, `/hooks` and `/mcp` at request time                                                                     | 71    |

## Packages

| package                                                              | state                                                                            | tests |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----- |
| `workflow-core`                                                      | contracts, FlowExpr, templates, schema checker                                   | 2,665 |
| `workflow-compiler`                                                  | 8 passes, 94 diagnostics, diff, migrate                                          | 167   |
| `workflow-runtime`                                                   | scheduler, orchestrator, replay, drivers                                         | 78    |
| `database`                                                           | schema, migrations with RLS, run store, queue, event bus                         | 56    |
| `nodes-core`                                                         | 36 nodes and the templates                                                       | 90    |
| `providers`, `provider-typesafe`, `-openai`, `-anthropic`, `-ollama` | registry, pricing, failover; TypeSafe Jev and generation providers               | 140   |
| `mcp`, `openapi-tools`                                               | MCP client pool and exposure; OpenAPI tools                                      | 75    |
| `sandbox`, `credentials`, `observability`                            | isolated-vm and container executors; envelope encryption; logs, tracing, metrics | 133   |
| `evaluation`, `jev`                                                  | evaluation runner and reports; Jev decision-contract library                     | 209   |
| `workflow-sdk`, `cli`                                                | typed client with resumable SSE and builders (P4-01); the `flowaid` CLI          | 37    |
| `codegen`                                                            | code export packages, npm and vendored (P4-04)                                   | 29    |
| `langchain`, `nodes-langchain`                                       | adapters, callback handler, bundled nodes and the RAG template (P3-04, P4-03)    | 53    |
| `node-sdk`, `shared`, `env`                                          | node authoring kit; primitives; environment schema                               | 162   |
| `ui`                                                                 | component library and playground                                                 | 872   |

Workspace packages export `types` and `development` conditions to their sources and `default`
to `dist`: tests, `tsx --conditions=development` and the web build read sources, while the
compiled API, worker and Docker images run plain `node` on `dist`.

## Upgrade plan (`docs/UPGRADE_PLAN.md`)

- **Phases 0–2:** complete (P0-20, the UI visual/axe regression suite, and parts of P0-05 —
  release automation, git hooks, changesets — remain).
- **Phase 3:** P3-01 complete; P3-02 complete except OIDC, invitations and password-reset
  flows; P3-03 complete except the plugin-host processes, delegated worker pools (a separate
  sandbox host for the `code` pool) and S3 artifact storage (artifacts use the shared data
  volume); P3-04 complete.
- **Phase 4:** P4-01, P4-03 and P4-04 complete (the CLI lacks `db`, `plugin`, `keys
rotate-master` and `import external`, which need routes or packages not built yet); P4-02's UI
  items shipped with the web app.
- **Phase 5:** P5-01 and P5-02 complete; P5-03's journey runs against the production builds and
  compose (provider-fixture replay and secret-canary log checks are not automated yet).
- **Phase 6:** not started (routing/advisor, observability dashboards, importer, identity
  extras, plugins, knowledge, agents).
- **Track J:** J-01 to J-07 in `@flowaid/jev`. **Track L:** designed, not started.

## Known gaps

- Runs list: saved views; run actions restart, fork and retry-node need API routes.
- Human tasks: no route lists a task's existing review links.
- The API serves bundled plugin providers' nodes but not their provider descriptors.
- `docker/compose.yml` no longer runs MinIO or a separate `worker-code` sandbox host: neither
  was used by the code (artifacts live in `flowaid-data`; code nodes run in isolated-vm inside
  the worker).
