---
"@flowaid/api": minor
"@flowaid/workflow-sdk": minor
"@flowaid/web": patch
---

More list endpoints are paged. `GET /v1/agents`, `/v1/api-keys`, `/v1/credentials`,
`/v1/knowledge/sources`, `/v1/notifications`, `/v1/saved-views`, `/v1/workflows/:id/versions` and
`/v1/workspaces/:id/members` now answer `{ items, next_cursor }` (keyset pagination with `limit`, at
most 200, and `cursor`) instead of a bare array, like the other lists. Callers that read these
responses as arrays must read `items` and follow `next_cursor`; the web app reads every page.
