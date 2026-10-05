---
"@flowaid/web": patch
"@flowaid/api": patch
---

A webhook path or MCP tool name that is switched off no longer stays reserved: deploying another
workflow with it (or exposing another workflow under that tool name) takes it over, and only a
switched-on one is a conflict.

Secrets shown once (API keys, MCP tokens, webhook and notification signing secrets) can no longer
be dismissed by a stray click outside the dialog or by Escape; only "I have copied it" closes it.
The Rotate credential dialog forgets typed secrets when it is cancelled or opened for another
credential.
