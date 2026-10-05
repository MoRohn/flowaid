---
"@flowaid/web": patch
"@flowaid/api": patch
"@flowaid/database": patch
"@flowaid/ui": patch
"@flowaid/cli": patch
"@flowaid/workflow-sdk": patch
---

Signing secrets FlowAId generates for webhooks and notification channels now belong to them
(migration 0016): they are no longer listed under Credentials, rotating replaces the previous
secret instead of leaving it behind, and deleting, rotating or editing one from Credentials is
refused with the webhook or channel named. Existing secrets are matched to their owner. Rotating a
notification channel's signing secret no longer fails with an internal error.

A webhook path or MCP tool name that is switched off no longer stays reserved: deploying another
workflow with it (or exposing another workflow under that tool name) takes it over, and only a
switched-on one is a conflict.

Secrets shown once (API keys, MCP tokens, webhook and notification signing secrets) can no longer
be dismissed by a stray click outside the dialog or by Escape; only "I have copied it" closes it.
The Rotate credential dialog forgets typed secrets when it is cancelled or opened for another
credential.

Deleting a credential now knows everything that uses it: workflow secret bindings, OpenAPI
toolsets, MCP servers, knowledge sources, webhooks and notification channels
(`GET /v1/credentials/:id/uses`, also shown in the credential's details). The delete
confirmation lists those uses with links; an admin can unbind and delete, anyone else is asked to
give them another credential first. The API refuses the delete (409, uses listed) unless forced.

A schedule's Run now asks first, naming the environment (and saying when it is protected), then
offers Open run; the schedule's last run shows the manual run. Rotating a webhook's or
notification channel's signing secret asks first, since the current secret stops working at once.
Switches, Send a test and rotation buttons show that they are working and can't be fired twice.
