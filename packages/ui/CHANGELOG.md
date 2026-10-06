# @flowaid/ui

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

- 33ad20d: Builder details. The description you give a new workflow now shows in the builder too. Typing in a
  step's setting undoes as one change instead of one character at a time. A Branch added after a
  yes/no decision routes on its answer instead of always taking "yes", and a Branch condition offers
  the earlier steps' outputs as you type. Publishing no longer clears the run you were looking at,
  and its toast offers **Deploy** for the new version. The header menu says "Duplicate workflow"
  (⌘D on the canvas duplicates steps), canvas edges have names that tell a control edge from a data
  edge, and a workflow whose only key is optional (a TypeSafe step's) no longer reads "none of this
  workflow's do yet".
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
- 7861a72: Data edges leave the Input step from its handles again. The start and end pills declared handle
  positions that replaced the canvas's measurement on every update, so edges from Input started at the
  pill's left edge; pills are now measured, and measured again when their ports change. Dragging a
  connection over a pill no longer logs an unknown `handleReasons` prop, and a refused handle on a
  pill says why, as it does on other steps.
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
- 752387a: Confirmations for destructive actions (delete, revoke, Quit FlowAId) open with Cancel focused and
  are announced as alerts, so pressing Enter by habit cancels instead of deleting or stopping
  FlowAId. Other confirmations still open on their confirm button.
- bf367cc: Closing a dialog, side sheet or confirmation puts keyboard focus back on the control that opened
  it, also when a menu item, a ⌘K command or a button that is not the dialog's own trigger opened
  it. Before, focus fell to the top of the page after the navigation drawer, Quit FlowAId, Publish,
  Add webhook and other dialogs opened from menus.
- 8d2cd09: Pages load about 150 KB (gzip) less JavaScript: the code and template editors fetch CodeMirror
  only when one appears, instead of every list page, every workflow page and the external review
  page loading it up front (Agents 654 → 503 KB, Templates 650 → 498 KB, `/review` 700 → 541 KB, the
  builder 1,650 → 1,491 KB). While it loads, a box of the editor's size holds its place.
  `CodeEditor`, `ExpressionInput`, `ExpressionTextarea`, `TemplateEditor` and `TemplateInput` keep
  their props and refs; `preloadCodeEditors()` fetches them ahead of time. `EMPTY_SCOPE` is also
  exported from the CodeMirror-free expression helpers.
- ddaf61f: Wrong links and an unreachable API get real pages. A path no page answers shows "This page does
  not exist" inside the usual frame, with links back into the workspace, instead of a bare 404. A
  link whose id is malformed (`/runs/not-a-uuid`) says Not found and links back to its list instead
  of "request params is invalid" with a Try again that could not help; missing knowledge sources and
  evaluation sets link back too. A workspace that does not exist says so and offers the same page in
  your workspaces instead of silently opening another one. When FlowAId's API cannot be reached, the
  page says so, explains how to start FlowAId again, and opens by itself once the API answers.
  Not-found and error pages have a heading. `EmptyState` takes `titleAs` to make its title a
  heading.
- fc5fb9e: The workspace switcher opens from the collapsed navigation rail again, by mouse, Enter or Space.
  `Tooltip` now passes any other props and its ref to the trigger, so it can sit inside another
  `asChild` trigger such as a menu button; its ref now points at the trigger instead of the tooltip
  bubble (nothing used the old target).
- Updated dependencies [d568cf6]
  - @flowaid/workflow-core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [6b5c535]
  - @flowaid/workflow-core@0.9.0

## 0.8.0

### Patch Changes

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

### Patch Changes

- 9a27593: The Guide: plain-language help on every page, for people who are not technical. **Guide** in the
  top bar (also _Help → Explain this page_ and the command menu) opens a panel beside the page that
  says what the page is for, what to do next and what its words mean. In the builder it tells the
  workflow as a short story and explains any step, writing each rule out as a sentence; after a run,
  the Run result and the run page say what happened in plain words, with how sure each decision was
  and what a person did. It needs no AI model. On wide screens the page makes room for the panel
  instead of sitting under it.
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
  - @flowaid/workflow-core@0.5.0

## 0.4.0

### Minor Changes

- a929b56: A guided first run and clearer flows everywhere: a getting-started checklist on the Overview, a
  workspace command menu (search, create, jump), a help menu, adding webhooks and schedules from the
  app, credential guidance with a connection test, knowledge sources that pick a ready embedding
  model, evaluation cases as forms, a lane-routed graph layout that opens legibly, failed runs with
  "Retry node", and follow-through after answering a human task.

### Patch Changes

- Updated dependencies [0a0ec14]
  - @flowaid/workflow-core@0.4.0
