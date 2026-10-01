---
"@flowaid/api": minor
"@flowaid/worker": minor
"@flowaid/web": minor
"@flowaid/database": minor
"@flowaid/mcp": minor
"@flowaid/workflow-core": minor
"@flowaid/cli": minor
"@flowaid/workflow-sdk": minor
---

MCP tools that survive deploys, and stdio MCP servers you can test and discover.

A workflow exposed as an MCP tool under Triggers, MCP tools now stays exposed when you deploy,
redeploy or roll back the workflow. It keeps its tool name and description, and clients see it
whenever a version is deployed to its environment. Each tool in the list has an On/Off switch,
so a switched-off tool can be switched back on; deploys leave the switch as you set it. A tool
made before anything is deployed says it is waiting for a deployment. A tool declared by a
version's own MCP trigger works as before: a later version without the trigger switches it off,
and switching it back on makes it yours. Tools that a deploy switched off before this release are
switched back on (migration 0015). `PATCH /v1/mcp/exposures/:id` takes `enabled` and
`description`, and the exposure list reports `source`, `deployed` and `active`.

stdio MCP servers can now be tested and discovered. The api never starts a program itself: it
hands the test or discovery to the worker, which checks the command against its allow-list again,
starts it, and stores the tools it lists on the server, so they reach agents and the MCP tool
step. Each start is recorded in the audit log by name only. If no worker answers within 45
seconds, the test says so.

The Connect MCP server dialog can test the settings before saving them
(`POST /v1/mcp/servers/test`, for HTTP and stdio servers); nothing is stored by the test.
