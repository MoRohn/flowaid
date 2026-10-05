---
"@flowaid/web": patch
---

Editing an agent keeps the settings the form doesn't show: temperature, max output tokens, the
token cap and streaming set through the API or CLI were dropped by the first edit in the app. They
now have their own "Advanced" group under Limits, and any other stored setting is saved back
unchanged. A tool an agent lists that the workspace no longer offers (an MCP server removed, a tool
renamed) is shown under "No longer available" in Tools, where it can be unchecked; Review names it
and saving waits until it is removed, and the agent's card marks it, since every run would fail.
