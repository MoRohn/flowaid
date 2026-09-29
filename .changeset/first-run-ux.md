---
"@flowaid/web": minor
"@flowaid/ui": minor
"@flowaid/nodes-core": minor
"@flowaid/workflow-core": patch
---

A first run that works, and says why when it does not. A new starter template, Message triage,
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
