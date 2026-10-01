# @flowaid/database

## 0.9.1

### Patch Changes

- @flowaid/env@0.9.1
  - @flowaid/shared@0.9.1
  - @flowaid/workflow-core@0.9.1

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

- feb43fe: Security and reliability hardening (P3-3, P3-4, P3-6, P3-7):

  - With `REDIS_URL`, request rate limits, sign-in throttles and the webhook replay cache are kept in Redis, so they hold across api replicas.
  - Migration 0012 gates the row-level-security bypass on membership in the new `flowaid_rls_bypass` role (granted to `flowaid_app` and the owner, never to the sandbox host's `flowaid_code`). A migrating role without `CREATEROLE` needs the role created first (see `docker/postgres-init/01-roles.sql`).
  - Each mutation's audit row is written inside the transaction that makes the change.
  - `flowaid keys rotate-master` (`pnpm keys`, `node dist/keys.js` in the api image) re-wraps every key-encryption key and re-seals every credential under a new master key, verified and resumable.
  - Timers are due by the database clock, not the worker's.

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

- c630951: `RATE_LIMIT_MAX` now sets the per-session request limit as documented, with API keys allowed
  double and unauthenticated requests (webhooks, sign-in) a fifth per address; unset, the limits are
  unchanged (600, 1 200 and 120 a minute). `pnpm loadtest` measures read and end-to-end run capacity
  of a running API, and docs/operations/PERFORMANCE.md records the first results. Migration 0015 can
  run again safely on a database that already has its columns.
- Updated dependencies [b19f9bc]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [c630951]
- Updated dependencies [6b5c535]
  - @flowaid/env@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- @flowaid/env@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Patch Changes

- @flowaid/env@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/workflow-core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [e67dd32]
  - @flowaid/env@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/workflow-core@0.5.0
  - @flowaid/env@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [dff6c83]
- Updated dependencies [bf0de6e]
- Updated dependencies [0a0ec14]
  - @flowaid/env@0.4.0
  - @flowaid/workflow-core@0.4.0
  - @flowaid/shared@0.4.0
