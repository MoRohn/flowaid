---
"@flowaid/web": patch
---

Editing an agent keeps the settings the form doesn't show: temperature, max output tokens, the
token cap and streaming set through the API or CLI were dropped by the first edit in the app. They
now have their own "Advanced" group under Limits, and any other stored setting is saved back
unchanged. A tool an agent lists that the workspace no longer offers (an MCP server removed, a tool
renamed) is shown under "No longer available" in Tools, where it can be unchecked; Review names it
and saving waits until it is removed, and the agent's card marks it, since every run would fail.

Smaller agent fixes: Review warns when Max cost is $0 or Max tool calls is 0 with tools chosen
(both stop the agent where it starts), and the hints say what 0 means. A chosen tool's approval
choice no longer squeezes the tool's name, Edit no longer promises to keep changes across pages
(its links open a new tab, with a way to refresh the tool list), the card shows "approval" only
for tools that really wait for a person, its buttons and switch are named after the agent, and
"ready to use" says the agent is in Add node under its own name.
