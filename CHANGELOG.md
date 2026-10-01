# Changelog

Every release of FlowAId, newest first. The `@flowaid/*` packages share one version; each
release publishes the `ghcr.io/morohn/flowaid-api`, `-worker` and `-web` images at that version.
Sections are added by `pnpm version-packages` from the changesets merged since the last release
(see [docs/operations/RELEASING.md](docs/operations/RELEASING.md)); each package also keeps its own `CHANGELOG.md`.

## 0.9.0 — 2026-10-01

- Built-in agent tools, and agents you can switch on and off.
  - Three tools every agent can use without connecting anything: `calculator` (exact arithmetic,
    parsed rather than evaluated), `current_time` (date, time, weekday and offset in any IANA time
    zone) and `web_fetch` (a public web page's title and main text as Markdown, through the guarded
    fetch, GET only, 15 s, 2 MB, 20 000 characters at most). Their schemas use only `type`,
    `properties`, `required` and `description`, which every provider's function calling accepts, and
    a bad argument comes back as a message the model can act on. They are in every workspace's tool
    catalog; the New agent dialog lists them under "Built into FlowAId", apart from your own tools,
    with a note on what reading the web means for private data.
  - Agents have an Active switch on the Agents page. An active agent appears by name in every
    workflow's Add node (Agent group); adding it creates an Agent step that uses the agent and
    overrides none of its settings. Switching it off hides it there without breaking the steps that
    already use it. `GET /v1/agents?active=true|false` filters by it, and `PATCH /v1/agents/:id`
    takes `active`. New agents start active; migration `0011_agent_active` adds the column.
