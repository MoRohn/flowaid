# @flowaid/cli

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
