# Decision receipts

> "A label without a receipt is difficult to evaluate or audit." (Table III caption)

Every Jev decision in FlowAId writes an immutable **receipt**. The receipt links the judgment to
the state, contract, thresholds and policy that existed at that moment. "It is the minimum unit for
auditing, calibration, incident review, and comparison between contract versions" (§III.D The
Decision Receipt). The implementation is
[`packages/jev/src/receipt.ts`](../../packages/jev/src/receipt.ts) with the wire types in
[`wire.ts`](../../packages/jev/src/wire.ts). The normative design is
[`JEV_ENGINEERING.md` §12](../design/JEV_ENGINEERING.md).

## What a receipt records

Table III's seven fields, and where FlowAId keeps them:

| Table III field      | Purpose                                    | Receipt field                                                        |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `contract_version`   | Identifies the semantic program            | `contract: { key, version, hash, origin }`                           |
| `state_reference`    | Links to the evaluated evidence snapshot   | `stateReference: { stateVersion, packetHash, snapshotId, fidelity }` |
| `full_distribution`  | Preserves uncertainty, not only the winner | `distribution` (every option), `bandMass` for banded scores          |
| `selected_threshold` | Explains the operating zone                | `routings[].threshold` (zone thresholds, confidence, margin, source) |
| `consequence_class`  | Explains why a route was permitted         | `routings[].consequenceClass`                                        |
| `route`              | Records auto, improve, or human            | `routings[].route` with `reasons`                                    |
| `resulting_action`   | Connects judgment to execution             | `routings[].authorizedAction`, the executed action and any overrides |

Other sections of the handbook add requirements, and the receipt carries them too:

- **Rubric level texts.** The Score level descriptions as evaluated (`rubric`), "so later analysis can distinguish model behavior from a contract change" (§II.G Rubric Design).
- **Evidence scope.** The fields and evidence ids each question was allowed to inspect (`evidenceScope`, §VI.C).
- **Option-set version.** The version of the live menu (`optionSet`, §VIII.H).
- **Model.** The provider, the requested alias and the resolved model (`jev-latest` → `jev-1.13.0`), plus the request id, latency, cost and failover attempts.
- **The safe order.** Judgment, policy verdict, execution and record, each visible (§X.N).
- **Identity.** The run, node run, node, scope, question key, bundle and batch ids, and the mode (`live`, `shadow`, `replay`, `evaluation`).

## Building and checking receipts

`buildReceipt(input)` reads the judgment from the decision under the contract and validates the
whole receipt with Zod, so a field outside the contract throws instead of being stored.
`withRouting` appends a routing record when a route node decides later. That keeps evaluation
separate from routing (§III.E). `checkReceipt` lists consistency issues: a missing distribution ("a
winner-only receipt cannot be calibrated or audited"), a distribution that does not sum to one, an
outcome that is not in the distribution, a routing without reasons, an auto routing that does not
authorise a port, and a routing confidence that differs from the receipt's.

## Tamper-evident chains

`receiptHash` is the SHA-256 of the canonical receipt. `buildReceiptChain` links receipts into a
hash chain, where each link records the sequence number, receipt hash, previous chain hash and its
own chain hash. `verifyReceiptChain(chain, receipts)` checks that:

- the sequence is contiguous,
- every link hash and back-pointer is correct,
- every receipt still hashes to its recorded value.

A changed, dropped, reordered or truncated receipt fails with the position and the reason.

## Reconstruction

A complete trace lets an investigator replay the semantic transaction (§VI.H):

1. load the state snapshot
2. recover the contract version
3. reproduce the declared options
4. inspect the distributions
5. apply the threshold configuration
6. compare the resulting route with the action that executed

The routing engine is deterministic, so step 5 re-runs `route()` on the recorded inputs and must
reproduce the recorded route and reasons. "If any link cannot be reconstructed, the decision is only
partially observable. That gap should be treated as an operational defect even when no user-visible
error occurred" (§VI.H). Receipts whose snapshot was not persisted, such as those under privacy
policy, are marked `not_persisted` and reported as partially observable.

## Counterfactual replay

"A new contract version can be replayed against historical state snapshots without repeating the
original side effects" (§III.G). Replay rebuilds the questions from the new version, asks the
provider in `replay` mode with no run, node or side effect, routes with the new policy and
reports outcome flips, route flips, accuracy and calibration before and after, and flips at the
automation boundary. Review of a new contract version cites this report
([decision-contracts.md](decision-contracts.md)).

## What receipts power

- **Calibration**: every metric is computed from labeled receipts ([calibration.md](calibration.md)).
- **Shadow comparisons**: a shadow evaluation is a receipt with `mode: "shadow"` ([shadow-mode-and-rollout.md](shadow-mode-and-rollout.md)).
- **Incident review**: the receipt answers "what the model saw, which contract interpreted it, how probability was distributed, which threshold fired, which deterministic policy applied, and which action followed" (§III.G). See [failure-modes.md](failure-modes.md).

## Status

- **Built** (`@flowaid/jev`): the receipt wire schema, `buildReceipt`, `withRouting`, routing and policy records, `checkReceipt`, `receiptHash`, and the hash chain with `verifyReceiptChain`. All are covered by tests, including tampering, reordering and truncation.
- **Waiting on other packages**: `reconstruct` and `planReplay` in `@flowaid/jev`, persistence (database), the replay job (worker) and the receipt viewer (web, using the `DecisionReceiptView` component in `@flowaid/ui`).