- Evaluation judge checks now run, and schedules catch up and check their input as documented.
  - Judge checks in an evaluation are graded by the same model the AI builder uses: the workspace's
    chosen model, else the first of Anthropic, OpenAI or Ollama with a key (a workspace credential
    or the server's own). Judge calls are priced like any model call: each case's result carries
    `judgeCostUsd`, and the summary's `costUsd` gains `judge`, counted in `total` but not in
    `perCase` (the workflow's own cost, which the regression report compares). Cancelling an
    evaluation stops judge calls in progress. Without a usable model a judge check fails with "no
    judge model available: add an OpenAI, Anthropic or Ollama key".
  - Schedule catch-up modes now differ. After downtime with missed run times, Skip starts none of
    them and waits for the next run time (a run time at most 60 seconds late still counts as on
    time); Run once starts exactly one run for all of them; Run all starts one per missed time, the
    most recent ones up to the limit, which is at most 100. Skipped runs are noted on the schedule.
  - A schedule's input is checked against the workflow's inputs: deploying a version whose schedule
    trigger has an input that does not match is refused with a pointer to that trigger
    (`/triggers/<i>/input`), and a schedule that fires with such an input starts no run and records
    the reason (and sends the schedule-failed alert) instead.
- MCP tools that survive deploys, and stdio MCP servers you can test and discover.
  A workflow exposed as an MCP tool under Triggers, MCP tools now stays exposed when you deploy,
  redeploy or roll back the workflow. It keeps its tool name and description, and clients see it
  whenever a version is deployed to its environment. Each tool in the list has an On/Off switch,
  so a switched-off tool can be switched back on; deploys leave the switch as you set it. A tool
  made before anything is deployed says it is waiting for a deployment. A tool declared by a
  version's own MCP trigger works as before: a later version without the trigger switches it off,
  and switching it back on makes it yours. Tools that a deploy switched off before this release are
  switched back on (migration 0015). `PATCH /v1/mcp/exposures/:id` takes `enabled` and
  `description`, and the exposure list reports `source`, `deployed` and `active`.
  stdio MCP servers can now be tested and discovered. The api never starts a program itself: it
  hands the test or discovery to the worker, which checks the command against its allow-list again,
  starts it, and stores the tools it lists on the server, so they reach agents and the MCP tool
  step. Each start is recorded in the audit log by name only. If no worker answers within 45
  seconds, the test says so.
  The Connect MCP server dialog can test the settings before saving them
  (`POST /v1/mcp/servers/test`, for HTTP and stdio servers); nothing is stored by the test.
- Security and reliability hardening (P3-3, P3-4, P3-6, P3-7):
  - With `REDIS_URL`, request rate limits, sign-in throttles and the webhook replay cache are kept in Redis, so they hold across api replicas.
  - Migration 0012 gates the row-level-security bypass on membership in the new `flowaid_rls_bypass` role (granted to `flowaid_app` and the owner, never to the sandbox host's `flowaid_code`). A migrating role without `CREATEROLE` needs the role created first (see `docker/postgres-init/01-roles.sql`).
  - Each mutation's audit row is written inside the transaction that makes the change.
  - `flowaid keys rotate-master` (`pnpm keys`, `node dist/keys.js` in the api image) re-wraps every key-encryption key and re-seals every credential under a new master key, verified and resumable.
  - Timers are due by the database clock, not the worker's.
- A key set in the server's environment (TYPESAFE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
  OLLAMA_HOST) now answers a workflow's required secret of that type when nothing is bound in the
  environment. Runs start, deploys (including Publish with deploy) go through, and steps use the
  server key, so the built-in templates run without saving and binding the key first. The builder,
  templates, Deployments and Secrets pages no longer ask you to bind such a secret.
  The monthly budget in Settings → Workspace is now enforced. Once the runs started this calendar
  month (UTC) have cost the budget, new runs are refused with HTTP 409 from every source (the
  builder, the API, webhooks, schedules, MCP and evaluations) until next month or until the budget is
  raised; runs already going finish. Two new notification events, "80% of the monthly budget is
  spent" and "The monthly budget is used up", reach subscribed channels at most once a month each.
  Settings → Workspace shows this month's spend next to the budget, also available from
  `GET /v1/workspaces/:id/budget` (`flowaid workspace budget`).
  The retention days in Settings → Workspace now apply at the nightly clean-up: runs keep their data
  for the workspace's run days instead of 90 (workflows set to short or long retention keep theirs),
  the audit log keeps entries for the audit days (400 when empty, which the clean-up now also
  applies), and files runs write are deleted after the artifact days even while the run is kept.
- `RATE_LIMIT_MAX` now sets the per-session request limit as documented, with API keys allowed
  double and unauthenticated requests (webhooks, sign-in) a fifth per address; unset, the limits are
  unchanged (600, 1 200 and 120 a minute). `pnpm loadtest` measures read and end-to-end run capacity
  of a running API, and docs/operations/PERFORMANCE.md records the first results. Migration 0015 can
  run again safely on a database that already has its columns.
- Plugin hosts run under the Node permission model in development too, and plugins reach the
  network only through `ctx.http`.
  - A development checkout bundles the plugin host with esbuild and starts the bundle with the same
    flags as the compiled host: `--permission`, reads limited to the host's code, the provided
    packages and the plugin's own directory (no longer the repository root, so not `.env` or
    `.flowaid/`), and no writes, child processes, worker threads, addons, WASI or inspector.
  - Installed plugin code may import only an allow-list of built-ins (`net`, `http`, `dns`,
    `child_process`, `module`, `vm` and the like are refused with `E_PLUGIN_BUILTIN_DENIED`);
    the global `fetch`, `WebSocket` and `EventSource` throw `E_PLUGIN_NETWORK_DENIED`; and
    `process.kill` only signals the host. On Node 25+ the permission model also refuses sockets.
  - `@flowaid/node-sdk`, `@flowaid/workflow-core` and `zod` imported by a plugin resolve to the
    host's own instances.
- AWS KMS master keys and AWS Secrets Manager references, without the AWS SDK.
  - `FLOWAID_MASTER_KEY_PROVIDER=aws-kms` with a key or alias ARN in `FLOWAID_MASTER_KEY_ID` wraps
    the key-encryption keys with KMS `Encrypt`/`Decrypt` (`Decrypt` pinned to the configured key).
    `aws-sm:<secret ARN>[#<json key>]` external references resolve through Secrets Manager
    `GetSecretValue`.
  - Requests are signed with Signature Version 4 over `node:crypto` (checked against AWS's
    published test-suite vectors) and sent through the injected fetch. Credentials come from
    `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, else the ECS task role
    (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`), else the EC2 instance profile (IMDSv2); the region
    is the ARN's. `AWS_ENDPOINT_URL` points both services at LocalStack or a VPC endpoint.

## 0.8.0 — 2026-09-30

- Fill with AI in the builder's Run tab.
  - Choose the kind of case (typical, edge cases at the limits the workflow checks, or unusual but
    valid), optionally describe it, and get three realistic inputs written from the workflow's input
    fields, steps, rules and settings. Each says in plain words what it exercises and which values it
    would replace; the form changes only when you pick one, with Undo, and nothing runs until Run
    draft. Values you entered can be kept while the rest is written around them.
  - Every example is checked against the workflow's input rules the way a run's input is; one that
    fails is sent back once and otherwise left out, never shown. The model, cost and anything left
    out are shown; secrets, keys and past runs are never sent.
  - `POST /v1/workflows/:id/ai/sample-inputs` (and `flowaid workflow sample-inputs`) serve it: the
    workspace's text model, the runs:create scope, 20 calls a minute, audited as
    `workflow.ai_sample_inputs`.
  - Number fields without a step of their own keep every decimal entered: 24.99 was rounded to 25.0.
  - Anthropic models that refuse `temperature` (such as claude-sonnet-5) are retried once without it
    and remembered, so the AI builder and generation steps work with them.
