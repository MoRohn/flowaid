# Verification: smart-routing-cost-optimizer

Verdict: NOT refuted. Severity adjusted high -> medium.

## Evidence

- SPEC.md:55 (§UI) lists "cost optimizer; smart model routing" as product features; SPEC.md:13 requires "provider health tracking". §Design principles (SPEC.md:72) does not name them literally (only "provider independence") — minor misattribution in the finding.
- CONTRACTS.ts:492 `ModelRefSchema = { provider, model }` — a single ref, no candidates/fallbacks.
- ARCHITECTURE.md §6.2 (line 638-646): `registry.generation(ref, creds)` takes one ModelRef; `FailoverChain` walks decision hops only (`typesafe|llm|rule|human`, ProviderHopSchema CONTRACTS.ts:496). No generation-path failover anywhere in ARCHITECTURE.md (grep for generate+failover/retry: none).
- `W_FAILOVER_UNCONFIGURED` (ARCHITECTURE.md:417, 1093) is decision-only.
- UI.md:155 `x-ui.widget:'model'` -> ModelPicker binds `ModelRefSchema` (single) with a health dot but no fallback list.
- ARCHITECTURE.md:1118 and IMPLEMENTATION_PLAN.md:165 (WP-27) explicitly defer "cost optimizer / smart routing" in one clause. No code exists in packages/ for either.

## Why medium, not high

Both features are consciously deferred and documented as such (the "excluded until real" list), so this is a planned gap, not a hidden contradiction. The genuine design hole is narrower: HealthTracker wraps generation providers but nothing consumes it for `flowaid.ai.generate` routing, so a `down` model just fails the node. The proposed GenerationPolicySchema + generation FailoverChain is the concrete, implementable part; the advisor package is larger and should be split into its own work item.
