---
"@flowaid/web": patch
---

Set a workflow's run limits without editing JSON. With no step selected, the builder's panel has an
**Execution** section: how long a run may take (waiting for a person counts), how much it may spend,
and how many steps run at once. The "No cost bound" warning has a **Set a cost limit** action and
the new "a human step can outlive its run" warning a **Set the run time limit** action, each opening
that field.