- Templates, Evaluations, Triggers, Settings and the credential, API key and schedule dialogs no longer
  fail with "Could not load this" after visiting Runs or Human tasks. Those two pages kept a
  workflow-name lookup under the same cache entry as the workflow list the others read, in a
  different shape.

## 0.7.0 — 2026-09-30

- More list endpoints are paged. `GET /v1/agents`, `/v1/api-keys`, `/v1/credentials`,
  `/v1/knowledge/sources`, `/v1/notifications`, `/v1/saved-views`, `/v1/workflows/:id/versions` and
  `/v1/workspaces/:id/members` now answer `{ items, next_cursor }` (keyset pagination with `limit`, at
  most 200, and `cursor`) instead of a bare array, like the other lists. Callers that read these
  responses as arrays must read `items` and follow `next_cursor`; the web app reads every page.
- Fixes from a page-by-page audit of the app.
  - A run's graph draws every connection: branch cases get their own outlets, and data connections
    come from the workflow's bindings when the version has no stored plan.
  - A new decision step uses the TypeSafe key the server already has (or a secret the workflow
    already declares) instead of starting with an unbound-key error.
  - ⌘K in the builder opens Add node whenever focus is on the canvas or nowhere in particular, and
    closing the palette hands focus back to the canvas.
  - Replay starts with "Reuse recorded results" (free) selected; running every step again is a
    choice the confirm button names.
  - Template cards say when a key the server has still needs a saved credential, and tell two
    secrets of the same kind apart.
  - Add schedule checks each cron field and whether it ever fires, and shows the next run times;
    missing required input fields are flagged at the input step.
  - New knowledge source rejects addresses that are not http(s) URLs and does not count an
    embedding model without a key as a finished choice.
  - Expose workflow no longer suggests exposing before a deploy that would switch it off again.
  - Evaluation cases need the workflow's required inputs in the form view; the set page names the
    workflow it tests.
  - Edit agent asks before discarding changes. New workflow only needs a name for Blank, and keeps
    an unsent "Describe it" text across a reload.
  - Missing runs, tasks and workflows say so and link back to their list; connection failures say
    the API cannot be reached; other errors keep their technical details one click away.
  - The Publish dialog lists problems in plain words with "Show node", and explains a protected
    environment when it is ticked. Settings shows a template copy's description.
  - Wording: steps rather than nodes in runs and human tasks, OpenAPI document versions, "an
    OpenAI credential", "TypeSafe", step requirements in words where nothing on the form is marked.
- Clearer step settings in the builder.
  - Inputs and output results that are built from several fields (object and array bindings) now
    open as editable Fields / List instead of an empty value box, so opening a step no longer hides
    its wiring and typing into it no longer replaces it by accident.
  - The value source switch reads Value · Reference · Template · Expression, with a one-line
    explanation of the current choice; step inputs and output results have visible labels.
  - "Execution policy" is now "Errors & limits": what happens when the step fails, attempts, time
    limit, cost and token limits as plain controls (with their defaults shown), and the full policy
    still editable as JSON.
  - Output steps explain the outcome label and "End the run early".
  - Workspace settings say what the retention, queue and budget values actually do today, show
    "Unsaved changes", and ask before a link or reload discards them.
  - Environment tags read dev · stg · prod; optional boolean criteria are no longer announced as
    required; "Add a key for LLM" instead of "llm".
  - Template fields speak the compiler's grammar everywhere: the footer counts the references a
    template really reads (`start.order_id`, `$vars.limit`), holes that name a missing step,
    output or setting are underlined with the fix, parse errors show under the field, single-line
    template fields complete references too, and the value switch's Template mode no longer offers
    the old picker whose `input.*` / `nodes.*` insertions did not compile.
  - Unsaved edits in Settings and workflow settings survive switching tabs; tabs with unsaved
    edits carry a dot, sections have Discard, and leaving the page asks first.
  - The mouse wheel zooms the canvas toward the pointer instead of panning it; pan with space-drag,
    the middle or right button, or the minimap.
