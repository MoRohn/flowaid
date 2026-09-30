# @flowaid/api

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
  - @flowaid/advisor@0.8.0
  - @flowaid/provider-anthropic@0.8.0
  - @flowaid/codegen@0.8.0
  - @flowaid/credentials@0.8.0
  - @flowaid/database@0.8.0
  - @flowaid/env@0.8.0
  - @flowaid/evaluation@0.8.0
  - @flowaid/importer@0.8.0
  - @flowaid/insights@0.8.0
  - @flowaid/knowledge@0.8.0
  - @flowaid/mcp@0.8.0
  - @flowaid/nodes-core@0.8.0
  - @flowaid/observability@0.8.0
  - @flowaid/openapi-tools@0.8.0
  - @flowaid/pageindex@0.8.0
  - @flowaid/plugins@0.8.0
  - @flowaid/provider-ollama@0.8.0
  - @flowaid/provider-openai@0.8.0
  - @flowaid/provider-typesafe@0.8.0
  - @flowaid/providers@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/storage@0.8.0
  - @flowaid/workflow-compiler@0.8.0
  - @flowaid/workflow-core@0.8.0
  - @flowaid/workflow-runtime@0.8.0

## 0.7.0

### Minor Changes

- cf29f2c: More list endpoints are paged. `GET /v1/agents`, `/v1/api-keys`, `/v1/credentials`,
  `/v1/knowledge/sources`, `/v1/notifications`, `/v1/saved-views`, `/v1/workflows/:id/versions` and
  `/v1/workspaces/:id/members` now answer `{ items, next_cursor }` (keyset pagination with `limit`, at
  most 200, and `cursor`) instead of a bare array, like the other lists. Callers that read these
  responses as arrays must read `items` and follow `next_cursor`; the web app reads every page.

### Patch Changes

- cf29f2c: Fixes from a page-by-page audit of the app.

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

- Updated dependencies [cf29f2c]
  - @flowaid/nodes-core@0.7.0
  - @flowaid/codegen@0.7.0
  - @flowaid/advisor@0.7.0
  - @flowaid/credentials@0.7.0
  - @flowaid/database@0.7.0
  - @flowaid/env@0.7.0
  - @flowaid/evaluation@0.7.0
  - @flowaid/importer@0.7.0
  - @flowaid/insights@0.7.0
  - @flowaid/knowledge@0.7.0
  - @flowaid/mcp@0.7.0
  - @flowaid/observability@0.7.0
  - @flowaid/openapi-tools@0.7.0
  - @flowaid/pageindex@0.7.0
  - @flowaid/plugins@0.7.0
  - @flowaid/provider-anthropic@0.7.0
  - @flowaid/provider-ollama@0.7.0
  - @flowaid/provider-openai@0.7.0
  - @flowaid/provider-typesafe@0.7.0
  - @flowaid/providers@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/storage@0.7.0
  - @flowaid/workflow-compiler@0.7.0
  - @flowaid/workflow-core@0.7.0
  - @flowaid/workflow-runtime@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [680d9e3]
- Updated dependencies [e67dd32]
  - @flowaid/workflow-compiler@0.6.0
  - @flowaid/env@0.6.0
  - @flowaid/advisor@0.6.0
  - @flowaid/codegen@0.6.0
  - @flowaid/workflow-runtime@0.6.0
  - @flowaid/credentials@0.6.0
  - @flowaid/database@0.6.0
  - @flowaid/observability@0.6.0
  - @flowaid/evaluation@0.6.0
  - @flowaid/importer@0.6.0
  - @flowaid/insights@0.6.0
  - @flowaid/knowledge@0.6.0
  - @flowaid/mcp@0.6.0
  - @flowaid/nodes-core@0.6.0
  - @flowaid/openapi-tools@0.6.0
  - @flowaid/pageindex@0.6.0
  - @flowaid/plugins@0.6.0
  - @flowaid/provider-anthropic@0.6.0
  - @flowaid/provider-ollama@0.6.0
  - @flowaid/provider-openai@0.6.0
  - @flowaid/provider-typesafe@0.6.0
  - @flowaid/providers@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/storage@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/nodes-core@0.5.0
  - @flowaid/workflow-core@0.5.0
  - @flowaid/advisor@0.5.0
  - @flowaid/codegen@0.5.0
  - @flowaid/credentials@0.5.0
  - @flowaid/database@0.5.0
  - @flowaid/evaluation@0.5.0
  - @flowaid/importer@0.5.0
  - @flowaid/knowledge@0.5.0
  - @flowaid/mcp@0.5.0
  - @flowaid/observability@0.5.0
  - @flowaid/openapi-tools@0.5.0
  - @flowaid/pageindex@0.5.0
  - @flowaid/plugins@0.5.0
  - @flowaid/provider-anthropic@0.5.0
  - @flowaid/provider-ollama@0.5.0
  - @flowaid/provider-openai@0.5.0
  - @flowaid/provider-typesafe@0.5.0
  - @flowaid/providers@0.5.0
  - @flowaid/storage@0.5.0
  - @flowaid/workflow-compiler@0.5.0
  - @flowaid/workflow-runtime@0.5.0
  - @flowaid/env@0.5.0
  - @flowaid/insights@0.5.0
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
- bf0de6e: Local-first by default: on your own computer FlowAId opens without a sign-in (`FLOWAID_AUTH_MODE=auto`
  resolves to `local` when the app's URLs are loopback). The api issues the owner's session only to
  callers on this computer; behind public URLs, and in the compose stack, email and password sign-in
  stays. The web app hides sign-out, members and profile in local mode.
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
- Updated dependencies [614fb1a]
  - @flowaid/env@0.4.0
  - @flowaid/mcp@0.4.0
  - @flowaid/nodes-core@0.4.0
  - @flowaid/pageindex@0.4.0
  - @flowaid/workflow-core@0.4.0
  - @flowaid/advisor@0.4.0
  - @flowaid/insights@0.4.0
  - @flowaid/credentials@0.4.0
  - @flowaid/database@0.4.0
  - @flowaid/workflow-runtime@0.4.0
  - @flowaid/codegen@0.4.0
  - @flowaid/evaluation@0.4.0
  - @flowaid/importer@0.4.0
  - @flowaid/knowledge@0.4.0
  - @flowaid/observability@0.4.0
  - @flowaid/openapi-tools@0.4.0
  - @flowaid/plugins@0.4.0
  - @flowaid/provider-anthropic@0.4.0
  - @flowaid/provider-ollama@0.4.0
  - @flowaid/provider-openai@0.4.0
  - @flowaid/provider-typesafe@0.4.0
  - @flowaid/providers@0.4.0
  - @flowaid/storage@0.4.0
  - @flowaid/workflow-compiler@0.4.0
  - @flowaid/shared@0.4.0
