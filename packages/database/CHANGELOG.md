# @flowaid/database

## 0.10.0

### Patch Changes

- e8b6267: Signing secrets FlowAId generates for webhooks and notification channels now belong to them
  (migration 0016): they are no longer listed under Credentials, rotating replaces the previous
  secret instead of leaving it behind, and deleting, rotating or editing one from Credentials is
  refused with the webhook or channel named. Existing secrets are matched to their owner. Rotating a
  notification channel's signing secret no longer fails with an internal error.

  A webhook path or MCP tool name that is switched off no longer stays reserved: deploying another
  workflow with it (or exposing another workflow under that tool name) takes it over, and only a
  switched-on one is a conflict.

  Secrets shown once (API keys, MCP tokens, webhook and notification signing secrets) can no longer
  be dismissed by a stray click outside the dialog or by Escape; only "I have copied it" closes it.
  The Rotate credential dialog forgets typed secrets when it is cancelled or opened for another
  credential.

  Deleting a credential now knows everything that uses it: workflow secret bindings, OpenAPI
  toolsets, MCP servers, knowledge sources, webhooks and notification channels
  (`GET /v1/credentials/:id/uses`, also shown in the credential's details). The delete
  confirmation lists those uses with links; an admin can unbind and delete, anyone else is asked to
  give them another credential first. The API refuses the delete (409, uses listed) unless forced.

  A schedule's Run now asks first, naming the environment (and saying when it is protected), then
  offers Open run; the schedule's last run shows the manual run. Rotating a webhook's or
  notification channel's signing secret asks first, since the current secret stops working at once.
  Switches, Send a test and rotation buttons show that they are working and can't be fired twice.

  MCP servers can be edited (name, address or program, sign-in); changing where one runs or how it
  signs in sets it back to Pending. Test and Discover show that they are running, record their
  outcome on the row at once, and name the real cause of a failure. Every refusal of a private or
  local address (MCP servers, OpenAPI documents and tools, notification sends) now says to set
  FLOWAID_ALLOW_PRIVATE_NETWORK=true, instead of "You do not have access".

  OpenAPI toolsets have a Details view: their operations (method, path, what each does), the
  document and server they came from, and a form to rename them or change their credential
  (a taken name is refused with 409 instead of failing).

  Each notification channel has a History (`GET /v1/notifications/:id/deliveries`): the alerts
  and tests sent to it, newest first, with why a send failed. Test sends are now recorded there too.

  The audit log exports the filtered range as CSV or JSON (`GET /v1/audit/export`; formula-like
  CSV fields are defused), offers the resource types it actually holds
  (`GET /v1/audit/resource-types`) instead of a fixed list, and its period now reaches a year or
  all time.

  Saving a shorter run, artifact or audit retention asks first and says what the next nightly
  clean-up will clear; a monthly budget of $0 says that it means no budget.

  Deleting an environment lists what goes with it (deployments, webhooks, schedules, MCP tools,
  secret bindings, credentials limited to it, keys pinned to it; `GET /v1/environments/:id/usage`),
  and one with runs on record says why it can't be deleted before you try. Renaming one warns that
  webhook URLs move with the name, and that renaming dev stops Run draft.

  After adding an unsigned webhook, the next steps no longer ask for a signing secret; the review
  says when a schedule's input will stop it deploying, reads "prod is protected and refuses unsigned
  calls", and unsigned webhooks no longer show a switched-off "Require signed timestamp".

  Smaller fixes: Providers' "Add … credential" opens New credential on that provider's key; an MCP
  client calling a tool with arguments that don't fit gets each problem named, so its model can
  correct the call; an MCP token pinned to a workflow id that doesn't exist is refused.

- d569cf1: Data-safety fixes. `?purge=false`, `?force=false`, `?archived=false` and the other boolean query
  flags now mean false (they meant true). Rotating a credential keeps its fields that are not secret,
  such as a username or base URL. Archiving a workflow switches off its webhooks, schedules and MCP
  tools and refuses new runs and deploys, as the app promised. A webhook call retried after a refused
  delivery now starts a run, and repeats are listed in Deliveries as duplicates. Deleting an
  environment revokes the API keys and MCP tokens pinned to it instead of widening them to every
  environment, and a delete or rename that can't happen answers 409 with the reason instead of 500.
  Redeploying keeps a trigger switched off by hand. Testing a credential type that has no connection
  test no longer records "OK". Tall form dialogs (New credential with all fields, Use template)
  scroll their body so the submit button stays on screen; before, a click there closed the dialog
  and nothing was saved. A recorded replay runs again a step whose output was not stored (privacy "do not persist")
  instead of handing later steps the stored placeholder.
  A workflow's evaluation gate link is cleared by the database when its set is deleted (migration
  0017), and links left pointing at sets deleted earlier are cleared.
