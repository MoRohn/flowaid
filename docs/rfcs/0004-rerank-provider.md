# RFC-0004: Rerank provider

- Status: accepted (2026-09-27)
- Raised by: `node-catalog-gaps` — the spec's `flowaid.ai.rerank` node has no provider interface to call
- Implemented by: P6-03 (nodes-core slice 3)
- Affects: `CONTRACTS.ts` §15 (new `RerankProvider`; `ProviderFactory.kind` gains `'rerank'` and its type parameter `RerankProvider`), §16 (`ProviderAccess.rerank`, `NodePackage.providers` accepts rerank factories); `@flowaid/workflow-core` 0.3.4 → 0.3.5 (after RFC-0005 took 0.3.4)

## Motivation

Retrieval pipelines rank candidate passages with a cross-encoder before they reach a prompt.
`ModelInfo.kind` already listed `'rerank'`, but no provider shape existed, so neither the
registry nor a node could resolve one.

## Change

- §15: `RerankProvider { id; model; rerank(query, docs, ctx) → { scores: number[]; usage?; costUsd }; health() }`.
  Scores are in input order (not sorted); the node sorts and cuts.
- §15: `ProviderFactory.kind` gains `'rerank'`; the registry resolves rerank models like
  embeddings (catalog alias, credential, rate limit, catalog pricing when the provider reports
  none).
- §16: `ProviderAccess.rerank(ref, opts?)`, gated by the `generation` capability like
  `embedding`.
- `@flowaid/providers` ships an OpenAI-compatible `/rerank` client with Cohere (`cohere`,
  `/v2/rerank`) and Jina (`jina`) presets plus a generic `rerank-compatible` factory (vLLM, TEI,
  LocalAI) that takes `baseUrl` from its credential.

Additive: new types, a widened union and an extra method on an interface the runtime implements.

## Compatibility

- Stored data: none.
- Wire: none.
- Other `ProviderAccess` implementations (test doubles) must add `rerank`; the node-sdk test
  context does.

## Tests

- `@flowaid/providers`: preset request/response fixtures, error mapping, registry resolution.
- `@flowaid/nodes-core`: `flowaid.ai.rerank` harness tests against a fake `RerankProvider`.
