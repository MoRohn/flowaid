# @flowaid/env

## 0.8.0

### Patch Changes

- @flowaid/shared@0.8.0

## 0.7.0

### Patch Changes

- @flowaid/shared@0.7.0

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

- @flowaid/shared@0.6.0

## 0.5.0

### Patch Changes

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

- bf0de6e: Local-first by default: on your own computer FlowAId opens without a sign-in (`FLOWAID_AUTH_MODE=auto`
  resolves to `local` when the app's URLs are loopback). The api issues the owner's session only to
  callers on this computer; behind public URLs, and in the compose stack, email and password sign-in
  stays. The web app hides sign-out, members and profile in local mode.

### Patch Changes

- @flowaid/shared@0.4.0
