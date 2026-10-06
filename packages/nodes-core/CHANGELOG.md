# @flowaid/nodes-core

## 0.10.0

### Patch Changes

- d568cf6: A human step that can outlive its run is flagged. A run's time limit counts the time it waits for a
  person, so an approval that may stay open longer than the run (or has no expiry at all) was
  cancelled with the run while its card still promised the full time. The compiler now warns with
  `W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT` (RFC-0023) and names both durations. The Support triage
  template's run limit is now 3 hours, so its 2-hour approval stays open as promised.
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

- Updated dependencies [d568cf6]
  - @flowaid/workflow-core@0.10.0
  - @flowaid/knowledge@0.10.0
  - @flowaid/mcp@0.10.0
  - @flowaid/node-sdk@0.10.0
  - @flowaid/pageindex@0.10.0
  - @flowaid/providers@0.10.0
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

### Patch Changes

- Updated dependencies [d3e7936]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [371cb0c]
- Updated dependencies [6b5c535]
  - @flowaid/providers@0.9.0
  - @flowaid/mcp@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/node-sdk@0.9.0
  - @flowaid/knowledge@0.9.0
  - @flowaid/pageindex@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- @flowaid/knowledge@0.8.0
  - @flowaid/mcp@0.8.0
  - @flowaid/node-sdk@0.8.0
  - @flowaid/pageindex@0.8.0
  - @flowaid/providers@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Minor Changes

- cf29f2c: Pickers for steps that point at something in the workspace.

  - The Agent step's preset is chosen by name from the workspace's agent presets instead of typed
    as an id.
  - MCP tool and MCP prompt steps list the connected servers, then the chosen server's tools or
    prompts; OpenAPI steps list the imported toolsets, then the chosen toolset's operations. A
    list that depends on another field says to choose that one first, and a list that fails to
    load says why and can be refreshed.

### Patch Changes

- @flowaid/knowledge@0.7.0
  - @flowaid/mcp@0.7.0
  - @flowaid/node-sdk@0.7.0
  - @flowaid/pageindex@0.7.0
  - @flowaid/providers@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/workflow-core@0.7.0

## 0.6.0

### Patch Changes

- @flowaid/knowledge@0.6.0
  - @flowaid/mcp@0.6.0
  - @flowaid/node-sdk@0.6.0
  - @flowaid/pageindex@0.6.0
  - @flowaid/providers@0.6.0
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
  - @flowaid/workflow-core@0.5.0
  - @flowaid/knowledge@0.5.0
  - @flowaid/mcp@0.5.0
  - @flowaid/node-sdk@0.5.0
  - @flowaid/pageindex@0.5.0
  - @flowaid/providers@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Minor Changes

- 0a0ec14: PageIndex document intelligence: PageIndex knowledge sources index uploaded PDFs into section
  trees with the pinned PageIndex SDK (a private Python service, `./flowaid --pageindex` or the
  compose `pageindex` profile), versioned and deduplicated per file. The new nodes
  `flowaid.pageindex.index`, `.retrieve` (TypeSafe Jev navigates the tree) and `.cite` (every
  citation checked against the page text), document tools for agents, three templates, a source
  page with outline, source viewer and test panel, and `pnpm eval:pageindex` (RFC-0022). Also:
  the web app opens at http://flowaid.localhost:3000 (API on 3001), `./flowaid` starts everything,
  local Ollama works without opening the private network, and upgraded installs receive new
  built-in templates.

### Patch Changes

- Updated dependencies [dff6c83]
- Updated dependencies [0a0ec14]
  - @flowaid/mcp@0.4.0
  - @flowaid/pageindex@0.4.0
  - @flowaid/workflow-core@0.4.0
  - @flowaid/knowledge@0.4.0
  - @flowaid/node-sdk@0.4.0
  - @flowaid/providers@0.4.0
  - @flowaid/shared@0.4.0
