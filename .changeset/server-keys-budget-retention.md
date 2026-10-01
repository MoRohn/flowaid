---
"@flowaid/api": minor
"@flowaid/worker": minor
"@flowaid/web": minor
"@flowaid/database": minor
"@flowaid/observability": minor
"@flowaid/workflow-core": minor
"@flowaid/workflow-compiler": minor
"@flowaid/workflow-sdk": minor
"@flowaid/cli": minor
---

A key set in the server's environment (TYPESAFE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
OLLAMA_HOST) now answers a workflow's required secret of that type when nothing is bound in the
environment. Runs start, deploys (including Publish with deploy) go through, and steps use the
server key, so the built-in templates run without saving and binding the key first. The builder,
templates, Deployments and Secrets pages no longer ask you to bind such a secret.

The monthly budget in Settings → Workspace is now enforced. Once the runs started this calendar
month (UTC) have cost the budget, new runs are refused with HTTP 409 from every source (the
builder, the API, webhooks, schedules, MCP and evaluations) until next month or until the budget is
raised; runs already going finish. Two new notification events, "80% of the monthly budget is
spent" and "The monthly budget is used up", reach subscribed channels at most once a month each.
Settings → Workspace shows this month's spend next to the budget, also available from
`GET /v1/workspaces/:id/budget` (`flowaid workspace budget`).

The retention days in Settings → Workspace now apply at the nightly clean-up: runs keep their data
for the workspace's run days instead of 90 (workflows set to short or long retention keep theirs),
the audit log keeps entries for the audit days (400 when empty, which the clean-up now also
applies), and files runs write are deleted after the artifact days even while the run is kept.
