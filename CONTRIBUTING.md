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
[`docs/UPGRADE_PLAN.md`](docs/UPGRADE_PLAN.md), and the current state is in
[`docs/STATUS.md`](docs/STATUS.md). Pick an item from the plan, or open an issue to discuss a
change that is not in it.

## Setup

Requirements: Node.js 24 or newer (`.nvmrc`), pnpm 12 (`corepack enable` or `npm i -g pnpm`).

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

Useful commands:

| Command                             | What it does                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm test`                         | All package tests (Vitest, through Turborepo)                                      |
| `pnpm --filter @flowaid/<pkg> test` | One package's tests                                                                |
| `pnpm boundaries`                   | The dependency-graph check: `boundaries.json` against every package and the design |
| `pnpm format` / `pnpm format:check` | Prettier                                                                           |
| `pnpm env:check`                    | `.env.example` and `packages/env/README.md` match the environment schema           |
| `pnpm --filter @flowaid/ui dev`     | The UI component playground at http://127.0.0.1:5178                               |

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
3. Make `pnpm typecheck && pnpm lint && pnpm test && pnpm boundaries && pnpm format:check` pass.
4. Update the docs the change affects: the package README, a guide page, `docs/STATUS.md`.
5. A contract change needs an accepted RFC first.

## Repository map

See the README's [repository layout](README.md#repository-layout) and the
[documentation index](docs/README.md).
