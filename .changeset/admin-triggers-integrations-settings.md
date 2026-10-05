---
"@flowaid/web": patch
"@flowaid/api": patch
"@flowaid/database": patch
"@flowaid/ui": patch
"@flowaid/cli": patch
"@flowaid/workflow-sdk": patch
"@flowaid/observability": patch
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

MCP servers can be edited (name, address or program, sign-in); changing where one runs or how it
signs in sets it back to Pending. Test and Discover show that they are running, record their
outcome on the row at once, and name the real cause of a failure. Every refusal of a private or
local address (MCP servers, OpenAPI documents and tools, notification sends) now says to set
FLOWAID_ALLOW_PRIVATE_NETWORK=true, instead of "You do not have access".

OpenAPI toolsets have a Details view: their operations (method, path, what each does), the
document and server they came from, and a form to rename them or change their credential
(a taken name is refused with 409 instead of failing).

Each notification channel has a History (`GET /v1/notifications/:id/deliveries`): the alerts
and tests sent to it, newest first, with why a send failed. Test sends are now recorded there too.

The audit log exports the filtered range as CSV or JSON (`GET /v1/audit/export`; formula-like
CSV fields are defused), offers the resource types it actually holds
(`GET /v1/audit/resource-types`) instead of a fixed list, and its period now reaches a year or
all time.

Saving a shorter run, artifact or audit retention asks first and says what the next nightly
clean-up will clear; a monthly budget of $0 says that it means no budget.

Deleting an environment lists what goes with it (deployments, webhooks, schedules, MCP tools,
secret bindings, credentials limited to it, keys pinned to it; `GET /v1/environments/:id/usage`),
and one with runs on record says why it can't be deleted before you try. Renaming one warns that
webhook URLs move with the name, and that renaming dev stops Run draft.

After adding an unsigned webhook, the next steps no longer ask for a signing secret; the review
says when a schedule's input will stop it deploying, reads "prod is protected and refuses unsigned
calls", and unsigned webhooks no longer show a switched-off "Require signed timestamp".

Smaller fixes: Providers' "Add … credential" opens New credential on that provider's key; an MCP
client calling a tool with arguments that don't fit gets each problem named, so its model can
correct the call; an MCP token pinned to a workflow id that doesn't exist is refused.
