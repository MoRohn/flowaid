---
"@flowaid/web": minor
"@flowaid/ui": minor
"@flowaid/nodes-core": minor
"@flowaid/workflow-core": patch
---

Business flows: four complete workflows to start from, each running end to end with only a TypeSafe
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
