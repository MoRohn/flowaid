# @flowaid/providers

The provider layer between flowaid nodes and model vendors: which provider answers, what it
costs, what happens when it fails, and how a run can be replayed without calling anyone. Vendor
adapters (`provider-typesafe`, `provider-openai`, `provider-anthropic`, `provider-ollama`) plug
into it. Design: [ARCHITECTURE.md §6](../../docs/design/ARCHITECTURE.md).

| Module                   | What it does                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProviderRegistry`       | Factories by `(kind, id)`; resolves credentials, memoises per workspace, hop and credential; wraps providers with rate limiting, pricing and health                                    |
| `FailoverChain`          | Walks `[primary, ...failover]`: advances on transient errors and open circuits, fails fast on configuration errors, records every attempt, hands over to a person at a `human` hop     |
| `HealthTracker`          | 60 s window per provider, model and credential; degraded at 5 % errors; circuit opens for 30 s after 5 consecutive failures or a > 50 % error rate, then allows one half-open probe    |
| `TokenBucket`            | Requests per minute per credential (from the catalog), waiting instead of hitting a 429                                                                                                |
| `DefaultModelCatalog`    | The JSON catalogs in `src/catalog/` (with sources and retrieval date), workspace overrides and discovery cached 10 minutes; `price()` with cache and long-context rates                |
| `LLMDecisionProvider`    | Typed decisions from a chat model: one strict-schema request per batch, renormalisation, fuzzy option matching at 0.8× confidence, one corrective re-ask                               |
| `RuleDecisionProvider`   | Deterministic, free decisions from FlowExpr rules over `$state`                                                                                                                        |
| `OpenAICompatibleClient` | Chat completions (SSE streaming, tool calls, strict JSON schema, cached tokens), embeddings and model listing for OpenAI and compatible endpoints                                      |
| Record/replay            | `recordingDecisionProvider` / `recordingGenerationProvider` keyed by provider, model and request hash; `@flowaid/providers/recording-fs` stores recordings as JSON files for CI replay |

## Prices

Prices live in `src/catalog/*.json`, one file per vendor, each with the official pages it was
read from and the date. They are validated when the package loads. Update them by editing the
file (and its `retrievedAt`); results already recorded keep the price snapshot they were
charged at, so history never changes. `TokenUsage.inputTokens` includes cached tokens: cache
reads and writes are billed at their own rates, the rest at the input rate.

## Failover in one example

```ts
const chain = await registry.chain(
  [
    { provider: "typesafe", model: "jev-latest" },
    { provider: "llm", model: { provider: "openai", model: "gpt-4.1-mini" } },
    { provider: "human" },
  ],
  { workspaceId, credential, http },
  {
    onFailover: (e) =>
      emit({ type: "PROVIDER_FAILOVER", from: e.from, to: e.to, error: e.error.toInfo() }),
  },
);
const decision = await chain.decideChoice(state, question, callCtx);
// decision.attempts lists every hop tried; if all providers fail, HumanFallbackSignal is thrown.
```
