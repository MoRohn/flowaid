# RFC-NNNN: <title>

- Status: proposed | accepted | rejected | superseded
- Raised by: <finding id(s) from docs/review or an issue link>
- Implemented by: <upgrade-plan item id / PR>
- Affects: `CONTRACTS.ts` §<n> (<schema/type names>), `@flowaid/workflow-core` <current version> → <next version>

## Motivation

What is wrong or missing in the current contract, with the evidence (file:line, failing scenario).

## Change

The exact diff against `docs/design/CONTRACTS.ts` (paste the changed schema/type declarations). Say whether the change is additive (optional field, new union member) or breaking (renamed field, narrowed enum), and what the parity test in `packages/workflow-core/src/contracts.test.ts` must assert afterwards.

## Compatibility

- Stored data: which tables/columns hold values of the changed schema and how existing rows stay valid (migration, default, or "nothing stored yet").
- Wire: SDK/CLI/OpenAPI impact; `x-cli` and generated types.
- Design docs: which of `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `UI.md`, `CODE_EXPORT.md`, `LANGCHAIN.md` change and where.

## Tests

The tests that prove the change (unit, fixture, property, golden) and the packages they live in.

## Alternatives considered

Why the other shapes were rejected.
