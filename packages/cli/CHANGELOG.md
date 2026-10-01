# @flowaid/cli

## 0.9.1

### Patch Changes

- @flowaid/importer@0.9.1
  - @flowaid/nodes-core@0.9.1
  - @flowaid/plugins@0.9.1
  - @flowaid/provider-anthropic@0.9.1
  - @flowaid/provider-ollama@0.9.1
  - @flowaid/provider-openai@0.9.1
  - @flowaid/provider-typesafe@0.9.1
  - @flowaid/providers@0.9.1
  - @flowaid/sandbox@0.9.1
  - @flowaid/shared@0.9.1
  - @flowaid/workflow-compiler@0.9.1
  - @flowaid/workflow-core@0.9.1
  - @flowaid/workflow-runtime@0.9.1
  - @flowaid/workflow-sdk@0.9.1

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
- Updated dependencies [d3e7936]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [6b5c535]
  - @flowaid/nodes-core@0.9.0
  - @flowaid/workflow-sdk@0.9.0
  - @flowaid/providers@0.9.0
  - @flowaid/workflow-compiler@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/workflow-runtime@0.9.0
  - @flowaid/provider-anthropic@0.9.0
  - @flowaid/provider-ollama@0.9.0
  - @flowaid/provider-openai@0.9.0
  - @flowaid/provider-typesafe@0.9.0
  - @flowaid/importer@0.9.0
  - @flowaid/plugins@0.9.0
  - @flowaid/sandbox@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Minor Changes

- 6002722: Fill with AI in the builder's Run tab.

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

### Patch Changes

- Updated dependencies [6002722]
  - @flowaid/provider-anthropic@0.8.0
  - @flowaid/workflow-sdk@0.8.0
  - @flowaid/importer@0.8.0
  - @flowaid/nodes-core@0.8.0
  - @flowaid/plugins@0.8.0
  - @flowaid/provider-ollama@0.8.0
  - @flowaid/provider-openai@0.8.0
  - @flowaid/provider-typesafe@0.8.0
  - @flowaid/providers@0.8.0
  - @flowaid/sandbox@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/workflow-compiler@0.8.0
  - @flowaid/workflow-core@0.8.0
  - @flowaid/workflow-runtime@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [cf29f2c]
- Updated dependencies [cf29f2c]
  - @flowaid/workflow-sdk@0.7.0
  - @flowaid/nodes-core@0.7.0
  - @flowaid/importer@0.7.0
  - @flowaid/plugins@0.7.0
  - @flowaid/provider-anthropic@0.7.0
  - @flowaid/provider-ollama@0.7.0
  - @flowaid/provider-openai@0.7.0
  - @flowaid/provider-typesafe@0.7.0
  - @flowaid/providers@0.7.0
  - @flowaid/sandbox@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/workflow-compiler@0.7.0
  - @flowaid/workflow-core@0.7.0
  - @flowaid/workflow-runtime@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [680d9e3]
  - @flowaid/workflow-compiler@0.6.0
  - @flowaid/workflow-runtime@0.6.0
  - @flowaid/importer@0.6.0
  - @flowaid/nodes-core@0.6.0
  - @flowaid/plugins@0.6.0
  - @flowaid/provider-anthropic@0.6.0
  - @flowaid/provider-ollama@0.6.0
  - @flowaid/provider-openai@0.6.0
  - @flowaid/provider-typesafe@0.6.0
  - @flowaid/providers@0.6.0
  - @flowaid/sandbox@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0
  - @flowaid/workflow-sdk@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/nodes-core@0.5.0
  - @flowaid/workflow-core@0.5.0
  - @flowaid/importer@0.5.0
  - @flowaid/plugins@0.5.0
  - @flowaid/provider-anthropic@0.5.0
  - @flowaid/provider-ollama@0.5.0
  - @flowaid/provider-openai@0.5.0
  - @flowaid/provider-typesafe@0.5.0
  - @flowaid/providers@0.5.0
  - @flowaid/sandbox@0.5.0
  - @flowaid/workflow-compiler@0.5.0
  - @flowaid/workflow-runtime@0.5.0
  - @flowaid/workflow-sdk@0.5.0
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

### Patch Changes

- Updated dependencies [dff6c83]
- Updated dependencies [e63b348]
- Updated dependencies [0a0ec14]
  - @flowaid/workflow-sdk@0.4.0
  - @flowaid/nodes-core@0.4.0
  - @flowaid/workflow-core@0.4.0
  - @flowaid/workflow-runtime@0.4.0
  - @flowaid/importer@0.4.0
  - @flowaid/plugins@0.4.0
  - @flowaid/provider-anthropic@0.4.0
  - @flowaid/provider-ollama@0.4.0
  - @flowaid/provider-openai@0.4.0
  - @flowaid/provider-typesafe@0.4.0
  - @flowaid/providers@0.4.0
  - @flowaid/sandbox@0.4.0
  - @flowaid/workflow-compiler@0.4.0
  - @flowaid/shared@0.4.0
