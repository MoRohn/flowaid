---
"@flowaid/api": patch
"@flowaid/database": patch
"@flowaid/env": patch
---

`RATE_LIMIT_MAX` now sets the per-session request limit as documented, with API keys allowed
double and unauthenticated requests (webhooks, sign-in) a fifth per address; unset, the limits are
unchanged (600, 1 200 and 120 a minute). `pnpm loadtest` measures read and end-to-end run capacity
of a running API, and docs/operations/PERFORMANCE.md records the first results. Migration 0015 can
run again safely on a database that already has its columns.
