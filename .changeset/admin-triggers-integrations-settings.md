---
"@flowaid/web": patch
---

Secrets shown once (API keys, MCP tokens, webhook and notification signing secrets) can no longer
be dismissed by a stray click outside the dialog or by Escape; only "I have copied it" closes it.
The Rotate credential dialog forgets typed secrets when it is cancelled or opened for another
credential.
