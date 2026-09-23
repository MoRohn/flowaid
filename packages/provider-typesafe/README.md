# @flowaid/provider-typesafe

TypeSafe's Jev System One as a flowaid `DecisionProvider`: typed boolean, choice and score
decisions with full probability distributions, batched against one state. The mapping follows
the API verified live (ARCHITECTURE.md §6.3); `fixtures/` holds recorded exchanges.

```ts
registry.register(typesafeFactory()); // credential type: typesafe.api_key
const chain = await registry.chain([{ provider: "typesafe", model: "jev-latest" }], ctx);
const decision = await chain.decideChoice(
  state,
  { kind: "choice", instructions, options },
  callCtx,
);
// decision.value, decision.confidence, decision.probabilities, decision.model === "jev-1.13.0"
```

| flowaid | System One                    | Result                                                                           |
| ------- | ----------------------------- | -------------------------------------------------------------------------------- |
| boolean | `noul` (+ criteria)           | `pYes = noul`, `value = pYes ≥ threshold` (0.5), `confidence = max(p, 1−p)`      |
| choice  | `choice` (criteria = options) | `value`, `confidence`, `probabilities` (keys checked against the options)        |
| score   | `score` (criteria = levels)   | `value`, `normalized`, `level`, `levelLabel`, `levels` (legend in numeric order) |

- **Cost:** $0.042 per million input tokens, output free; a batch's usage and cost are split
  across its answers. `model` is the resolved model (`jev-1.13.0`), never the alias.
- **Limits:** checked before calling — state plus the longest question within 32k tokens and the
  request within 64k (3.5 characters per token) — or `BoundsExceededError('maxTokens')` with a
  hint to chunk the state.
- **Errors:** 401 → `CredentialError`; 400 (semantic validation) and 422 (request shape) →
  non-retryable `ProviderError` (no failover); 429 → up to five in-call retries honouring
  `Retry-After`, then `ProviderRateLimitedError`; 529 → `ProviderOverloadedError` (failover);
  other 5xx → retryable; transport → `NetworkError`; every wait honours the abort signal.

## Fixtures

`boolean`, `choice`, `score`, `batch-3`, `error-400`, `error-401` and `error-422` were recorded
from the live API on 2026-09-23. `error-429.synthetic` and `error-529.synthetic` are
constructed (those statuses cannot be provoked on demand) and say so. Re-record with a key:

```sh
TYPESAFE_API_KEY=… pnpm --filter @flowaid/provider-typesafe record
```

With a key present (`TYPESAFE_API_KEY` or the repository's `.env.local`), `pnpm test` also runs
live smoke tests that assert the response schema still parses; without one they skip.
