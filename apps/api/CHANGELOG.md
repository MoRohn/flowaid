# @flowaid/api

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
