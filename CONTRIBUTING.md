# Contributing to FlowAId

Thank you for helping build FlowAId. This guide explains how the repository is organised, how
to set it up, and what a change needs before it can be merged.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. Report security problems privately
as described in [SECURITY.md](SECURITY.md), not in public issues.

## Before you start

FlowAId is designed before it is built. The design documents in [`docs/design/`](docs/design/)
are authoritative, and [`docs/design/CONTRACTS.ts`](docs/design/CONTRACTS.ts) is frozen. A change
to a contract goes through an RFC ([`docs/design/RFCS.md`](docs/design/RFCS.md), template in
[`docs/rfcs/0000-template.md`](docs/rfcs/0000-template.md)). Work is planned in
[`docs/project/UPGRADE_PLAN.md`](docs/project/UPGRADE_PLAN.md), and the current state is in
[`docs/STATUS.md`](docs/STATUS.md). Pick an item from the plan, or open an issue to discuss a
change that is not in it.

## Setup

Requirements: Node.js 24 or newer (`.nvmrc`), pnpm 12 (`corepack enable` or `npm i -g pnpm`).

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

Useful commands:

| Command                             | What it does                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                         | All package tests (Vitest, through Turborepo)                                                                      |
| `pnpm --filter @flowaid/<pkg> test` | One package's tests                                                                                                |
| `pnpm boundaries`                   | The dependency-graph check: `boundaries.json` against every package and the design                                 |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                           |
| `pnpm env:check`                    | `.env.example` and `packages/env/README.md` match the environment schema                                           |
| `pnpm start`                        | Preflight, install, build, then the whole stack on this computer (`--playground` serves the UI playground instead) |
| `pnpm preflight`                    | Check Node.js, pnpm, dependencies and the web (3000) and API (3001) ports                                          |
| `pnpm check`                        | Every CI gate in one command                                                                                       |

### PostgreSQL and Redis suites

The database, api, worker and core-node tests include suites that need a real PostgreSQL 16 with
pgvector, and the queue and event-bus suites need Redis. **They skip silently when their
variable is unset**, so `pnpm test` can pass without running them; CI's `integration` job always
runs them. To run them locally, start disposable servers (never point these variables at a
server that holds data: every suite creates and drops its own database):

```sh
docker run -d --rm --name flowaid-test-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 \
  pgvector/pgvector:0.8.6-pg16
docker run -d --rm --name flowaid-test-redis -p 127.0.0.1:56379:6379 redis:7.4.11-alpine

export FLOWAID_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres
export FLOWAID_TEST_REDIS_URL=redis://127.0.0.1:56379
pnpm --filter @flowaid/database --filter @flowaid/workflow-runtime --filter @flowaid/api \
  --filter @flowaid/worker --filter @flowaid/nodes-core test
```

`FLOWAID_TEST_DATABASE_URL` is a superuser connection; `FLOWAID_TEST_REDIS_URL` suites use a
unique key prefix per run. `docker rm -f flowaid-test-pg flowaid-test-redis` removes both.

## Rules every change follows

- **TypeScript 5.9 strict**, including `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
  ESM only, with `.js` extensions in relative imports.
- **No `any`, no non-null assertions, and no casts to get around the type model.** Fix the types.
- **No placeholders.** No `TODO` implementations, fake handlers or features that only look
  finished. If something is not built, leave it out and say so.
- **Tests next to the code** (`*.test.ts`). A bug fix comes with a regression test. Never delete
  or skip a test to make a build pass.
- **Dependency boundaries.** Packages may only import what `boundaries.json` allows. The core
  (`workflow-core`, `jev`, `shared`, `ui`) is browser-safe and never imports Node built-ins.
  LangChain may be imported only in the packages listed in
  [`docs/design/LANGCHAIN.md`](docs/design/LANGCHAIN.md).
- **Pinned versions.** Add dependencies with an exact version (see
  [`docs/design/VERSIONS.md`](docs/design/VERSIONS.md)).
- **Brand rules.** UI code uses the design tokens only, with no hard-coded colours. Purple, pink
  and teal are never used ([`brand/IDENTITY.md`](brand/IDENTITY.md)).
- **Writing.** Sentence case, plain verbs, errors that say what to do next.

## Pull requests

1. Branch from `main`.
2. Keep the change focused on one plan item or issue, and reference it in the description.
3. Make `pnpm check` pass (every gate CI runs). `pnpm install` sets up lefthook hooks that check
   formatting and lint on commit, and boundaries and types on push.
4. Add a changeset (`pnpm changeset`) when users will notice the change: it becomes the release
   notes ([docs/operations/RELEASING.md](docs/operations/RELEASING.md)).
5. Update the docs the change affects: the package README, a guide page, `docs/STATUS.md`.
6. A contract change needs an accepted RFC first.

## Repository map

See the README's [repository layout](README.md#repository-layout) and the
[documentation index](docs/README.md).
