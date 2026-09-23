# State packets and evidence

> "Jev can only judge the state it receives." (§IV.A)

A decision contract never sees the run's transcript. It sees a **state packet**: a compact,
current, evidence-based projection of the run, built from the fields the contract declares and
nothing else. This page explains how FlowAId builds packets, what goes in them and how to test
them. The normative design is [`JEV_ENGINEERING.md` §5](../design/JEV_ENGINEERING.md); the
implementation is `buildPacket` in [`packages/jev/src/packet/`](../../packages/jev/src/packet/).

## Why a packet and not a transcript

A transcript "forces the model to reconstruct the workflow from mixed instructions, old attempts,
conclusions, and irrelevant history" (§IV.A). The handbook asks for state that is "compact,
current, and evidence-based", with its functions separated (Table IV):

| Packet field   | Function (Table IV)                         | In FlowAId                                                                                 |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `goal`         | Defines success for the current task        | `StateSpec.goal`, fixed per contract                                                       |
| `facts`        | Records what the system currently knows     | Exact values: counts, flags, ids, channel, tier                                            |
| `artifacts`    | Lists outputs that already exist            | Drafts, reports, patches with `ref` and `hash`                                             |
| `evidence`     | Supports the next semantic judgment         | `EvidenceItem[]`: `id`, `kind`, `supports[]`, `summary`, `source`, `observedAt`, `version` |
| `constraints`  | Defines boundaries the system may not cross | Deadlines, budgets, publish flags                                                          |
| `options`      | Enumerates what can happen now              | Context only; the menu itself travels in the question                                      |
| `stateVersion` | Identifies the exact evaluated snapshot     | `"<runId>:<scope>@<seq>"`                                                                  |

"The separation makes omissions visible and prevents an earlier agent's interpretation from
becoming an unquestioned fact." (§IV.A)

## Evidence, not conclusions

The handbook's first failure mode is a conclusion stored as evidence: _"Jev then confirms the
conclusion because it was presented as a fact"_ (§X.A). Compare (§IV.B):

```
BAD      research_status: 'probably enough'
BETTER   sources_collected: 7, official_sources: 3, pricing_verified: true, security_claim: 'unresolved'
```

FlowAId enforces this in two places. Every declared field has a **role** (`goal`, `fact`,
`artifact`, `evidence`, `constraint`, `option`), and the contract lint flags fields whose names or
descriptions read as conclusions (`isConclusionName`, `isConclusionText` in
[`lint/text.ts`](../../packages/jev/src/lint/text.ts)) or as transcripts (`isTranscriptName`).

## How `buildPacket` works

`buildPacket(spec, bound, options)` is pure: the same spec, bound values and clock always give the
same packet, canonical text and hash.

1. **Declared fields only.** Anything bound but not declared in `StateSpec.fields` is reported as
   `excluded: undeclared` and never sent. This is least privilege: "the decision model receives
   only fields required for the contract" (§IV.C State Access Control).
2. **Data classes.** Each field has a data class (`public`, `internal`, `sensitive`, `pii`); the effective class is the
   maximum of the field and its producer. A field above the provider's `eligibleClass` is excluded,
   or handled by its `redact` policy: `error` (the default) fails the build, `mask`, `hash` or `drop` transform it. A PII message therefore never reaches a
   provider that may only receive internal data.
3. **Freshness.** Evidence items older than the field's `freshness.maxAgeMs` are reported stale,
   and `freshness.requireVersion` demands a content version (§IV.D "Attach timestamps or versions
   to evidence that can become stale").
4. **Selection and budget.** Evidence arrays are ordered and capped by a declared selection
   (`selection.maxItems`, `order`), never by ad-hoc truncation. A field over its `maxChars` fails
   the build unless it opts into `overflow: "truncate_marked"`, which cuts it with a visible marker
   (`…[truncated N chars]`). The whole packet is held under the contract's `maxTokens` (at most
   30 000, so the longest question still fits Jev's 32k state limit; tokens are estimated at
   characters ÷ 3.5).
5. **Canonical form and hash.** The packet is stable-stringified and hashed with SHA-256. The hash
   is the `packetHash` in the receipt's `stateReference`.

The result carries a **report**: included, excluded (with reason), redacted, truncated, stale and
dropped evidence ids. The packet "should be inspectable by a human. If developers cannot explain
why a field is present, the state has probably absorbed transcript history rather than decision
evidence" (§IV.E).

## Projections of one run

"Different decision families may receive different projections of the same underlying state"
(§IV.C). In FlowAId each contract declares its own `StateSpec`, so a routing contract, a
retrieval-relevance contract and an approval contract can read the same run and see different
packets. Bundles share one `stateVersion` but each question still gets its own projection
([parallel-questions.md](parallel-questions.md)).

## Testing packets

§IV.F asks for two ablations. FlowAId's contract-test runner (upgrade item J-14, not built yet) runs both against fixtures:

| Ablation                           | Failure signal                        | Meaning                                                                    |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Remove, corrupt or age each field  | Irrelevant history changes the answer | "the packet is not sufficiently isolated"                                  |
| Remove a supposedly required field | No effect                             | "either the field is unnecessary or the contract is not using it reliably" |

Fixtures record the expected route and a short human rationale, "not a chain-of-thought trace"
(§IV.F).

## Status

- **Built** (`@flowaid/jev`): the `StateSpec` and packet schemas, `buildPacket` with data classes, freshness, selection, truncation, budgets, canonical hashing and the report, and the lints above.
- **Waiting on other packages**: calling the builder from a node executor at run time (nodes-core and the runtime) and persisting packet snapshots (database). The planned `flowaid.jev.packet` node will expose the packet as an inspectable output.