- f1ca1b8: Runs, human tasks and the Overview. Many open run pages no longer freeze FlowAId: a run page holds
  its live stream only while the run moves and the tab is visible, checks every 10 seconds while the
  run waits for a person, and falls back to checking with a "Reconnect" button when the stream drops
  or can't connect (six waiting-run tabs used to hold every connection the browser allows, and no
  other page loaded).

  "Retry node" reads as running while the retry runs (the header said Failed), the attempt it
  replaced reads failed instead of staying active for good, and a finished run's "Started" and
  "Ended" times keep counting.

  Runs search and the created range cover every run, not the 50 loaded: `GET /v1/runs` takes `q` (the
  start of a run id, the workflow's name or the error text), `from` and `to`, and the list sends them.
  While older runs exist the count reads "50 runs loaded", an empty result says so and points at
  "Load older runs", and a sort other than newest first says it orders the loaded runs. Version numbers
  come with the runs (`include=version`, combinable as `include=decisions,version`), so the list no
  longer asks for every workflow's versions, and it refreshes every 15 s instead of 3 s while its runs
  only wait for a person.

  "What happened, in plain words" no longer says a person answered when nobody did: a person's step
  closed by a cancelled, timed-out or failed run reads "Nobody answered … before the run was
  cancelled" (or reached its time limit, or failed), and "after 1 minute" is the time the person took,
  not the step's own run time. A step retried in place reads once. A timed-out run gets a banner with
  the limit it reached and a "Workflow settings" button, and its Guide steps no longer send you to a
  failed step and Retry that don't exist.

  Human tasks that closed without an answer are read-only: an expired or cancelled task shows its
  status instead of a countdown, says why it closed (expired, or the run was cancelled, reached its
  time limit or failed), and has no answer buttons, comment box or shortcuts. An answer is sent once:
  the card stays locked after the API accepts it, so a double click or a second A sends nothing, and a
  409 "already answered" reads as done instead of an error. Resolved lists every closed task
  (answered, expired, cancelled) with an outcome filter and a workflow filter; `GET /v1/human-tasks`
  takes several statuses (`status=responded,expired,cancelled`). A closed task's guidance reads
  "About this task" and no longer gives a due time for a cancelled task.

  Answer controls no longer claim a model decided when none did: a choice nobody ranked shows no
  "Model pick", and a value to review reads "Proposed by the workflow" (or "by the step" for a paused
  step) instead of "by the model", in the app and on external review links. On your own computer
  (local mode) the task page drops Escalate and the inbox drops "Assign to me", since there is nobody
  else to hand a task to. The escalation dialog's "Notify now" box, which sent nothing, is gone, and
  the escalation reason is now kept on the audit trail as the dialog says. Assignees read as names
  ("Admins", a member's name) instead of ids.

  Cancelling a run asks first, in the trace header and the runs list's row menu: the confirmation
  says it can't be undone and names the task that will close unanswered, takes an optional reason
  (kept with the run), and offers "Keep running". The run's story ends with the reason.

  The Overview keeps its time range, workflow and environment in the URL (`?range=7d&workflow=…&env=…`),
  so a reload or a shared link shows the same view (7d used to come back as 24h). Open approvals follow
  the environment filter like everything else on the page, the success-rate hint counts timed-out runs
  with the failures, the page and its getting-started checklist share one workflow list, and "Publish
  and deploy" ticks off only once a version is deployed, not just published.

  "Ask someone outside the workspace" says who can open a review link before you send one: only this
  computer when FlowAId runs locally (its web address is on this computer), or only people on your
  network for a private address, with how to change that (FLOWAID_WEB_URL).

- Updated dependencies [d568cf6]
  - @flowaid/workflow-core@0.10.0
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