- Step-by-step guidance on every page in the navigation.
  - Each page opens with "Start here": what you can do there, when to use it, what it needs (checked
    against the workspace: keys, tools, published versions, your role), how to start and what you
    get. It collapses to one line, remembers that, and still flags anything missing.
  - Creating an agent, knowledge source, evaluation set, workflow, credential, API key,
    notification channel, webhook, schedule, MCP server, OpenAPI import, exposed tool or a copy of a
    template is a guided flow: steps tick off from what the form actually holds, "All fields" shows
    the same form at once, and a review lists what blocks saving and what is worth knowing. Unsent
    drafts of new items are kept in the browser tab (never their secrets).
  - Monitoring pages explain how to read them: the Overview's insights, a run and its trace, a human
    task ("Before you answer"), an evaluation report, a knowledge source's test search.
  - Publishing reviews the draft's problems first; nothing is deployed unless ticked. Replay from
    the runs list asks before starting. Starting an evaluation or creating a web source happens
    only from its labelled button, not from Enter.
  - Fixes found on the way: API key example requests include the environment, correct external
    secret reference formats, credentials can be limited to chosen workflows, MCP tool policies can
    be edited, tool lists refresh after discovery or import, and evaluation gate labels are right.
- Pickers for steps that point at something in the workspace.
  - The Agent step's preset is chosen by name from the workspace's agent presets instead of typed
    as an id.
  - MCP tool and MCP prompt steps list the connected servers, then the chosen server's tools or
    prompts; OpenAPI steps list the imported toolsets, then the chosen toolset's operations. A
    list that depends on another field says to choose that one first, and a list that fails to
    load says why and can be refreshed.

## 0.6.0 — 2026-09-29

- Clearer errors, a sharper Guide and smarter Add node.
  - **Config errors in plain words.** `E_CONFIG_INVALID` names the setting by its title, says what it
    expects and what it holds now ("Max steps must be at most 50; it is the number 90") and never
    prints a schema regex. A template placeholder left anywhere in a node's config (such as a
    knowledge source id in a list) is reported once as "Choose the knowledge source…", with a link to
    Knowledge in the builder, instead of a pattern error or a failure at run time.
  - **The Guide** docks beside the page only where there is room (1680px and wider) and floats as a
    card otherwise, so the canvas keeps its width. Collapsible sections, numbered steps, the workflow
    as a timeline, outcomes as chips and settings with their current values.
  - **Add node** suggests the steps likely to come next, each with a reason, and remembers recent
    ones. With a step selected, the new step is placed beside it in free space and connected from its
    first free port (one undo); otherwise it is moved clear of other steps instead of on top of them.
- The Guide: plain-language help on every page, for people who are not technical. **Guide** in the
  top bar (also _Help → Explain this page_ and the command menu) opens a panel beside the page that
  says what the page is for, what to do next and what its words mean. In the builder it tells the
  workflow as a short story and explains any step, writing each rule out as a sentence; after a run,
  the Run result and the run page say what happened in plain words, with how sure each decision was
  and what a person did. It needs no AI model. On wide screens the page makes room for the panel
  instead of sitting under it.
- Docker Compose fixes:
  - The worker image starts again. `zod` was a development-only dependency of the worker, so the
    pruned production image lacked it and the worker and sandbox host crashed at start (0.4.0 and
    0.5.0 images). A repository check now fails when an app's runtime code imports a package that
    is not a runtime dependency.
  - Compose defaults to the same address as `./flowaid`, http://flowaid.localhost:3000, and the api
    and worker also read `.env.local`. `APP_BIND_ADDRESS` publishes web and api on the network
    while the databases stay on loopback.
  - Sign-in explains when the browser drops the session over plain http on a network address,
    and how to fix it (https, or `FLOWAID_ALLOW_INSECURE_HTTP=true` with the public URLs).

## 0.5.0 — 2026-09-29

- Business flows: four complete workflows to start from, each running end to end with only a TypeSafe
  key.
  - **Expense approval** (finance): a policy check, auto-approval under a limit, otherwise a manager
    approval.
  - **Sales lead qualification** (sales): intent, fit and a 0–100 score, routed to sales, nurture,
    support or discard.
  - **IT help desk routing** (IT operations): priority, team and response time, with security
    escalation.
  - **Refund request handling** (customer service): policy, fraud risk and limits, then refund,
    decline or agent review, each with the customer reply.
    They appear first on Templates and on New workflow. Each flow's limits are workflow settings, and a
    new workflow panel (shown when nothing is selected in the builder) renames the workflow, edits its
    description, and edits, adds or removes those settings.
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

The work that led to the first beta, by phase of [the upgrade plan](docs/project/UPGRADE_PLAN.md).

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
