---
"@flowaid/workflow-core": minor
"@flowaid/workflow-compiler": patch
"@flowaid/nodes-core": patch
---

A human step that can outlive its run is flagged. A run's time limit counts the time it waits for a
person, so an approval that may stay open longer than the run (or has no expiry at all) was
cancelled with the run while its card still promised the full time. The compiler now warns with
`W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT` (RFC-0023) and names both durations. The Support triage
template's run limit is now 3 hours, so its 2-hour approval stays open as promised.
