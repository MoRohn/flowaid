# RFC-0008: `definitionHash` parses first; resolved defaults are part of the hash

- Status: accepted (2026-09-23)
- Raised by: `wc-definition-hash-defaults` (docs/review/workflow-core.md §12)
- Implemented by: P0-13
- Affects: `CONTRACTS.ts` §6 (`definitionHash` signature and comment), `@flowaid/workflow-core` 0.2.0 → 0.3.0, `VERSIONS.md` ("Hash-changing releases")

## Motivation

`canonicalDefinition` hashed whatever object it was given. The raw fixture and its parsed form hashed differently (`0e5ca803…` vs `d86f4019…`) because parsing expands every `default`/`prefault` (`execution.concurrency: 8`, `description: ''`, `edges: []`, trigger defaults), so the same document had two hashes depending on whether the caller had parsed it. The dependence on defaults was also undocumented: changing any default in `policy.ts` silently changed the hash of every stored definition that omitted it, with no test to catch the change. Duplicate node ids hashed order-dependently (a stable sort on equal ids keeps input order), so two documents with the same duplicate nodes in a different order hashed differently.

## Change

`CONTRACTS.ts` §6:

```ts
/**
 * sha256 of the canonical definition (layout and metadata removed, keys sorted, nodes/edges sorted by id).
 * RFC-0008: the document is parsed with `WorkflowDefinitionSchema` first (idempotent on parsed input), so a raw
 * JSON document and its parsed form hash identically and every resolved schema default is part of the hash
 * (a default change is a hash-changing release, VERSIONS.md); a document the schema rejects throws the
 * `ZodError`; duplicate node or edge ids throw a `TypeError`.
 */
export declare function definitionHash(def: unknown): string;
```

Semantics:

- `definitionHash(def)` = `sha256Json(canonicalDefinition(WorkflowDefinitionSchema.parse(def)))`. Parsing is idempotent, so `definitionHash(raw) === definitionHash(parse(raw)) === definitionHash(parse(parse(raw)))`.
- `canonicalDefinition(def: WorkflowDefinition)` keeps its signature (it takes a parsed document) and throws a `TypeError` naming the first duplicate node or edge id; `definitionHash` propagates it. The compiler reports duplicates as diagnostics; a hash is never computed over such a document.
- Resolved defaults are part of the hash. A change to any default a hashed field carries is a **hash-changing release**: minor bump of `@flowaid/workflow-core`, an entry in `VERSIONS.md` § "Hash-changing releases", and a reviewed update of the golden constants.
- `packages/workflow-core/src/fixtures-roundtrip.test.ts` pins the hash of each of the four golden fixtures (`GOLDEN_HASHES`) and asserts raw ≡ parsed ≡ re-parsed ≡ `JSON.parse(JSON.stringify(parsed))` for each.

## Compatibility

- Signature: `def: WorkflowDefinition` → `def: unknown` is a widening; every existing caller compiles. Callers that passed unparsed JSON now get the same hash as callers that parsed first (previously two different hashes for one document).
- Stored data: `workflow_versions.definition_hash` rows written by an earlier `@flowaid/workflow-core` were computed over parsed documents, which hash the same under this RFC as long as no default changed; the first hash-changing release is 0.3.0 itself only for documents hashed raw (never the case in the API, which parses on ingest). Consumers must treat hashes from different `@flowaid/workflow-core` versions as incomparable and recompute rather than diff.
- The `contracts-parity` test needs no change (names and enums are unchanged).

## Tests

- `definition.test.ts`: raw ≡ parsed for every fixture; `TypeError` on duplicate node and edge ids from both `definitionHash` and `canonicalDefinition`.
- `fixtures-roundtrip.test.ts`: golden constants for the four fixtures; key order, node/edge order, layout and metadata invariance; every substantive edit changes the hash.
- `scripts/check-browser-bundle.test.ts`: the bundled `definitionHash` (now including Zod parsing) still matches an independent `node:crypto` digest under happy-dom and in a Web-globals-only `vm` context.
