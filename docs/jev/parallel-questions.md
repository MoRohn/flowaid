# Parallel questions and state boundaries

> "The boundary is simple: same evidence may be evaluated together; new evidence requires a new
> snapshot." (§VI.B)

Jev answers several typed questions about one state in a single request. FlowAId uses this to
make a group of related judgments describe **one version of reality**. The implementation is
`planBundle` in [`packages/jev/src/bundle.ts`](../../packages/jev/src/bundle.ts); the normative
design is [`JEV_ENGINEERING.md` §8](../design/JEV_ENGINEERING.md).

## One snapshot, many questions

The handbook's example asks three questions of one state (§VI.A):

```
response = system_one(state=state, questions={
  'next_worker': Choice(...), 'urgency': Score(...), 'requires_approval': Noul(...) })
```

The live TypeSafe API has exactly this shape: `POST /v1/systemone` with one `state` and a
`questions` map, answered in one response ([`TYPESAFE_API.md`](../design/TYPESAFE_API.md)).
"Because the questions share one snapshot, the decision record is coherent and easier to inspect
than a chain of independent generative calls" (§VI.A).

In FlowAId a **bundle** is a set of contract-bound questions evaluated against one `stateVersion`
(`"<runId>:<scope>@<seq>"`). The `flowaid.jev.bundle` node declares up to 32 contracts. Separately,
the compiler forms batch groups automatically from decision nodes that share a state binding.

## How `planBundle` turns a bundle into requests

1. **One snapshot.** Every question must carry the bundle's `stateVersion`; a question from any
   other snapshot is refused (`checkBundle`).
2. **No dependencies inside a bundle.** "One question cannot consume another question's fresh
   answer inside the same evaluation" (§VI.B). A question that `dependsOn` another question of the
   same bundle is refused. Put it in a later node, after the action that creates the evidence.
3. **Group by transport and class.** Questions are grouped by packet, provider hop, credential,
   **privacy class** and **latency class**. "Batch only questions that belong to the same latency
   and privacy class. A sensitive approval judgment should not inherit a provider route chosen for
   a low-cost internal classification" (§VI.D Batching Economics).
4. **Respect Jev's limits.** A question whose packet plus question text exceeds 32k tokens is
   rejected. A group whose packet plus all questions exceeds 64k is split, largest questions first,
   deterministically.
5. **One request per group.** Each planned request has a `batchId`, the question keys, token
   counts (state, questions, total) and the exact System One request body.

Every receipt records its `bundleId` and `batchId`, and the evidence scope each question was
allowed to inspect (§VI.C).

## Snapshot discipline

§VI.C lists four rules, and FlowAId maps each one:

| Rule (§VI.C)                                                                                     | FlowAId                                                                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| "Every batch should carry a state version or content hash."                                      | `stateVersion` + `packetHash` on every request and receipt                                |
| "Prevent relevant writes between snapshot creation and evaluation, or at least record the race." | The runtime checks the scope's sequence at evaluation; a race is recorded as `state_race` |
| "The decision receipt should identify which evidence each question was allowed to inspect."      | `evidenceScope: { fields, evidenceIds }` on each receipt                                  |
| Batching "provides a semantic transaction boundary."                                             | A bundle's receipts share one snapshot; any later write starts a new one                  |

## Dependent sequences stay visible

When the next judgment needs new evidence, the graph shows it (§VI.E):

```
STATE v7 -> decide: evidence missing -> search: obtain official source -> STATE v8
         -> decide: evidence sufficient -> route: fact_check -> STATE v9
```

"Each arrow that creates evidence must be visible in the trace." In FlowAId each arrow is a node,
each node run advances the state sequence, and each decision after it records the new
`stateVersion`. A label that hides a multi-step plan is failure mode 10 in the
[catalog](failure-modes.md).

## Decision parallelism is not execution parallelism

"Two decisions may be semantically independent while their resulting actions contend for the same
file, queue, budget, or external account" (§VI.F). FlowAId evaluates bundle questions together and
then runs the resulting actions under the ordinary execution rules: concurrency limits, joins, and
idempotency and locking declared per node. A fast decision model does not remove ordinary
distributed-systems concerns.

## Failure modes this prevents

"Batching questions that actually depend on one another, mixing state versions in one record,
evaluating after a write without rebuilding evidence, and logging only the final selected answer"
(§VI.G). The bundle planner refuses the first two. The runtime's state-race check covers the third.
The receipt's full distribution covers the fourth.

## Status

- **Built** (`@flowaid/jev`): `checkBundle` and `planBundle` (snapshot, dependency, class and 32k/64k rules), the System One request builder and validators. All are covered by tests.
- **Waiting on other packages**: sending requests (provider-typesafe), the `flowaid.jev.bundle` node (nodes-core) and the runtime's state-race check.
