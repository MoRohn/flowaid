---
"@flowaid/api": patch
"@flowaid/ui": patch
---

Data-safety fixes. `?purge=false`, `?force=false`, `?archived=false` and the other boolean query
flags now mean false (they meant true). Rotating a credential keeps its fields that are not secret,
such as a username or base URL. Archiving a workflow switches off its webhooks, schedules and MCP
tools and refuses new runs and deploys, as the app promised. A webhook call retried after a refused
delivery now starts a run, and repeats are listed in Deliveries as duplicates. Deleting an
environment revokes the API keys and MCP tokens pinned to it instead of widening them to every
environment, and a delete or rename that can't happen answers 409 with the reason instead of 500.
Redeploying keeps a trigger switched off by hand. Testing a credential type that has no connection
test no longer records "OK". Tall form dialogs (New credential with all fields, Use template)
scroll their body so the submit button stays on screen; before, a click there closed the dialog
and nothing was saved.
