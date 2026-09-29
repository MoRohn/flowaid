---
"@flowaid/api": minor
"@flowaid/web": minor
"@flowaid/worker": minor
"@flowaid/env": minor
"@flowaid/mcp": minor
"@flowaid/workflow-sdk": minor
"@flowaid/cli": minor
---

FlowAId behaves like a desktop application on macOS and Windows alike.

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
