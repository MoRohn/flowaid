# @flowaid/jev

Jev engineering for FlowAId: decision contracts, state packets, question bundles,
confidence × consequence routing, live option menus, decision receipts, shadow comparison,
calibration and the failure-mode catalog.

This package turns the practices of _Jev Engineering for Production Agents_
([`docs/research/jev/`](../../docs/research/jev/)) into code. Its thesis in one line: _"The LLM
turns context into new work. Jev turns state into typed judgment. Code turns judgment into
controlled action."_ (§XI.D)

- Guides: [`docs/jev/`](../../docs/jev/overview.md)
- Normative design: [`docs/design/JEV_ENGINEERING.md`](../../docs/design/JEV_ENGINEERING.md)
- Verified TypeSafe API: [`docs/design/TYPESAFE_API.md`](../../docs/design/TYPESAFE_API.md)

## Placement

`@flowaid/jev` depends only on `@flowaid/workflow-core`, `@flowaid/shared` and `zod`, and is
**browser-safe**: no Node built-ins, with hashing through `@flowaid/shared`. The compiler in the
browser, the runtime in the worker, the API, evaluation, observability and the UI therefore share
one implementation. `boundaries.json` enforces this.

## Modules, by handbook chapter

| Handbook                                | Module                                            | Main exports                                                                                                                                | Guide                                                                         |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| §II Choice, Score, Noul; §III Contracts | `contract.ts`, `ids.ts`, `diff.ts`, `registry.ts` | `DecisionContractBodySchema`, `parseContract`, `contractHash`, `interfaceHash`, `outcomePorts`, `diffContracts`, `ContractRegistry`         | [decision-contracts.md](../../docs/jev/decision-contracts.md)                 |
| Live API mapping                        | `question.ts`, `limits.ts`                        | `toDecisionQuestion`, `toSystemOneQuestion`, `toSystemOneRequest`, `validateSystemOneQuestion`, `SystemOneResponseSchema`, `estimateTokens` | [overview.md](../../docs/jev/overview.md)                                     |
| §IV State packets                       | `packet/spec.ts`, `packet/build.ts`               | `StateSpecSchema`, `StatePacketSchema`, `buildPacket`, `statePacketHash`                                                                    | [evidence-packets.md](../../docs/jev/evidence-packets.md)                     |
| §V Confidence and consequence           | `routing/*`, `consequence.ts`                     | `route`, `routeAction`, `routingSignal`, `ILLUSTRATIVE_THRESHOLDS`, `blindRetryKey`, `BlindRetryGuard`                                      | [confidence-and-consequence.md](../../docs/jev/confidence-and-consequence.md) |
| §V Calibration                          | `calibration/*`                                   | `calibrationMetrics`, `reliabilityBins`, `wilsonLower`, `psi`, `sampleForLabel`, `adjudicate`, `driftAlarms`, `recommendThresholds`         | [calibration.md](../../docs/jev/calibration.md)                               |
| §VI Parallel questions                  | `bundle.ts`                                       | `checkBundle`, `planBundle`                                                                                                                 | [parallel-questions.md](../../docs/jev/parallel-questions.md)                 |
| §VIII Live menus                        | `menu.ts`                                         | `buildOptionSet`, `optionKey`, `optionSetCriteria`, `isOptionSetStale`, `optionSetRef`                                                      | [live-menus.md](../../docs/jev/live-menus.md)                                 |
| §IX Shadow mode and rollout             | `shadow/*`                                        | `ShadowComparisonSchema`, `mapProductionAnswer`, `compareShadow`, `summarizeShadow`                                                         | [shadow-mode-and-rollout.md](../../docs/jev/shadow-mode-and-rollout.md)       |
| §III.D Receipts, §VI.H                  | `receipt.ts`, `wire.ts`                           | `DecisionReceiptSchema`, `buildReceipt`, `withRouting`, `checkReceipt`, `receiptHash`, `buildReceiptChain`, `verifyReceiptChain`            | [receipts.md](../../docs/jev/receipts.md)                                     |
| §X Failure modes                        | `catalog/*`, `lint/*`                             | `FAILURE_MODES`, `JEV_DIAGNOSTIC_CODES`, `failureModesForCode`, `failureModesForReason`, `lintContract`                                     | [failure-modes.md](../../docs/jev/failure-modes.md)                           |

## Example

```ts
import { parseContract, toDecisionQuestion, toSystemOneQuestion, buildPacket, route } from "@flowaid/jev";

const contract = parseContract(body); // e.g. support.ticket_router@1 from templates/
const packet = buildPacket(contract.state, { message, channel: "email" }, { stateVersion, now });
const question = toSystemOneQuestion(toDecisionQuestion(contract));
// … POST /v1/systemone with packet.value.packet as `state` and { route: question } as `questions`
const decision = /* the normalized DecisionResult from @flowaid/provider-typesafe */;
const { route: zone, port, reasons } = route({ contract, decision, calibrated: true });
// zone: "auto" | "improve" | "human"; port: the one control port an auto route may fire
```

## Templates

[`templates/`](templates/) holds six harness-pattern workflows: pre-tool gate, post-generation
verifier, escalation triage, retrieval relevance with a live menu, first contract in shadow, and
classifier rollout. Each ships with its contracts in `<template>.contracts.json`.
`templates/templates.test.ts` validates the workflows, their metadata and their docs pages. The
contract tests check that every shipped contract parses, lints clean and compiles into a question
the live TypeSafe API accepts.

## Development

```sh
pnpm --filter @flowaid/jev typecheck
pnpm --filter @flowaid/jev lint
pnpm --filter @flowaid/jev test
```

Tests live next to the code (`*.test.ts`). `src/test-fixtures.ts` is a test-only helper that loads
the template contracts. It is not exported and it is excluded from the build.

## Not built yet

These modules of the design (§3.2) are still to come:

- the tool-proposal normalizer and tool policy (`tools/`)
- receipt reconstruction and counterfactual replay planning (`reconstruct`, `planReplay`)
- the workflow analyzers (`analyze/`)
- incident review (`incident/`)
- rollout disposition and policy verdict helpers
- the testing contract library (`testing/`)

Integration into the compiler, database, providers, runtime, nodes, API and UI is tracked as items
J-08 to J-22 in [`docs/UPGRADE_PLAN.md`](../../docs/UPGRADE_PLAN.md).
