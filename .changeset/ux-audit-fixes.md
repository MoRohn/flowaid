---
"@flowaid/web": patch
"@flowaid/ui": patch
"@flowaid/api": patch
---

Fixes from a page-by-page audit of the app.

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
