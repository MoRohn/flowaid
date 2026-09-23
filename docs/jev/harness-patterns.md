# Harness patterns: where Jev belongs

> "Jev sits at semantic transitions; authority remains deterministic." (Table VI caption)

Jev is not placed at every edge. It sits where the harness makes a semantic judgment that has a
known answer shape: before the model, before a tool, after a tool, around retrieval and at
escalation. This page describes the six patterns FlowAId ships as templates in
[`packages/jev/templates/`](../../packages/jev/templates/). The node catalog and pattern details
are in [`JEV_ENGINEERING.md` §9](../design/JEV_ENGINEERING.md).

## The placement test

"Do not place Jev at every edge simply because it is inexpensive" (§VII.F). A decision node must
do at least one of: **remove a generative call, clarify a policy boundary, improve observability,
or create a route that did not exist before**. Two misplacements to avoid: "If a node only restates
an exact condition already known to code, it adds uncertainty without adding intelligence. If a
node produces open-ended content, it is being used outside its intended role." The contract lint
flags exact rules written as questions (`exactRuleMatch`: comparisons, counts, dates, allowlists)
and free-value requests (`freeValueMatch`: names, URLs, identifiers), which belong to code or
extraction ([failure-modes.md](failure-modes.md), rows 8 and 9).

## Table VI

| Insertion point | Jev judgment              | Code authority                        | FlowAId pattern and node                       |
| --------------- | ------------------------- | ------------------------------------- | ---------------------------------------------- |
| Before model    | Route task or model       | Availability, budget, provider policy | A: `flowaid.jev.decide` over a live model menu |
| Before tool     | Estimate semantic risk    | Permission, scope, approval           | B: `flowaid.jev.tool_gate`                     |
| After tool      | Pass, repair, or escalate | Artifact and invariant checks         | C: `flowaid.jev.verify`                        |
| Retrieval       | Score decision relevance  | Exact filters and access control      | E: `flowaid.jev.relevance`                     |

Patterns D (escalation) and F (next step with stop) come from §V.A and §VIII.

## The templates

Each template is a complete `WorkflowDefinition` together with the decision contracts it binds, in
`<template>.contracts.json`. Every contract parses, lints clean and compiles into a question the
live TypeSafe API accepts; the package tests check this.

| Template                    | Pattern                                            | Contracts                                                                                | Handbook                                  |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| `jev-tool-gate`             | B: before the tool                                 | `ops.tool_risk` (Score)                                                                  | §VII.B, §VII.D Tool Semantics, §X.G       |
| `jev-verified-builder`      | C: after the tool / after generation               | `research.report_verifier` (Choice with an improve zone)                                 | §VII.C, §VII.D Builder and Verifier, §X.K |
| `jev-escalation-triage`     | D: escalation over a Choice/Score/Noul bundle      | `ops.alert_needs_owner` (Noul), `ops.alert_impact` (Score), `ops.alert_runbook` (Choice) | §VI.A, §II.F, §V.A                        |
| `jev-retrieval-relevance`   | E: retrieval relevance, with F: live menu and stop | `research.next_source` (dynamic Choice), `research.source_relevance` (Score)             | §VII.E, §VIII.A–B, §VIII.G                |
| `jev-first-contract-shadow` | Shadow beside an existing path                     | `support.ticket_router` (Choice)                                                         | §IX.A, §IX.B, §IX.D, §V.F                 |
| `jev-classifier-rollout`    | Staged rollout by contract deployment              | `support.ticket_router` (Choice)                                                         | §IX.D, §IX.F–I                            |

## Pattern A: before the model

"A generative model is unnecessary when the system only needs to decide whether a request is
simple, ambiguous, routine, high-stakes, or outside the available capability set" (§VII.A). The
router receives the **live** model menu and the budgets: "Routing over a stale menu is an invalid
graph, not a weak inference." Code first removes providers that are not eligible for the packet's
data class (§VII.G Security-Aware Routing). Jev then chooses among the providers that remain.

## Pattern B: before the tool

```
proposal = llm.propose_tool_call()
judgment = jev.classify_semantic_risk(proposal)
route = policy.apply(judgment, proposal, user_scope)
```

The proposal is **normalized first**: intended operation, target, destination, data class,
reversibility and external side effects (§VII.D Tool Semantics). Risk "cannot be evaluated reliably
from a command name alone". The tool gate fires `allow`, `review` or `deny`, and deterministic tool
policy has the last word: "A low-risk prediction cannot override an allowlist, a repository
boundary, an account permission, or a requirement for human confirmation" (§VII.B).

## Pattern C: after the tool, after generation

"A successful HTTP response or zero exit code proves that an operation completed, not that the
user's goal was achieved" (§VII.C). The verifier checks new evidence: the artifact exists, the
required sections are present, claims have citations, the destination is correct, and no approval
is still pending. Deterministic checks run first and Jev judges what remains. A failed check routes
to `repair`, `collect_evidence` or a human, "rather than an unbounded retry" (§VII.D Builder and
Verifier).

## Pattern D: escalation

A bundle asks several questions of one alert: whether it needs a named owner (Noul), how large the
impact is (Score), and which runbook applies (Choice). The routes combine consequence and
confidence ([confidence-and-consequence.md](confidence-and-consequence.md)). "Low confidence or high
consequence should escalate" (§V.A).

## Pattern E: around retrieval

The pipeline order is **cheap deterministic filters → embedding shortlist → Jev relevance score →
small evidence packet → generative model** (§VII.E). "A retrieval item should survive because it
contributes evidence to a declared question, not merely because it is topically close" (§VIII.E).
The relevance node keeps only the declared bands and records every dropped candidate with its band
and confidence, so "the trace can explain why each item survived".

## Pattern F: next step, with stop

A dynamic menu of next actions always includes `stop`: "Stop is not a failure; it is a declared
outcome with criteria that can be evaluated and audited" (§VIII.G). See
[live-menus.md](live-menus.md).

## Expand one boundary at a time

Recommended order (§IX.G): **internal routing → retrieval filtering → completion verification →
model selection → low-risk tool gating**. Consequential actions come later, and always inside
explicit policy and approval. The critic flags a plan that automates a later boundary first
([shadow-mode-and-rollout.md](shadow-mode-and-rollout.md)).

## Status

- **Built**: the six templates and their contracts, validated against the contract schema, the lint and the System One limits.
- **Waiting on other packages**: the `flowaid.jev.*` node executors (nodes-core), the compiler support that makes the templates run end to end, and the tool-proposal normalizer and tool policy modules of `@flowaid/jev`.
