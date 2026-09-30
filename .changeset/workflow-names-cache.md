---
"@flowaid/web": patch
---

Templates, Evaluations, Triggers, Settings and the credential, API key and schedule dialogs no longer
fail with "Could not load this" after visiting Runs or Human tasks. Those two pages kept a
workflow-name lookup under the same cache entry as the workflow list the others read, in a
different shape.
