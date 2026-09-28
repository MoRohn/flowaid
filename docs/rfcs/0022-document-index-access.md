# RFC-0022: `ctx.documents` and document indexes

- Status: accepted (2026-09-28)
- Raised by: the PageIndex integration (docs/pageindex/ADR.md), whose nodes build hierarchical
  indexes of uploaded documents and retrieve evidence by navigating them
- Implemented by: the PageIndex integration
- Affects: `CONTRACTS.ts` §4 `NodeCapability` (one value added), §15 a Document indexes block
  (types only), §16 `ExecutionContext` (one optional member) and `DocumentIndexAccess`;
  `@flowaid/workflow-core` 0.3.8 → 0.3.9

## Motivation

Knowledge bases (RFC-0021) retrieve chunks by similarity. Long, structured documents (policies,
contracts, manuals, filings) are better served by a different strategy: build the document's
section hierarchy once, then answer a question by navigating it and reading the pages it points
to, citing physical page positions in an immutable version of the file. Nodes need to reach
those indexes without seeing the backend service, other workspaces, or anything outside the
scope they were configured with.

## Change

- `NodeCapability` gains `'documents'`. Nodes that declare it get `ctx.documents`; others get an
  accessor that rejects with `FORBIDDEN`.
- `ExecutionContext.documents?: DocumentIndexAccess` with `resolve(scope)`, `getIndex(indexId)`,
  `outline(indexId)`, `readPages(indexId, pages)` and `requestIndex(documentId)`. The host binds
  it per call to the run's workspace; ids from another workspace are `NOT_FOUND`, and only
  `ready` indexes are readable.
- New §15 types: `DocumentIndexState`, `DocumentIndexCapabilities`, `DocumentReference`,
  `IndexReference`, `OutlineNode`, `DocumentScope`, `SourceLocator` (physical, 1-based pages;
  `pageLabel` null unless known), `Evidence`, `RetrievalActivity`, `RetrievalResult`,
  `Citation`, `GroundedAnswer`, `IndexRequestResult`.

## Compatibility

Additive. Existing manifests, plans and definitions are unaffected; `ctx.documents` is optional,
so a runtime that does not bind it (an exported code package) fails document nodes with a clear
`BAD_REQUEST`. The database side is migration `0010`.

## Tests

- `contracts-parity.test.ts` (workflow-core and node-sdk) keep `CONTRACTS.ts` in step.
- The retrieval and citation logic (`@flowaid/pageindex`) is tested with scripted decisions; the
  worker's access and the API's routes against PostgreSQL; the service protocol against the
  Python service.
