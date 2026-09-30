---
"@flowaid/web": minor
---

Step-by-step guidance on every page in the navigation.

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
