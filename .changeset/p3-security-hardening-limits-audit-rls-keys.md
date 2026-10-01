---
"@flowaid/api": minor
"@flowaid/database": minor
"@flowaid/credentials": minor
"@flowaid/workflow-core": patch
---

Security and reliability hardening (P3-3, P3-4, P3-6, P3-7):

- With `REDIS_URL`, request rate limits, sign-in throttles and the webhook replay cache are kept in Redis, so they hold across api replicas.
- Migration 0012 gates the row-level-security bypass on membership in the new `flowaid_rls_bypass` role (granted to `flowaid_app` and the owner, never to the sandbox host's `flowaid_code`). A migrating role without `CREATEROLE` needs the role created first (see `docker/postgres-init/01-roles.sql`).
- Each mutation's audit row is written inside the transaction that makes the change.
- `flowaid keys rotate-master` (`pnpm keys`, `node dist/keys.js` in the api image) re-wraps every key-encryption key and re-seals every credential under a new master key, verified and resumable.
- Timers are due by the database clock, not the worker's.
