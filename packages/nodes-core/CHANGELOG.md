# @flowaid/nodes-core

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
