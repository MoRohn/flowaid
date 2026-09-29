# Changelog

Every release of FlowAId, newest first. The `@flowaid/*` packages share one version; each
release publishes the `ghcr.io/morohn/flowaid-api`, `-worker` and `-web` images at that version.
Sections are added by `pnpm version-packages` from the changesets merged since the last release
(see [docs/RELEASING.md](docs/RELEASING.md)); each package also keeps its own `CHANGELOG.md`.

## 0.5.0 — 2026-09-29

- A first run that works, and says why when it does not. A new starter template, Message triage,
  runs with only a TypeSafe key. Template cards say what each one needs and whether the workspace
  has it, and each "Use template" button names its template.
  In the builder:
  - A step that needs a key gets it in one step (**Add a key for this step**). Before this there was
    no way to declare a secret in the app.
  - Prompt and template fields insert references the compiler accepts (`{{ start.message }}`) instead
    of `input.*`, `nodes.*` and `variables.*`, which never compiled.
  - The Run tab checks required input before sending, lists the problems that block a run with a way
    to reach each one, and shows why the server refused a run (input, keys, connection, permission,
    rate limit), with the request id.
  - The Output tab summarises the run: completed, failed at which step, or waiting for a person, with
    time, cost and the full run.
  - Problems name the node and field.
  - The model picker marks providers that have no key.
  - Publish stays available and its dialog lists what blocks it.
  - Confirm dialogs show a failure instead of failing silently.

## 0.4.0 — 2026-09-29

- FlowAId behaves like a desktop application on macOS and Windows alike.
  - `./flowaid` (`flowaid.cmd` on Windows) opens FlowAId in its own app window (Chrome, Edge, Brave
    or Chromium; otherwise the default browser), with its icon in the menu bar or the notification
    area: Open FlowAId, Quit FlowAId, and what runs in the background (runs in progress, approvals
    waiting; a notification when an approval arrives, a badge on macOS). Quitting from the icon
    while runs are in progress asks first.
  - In the app, the power button and the command menu offer **Close window** (FlowAId keeps
    running; the icon reopens it) and **Quit FlowAId** (after a confirmation that says what is
    running). New `/v1/desktop` routes (session-only, `admin`, audited), `features.desktop`, and
    `FLOWAID_LAUNCHER_URL`/`FLOWAID_LAUNCHER_TOKEN`.
  - Nothing is left running: every process runs under a guard that stops its whole tree with the
    launcher, however the launcher stops (Quit, Ctrl+C, a closed terminal, a crash). A second
    `./flowaid` opens the running instance's window, and a start after a hard crash ends what was
    left. On Windows the API and worker stop gracefully over IPC. `pnpm smoke:desktop` checks all
    of it, and CI runs it on Windows and macOS.
  - Windows fixes: artifact storage paths, stdio MCP servers (Windows executable paths accepted,
    shells and scripts refused, process trees ended with `taskkill`), and PageIndex finds Python
    through the `py` launcher.
- The first public beta of FlowAId: typed workflows compiled into content-hashed plans and run on an
  event-sourced runtime, TypeSafe Jev decisions with calibrated probabilities, human review,
  evaluations with a publish gate, model routing and failover, agents, knowledge bases, plugins,
  triggers, observability and alerts, the FlowAId importer, code export, and published container
  images for the api, the worker and the web app.
- Local-first by default: on your own computer FlowAId opens without a sign-in (`FLOWAID_AUTH_MODE=auto`
  resolves to `local` when the app's URLs are loopback). The api issues the owner's session only to
  callers on this computer; behind public URLs, and in the compose stack, email and password sign-in
  stays. The web app hides sign-out, members and profile in local mode.
- PageIndex document intelligence: PageIndex knowledge sources index uploaded PDFs into section
  trees with the pinned PageIndex SDK (a private Python service, `./flowaid --pageindex` or the
  compose `pageindex` profile), versioned and deduplicated per file. The new nodes
  `flowaid.pageindex.index`, `.retrieve` (TypeSafe Jev navigates the tree) and `.cite` (every
  citation checked against the page text), document tools for agents, three templates, a source
  page with outline, source viewer and test panel, and `pnpm eval:pageindex` (RFC-0022). Also:
  the web app opens at http://flowaid.localhost:3000 (API on 3001), `./flowaid` starts everything,
  local Ollama works without opening the private network, and upgraded installs receive new
  built-in templates.
- FlowAId V2: what needs you, what changed, and why. The Overview opens with "Needs attention"
  (open approvals, workflows with failed runs) and "What changed" (statistically tested regressions
  per workflow in failure rate, latency, cost and decision confidence, and new error codes, with
  their evidence and the version they coincide with; `GET /v1/insights`). Ask FlowAId answers
  questions about the workspace from read-only lookups, typing each statement as a fact,
  calculation, suggestion or unconfirmed and linking the records it cites
  (`POST /v1/assistant/ask`, `pnpm eval:assistant`). Streamed generations are priced, metrics count
  production traffic by default, the retention sweep runs, runs no longer hang in Redis mode, and
  local mode stays on loopback.
- A guided first run and clearer flows everywhere: a getting-started checklist on the Overview, a
  workspace command menu (search, create, jump), a help menu, adding webhooks and schedules from the
  app, credential guidance with a connection test, knowledge sources that pick a ready embedding
  model, evaluation cases as forms, a lane-routed graph layout that opens legibly, failed runs with
  "Retry node", and follow-through after answering a human task.

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
