# @flowaid/ui

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
