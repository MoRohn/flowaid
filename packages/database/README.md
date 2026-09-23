# @flowaid/database

flowaid's persistence on PostgreSQL 16 with pgvector: the schema, migrations with forced
row-level security, the event-sourced run store, a Postgres job queue and event bus, and the
repositories the API and worker use. Design: [DATABASE.md](../../docs/design/DATABASE.md).

| Module                   | What it does                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`              | DATABASE.md verbatim: 45 tables, Postgres enums for run and node-run status, partial unique indexes, the `run_events` payload size check. Tests keep the file, the document and the migrations identical                           |
| `migrate()`              | Applies `migrations/` as the owner (`DATABASE_ADMIN_URL`) under an advisory lock, in one transaction                                                                                                                               |
| `createDatabase()`       | postgres.js pool + Drizzle; `tenant(workspaceId, fn)` and `system(fn)` transaction scopes set the RLS settings per transaction                                                                                                     |
| `PgRunStore`             | `RunStore`: fenced appends (`WorkerLostError` when another worker owns the run), dense `seq`, projections in the same transaction, `NOTIFY` with ids only; leases, timers, checkpoints, human tasks                                |
| `reproject()`            | Rebuilds a run's projections from its log with the same code; tests assert the rows come out identical                                                                                                                             |
| `PgQueueDriver`          | `QueueDriver` without Redis: `SKIP LOCKED` claims, LISTEN/NOTIFY wake-ups, delays, priorities, job-id dedupe, visibility leases with heartbeats, backoff and dead-lettering                                                        |
| `PgEventBus`             | `EventBus` over LISTEN/NOTIFY (≤ 7 900-byte messages)                                                                                                                                                                              |
| `PgCredentialRepository` | `CredentialRepository` for `@flowaid/credentials` (storage → provider, RFC-0010), environment- and workflow-pinned bindings; `PgKekStore` for KEK versions                                                                         |
| `PgArtifactIndex`        | Artifact metadata with server-generated storage keys and verified upload completion                                                                                                                                                |
| `repositories/*`         | Workspaces (with default environments), users, rotating refresh tokens with reuse detection, single-use tokens, API keys, drafts (optimistic concurrency), versions, deployments and rollback, secret bindings, run listing, audit |
| `sweepRetention()`       | Bounded retention batches: expired runs keep their metrics row, sensitive I/O, checkpoints, drafts, deliveries, idempotency keys (24 h), tokens, run_events partitions                                                             |

## Row-level security

Every tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY`, so the owner role is filtered too.
A row is visible when its `workspace_id` equals the transaction's `app.workspace_id`; with no
workspace set, queries return nothing. Run-scoped tables without a `workspace_id` follow their
run through `SECURITY DEFINER` checks, so the sandbox role (`flowaid_code`, insert-only) passes
them without read access to `runs`. Built-in templates and global plugins are readable by every
workspace and writable by none.

`app.bypass_rls = on` is the trusted system scope (worker run store, sweeps, reprojection,
principal lookup) and what `DB_RLS=false` sets per connection. It guards against application
bugs leaking data between tenants; it is not a boundary against code that already holds the
`flowaid_app` credentials, which is why the sandbox connects as `flowaid_code`.

## Tests

Unit tests always run. The Postgres suites (`*.pg.test.ts`) run when `FLOWAID_TEST_DATABASE_URL`
names a superuser connection to a disposable PostgreSQL 16 + pgvector server; each suite creates
its own database, migrates it as a non-superuser owner and drops it:

```sh
docker run -d --name flowaid-pgtest -e POSTGRES_PASSWORD=postgres -p 55432:5432 pgvector/pgvector:0.8.6-pg16
FLOWAID_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm --filter @flowaid/database test
```

CI runs them in the `database` job against the same image.

## Seeds

```sh
pnpm --filter @flowaid/database seed:templates                 # the three demo templates
pnpm --filter @flowaid/database seed:environments <workspace>  # dev, staging, prod (protected)
```
