# Changelog

Every release of FlowAId, newest first. The `@flowaid/*` packages share one version; each
release publishes the `ghcr.io/morohn/flowaid-api`, `-worker` and `-web` images at that version.
Sections are added by `pnpm version-packages` from the changesets merged since the last release
(see [docs/RELEASING.md](docs/RELEASING.md)); each package also keeps its own `CHANGELOG.md`.

## Before the first release (2026-09-23 to 2026-09-28)

The work that led to the first beta, by phase of [the upgrade plan](docs/UPGRADE_PLAN.md).

### Phase 0: foundation

- A pnpm and Turborepo monorepo with strict TypeScript, dependency boundaries checked in CI,
  generated environment documentation, and one command (`pnpm check`) that runs every gate.
- The frozen contracts (`@flowaid/workflow-core`): the workflow definition, bindings, the FlowExpr
  expression language, templates, events, errors, decisions and execution plans.
- The React component library (`@flowaid/ui`) with a playground and an accessibility gallery.
- `pnpm start` runs the whole stack locally in one command; `pnpm preflight` checks the machine.

### Phase 1: the core libraries

- The workflow compiler: eight passes, typed diagnostics, guard analysis and a content-hashed
  execution plan, run the same way in the browser, the API, the worker and the CLI.
- The PostgreSQL schema with forced row-level security, the provider registry with pricing and
  failover, envelope-encrypted credentials, and redacting logs, tracing and metrics.

### Phase 2: running workflows

- An event-sourced runtime with leases, crash recovery and recorded replay.
- TypeSafe Jev decisions with exact probability distributions, plus OpenAI, Anthropic, Ollama and
  compatible generation providers.
- Core nodes, MCP and OpenAPI tools, sandboxed code and shell nodes, and evaluations.

### Phase 3: the services

- The REST API with OpenAPI 3.1, sessions, API keys, audit, runs with SSE streams, human tasks,
  external review links, webhooks, schedules and the `/mcp` server.
- The worker, a separate sandbox host for code nodes, plugin host processes, and artifact storage
  on a volume or S3.
- LangChain adapters and a bundled LangChain node package, kept behind a strict boundary.

### Phase 4: developer tools

- The TypeScript SDK with resumable streams and workflow builders, and the `flowaid` CLI with a
  command for every API operation.
- Download code: a flow as a runnable TypeScript package with its own tests.

### Phase 5: the web app and the release gate

- The builder with an in-browser compiler, the trace viewer, the human task inbox, credentials,
  integrations, evaluations, templates, versions, deployments and settings.
- A browser acceptance journey against the production builds with recorded provider responses,
  and checks that no secret reaches the logs.

### Phase 6: platform features

- Model routing and failover, a cost optimizer, an AI workflow builder and an AI critic.
- The full node catalog with rerank, run actions (restart, fork, retry a node), event
  correlation, a plugin ecosystem, agents, knowledge bases with hybrid search, an observability
  dashboard with alerts, trigger and notification pages, the FlowAId importer and a docs site.
- Fixes from an end-to-end walk through every page of the web app.
