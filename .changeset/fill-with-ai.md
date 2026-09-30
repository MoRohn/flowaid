---
"@flowaid/web": minor
"@flowaid/api": minor
"@flowaid/advisor": minor
"@flowaid/ui": patch
"@flowaid/provider-anthropic": patch
"@flowaid/cli": minor
"@flowaid/workflow-sdk": minor
---

Fill with AI in the builder's Run tab.

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
