# @flowaid/workflow-compiler

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

- Updated dependencies [d568cf6]
  - @flowaid/workflow-core@0.10.0
  - @flowaid/shared@0.10.0

## 0.9.0

### Minor Changes

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

- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [6b5c535]
  - @flowaid/workflow-core@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- @flowaid/shared@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Patch Changes

- @flowaid/shared@0.7.0
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

- @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/workflow-core@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [0a0ec14]
  - @flowaid/workflow-core@0.4.0
  - @flowaid/shared@0.4.0
