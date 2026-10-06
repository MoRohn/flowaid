# @flowaid/worker

## 0.10.0

### Patch Changes

- bde0473: Evaluations score a Decision batch step per question. Such a step (the Message triage starter and
  every business template use one) answers several questions, but only one answer reached the
  evaluation, so a case expecting the topic was compared with the yes/no answer. Expectations can now
  name one question (`"triage.topic"`); a case that names only the step is checked against the one
  question that can give the expected value, so existing cases keep their meaning. Add to evaluation
  captures every answer, and accuracy, calibration and confusion are shown per question. A batch step
  with more questions than one request takes now asks them in several batches rather than one by
  one, and answers a person gave are recorded per question too.

  Evaluation reports say what happened. A run with no gate reads "No gate set" (it read "Gate passed
  with warnings") and offers Publish as a secondary action; the Block publish button, which did
  nothing, is gone. Each failed case lists the checks it failed and why. A cancelled or failed
  evaluation says how many of the set's cases ran and that every figure covers only those, and a
  baseline that scored other cases is no longer shown as differences.

  Deleting an evaluation set clears the publish-gate link of the workflows that used it (they kept
  the id of a set that no longer existed), and the confirmation names those workflows.
  `GET /v1/evaluations/sets/:id` lists them as `gateOf`.

  Smaller evaluation fixes: Add to evaluation also offers sets tied to no workflow and will not add
  a run the set already holds; the gate's minimum pass rate is entered in percent, as its text
  speaks of it; a new case's form no longer shows "Fill in the required field" before anything is
  typed; and a set's description ends its sentence in the header.

- Updated dependencies [e8b6267]
- Updated dependencies [d568cf6]
- Updated dependencies [08d7faf]
- Updated dependencies [bde0473]
- Updated dependencies [d569cf1]
- Updated dependencies [f1ca1b8]
  - @flowaid/database@0.10.0
  - @flowaid/observability@0.10.0
  - @flowaid/workflow-core@0.10.0
  - @flowaid/workflow-compiler@0.10.0
  - @flowaid/nodes-core@0.10.0
  - @flowaid/evaluation@0.10.0
  - @flowaid/workflow-runtime@0.10.0
  - @flowaid/codegen@0.10.0
  - @flowaid/credentials@0.10.0
  - @flowaid/knowledge@0.10.0
  - @flowaid/mcp@0.10.0
  - @flowaid/node-sdk@0.10.0
  - @flowaid/nodes-langchain@0.10.0
  - @flowaid/openapi-tools@0.10.0
  - @flowaid/pageindex@0.10.0
  - @flowaid/plugins@0.10.0
  - @flowaid/provider-anthropic@0.10.0
  - @flowaid/provider-ollama@0.10.0
  - @flowaid/provider-openai@0.10.0
  - @flowaid/provider-typesafe@0.10.0
  - @flowaid/providers@0.10.0
  - @flowaid/sandbox@0.10.0
  - @flowaid/storage@0.10.0
  - @flowaid/env@0.10.0
  - @flowaid/shared@0.10.0

## 0.9.0

### Minor Changes

- e401b7b: Built-in agent tools, and agents you can switch on and off.

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

- d3e7936: Evaluation judge checks now run, and schedules catch up and check their input as documented.

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

- 0778a7b: MCP tools that survive deploys, and stdio MCP servers you can test and discover.

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

- 371cb0c: Plugin hosts run under the Node permission model in development too, and plugins reach the
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

- 6b5c535: A key set in the server's environment (TYPESAFE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
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

### Patch Changes

- Updated dependencies [e401b7b]
- Updated dependencies [b19f9bc]
- Updated dependencies [d3e7936]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [371cb0c]
- Updated dependencies [c630951]
- Updated dependencies [6b5c535]
  - @flowaid/nodes-core@0.9.0
  - @flowaid/database@0.9.0
  - @flowaid/credentials@0.9.0
  - @flowaid/env@0.9.0
  - @flowaid/evaluation@0.9.0
  - @flowaid/providers@0.9.0
  - @flowaid/workflow-compiler@0.9.0
  - @flowaid/mcp@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/node-sdk@0.9.0
  - @flowaid/observability@0.9.0
  - @flowaid/codegen@0.9.0
  - @flowaid/workflow-runtime@0.9.0
  - @flowaid/nodes-langchain@0.9.0
  - @flowaid/provider-anthropic@0.9.0
  - @flowaid/provider-ollama@0.9.0
  - @flowaid/provider-openai@0.9.0
  - @flowaid/provider-typesafe@0.9.0
  - @flowaid/knowledge@0.9.0
  - @flowaid/openapi-tools@0.9.0
  - @flowaid/pageindex@0.9.0
  - @flowaid/plugins@0.9.0
  - @flowaid/sandbox@0.9.0
  - @flowaid/storage@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [6002722]
  - @flowaid/provider-anthropic@0.8.0
  - @flowaid/codegen@0.8.0
  - @flowaid/credentials@0.8.0
  - @flowaid/database@0.8.0
  - @flowaid/env@0.8.0
  - @flowaid/evaluation@0.8.0
  - @flowaid/knowledge@0.8.0
  - @flowaid/mcp@0.8.0
  - @flowaid/node-sdk@0.8.0
  - @flowaid/nodes-core@0.8.0
  - @flowaid/nodes-langchain@0.8.0
  - @flowaid/observability@0.8.0
  - @flowaid/openapi-tools@0.8.0
  - @flowaid/pageindex@0.8.0
  - @flowaid/plugins@0.8.0
  - @flowaid/provider-ollama@0.8.0
  - @flowaid/provider-openai@0.8.0
  - @flowaid/provider-typesafe@0.8.0
  - @flowaid/providers@0.8.0
  - @flowaid/sandbox@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/storage@0.8.0
  - @flowaid/workflow-compiler@0.8.0
  - @flowaid/workflow-core@0.8.0
  - @flowaid/workflow-runtime@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [cf29f2c]
  - @flowaid/nodes-core@0.7.0
  - @flowaid/codegen@0.7.0
  - @flowaid/credentials@0.7.0
  - @flowaid/database@0.7.0
  - @flowaid/env@0.7.0
  - @flowaid/evaluation@0.7.0
  - @flowaid/knowledge@0.7.0
  - @flowaid/mcp@0.7.0
  - @flowaid/node-sdk@0.7.0
  - @flowaid/nodes-langchain@0.7.0
  - @flowaid/observability@0.7.0
  - @flowaid/openapi-tools@0.7.0
  - @flowaid/pageindex@0.7.0
  - @flowaid/plugins@0.7.0
  - @flowaid/provider-anthropic@0.7.0
  - @flowaid/provider-ollama@0.7.0
  - @flowaid/provider-openai@0.7.0
  - @flowaid/provider-typesafe@0.7.0
  - @flowaid/providers@0.7.0
  - @flowaid/sandbox@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/storage@0.7.0
  - @flowaid/workflow-compiler@0.7.0
  - @flowaid/workflow-core@0.7.0
  - @flowaid/workflow-runtime@0.7.0

## 0.6.0

### Patch Changes

- e67dd32: Docker Compose fixes:

  - The worker image starts again. `zod` was a development-only dependency of the worker, so the
    pruned production image lacked it and the worker and sandbox host crashed at start (0.4.0 and
    0.5.0 images). A repository check now fails when an app's runtime code imports a package that
    is not a runtime dependency.
  - Compose defaults to the same address as `./flowaid`, http://flowaid.localhost:3000, and the api
    and worker also read `.env.local`. `APP_BIND_ADDRESS` publishes web and api on the network
    while the databases stay on loopback.
  - Sign-in explains when the browser drops the session over plain http on a network address,
    and how to fix it (https, or `FLOWAID_ALLOW_INSECURE_HTTP=true` with the public URLs).

- Updated dependencies [680d9e3]
- Updated dependencies [e67dd32]
  - @flowaid/workflow-compiler@0.6.0
  - @flowaid/env@0.6.0
  - @flowaid/codegen@0.6.0
  - @flowaid/workflow-runtime@0.6.0
  - @flowaid/credentials@0.6.0
  - @flowaid/database@0.6.0
  - @flowaid/observability@0.6.0
  - @flowaid/evaluation@0.6.0
  - @flowaid/knowledge@0.6.0
  - @flowaid/mcp@0.6.0
  - @flowaid/node-sdk@0.6.0
  - @flowaid/nodes-core@0.6.0
  - @flowaid/nodes-langchain@0.6.0
  - @flowaid/openapi-tools@0.6.0
  - @flowaid/pageindex@0.6.0
  - @flowaid/plugins@0.6.0
  - @flowaid/provider-anthropic@0.6.0
  - @flowaid/provider-ollama@0.6.0
  - @flowaid/provider-openai@0.6.0
  - @flowaid/provider-typesafe@0.6.0
  - @flowaid/providers@0.6.0
  - @flowaid/sandbox@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/storage@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/nodes-core@0.5.0
  - @flowaid/workflow-core@0.5.0
  - @flowaid/codegen@0.5.0
  - @flowaid/credentials@0.5.0
  - @flowaid/database@0.5.0
  - @flowaid/evaluation@0.5.0
  - @flowaid/knowledge@0.5.0
  - @flowaid/mcp@0.5.0
  - @flowaid/node-sdk@0.5.0
  - @flowaid/nodes-langchain@0.5.0
  - @flowaid/observability@0.5.0
  - @flowaid/openapi-tools@0.5.0
  - @flowaid/pageindex@0.5.0
  - @flowaid/plugins@0.5.0
  - @flowaid/provider-anthropic@0.5.0
  - @flowaid/provider-ollama@0.5.0
  - @flowaid/provider-openai@0.5.0
  - @flowaid/provider-typesafe@0.5.0
  - @flowaid/providers@0.5.0
  - @flowaid/sandbox@0.5.0
  - @flowaid/storage@0.5.0
  - @flowaid/workflow-compiler@0.5.0
  - @flowaid/workflow-runtime@0.5.0
  - @flowaid/env@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Minor Changes

- dff6c83: FlowAId behaves like a desktop application on macOS and Windows alike.

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

- e63b348: The first public beta of FlowAId: typed workflows compiled into content-hashed plans and run on an
  event-sourced runtime, TypeSafe Jev decisions with calibrated probabilities, human review,
  evaluations with a publish gate, model routing and failover, agents, knowledge bases, plugins,
  triggers, observability and alerts, the FlowAId importer, code export, and published container
  images for the api, the worker and the web app.
- 0a0ec14: PageIndex document intelligence: PageIndex knowledge sources index uploaded PDFs into section
  trees with the pinned PageIndex SDK (a private Python service, `./flowaid --pageindex` or the
  compose `pageindex` profile), versioned and deduplicated per file. The new nodes
  `flowaid.pageindex.index`, `.retrieve` (TypeSafe Jev navigates the tree) and `.cite` (every
  citation checked against the page text), document tools for agents, three templates, a source
  page with outline, source viewer and test panel, and `pnpm eval:pageindex` (RFC-0022). Also:
  the web app opens at http://flowaid.localhost:3000 (API on 3001), `./flowaid` starts everything,
  local Ollama works without opening the private network, and upgraded installs receive new
  built-in templates.
- 614fb1a: FlowAId V2: what needs you, what changed, and why. The Overview opens with "Needs attention"
  (open approvals, workflows with failed runs) and "What changed" (statistically tested regressions
  per workflow in failure rate, latency, cost and decision confidence, and new error codes, with
  their evidence and the version they coincide with; `GET /v1/insights`). Ask FlowAId answers
  questions about the workspace from read-only lookups, typing each statement as a fact,
  calculation, suggestion or unconfirmed and linking the records it cites
  (`POST /v1/assistant/ask`, `pnpm eval:assistant`). Streamed generations are priced, metrics count
  production traffic by default, the retention sweep runs, runs no longer hang in Redis mode, and
  local mode stays on loopback.

### Patch Changes

- Updated dependencies [dff6c83]
- Updated dependencies [bf0de6e]
- Updated dependencies [0a0ec14]
  - @flowaid/env@0.4.0
  - @flowaid/mcp@0.4.0
  - @flowaid/nodes-core@0.4.0
  - @flowaid/pageindex@0.4.0
  - @flowaid/workflow-core@0.4.0
  - @flowaid/credentials@0.4.0
  - @flowaid/database@0.4.0
  - @flowaid/workflow-runtime@0.4.0
  - @flowaid/codegen@0.4.0
  - @flowaid/evaluation@0.4.0
  - @flowaid/knowledge@0.4.0
  - @flowaid/node-sdk@0.4.0
  - @flowaid/nodes-langchain@0.4.0
  - @flowaid/observability@0.4.0
  - @flowaid/openapi-tools@0.4.0
  - @flowaid/plugins@0.4.0
  - @flowaid/provider-anthropic@0.4.0
  - @flowaid/provider-ollama@0.4.0
  - @flowaid/provider-openai@0.4.0
  - @flowaid/provider-typesafe@0.4.0
  - @flowaid/providers@0.4.0
  - @flowaid/sandbox@0.4.0
  - @flowaid/storage@0.4.0
  - @flowaid/workflow-compiler@0.4.0
  - @flowaid/shared@0.4.0
