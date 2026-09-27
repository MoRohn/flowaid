# RFC-0005: Generation failover and smart model routing

- Status: accepted (2026-09-27)
- Raised by: `smart-routing-cost-optimizer` — decision nodes fail over along `execution.decisions`, but a generation node names exactly one model, so an outage or a rate limit at one vendor fails the run
- Implemented by: P6-01
- Affects: `CONTRACTS.ts` §5 (new `GenerationStrategySchema`, `GenerationPolicySchema`, `ModelSelectionSchema`, `modelCandidates`), §15 (`GenerationResult.attempts?`), §16 (`ProviderAccess.generation(ModelRef | GenerationPolicy)`); `@flowaid/workflow-core` 0.3.3 → 0.3.4

## Motivation

Generation is where most cost and most provider outages are. A node should be able to say
"use one of these models, prefer the cheapest (or fastest, or healthiest) that can do the job,
and move on when one is down" — with the same audit trail decisions already have.

## Change

- §5: `GenerationPolicySchema { candidates: ModelRef[] (1–5), strategy: 'ordered' | 'cheapest' | 'fastest' | 'healthiest' (default 'ordered'), requirements?: { tools?, jsonSchema?, vision?, minContext? }, maxCostUsdPerCall? }` and `ModelSelectionSchema = z.union([ModelRefSchema, GenerationPolicySchema])`, accepted by every `x-ui.widget: 'model'` field that is not an embedding model. `modelCandidates(selection)` lists the candidates.
- §15: `GenerationResult.attempts?: ProviderAttempt[]` — every candidate tried, with the same outcomes as `DecisionResult.attempts` (`ok`, `error`, `skipped_unhealthy`).
- §16: `ProviderAccess.generation` takes a `ModelRef` or a `GenerationPolicy`. For a policy the registry returns a failover chain:
  - candidates are filtered by `ModelInfo.capabilities` against `requirements` (and `tools` when the request carries tools) and by `contextTokens` against `minContext`; candidates whose estimated cost for the request exceeds `maxCostUsdPerCall` are skipped;
  - the rest are ordered by strategy: `ordered` as configured, `cheapest` by catalog price (input + output per million tokens; unknown prices last), `fastest` by the health tracker's p95 latency (unmeasured last), `healthiest` by status, then error rate;
  - a candidate whose circuit is open (`down`) is recorded as `skipped_unhealthy`; a retryable error advances to the next candidate and the runtime emits `PROVIDER_FAILOVER`; a non-retryable error (401, 422) surfaces;
  - a stream fails over only before its first chunk.
- The compiler's environment pass reads every candidate: `E/W_PROVIDER_UNAVAILABLE` when no candidate's provider is configured, `W_FAILOVER_UNCONFIGURED` for each further unconfigured candidate, `W_MODEL_DEPRECATED` per candidate.

Additive: a new union member, an optional result field, a widened parameter.

## Compatibility

- Stored definitions: a plain `{ provider, model }` stays valid everywhere.
- Wire: `GenerationResult.attempts` is optional; `GENERATION_COMPLETED` is unchanged.
- Nodes: `ctx.providers.generation(ref)` callers compile unchanged.

## Tests

- `@flowaid/providers`: failover matrix with fake providers (retryable advances, 401 surfaces, open circuit skipped, stream fails over before the first chunk only), strategy ordering (cheapest by catalog price, healthiest by tracker state, fastest by p95), requirement and cost filters.
- `@flowaid/workflow-compiler`: the environment pass on a policy (unconfigured candidates, none configured).
- `@flowaid/ui`: `ModelPicker` fallbacks list and strategy.
- `@flowaid/workflow-runtime`: PROVIDER_FAILOVER is emitted for generation.

## Alternatives considered

- A separate `fallbackModels` field next to `model`: every node schema would need it and the UI would show two unrelated fields.
- Routing inside each provider package: providers cannot see each other's health or prices.
