# @flowaid/web

## 0.10.0

### Minor Changes

- 02d9ec0: Download code from the app. The builder's ⋯ menu, the command menu (⌘K) and every row of the
  Versions page now offer **Download code**: choose the version or the current draft, whether the
  package carries the FlowAId runtime packages or lists them from npm, and whether the last successful
  run supplies its sample input and a recorded run for its tests. The dialog follows the build and
  saves the zip; a draft with problems lists them instead. The Versions row menu also downloads the
  workflow as a single TypeScript file. `ExportDialog` is exported from `@flowaid/ui/builder`, and
  `TopBar` takes `onDownloadCode`.

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

- cde7d83: Compare's Promote, Rollback and Open keep the version you chose. Deployments now says which version
  you chose, and every environment's button reads "Deploy v2" and starts on it; a deployed environment
  also says when a newer version exists. Open on Compare marks that version's row on the Versions
  page and scrolls to it.
- 33ad20d: Builder details. The description you give a new workflow now shows in the builder too. Typing in a
  step's setting undoes as one change instead of one character at a time. A Branch added after a
  yes/no decision routes on its answer instead of always taking "yes", and a Branch condition offers
  the earlier steps' outputs as you type. Publishing no longer clears the run you were looking at,
  and its toast offers **Deploy** for the new version. The header menu says "Duplicate workflow"
  (⌘D on the canvas duplicates steps), canvas edges have names that tell a control edge from a data
  edge, and a workflow whose only key is optional (a TypeSafe step's) no longer reads "none of this
  workflow's do yet".
- 6b52e97: Set a workflow's run limits without editing JSON. With no step selected, the builder's panel has an
  **Execution** section: how long a run may take (waiting for a person counts), how much it may spend,
  and how many steps run at once. The "No cost bound" warning has a **Set a cost limit** action and
  the new "a human step can outlive its run" warning a **Set the run time limit** action, each opening
  that field.
- 3e10b2a: A failed draft run names the step and shows it failed. The builder stopped following a run as soon
  as its record said it ended, sometimes before the events that say which step failed had been read:
  the step kept showing Running and the Output tab could not name it or its message. The builder now
  reads the run until its end is in, and settles any step still in progress against the run's error.
  Developer steps such as Assert and Log draw as ordinary steps instead of an empty code card.
- d0bea6b: Expression fields offer references. A step setting written in FlowExpr (a Transform's expression,
  an Assert's condition, a Filter's predicate) was a "JavaScript" code box with no help. It is now an
  expression editor: typing a step's id and a dot offers its outputs, `$vars.` the workflow settings,
  and every function with its arguments; a reference the step cannot read is underlined with what to
  write instead, and a syntax error shows under the field. `FlowExprEditor`, `flowExprCompletions`
  and `checkExpression` are exported from `@flowaid/ui/forms`.
- f4c66e8: New steps start without errors you did not cause. Adding a Boolean, Validator, Mock, Knowledge
  base, Policy check, Text splitter or a LangChain step used to save empty stubs for its optional
  settings (a Boolean's criteria, a Mock's failure, a reranker), which showed errors at once, came
  back after every edit and could make a Mock fail every run. Optional settings are now saved only
  once you fill them in, and clearing one removes it. The Problems list also matches the server's
  after you clear an optional field, instead of showing a spurious "Invalid input".
- 5714b7b: Quick add connects the new step and keeps it in view. With nothing selected, the palette suggests
  steps "after" the last one, but a pick used to land unconnected and often off-screen; it now follows
  that step (beside it, or where you right-clicked) and the canvas pans to it when it is out of sight.
  `FlowCanvas`'s `onAddNode` also says whether the palette opened at the pointer or in the view.
- 80bc244: The builder no longer loses an edit made just before you leave it. Clicking a tab, the sidebar or
  a breadcrumb within a second of an edit used to drop that edit silently; the builder now sends it
  on the way out, opens on it when you come back, and tells you if the save was refused. Two quick
  saves (⌘S twice) send one request after the other instead of colliding. Options in the Add node
  palette can be clicked again: a click used to close the palette and add nothing.
- 22c2907: The Workflows grid says when a search matches nothing, as the list does, and both offer **Clear the
  search**. `WorkflowsBrowser` takes an `emptyState` shown in either view.
- 08d7faf: Editing an agent keeps the settings the form doesn't show: temperature, max output tokens, the
  token cap and streaming set through the API or CLI were dropped by the first edit in the app. They
  now have their own "Advanced" group under Limits, and any other stored setting is saved back
  unchanged. A tool an agent lists that the workspace no longer offers (an MCP server removed, a tool
  renamed) is shown under "No longer available" in Tools, where it can be unchecked; Review names it
  and saving waits until it is removed, and the agent's card marks it, since every run would fail.

  Smaller agent fixes: Review warns when Max cost is $0 or Max tool calls is 0 with tools chosen
  (both stop the agent where it starts), and the hints say what 0 means. A chosen tool's approval
  choice no longer squeezes the tool's name, Edit no longer promises to keep changes across pages
  (its links open a new tab, with a way to refresh the tool list), the card shows "approval" only
  for tools that really wait for a person, its buttons and switch are named after the agent, and
  "ready to use" says the agent is in Add node under its own name.

  An agent's Max steps reaches the steps that use it. Adding an agent from Add node copied its Max
  steps onto the step (and the Agent step filled in 8 when it had none), so raising it on the agent
  changed nothing. A step that uses an agent now leaves Max steps unset unless it sets its own, and
  the compiler accepts that for a step with an agent. Steps added before keep the value they have;
  clear it in the step's settings to use the agent's.

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

- 7e289e3: Knowledge sources can be changed after they are created. The source page has a Settings button
  that opens the New source steps on the saved values: rename it, change its addresses, repository
  or token, its search (switch to keywords only when the embedding model has no key) and its
  chunking, or a PageIndex source's indexing model. Saving asks first when the change indexes every
  document again or fetches them again, and keeps settings the form doesn't show.

  A PageIndex source reads consistently when the PageIndex service is turned off: one notice says it
  is off and how to turn it on, the documents it holds are listed (the list no longer needs the
  service), and uploads, document actions and Try a question are not offered. Before, the banner
  said the service was not answering, the table failed to load and Try a question said nothing was
  indexed.

  Knowledge details: removing the last failed document of an upload source takes it out of Error
  (it stayed in Error over an empty table); keyword-only sources no longer mark every chunk "not
  embedded"; a missing embedding key reads as what to do about it; Add documents names files it
  could not read or that hold no text, and refuses an upload larger than one request takes, instead
  of failing silently; and an empty upload source is no longer polled every few seconds.

- e86eeb3: Use template picks the knowledge source a template reads. Document Q&A, the PageIndex agent and
  compare templates, and GitHub issue triage with a knowledge base now offer the workspace's sources
  of the kind they read (PageIndex PDFs, or chunked documents) and send the choice with the create,
  so the copy no longer opens with an unresolved placeholder. A card counts only sources of the right
  kind as ready and says when PageIndex is turned off. Template search covers the business flows too:
  searching "expense" finds Expense approval instead of "No templates match". Pressing Enter in the
  name field no longer creates the workflow before Review.
- cd266b1: Starting FlowAId while it is already running finds it at once on every platform: the second start
  asks the running launcher's control channel instead of a slow Windows process query, which could
  take over a minute on a busy machine. A start that stops processes an earlier FlowAId left behind
  now waits for their ports to be released before checking them.
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

- 4c6b15e: The automated accessibility checks now cover every page in the navigation (Overview, Agents,
  Triggers and Knowledge were missing), the command menu, the Guide, the collapsed navigation and an
  open dialog, and check with the keyboard that focus comes back after a dialog closes, that the
  Guide can be left with Tab and that the `g` shortcuts work.
- 98cebd3: Smaller accessibility fixes. The Light / Dark / System theme choice in the navigation is one Tab
  stop and the arrow keys move between the options and choose. Hiding or reopening "Start here"
  keeps keyboard focus on its button instead of dropping it to the top of the page. Error messages
  in toasts stay on screen, with a close button, until you dismiss them; other toasts still go after
  a few seconds.

  The builder and the human task page have a page heading for screen readers.

- 1db7a51: ⌘K is easier to reach and does what you expect. A Search button in the top bar opens it (an icon
  on phones), so it no longer needs a keyboard. Typed text picks the best match across all groups:
  "runs" goes to the Runs page instead of the first loose match, and Ask FlowAId is always listed
  last, so Enter only sends a question when nothing else matches. Pages come right after things to
  create, the templates list shows five with a link to the rest, the actions group is called
  Actions, and the placeholder fits. List pages show one filled button: the header's create button
  (now filled on Workflows and Agents too), with the empty state below repeating it as an outlined
  button.
- fbe8a51: On laptops the open Guide sits beside the page from 1280 px wide instead of floating over it, so it
  no longer covers buttons such as New workflow or the right-hand table columns. On the builder's
  canvas it still docks only from 1680 px, so the canvas keeps its width.
- ad09e3b: The Guide is a side panel you can Tab past: keyboard focus no longer cycles inside it, Shift+Tab
  from its first control goes back to the page, and screen readers announce it as a complementary
  region instead of a dialog. Escape or its close button closes it and puts focus back on the Guide
  button in the top bar.
- 8d2cd09: Pages load about 150 KB (gzip) less JavaScript: the code and template editors fetch CodeMirror
  only when one appears, instead of every list page, every workflow page and the external review
  page loading it up front (Agents 654 → 503 KB, Templates 650 → 498 KB, `/review` 700 → 541 KB, the
  builder 1,650 → 1,491 KB). While it loads, a box of the editor's size holds its place.
  `CodeEditor`, `ExpressionInput`, `ExpressionTextarea`, `TemplateEditor` and `TemplateInput` keep
  their props and refs; `preloadCodeEditors()` fetches them ahead of time. `EMPTY_SCOPE` is also
  exported from the CodeMirror-free expression helpers.
- a3080f3: The navigation shortcuts shown in the collapsed nav's tooltips and in ⌘K work: `g o` Overview,
  `g w` Workflows, `g a` Agents, `g r` Runs, `g h` Human tasks and `g s` Settings. They are listed
  under Navigate in the keyboard shortcuts dialog (`?`), stay quiet while you type in a field, and a
  page your workspace does not have registers none.
- ddaf61f: Wrong links and an unreachable API get real pages. A path no page answers shows "This page does
  not exist" inside the usual frame, with links back into the workspace, instead of a bare 404. A
  link whose id is malformed (`/runs/not-a-uuid`) says Not found and links back to its list instead
  of "request params is invalid" with a Try again that could not help; missing knowledge sources and
  evaluation sets link back too. A workspace that does not exist says so and offers the same page in
  your workspaces instead of silently opening another one. When FlowAId's API cannot be reached, the
  page says so, explains how to start FlowAId again, and opens by itself once the API answers.
  Not-found and error pages have a heading. `EmptyState` takes `titleAs` to make its title a
  heading.
- bf019e0: Pages no longer jump while they load. "Start here" keeps the shape it had on your last visit until
  the page's data arrives instead of opening and then folding away, and the Overview holds the
  getting-started checklist's place while its steps load. On phones "Start here" starts as one line,
  so the page's own content fills the first screen; opening it by hand is remembered as before.
- Updated dependencies [e8b6267]
- Updated dependencies [33ad20d]
- Updated dependencies [02d9ec0]
- Updated dependencies [3e10b2a]
- Updated dependencies [d0bea6b]
- Updated dependencies [d568cf6]
- Updated dependencies [f4c66e8]
- Updated dependencies [7861a72]
- Updated dependencies [5714b7b]
- Updated dependencies [80bc244]
- Updated dependencies [22c2907]
- Updated dependencies [08d7faf]
- Updated dependencies [bde0473]
- Updated dependencies [d569cf1]
- Updated dependencies [f1ca1b8]
- Updated dependencies [98cebd3]
- Updated dependencies [1db7a51]
- Updated dependencies [752387a]
- Updated dependencies [bf367cc]
- Updated dependencies [8d2cd09]
- Updated dependencies [ddaf61f]
- Updated dependencies [fc5fb9e]
  - @flowaid/ui@0.10.0
  - @flowaid/workflow-core@0.10.0
  - @flowaid/workflow-compiler@0.10.0
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

- Updated dependencies [d3e7936]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [6b5c535]
  - @flowaid/workflow-compiler@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/ui@0.9.0
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

- 2f60ab0: Templates, Evaluations, Triggers, Settings and the credential, API key and schedule dialogs no longer
  fail with "Could not load this" after visiting Runs or Human tasks. Those two pages kept a
  workflow-name lookup under the same cache entry as the workflow list the others read, in a
  different shape.
- Updated dependencies [6002722]
  - @flowaid/ui@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/workflow-compiler@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Minor Changes

- e130d8b: Clearer step settings in the builder.

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

- cf29f2c: Step-by-step guidance on every page in the navigation.

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

- cf29f2c: Pickers for steps that point at something in the workspace.

  - The Agent step's preset is chosen by name from the workspace's agent presets instead of typed
    as an id.
  - MCP tool and MCP prompt steps list the connected servers, then the chosen server's tools or
    prompts; OpenAPI steps list the imported toolsets, then the chosen toolset's operations. A
    list that depends on another field says to choose that one first, and a list that fails to
    load says why and can be refreshed.

### Patch Changes

- cf29f2c: More list endpoints are paged. `GET /v1/agents`, `/v1/api-keys`, `/v1/credentials`,
  `/v1/knowledge/sources`, `/v1/notifications`, `/v1/saved-views`, `/v1/workflows/:id/versions` and
  `/v1/workspaces/:id/members` now answer `{ items, next_cursor }` (keyset pagination with `limit`, at
  most 200, and `cursor`) instead of a bare array, like the other lists. Callers that read these
  responses as arrays must read `items` and follow `next_cursor`; the web app reads every page.
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

- Updated dependencies [e130d8b]
- Updated dependencies [cf29f2c]
  - @flowaid/ui@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/workflow-compiler@0.7.0
  - @flowaid/workflow-core@0.7.0

## 0.6.0

### Minor Changes

- 680d9e3: Clearer errors, a sharper Guide and smarter Add node.

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

- 9a27593: The Guide: plain-language help on every page, for people who are not technical. **Guide** in the
  top bar (also _Help → Explain this page_ and the command menu) opens a panel beside the page that
  says what the page is for, what to do next and what its words mean. In the builder it tells the
  workflow as a short story and explains any step, writing each rule out as a sentence; after a run,
  the Run result and the run page say what happened in plain words, with how sure each decision was
  and what a person did. It needs no AI model. On wide screens the page makes room for the panel
  instead of sitting under it.

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
- Updated dependencies [9a27593]
  - @flowaid/workflow-compiler@0.6.0
  - @flowaid/ui@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Minor Changes

- 859e8fc: Business flows: four complete workflows to start from, each running end to end with only a TypeSafe
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

- 702ab83: A first run that works, and says why when it does not. A new starter template, Message triage,
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

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/ui@0.5.0
  - @flowaid/workflow-core@0.5.0
  - @flowaid/workflow-compiler@0.5.0
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
- a929b56: A guided first run and clearer flows everywhere: a getting-started checklist on the Overview, a
  workspace command menu (search, create, jump), a help menu, adding webhooks and schedules from the
  app, credential guidance with a connection test, knowledge sources that pick a ready embedding
  model, evaluation cases as forms, a lane-routed graph layout that opens legibly, failed runs with
  "Retry node", and follow-through after answering a human task.
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

- Updated dependencies [0a0ec14]
- Updated dependencies [a929b56]
  - @flowaid/workflow-core@0.4.0
  - @flowaid/ui@0.4.0
  - @flowaid/workflow-compiler@0.4.0
  - @flowaid/shared@0.4.0
