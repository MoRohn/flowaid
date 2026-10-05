---
"@flowaid/web": patch
"@flowaid/api": patch
"@flowaid/database": patch
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
