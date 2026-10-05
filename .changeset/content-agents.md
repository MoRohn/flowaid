---
"@flowaid/web": patch
"@flowaid/nodes-core": patch
"@flowaid/workflow-compiler": patch
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

An agent's Max steps reaches the steps that use it. Adding an agent from Add node copied its Max
steps onto the step (and the Agent step filled in 8 when it had none), so raising it on the agent
changed nothing. A step that uses an agent now leaves Max steps unset unless it sets its own, and
the compiler accepts that for a step with an agent. Steps added before keep the value they have;
clear it in the step's settings to use the agent's.
