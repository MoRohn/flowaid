# flowaid — Jev engineering addendum: decision contracts, packets, routing, calibration, receipts

Status: **authoritative addendum** (v1.1, 2026-09-23), proposed for implementation through track **J** of `docs/UPGRADE_PLAN.md` (§6 there; machine-readable `docs/upgrade-plan.json`, `tracks[0]`). It makes the practices of _Jev Engineering for Production Agents: A Practical Handbook on Typed Semantic Decisions_ (September 2026; independent study edition, not affiliated with TypeSafe AI) a first-class part of how flowaid designs, runs, evaluates and explains decisions.

Sources, in order of authority for what they cover:

| Source                                                              | Authority for                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/CONTRACTS.ts`                                          | Types that exist today. It stays **frozen**: every contract change below is an RFC (RFC-0013…0016 in `RFCS.md`, exact diffs in §18).                                                                                                                                                                                                                                                                                               |
| `docs/design/TYPESAFE_API.md`                                       | The live Jev API (field names, limits, pricing). The handbook's code is pseudocode.                                                                                                                                                                                                                                                                                                                                                |
| This addendum                                                       | Everything about contract-bound decisions: contracts, packets, bundles, routing, calibration, shadow mode, rollout, receipts, Jev diagnostics, the `@flowaid/jev` package and the `flowaid.jev.*` nodes. Where it conflicts with `ARCHITECTURE.md`/`UI.md`/`API.md`/`DATABASE.md` on the behaviour of a **contract-bound** decision, this addendum wins; legacy `flowaid.decision.*` nodes keep their documented semantics (§6.8). |
| `docs/research/jev/jev-engineering-for-production-agents.{pdf,txt}` | The practices. Cited as `§<Roman>.<Letter> <Title>` because ten sections print a subsection letter twice (study guide §15 item 1).                                                                                                                                                                                                                                                                                                 |
| `docs/research/jev/JEV_EXPERT_GUIDE.md`                             | The distillation this addendum was built from (catalog numbering in §13 follows its §11.1).                                                                                                                                                                                                                                                                                                                                        |

Normative words: **MUST**, **MUST NOT**, **SHOULD**, **MAY**. Every number the handbook gives is illustrative ("Thresholds are illustrative and must be calibrated per action class", Table V); every number in this document that is not a verbatim handbook or API figure is a **flowaid default** and is listed in Appendix A.

Reading order: §0 → §1 → §4 (contracts) → §5 (packets) → §6 (routing) → §12 (receipts); implementers of a single package go to §3 (package map) and §20 (track J).

Revision v1.1 (2026-09-23, second pass of the gap analysis against the handbook and the design): run-start resolution when an environment has no contract deployment, for `runLocally` and for evaluation runs (§4.4); implicit contracts are synthesised outside the plan so legacy plans keep their `planHash`, and legacy nodes keep sending `state` verbatim (§4.4, §12.2); draft-level compiles may reference a contract version still in review (§4.4); one definition of `calibrated` (§6.4); canary evaluation order with pre- and post-evaluation guardrails (§6.7); the `NODE_SCHEDULED` seq behind `stateVersion` (§8.1); the per-candidate question of the relevance node (§9.6); templates provision their contracts (§9.8); promotion out of shadow no longer presupposes the baseline it freezes (§7.7, §11.4); the optimizer extends `batch_decisions` instead of adding a twin (§14.4); track J aligned with the upgrade plan, with hard and soft dependencies and what is buildable now (§20.1).

---

## 0. Summary for implementers

The handbook's thesis in one line: _"The LLM turns context into new work. Jev turns state into typed judgment. Code turns judgment into controlled action."_ (§XI.D). flowaid already has the typed primitives (Boolean/Noul, Choice, Score), native batching and a confidence gate. What it lacks is the engineering around them: a versioned **decision contract**, a compact **state packet**, **consequence-aware routing** with an improve-state zone, **calibration** in production, **shadow mode** and staged rollout, a per-decision **receipt**, and a compiler/critic/reviewer that knows the failure modes. This addendum adds exactly those.

Ten rules every flowaid component follows from now on:

| #   | Rule                                                                                                                                                                                                                                          | Where    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | A production semantic decision is a **versioned contract** (`<key>@<n>`), stored in a registry separate from workflow versions, reviewed like code, deployed per environment and rolled back independently.                                   | §4, §11  |
| R2  | Jev sees a **compact packet** built from declared fields only (least privilege), with evidence instead of conclusions, provenance, freshness, a token budget under the 32k state limit and a content hash. Never a transcript.                | §5       |
| R3  | **Consequence before confidence**: irreversible actions route to a human at every confidence; otherwise confidence maps to **auto / improve / human** with thresholds owned per consequence class and governed like production configuration. | §6       |
| R4  | The **improve** zone names the action that changes the evidence; re-asking the same contract on the same packet is blocked (blind-retry guard).                                                                                               | §6.5     |
| R5  | **Authority stays in code**: a contract declares its allowed actions; the compiler proves no auto route reaches an action outside them; the safe order _judge → policy → execute → record_ is visible in every receipt.                       | §6.6     |
| R6  | Independent questions share **one snapshot** (`stateVersion`), batched per packet into TypeSafe requests; new evidence means a new snapshot. Bundles never mix privacy or latency classes.                                                    | §8       |
| R7  | Option menus that can change are **built live** immediately before evaluation (≤ 255 options including escapes), versioned, counted and carry an **escape hatch**; `stop` is a declared outcome.                                              | §10      |
| R8  | New contracts run in **shadow** first; automation starts with **one low-consequence outcome** under deterministic guardrails and a rollback trigger defined before launch.                                                                    | §11      |
| R9  | Every decision writes an **immutable receipt** (contract version, state reference, full distribution, thresholds, consequence class, route, policy, action, overrides) that makes the semantic transaction replayable.                        | §12      |
| R10 | The failure-mode catalog is **executable**: compiler diagnostics, runtime route reasons, TraceReviewer signals and advisor rules all come from one catalog in `@flowaid/jev`.                                                                 | §13, §14 |

What changes where:

| Area                       | Change                                                                                                                                                                                                                                        | Track J    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| New package `@flowaid/jev` | Schemas, builders, routing engine, calibration math, receipts, menus, shadow, lints, static analyzers. Depends only on `@flowaid/workflow-core` + `@flowaid/shared` (+ `zod`). Browser-safe. **Buildable now.**                               | J-01…J-07  |
| `CONTRACTS.ts` (via RFC)   | Wire types for receipts (§7.1), 7 new run events + 3 additive fields (§11), 45 diagnostic codes (§12), `contractPorts` rule, `PlanNode.jev`, `CompileOptions.resolveContract`, `ctx.jev`, `ProviderAccess.models` (§4/§13/§16), 5 jobs (§17). | J-08       |
| Compiler                   | Contract resolution, Jev pass (lints + authority proofs), bundle formation by packet/privacy/latency class, quick-fixes.                                                                                                                      | J-09       |
| Database                   | 9 tables: `decision_contracts`, `decision_contract_versions`, `decision_contract_deployments`, `decision_snapshots`, `decision_receipts`, `decision_labels`, `shadow_comparisons`, `calibration_snapshots`, `decision_fixtures`.              | J-10       |
| Providers                  | Contract-aware bundles → TypeSafe requests, alias vs resolved model, uncalibrated-provider flag.                                                                                                                                              | J-11       |
| Runtime                    | Run-start contract resolution, `stateVersion`, receipts from node facts, action/override linkage, blind-retry guard, rollout sampling.                                                                                                        | J-12       |
| Nodes                      | `flowaid.jev.{decide,bundle,route,menu,packet,tool_gate,verify,relevance,shadow}` + harness templates + upgraded demos.                                                                                                                       | J-13       |
| Evaluation                 | Contract test runner, fixture categories, dual labels, monotonicity, ablation, Table VIII economics.                                                                                                                                          | J-14       |
| API / worker               | `/v1/decision-contracts`, `/v1/decision-receipts`, `/v1/shadow-comparisons`, calibration, labels, fixtures, replay; scopes `decisions:*`; `FeatureKey` `decision_contracts`; jobs.                                                            | J-15       |
| Observability              | TraceReviewer Jev signals, incident review, Jev metrics, drift/rollback notifications.                                                                                                                                                        | J-16       |
| UI / web                   | `@flowaid/ui` `jev` group; Decisions section, receipt viewer, calibration, shadow, rollout, labeling, incident workbench, builder integration.                                                                                                | J-17, J-18 |
| Advisor                    | Critic (inventory, catalog, launch checklist), builder (boundary test), optimizer (replace LLM classification, move exact rules to code).                                                                                                     | J-19       |
| Agent / RAG                | Pre-tool gate in the agent loop, relevance contracts in retrieval, live model menus.                                                                                                                                                          | J-20       |
| Rollout                    | Rollback triggers evaluated every 5 min, automatic pause/rollback, shadow baselines frozen at promotion, rollout report on completed-task outcomes.                                                                                           | J-21       |
| Docs / CLI                 | Docs pages, `support.router@1…@4` history, first-contract-in-shadow playbook, offline `flowaid decisions lint`.                                                                                                                               | J-22       |
| Templates                  | Built-in templates ship their contracts; instantiation provisions them (approved and deployed only in non-protected environments).                                                                                                            | J-13, J-15 |

---

## 1. Principles adopted (normative)

### 1.1 Three owners and the boundary test

flowaid assigns every branch to exactly one owner (§I.D, Table I):

| Owner          | Owns                                                                                     | flowaid construct                                                                |
| -------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Generative LLM | Output that must be authored (text, code, plans, tool arguments)                         | `flowaid.ai.*`, agent tool loop                                                  |
| Jev            | Ambiguous meaning when the answer shape is known (one winner / ordered quality / yes-no) | contract-bound `flowaid.jev.*` nodes (legacy `flowaid.decision.*`)               |
| Code           | Exact invariants, permissions, budgets, arithmetic, dates, allowlists, exact strings     | `branch`, FlowExpr, bounds, policies, credential scopes, tool gates' policy half |
| Code + human   | Consequential side effects                                                               | `human` nodes, inline escalation, approvals                                      |

The **operational boundary test** (§I.G Boundary Test) is implemented by the analyzer in §14.1 and the lints `W_JEV_GENERATION_FOR_DECISION`, `W_JEV_EXACT_RULE`, `W_JEV_FREE_VALUE`: (1) must the output be authored? → LLM; (2) ambiguous meaning, known shape? → Jev; (3) must it be obeyed exactly? → code; (4) all three → decompose into generation, judgment and enforcement nodes so a failure is attributable to one of them.

### 1.2 The safe operating order is a runtime invariant

_"Jev judges; code checks policy; the tool executes; the trace records."_ (§I.E, §X.N). In flowaid:

1. **Judge** — a contract-bound node evaluates one immutable packet (`DECISION_REQUESTED`/`DECISION_COMPLETED`).
2. **Policy** — the routing engine (§6.4) and deterministic policy (allowed actions proven at compile time, rollout guardrails, tool-gate policy, credential scopes, bounds, approvals) produce a route and a verdict (`DECISION_RECEIPT.routings[].policy`).
3. **Execute** — only the control port the policy authorised fires; the downstream node executes (`DECISION_ACTION_RECORDED`).
4. **Record** — the receipt links all three, and later overrides and labels (§12).

No flowaid component may execute a side effect because a decision _said_ so without step 2 in between (enforced statically by `E_JEV_AUTHORITY_EXCEEDED`, `E_JEV_IRREVERSIBLE_AUTO`, `W_JEV_POLICY_IN_CLASSIFIER`, and at run time by the runtime firing only authorised ports).

### 1.3 Vocabulary

| Term                      | Meaning in flowaid                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision contract         | Versioned specification of one semantic question: state spec, instructions, outcomes/rubric, escape hatch and fallback, thresholds by consequence class with governance, allowed actions, escalation, model, owner, tests (§4). Identified `<key>@<version>`. |
| Interface                 | The part of a contract a workflow is compiled against (kind, static outcome keys, escapes, state field names/schemas, routing ports). Versions with the same `interfaceHash` are interchangeable at run start (§4.4).                                         |
| State packet              | The compact JSON actually sent as TypeSafe `state` (§5.1), built from declared fields.                                                                                                                                                                        |
| Snapshot / `stateVersion` | The run state a packet was built from: `"<runId>:<scope>@<seq>"`, the event sequence number whose reduced state resolved the inputs (§8.4).                                                                                                                   |
| Bundle                    | All questions evaluated against one snapshot (`bundleId`). A bundle issues one TypeSafe request per distinct packet (`batchId`).                                                                                                                              |
| Consequence class         | `low` · `medium` · `high` · `irreversible` — stakes of the action a judgment may authorise (§6.1).                                                                                                                                                            |
| Route                     | `auto` · `improve` · `human` (Table III "Records auto, improve, or human").                                                                                                                                                                                   |
| Disposition               | What rollout allowed: `active` · `canary` · `holdback` · `shadow` (§6.7).                                                                                                                                                                                     |
| Receipt                   | Immutable per-question record of judgment, snapshot, policy and action (§12).                                                                                                                                                                                 |
| Escape outcome            | An outcome marked `none` · `other` · `stop` · `review` · `escalate` that absorbs probability mass when reality is not on the menu (§II.A, §X.B).                                                                                                              |
| Implicit contract         | A contract the compiler synthesises for a legacy `flowaid.decision.*` node so it still produces receipts (§4.4).                                                                                                                                              |

---

## 2. Gap analysis

### 2.1 Method

Every practice of the handbook (§I–§XI, the four figures/code sketches that carry rules, and Tables I–IX) was compared with the design as written in `ARCHITECTURE.md` (§2.8 decision result, §4.4 batch groups, §6 providers, §10.1 human-in-the-loop, §10.4 evaluation, §10.5 observability, §11 demos), `CONTRACTS.ts` (§7 `DecisionResult`, §11 events, §12 diagnostics, §15 `DecisionQuestion`/`DecisionState`), `UI.md`, `API.md`, `DATABASE.md` and `docs/UPGRADE_PLAN.md`. Status values: **aligned** (the design already does it), **partial** (the mechanism exists but misses a required element), **missing**, **conflict** (the design does something the handbook warns against). Gap ids `G-nn` are defined in §2.4 and are the `resolves` ids of the J items.

### 2.2 Practice-by-practice matrix

#### §I Why a decision layer

| #   | Practice                                                                                                                                                                                  | flowaid today                                                                                                            | Status                 | Resolution                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| I-1 | Stop implementing small branches as prose generation; the hidden cost is sequential latency, repeated context, JSON repair, schema retries and recovery (§I.A)                            | Decision nodes exist (ARCH §6.3); nothing detects `ai.generate`/`ai.structured_generate` used as a classifier            | partial                | `W_JEV_GENERATION_FOR_DECISION` + quick fix, optimizer `replace_generation_with_contract` (§13, §14.4) — G-17, G-20 |
| I-2 | Typed semantic judgment; constrained outputs compose with program logic (§I.B)                                                                                                            | `DecisionResult` union on typed `decision` ports (ARCH §2.8)                                                             | aligned                | contracts add the semantics (§4)                                                                                    |
| I-3 | The unit of analysis is the completed task (§I.C)                                                                                                                                         | `EvaluationSummary.completionRate`, cost per case (ARCH §10.4); no recovery cost, no cost per completed task             | partial                | Table VIII economics (§14.5) — G-19, G-25                                                                           |
| I-4 | Three owners: LLM authors, Jev interprets, code enforces (§I.D, Table I)                                                                                                                  | Decision vs generation taxonomy, deterministic `branch` (ARCH §2.4)                                                      | partial (not enforced) | boundary lints (§1.1, §13) — G-17                                                                                   |
| I-5 | Authority outside the model; safe order judge → policy → execute → record (§I.E, §X.N)                                                                                                    | Gates and branches exist; no allowed-action concept; nothing proves a decision cannot reach a side effect without policy | missing                | allowed actions, compile-time proofs, policy record in receipts (§1.2, §6.6) — G-07                                 |
| I-6 | Boundary design: remove generation where unnecessary; _"The goal is not to maximize Jev usage"_ (§I.F, Abstract)                                                                          | —                                                                                                                        | missing                | KPI "generative calls removed", `W_JEV_PLACEMENT` (§13, §14.4) — G-20, G-25                                         |
| I-7 | Inventory hidden decisions (request clarity, worker selection, model selection, retrieval survival, tool risk, completion, retry, escalation, stop) with owner and class (§I.G Inventory) | —                                                                                                                        | missing                | hidden-decision inventory (§14.1) — G-20                                                                            |
| I-8 | Boundary test and decomposition; failure attribution to generation / judgment / enforcement (§I.G Boundary Test)                                                                          | —                                                                                                                        | missing                | analyzer (§14.1) and incident boundary attribution (§13.3) — G-17, G-18                                             |

#### §II Choice, Score, Noul

| #     | Practice                                                                                                                                            | flowaid today                                                                                | Status   | Resolution                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| II-1  | Choice criteria state the evidence that distinguishes each outcome (§II.A, §VIII.F)                                                                 | `options: Record<key, description>` (CONTRACTS §15); `CriteriaEditor`                        | partial  | `OutcomeSpec.description`, `W_JEV_OPTIONS_UNDISTINGUISHED` (§4.2, §13) — G-13                           |
| II-2  | Closed menus need an escape hatch (none/other/stop/escalate, review) (§II.A, §X.B)                                                                  | No escape semantics; demo 1 relies on `general: "Anything else"`                             | missing  | `OutcomeSpec.escape`, escape routes (§4.2, §6.4), `W_JEV_NO_ESCAPE_HATCH` — G-13                        |
| II-3  | Choice never invents identifiers, URLs, numbers or names (§II.A, §X.I Unknown Values)                                                               | Choice keys validated ⊆ options (ARCH §6.3)                                                  | partial  | `W_JEV_FREE_VALUE`; dynamic menus return only declared candidates (§10) — G-12, G-17                    |
| II-4  | Score levels are verbal; interpolation is a position, not a measurement (§II.B)                                                                     | `ScoreDecision.normalized = value/(n−1)` (CONTRACTS §7) invites an "80 percent good" reading | conflict | `normalized` is display-only; score **bands** for routing (§6.2); `W_JEV_SCORE_AS_MEASURE` — G-21       |
| II-5  | Noul is yes/no uncertainty, not severity; the application sets bands (§II.C)                                                                        | `pYes` + node threshold (ARCH §6.3)                                                          | partial  | `W_JEV_PRIMITIVE_MISMATCH` on multi-band `pYes` branches (§13) — G-17                                   |
| II-6  | Selection discipline incl. the two "Not Jev" rows (Table II)                                                                                        | `E_DECISION_CONFIG` checks sizes only                                                        | partial  | `W_JEV_EXACT_RULE`, `W_JEV_FREE_VALUE` (§13) — G-17                                                     |
| II-7  | Type safety is not truth: representative examples, thresholds, deterministic checks, receipts, review paths (§II.E)                                 | Typed results, evaluation sets                                                               | partial  | this addendum as a whole — G-08, G-19                                                                   |
| II-8  | Compose primitives over one snapshot; never chain dependent questions in one request (§II.F)                                                        | Batch node and compiler batch groups exclude dependency paths (ARCH §4.4)                    | aligned  | bundle record + `stateVersion` (§8)                                                                     |
| II-9  | Rubrics: observable evidence, meaningful boundaries, reviewer consistency, prefer 3–5 levels, keep level texts in the receipt (§II.G Rubric Design) | 2–10 levels kept in `ScoreDecision.levels`                                                   | partial  | `W_JEV_RUBRIC_LEVELS`, `W_JEV_RUBRIC_ANCHORS`, `receipt.rubric`, inter-rater metric (§7.2) — G-17, G-09 |
| II-10 | Anti-patterns: multi-label as Choice, Score on unordered categories, Noul as severity; divide the question (§II.G Primitive Anti-Patterns)          | —                                                                                            | missing  | `W_JEV_PRIMITIVE_MISMATCH` (§13) — G-17                                                                 |

#### §III Decision contracts as code

| #      | Practice                                                                                                                                                                                                                     | flowaid today                                                                                                      | Status  | Resolution                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------- |
| III-1  | A production question is a contract; identifiers are not instructions (§III.A)                                                                                                                                               | Question = instructions + options in node config                                                                   | missing | `DecisionContractBody` (§4.2), `W_JEV_INSTRUCTIONS_WEAK` — G-01              |
| III-2  | Minimal contract: state schema, instructions, options/rubric, fallback, thresholds, consequence class, allowed action, escalation, model version, contract version (§III.B)                                                  | 3 of 10 (instructions, options/levels, model via the decision chain)                                               | missing | §4.2–4.3 — G-01                                                              |
| III-3  | Allowed action narrower than the judgment; the harness verifies it (§III.B, §III.D Review)                                                                                                                                   | —                                                                                                                  | missing | `AllowedAction` + compile-time proof + policy record (§6.6) — G-07           |
| III-4  | Version contracts separately: review, evaluate on history, deploy gradually, roll back (§III.C)                                                                                                                              | Decisions change only with the workflow version (D12)                                                              | missing | registry, deployments, run-start resolution (§4.1, §4.4, §11.3) — G-01, G-11 |
| III-5  | Review like code: every field necessary, outcomes distinguishable, escape hatch, every confidence range routed, allowed action narrower, exact constraints in code; regression tests; explanation of changes (§III.D Review) | —                                                                                                                  | missing | review workflow, lints, semantic diff, replay gate (§4.6) — G-02             |
| III-6  | Receipt per decision (Table III)                                                                                                                                                                                             | `DECISION_COMPLETED` carries the full `DecisionResult`; no contract version, threshold, consequence, route, action | partial | `DecisionReceipt` (§12), RFC-0013 — G-08                                     |
| III-7  | Lifecycle: define; evaluate one immutable snapshot; route via consequence thresholds and deterministic policy; record — no stage hidden in another (§III.E)                                                                  | Decision node + separate gate (ARCH §6.3)                                                                          | partial | decide/route split with receipts (§6, §9.1) — G-05, G-08                     |
| III-8  | One distribution, several authority policies (§III.E)                                                                                                                                                                        | A gate can read any decision                                                                                       | aligned | several `routings[]` per receipt (§12.2)                                     |
| III-9  | Contract tests: ordinary, ambiguous, missing evidence, adversarial, stale options, no-fit; confidence monotone in evidence quality (§III.F)                                                                                  | Evaluation sets without categories                                                                                 | missing | fixtures + contract test runner (§14.5) — G-19                               |
| III-10 | Incident answers: what the model saw, which contract, distribution, threshold, policy, action (§III.G)                                                                                                                       | Trace `DecisionCard` shows value/confidence/distribution                                                           | partial | receipt reconstruction (§12.3) — G-08, G-18                                  |
| III-11 | Counterfactual replay of a new version on historical snapshots without side effects (§III.G)                                                                                                                                 | Run-level recorded replay/fork (ARCH §5.9) re-executes side effects when inputs change                             | missing | contract replay over `decision_snapshots` (§12.4) — G-08                     |

#### §IV State packets and evidence

| #    | Practice                                                                                                                                          | flowaid today                                                                                | Status  | Resolution                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| IV-1 | Compact, current, evidence-based packet separating goal, facts, artifacts, evidence, constraints, options, version (§IV.A, Table IV)              | `DecisionState` "objects are sent verbatim" (CONTRACTS §15, ARCH §6.1)                       | missing | `StatePacket` + `StateSpec` (§5) — G-03                                                      |
| IV-2 | Evidence, not inherited confidence (§IV.B, §X.A)                                                                                                  | The ARCH §2.9 example passes `team` (a prior decision's value) into `safe`'s state as a fact | missing | `W_JEV_CONCLUSION_AS_EVIDENCE`, `I_JEV_INHERITED_JUDGMENT` (§13) — G-03                      |
| IV-3 | Least privilege; field-level access rules; per-family projections (§IV.C State Access Control)                                                    | Redaction happens at persistence (ARCH §10.6), not before sending                            | missing | declared fields, data classes, provider eligibility (§5.2, §5.6) — G-03                      |
| IV-4 | Freshness: timestamps/versions, rebuild live options, prevent or record writes between snapshot and evaluation, retries need new evidence (§IV.D) | Node outputs are immutable once produced                                                     | partial | freshness spec, `stateVersion`, race record, blind-retry guard (§5, §6.5, §8.4) — G-04, G-15 |
| IV-5 | Minimization is a declaration of relevance; code pre-filters; the packet is human-inspectable (§IV.E)                                             | —                                                                                            | missing | field descriptions + `PacketReport` (§5.5) — G-03                                            |
| IV-6 | Packet tests: remove/corrupt/stale fields; fixtures with expected route and a short human rationale (§IV.F)                                       | —                                                                                            | missing | ablation generator + fixtures (§5.7, §14.5) — G-19                                           |

#### §V Confidence, consequence, calibration

| #   | Practice                                                                                                                                                                | flowaid today                                                                                     | Status   | Resolution                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| V-1 | Confidence is a routing signal; three zones auto / improve / human (§V.A)                                                                                               | `confidence_gate` sends the middle band to human review and the lowest band to `fail` (ARCH §6.3) | conflict | three-zone router (§6.4), gate kept for legacy (§6.8) — G-05                         |
| V-2 | Thresholds belong to the consequence class; irreversible actions stay review-gated (§V.A, Table V, §X.C)                                                                | One threshold variable per gate                                                                   | missing  | `RoutingPolicy.thresholds` per class; irreversible fixed (§6.3) — G-06               |
| V-3 | The improve zone specifies how state improves; the retry budget purchases information (§V.B)                                                                            | —                                                                                                 | missing  | `ImproveAction`, `maxRounds`, blind-retry guard (§6.5) — G-05, G-15                  |
| V-4 | Threshold governance (owner, rationale, evaluation window, consequence class, rollback condition); monitor near-threshold mass (§V.C Threshold Governance)              | —                                                                                                 | missing  | `ThresholdGovernance`, near-threshold metric and alarm (§6.3, §7) — G-06             |
| V-5 | Reliability on labeled workload data (§V.C Calibration, Fig. 2)                                                                                                         | ECE per node inside evaluation runs (ARCH §10.4); `CalibrationChart`                              | partial  | production calibration per contract (§7) — G-09                                      |
| V-6 | Brier for Noul, top-label/classwise for Choice, segmentation by version, consequence, language, rare option (§V.D)                                                      | ECE only, per node                                                                                | partial  | §7.2–7.3 — G-09, G-22                                                                |
| V-7 | Confidence is not authority; consequence check precedes confidence (§V.E)                                                                                               | Gate is the only authority step                                                                   | partial  | §6.4 algorithm, §6.6 — G-05, G-07                                                    |
| V-8 | Calibration rollout: estimate in shadow, recheck after automation, recompute after contract/state-schema changes; oversample rare, consequential, near-threshold (§V.F) | —                                                                                                 | missing  | stratified label sampling with inverse-probability weights (§7.1), §7.7 — G-09, G-10 |

#### §VI Parallel questions and state boundaries

| #     | Practice                                                                                                          | flowaid today                                               | Status  | Resolution                                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| VI-1  | One snapshot, many questions; coherent record (§VI.A)                                                             | Batch node / batch groups share one `requestId` (ARCH §4.4) | aligned | bundle record (§8.1)                                                                        |
| VI-2  | Batching exposes incompatible projections (§VI.A)                                                                 | Groups require identical `state` binding ASTs               | partial | per-contract projections; bundle = one `stateVersion`, one request per packet (§8.2) — G-14 |
| VI-3  | Independence boundary: new evidence requires a new snapshot (§VI.B)                                               | No dependency paths inside a group                          | aligned | kept (§8.3)                                                                                 |
| VI-4  | Snapshot discipline: version or hash per batch; prevent or record races; per-question evidence scope (§VI.C)      | `DECISION_REQUESTED.stateHash` only                         | partial | `stateVersion`, race record, `evidenceScope` (§8.4, §12.1) — G-04                           |
| VI-5  | Batch only within one latency and privacy class (§VI.D Batching Economics)                                        | Not considered                                              | missing | group key extension, `E_JEV_BUNDLE_CLASS_MIX` (§8.3) — G-14                                 |
| VI-6  | Decision records keep distributions (§VI.D Decision Record)                                                       | `DECISION_COMPLETED` keeps `DecisionResult`                 | aligned | receipts (§12)                                                                              |
| VI-7  | Each evidence-creating arrow visible: STATE vN → act → vN+1 (§VI.E)                                               | Events exist; state versions not surfaced                   | partial | `stateVersion` on packets/receipts, Decisions timeline (§8.5, §17) — G-27                   |
| VI-8  | Separate decision parallelism from execution parallelism (§VI.F)                                                  | Run-level `concurrency` only                                | missing | `W_JEV_PARALLEL_SIDE_EFFECTS` and serialization rules (§8.6) — G-26                         |
| VI-9  | Failures: dependent batching, mixed versions in one record, evaluation after a write, winner-only logging (§VI.G) | Partly prevented by the compiler                            | partial | §8, §12, §13 — G-04, G-08                                                                   |
| VI-10 | Trace reconstruction in six steps; partial observability is a defect (§VI.H)                                      | —                                                           | missing | `ReconstructionCheck` (§12.3), TraceReviewer signal — G-18                                  |

#### §VII Harness placement

| #     | Practice                                                                                                                                           | flowaid today                                                                       | Status  | Resolution                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| VII-1 | Before the model: route task/model over the live menu with budgets and consequence class; no stale catalog (§VII.A)                                | P6-01 smart routing is a deterministic strategy (`cheapest`/`fastest`/`healthiest`) | partial | Pattern A (§9.2), `ProviderAccess.models` (RFC-0015) — G-16        |
| VII-2 | Before the tool: Jev estimates semantic risk, code checks permission, scope, budget, destination, approval (§VII.B)                                | Agent `approval: always\|irreversible\|never`, capability scopes (ARCH §3.6, §10.1) | partial | `flowaid.jev.tool_gate` (§9.3) — G-16, G-07                        |
| VII-3 | After the tool: verify the goal, not transport success (§VII.C, §X.K)                                                                              | `validator` node (boolean rubric)                                                   | partial | `flowaid.jev.verify`, `W_JEV_TRANSPORT_VERIFICATION` (§9.4) — G-16 |
| VII-4 | Normalized tool proposal: operation, target, destination, data class, reversibility, external side effects (§VII.D Tool Semantics)                 | `TOOL_CALLED` carries raw args                                                      | missing | `ToolProposal` (§9.3) — G-16                                       |
| VII-5 | Builder and verifier share an artifact and a rubric; failure → repair / evidence / escalation, never unbounded retry (§VII.D Builder and Verifier) | Loops are bounded                                                                   | partial | Pattern C (§9.4) — G-16                                            |
| VII-6 | Retrieval: exact filters → embedding shortlist → Jev relevance → small evidence packet → generation (§VII.E)                                       | Research demo scores each result; RAG in P6-09                                      | partial | `flowaid.jev.relevance` (§9.6) — G-16                              |
| VII-7 | Placement discipline: a node must remove a generative call, clarify a policy boundary, improve observability or create a route (§VII.F)            | —                                                                                   | missing | `W_JEV_PLACEMENT` (§13) — G-17                                     |
| VII-8 | Security-aware routing: code prunes ineligible providers by data class before Jev chooses (§VII.G)                                                 | Data classes exist; no provider eligibility                                         | missing | provider eligibility (§5.6), menu pruning (§10) — G-03, G-16       |

#### §VIII Live menus and retrieval

| #      | Practice                                                                                                                 | flowaid today                                                                            | Status  | Resolution                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| VIII-1 | Menus are runtime state derived immediately before evaluation (§VIII.A)                                                  | Options are static config; demo 2 deliberately avoids runtime criteria (ARCH §11.2 note) | missing | dynamic menus (§10) — G-12                            |
| VIII-2 | Large sets: deterministic exclusion → shortlist → Jev; keep an escape hatch; log original and surviving counts (§VIII.B) | —                                                                                        | missing | `flowaid.jev.menu` counts (§10.2) — G-12              |
| VIII-3 | Worker menus carry availability, capability, cost, latency, trust policy, load (§VIII.C)                                 | —                                                                                        | missing | Pattern F (§9.7) — G-12                               |
| VIII-4 | Test the menu builder separately from the choice (§VIII.D Option-Set Tests)                                              | —                                                                                        | missing | §10.5 — G-12                                          |
| VIII-5 | Staleness hazards and corrections (Table VII)                                                                            | —                                                                                        | missing | §10.4 — G-12                                          |
| VIII-6 | Retrieval packets record source ids and support relations (§VIII.E)                                                      | —                                                                                        | missing | `EvidenceItem.supports` (§5.1), relevance node — G-16 |
| VIII-7 | Descriptions distinguish, they do not praise; overlapping options get review/none (§VIII.F)                              | —                                                                                        | missing | `W_JEV_OPTIONS_UNDISTINGUISHED` — G-13                |
| VIII-8 | Stop is a declared, auditable outcome (§VIII.G)                                                                          | Loops exit through `exitWhen` only                                                       | partial | escape `stop` (§4.2), `W_JEV_NO_STOP` — G-13          |
| VIII-9 | Explicit cache invalidation; event-driven over TTL; option-set version in the receipt (§VIII.H)                          | —                                                                                        | missing | §10.3, `receipt.optionSet` — G-12                     |

#### §IX Evaluation and rollout

| #     | Practice                                                                                                                                                                                                         | flowaid today                      | Status  | Resolution                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------- | ------------------------------------------------------- |
| IX-1  | Begin with one high-volume, low-consequence, later-labelable decision (§IX.A)                                                                                                                                    | —                                  | missing | critic "first contract" proposal (§14.1) — G-20         |
| IX-2  | Write the contract before calling the model; no agreement → not ready (§IX.B)                                                                                                                                    | —                                  | missing | registry-first node creation (§4.4) — G-01              |
| IX-3  | Representative set: normal, ambiguous, missing evidence, adversarial, stale options, rare classes, no-fit; real distribution plus counterexamples (§IX.C)                                                        | Evaluation sets without categories | partial | fixture categories and required coverage (§14.5) — G-19 |
| IX-4  | Shadow mode logging (§IX.D)                                                                                                                                                                                      | —                                  | missing | §11 — G-10                                              |
| IX-5  | Written labeling rubric, adjudication, preserved disagreement, dual labels for consequential branches (§IX.E Labels)                                                                                             | —                                  | missing | §7.1 — G-09                                             |
| IX-6  | Whole-system metrics (Table VIII) (§IX.E Evaluate the Whole System)                                                                                                                                              | Partly in `EvaluationSummary`      | partial | §14.5 — G-19, G-25                                      |
| IX-7  | Automate one low-consequence, well-calibrated outcome; keep the rest in review; compare with the shadow baseline; immediate rollback (§IX.F)                                                                     | —                                  | missing | outcome allow-list, canary, rollback (§11.3) — G-11     |
| IX-8  | Expand one boundary at a time: routing → retrieval filtering → completion verification → model selection → low-risk tool gating (§IX.G)                                                                          | —                                  | missing | expansion guidance in the critic (§14.2) — G-11, G-20   |
| IX-9  | Monitor drift by contract version and window; treat semantic drift like software drift; economics are downstream (§IX.H)                                                                                         | —                                  | missing | drift alarms (§7.5), economics (§14.4) — G-09, G-25     |
| IX-10 | Guardrails by traffic share, tenant, language, consequence; sample automated cases; keep the old path; rollback trigger before launch; deterministic and independent of confidence; completion criterion (§IX.I) | —                                  | missing | §11.3–11.4 — G-11                                       |

#### §X Failure modes, §XI playbook

| #        | Practice                                                                                                                                 | flowaid today                                                  | Status  | Resolution                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| X-1…X-12 | The twelve failure modes §X.A–§X.L                                                                                                       | Only `E_DECISION_CONFIG`, `E_RETRY_ON_IRREVERSIBLE` touch them | missing | catalog rows 1–12 (§13.1) — G-17                     |
| X-13     | Operational correction table: symptom → inspect first (Table IX, §X.M)                                                                   | —                                                              | missing | TraceReviewer hints (§13.3) — G-18                   |
| X-14     | Distinguish model and contract error: evidence → option set → instructions → threshold mapping → only then the model (§X.I Distinguish)  | —                                                              | missing | incident diagnostic order (§13.3) — G-18             |
| X-15     | Safe operating order visible in code and receipts (§X.N)                                                                                 | —                                                              | missing | §1.2, `routings[].policy` — G-07, G-08               |
| X-16     | Incident review: reconstruct, earliest incorrect boundary, corrective locus, incident states become permanent regression fixtures (§X.O) | —                                                              | missing | incident workbench, fixture promotion (§13.3) — G-18 |
| XI-1     | Ten-step implementation sequence (§XI.A)                                                                                                 | —                                                              | missing | flowaid mapping of each step (§20.2) — G-20          |
| XI-2     | Sixteen-item launch checklist (§XI.B–C)                                                                                                  | —                                                              | missing | `ReadinessReport` (§14.2), publish dialog — G-20     |
| XI-3     | Suggested agent prompt: map hidden decisions, propose one low-consequence contract in shadow mode (§XI)                                  | —                                                              | missing | critic action "Map hidden decisions" (§14.1) — G-20  |

### 2.3 Conflicts with the current design and how they are resolved

| #   | Current design                                                                                             | Handbook position                                                                                                             | Resolution (non-breaking)                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `confidence_gate`: `pass` ≥ threshold, band below → `review` (human), lower → `fail` (ARCH §6.3)           | Medium confidence _improves the state_; low confidence or high consequence escalates (§V.A)                                   | The gate keeps its semantics and becomes a **legacy router** that writes `DECISION_ROUTED` for the upstream receipt (`pass→auto`, `review→human`, `fail→human`, reason `legacy_gate`). New work uses `flowaid.jev.route`/`decide` (auto/improve/human). The critic suggests migration (§6.8).                                          |
| C2  | `ScoreDecision.normalized` in [0,1]                                                                        | 1.6 is "not automatically 80 percent good" (§II.B)                                                                            | Contract unchanged; `normalized` is documented as a **display position** only; routing on scores uses **bands** of levels (§6.2); `W_JEV_SCORE_AS_MEASURE` flags arithmetic on it.                                                                                                                                                     |
| C3  | Failover `typesafe → llm → human` keeps automation after failing over to an LLM adapter (ARCH §6.2, demos) | Calibration is conditional on the workload and model; confidence without calibration is not an automation signal (§V.C, §V.F) | Contract routing policy `uncalibratedProviders: 'human'` (default): a decision answered by an `llm`/`rule`/`custom` hop or fuzzy-mapped, or — in a protected environment — by a contract version without calibration evidence there, cannot route `auto` (reason `provider_uncalibrated`; definition in §6.4). Legacy nodes unchanged. |
| C4  | `LLMDecisionProvider` fuzzy-maps an unknown label to the nearest option (`confidence × 0.8`) (ARCH §6.4)   | Probability mass forced onto the least-wrong option is type-valid but operationally false (§II.A)                             | Contract-bound calls mark fuzzy answers `raw.fuzzy = true`; the router treats them as escape `other` (human).                                                                                                                                                                                                                          |
| C5  | Batch groups keyed by identical `state` AST (ARCH §4.4)                                                    | Batch only within one latency and privacy class (§VI.D)                                                                       | Group key extended with `privacyClass`, `latencyClass`, packet spec (§8.3); RFC-0015 adds optional fields to `BatchGroupSchema`.                                                                                                                                                                                                       |
| C6  | Consensus node (2–5 voters over the same state) can gate automation (ARCH §6.3)                            | _"Repeated evaluation with unchanged evidence can create false reassurance"_ (§V.B)                                           | `W_JEV_CONSENSUS_REASSURANCE` when `agreed` leads to auto side effects at consequence ≥ `medium`; consensus is recommended for disagreement detection and shadow studies.                                                                                                                                                              |
| C7  | Demo 1 auto-sends customer replies at `autoThreshold 0.9` (ARCH §11.1)                                     | _"The same confidence should not control an internal queue and a public statement"_ (§V.A)                                    | Upgraded template (§9.8): reply safety contract has consequence `high`; `dev` deployment is `active` with thresholds marked illustrative (`W_JEV_THRESHOLDS_ILLUSTRATIVE`), protected environments require shadow calibration and governance first. The P5-03 acceptance workflow (ARCH §2.9) is not changed.                          |
| C8  | Demo 2 comments publicly on GitHub when `dup_judge.confidence ≥ 0.8` (ARCH §11.2)                          | Public representation needs consequence-specific thresholds (§V.A, §I.E)                                                      | Upgraded template: dynamic menu over candidates + `none`, consequence `medium`, shadow-first deployment in protected environments.                                                                                                                                                                                                     |

### 2.4 Gap register

| Gap  | `resolves` id                  | Summary                                                                                                      | Addendum   | J items                            |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------- |
| G-01 | `jev-decision-contracts`       | No versioned decision contract with the ten §III.B fields, independent of workflow versions                  | §4         | J-01, J-09, J-10, J-15             |
| G-02 | `jev-contract-review`          | No review-like-code workflow, semantic diff, regression replay, change explanation                           | §4.6       | J-02, J-14, J-15, J-17, J-18       |
| G-03 | `jev-state-packets`            | No packet structure, projection, provenance, budget, freshness, data-class policy                            | §5         | J-03, J-09, J-11                   |
| G-04 | `jev-snapshot-discipline`      | No state version, race record or per-question evidence scope                                                 | §8.4       | J-03, J-08, J-12                   |
| G-05 | `jev-three-zone-routing`       | No improve zone; low band routes to `fail`; consequence ignored                                              | §6.4       | J-04, J-12, J-13                   |
| G-06 | `jev-consequence-thresholds`   | No consequence classes, per-class thresholds or threshold governance                                         | §6.3       | J-04, J-05                         |
| G-07 | `jev-authority-boundary`       | No allowed actions; nothing proves the safe order                                                            | §6.6       | J-04, J-07, J-09, J-12             |
| G-08 | `jev-receipts`                 | No persisted, viewable per-decision receipt; no counterfactual replay                                        | §12        | J-06, J-08, J-10, J-12, J-17, J-18 |
| G-09 | `jev-calibration`              | No production calibration per contract, segmentation, drift alarms, threshold recommendation, label sampling | §7         | J-05, J-14, J-15, J-16, J-17       |
| G-10 | `jev-shadow-mode`              | No shadow evaluation beside an authoritative path                                                            | §11.1–11.2 | J-06, J-12, J-13, J-15             |
| G-11 | `jev-staged-rollout`           | No one-outcome-first automation, guardrails, rollback triggers                                               | §11.3–11.4 | J-04, J-12, J-15, J-21             |
| G-12 | `jev-live-menus`               | No runtime option sets, caps, counts, versions, invalidation, post-choice validity                           | §10        | J-06, J-13                         |
| G-13 | `jev-escape-hatches`           | No escape outcome semantics, stop outcome or description lints                                               | §4.2, §6.4 | J-02, J-04                         |
| G-14 | `jev-bundles`                  | Batching ignores privacy/latency class and cross-projection coherence                                        | §8         | J-06, J-09, J-11                   |
| G-15 | `jev-blind-retry`              | Same contract may be re-asked on the same evidence                                                           | §6.5       | J-04, J-07, J-12                   |
| G-16 | `jev-harness-insertion`        | No node patterns for before-model, before-tool, after-tool, retrieval, security-aware routing                | §9         | J-13, J-20                         |
| G-17 | `jev-failure-catalog`          | Failure modes not detectable by compiler/critic                                                              | §13.1–13.2 | J-02, J-07, J-09                   |
| G-18 | `jev-trace-review-incidents`   | TraceReviewer lacks decision signals, diagnostic order, incident fixtures                                    | §13.3      | J-07, J-16, J-17, J-18             |
| G-19 | `jev-evaluation-discipline`    | No case categories, dual labels, monotonicity, ablation, contract fixtures, Table VIII                       | §14.5      | J-14                               |
| G-20 | `jev-advisor-rules`            | Builder/critic/optimizer do not apply the boundary test, inventory, checklist; no first-integration playbook | §14, §20.2 | J-19, J-22                         |
| G-21 | `jev-score-semantics`          | `normalized` read as a percentage; no score bands                                                            | §6.2       | J-02, J-04                         |
| G-22 | `jev-noul-calibration`         | Noul routing confidence vs calibration target undefined                                                      | §6.2, §7.2 | J-05                               |
| G-23 | `jev-model-version`            | Alias vs resolved model not tracked as a drift source                                                        | §4.2, §7.5 | J-11, J-16                         |
| G-24 | `jev-consensus-reassurance`    | Consensus can create false reassurance                                                                       | §2.3 C6    | J-07                               |
| G-25 | `jev-economics-honesty`        | Vendor figures not framed as ceilings; no completed-task economics or "generative calls removed" KPI         | §14.4      | J-14, J-19, J-22                   |
| G-26 | `jev-execution-parallelism`    | Decision parallelism not separated from execution parallelism                                                | §8.6       | J-07, J-09                         |
| G-27 | `jev-dependent-sequence-trace` | Evidence-creating state transitions not surfaced in traces                                                   | §8.5       | J-12, J-17, J-18                   |

---

## 3. The `@flowaid/jev` package

### 3.1 Placement

`packages/jev` (`@flowaid/jev`) is a pure TypeScript library: `jev → workflow-core, shared` (+ `zod`, the same pin as workflow-core), **browser-safe** (no Node built-ins; hashing through `@flowaid/shared` `sha256Json`/`sha256Hex`, `stableStringify`). It holds the Jev engineering logic that every other layer needs, so the compiler (browser), runtime (worker), API, evaluation, observability, advisor and UI share one implementation.

`boundaries.json` / ARCHITECTURE §1.1 additions (applied by J-01 together with the package, so `scripts/check-boundaries.test.ts` stays green):

```
jev               → workflow-core, shared                               (browserSafe)
workflow-compiler → workflow-core, shared, jev
nodes-core        → …, jev
workflow-runtime  → …, jev
evaluation        → …, jev
observability     → …, jev
database          → …, jev            (types for jsonb columns)
cli               → …, jev            (offline `flowaid decisions lint`)
advisor           → …, jev            (P6-02 package)
ui                → workflow-core (types), jev (types)
apps/api, apps/worker → …, jev
```

### 3.2 Module map

```
packages/jev/src/
  wire.ts                 RFC-0013 wire types (§12.1). Until J-08 lands they are defined here with a parity test against §18.1 of this
                          document; afterwards the file re-exports them from @flowaid/workflow-core.
  ids.ts                  ContractKey, labels ("support.router@4"), HashSchema, ContractRef helpers.
  contract.ts             DecisionContractBody (§4.2), ContractBinding, interfaceOf/interfaceHash, contractHash, version record, review, diff.
  question.ts             contract → DecisionQuestion (CONTRACTS §15) and outcome/route ports (§4.5).
  packet/                 spec.ts (StateSpec §5.2) · build.ts (§5.3) · estimate.ts (chars/3.5) · report.ts · ablate.ts (§5.7)
  bundle/plan.ts          bundle → provider requests under 32k/64k (§8.2)
  routing/                policy.ts · route.ts (§6.4) · rollout.ts (§6.7) · verdict.ts (§6.6) · retryGuard.ts (§6.5)
  menu/                   optionSet.ts · build.ts · keys.ts · freshness.ts (§10)
  tools/                  proposal.ts (ToolProposal §9.3) · normalize.ts · policy.ts (deterministic tool policy)
  receipt/                build.ts · reconstruct.ts (§12.3) · replay.ts (counterfactual plan, §12.4)
  calibration/            bins.ts · metrics.ts · sampling.ts · adjudicate.ts · drift.ts · recommend.ts (§7)
  shadow/                 compare.ts · summary.ts (§11.2)
  lint/                   contract.ts · rubric.ts · menu.ts · packet.ts · readiness.ts · codes.ts (§13.2, §14.2)
  analyze/                inventory.ts · generationForDecision.ts · exactRule.ts · authority.ts · blindRetry.ts · shadowLeak.ts ·
                          transport.ts · placement.ts · parallelSideEffects.ts · confidenceUnused.ts (§13, §14.1)
  catalog/failureModes.ts the 31-row catalog as data (§13.1)
  incident/               reconstruct.ts · diagnosticOrder.ts (§13.3)
  testing/                contracts (support.router@1…@4, ticket.router@1, reply_safety@1, tool_risk@1, report_verifier@1, relevance@1),
                          packets, receipts, synthetic calibration datasets
  index.ts
```

Public exports: every schema named in §4–§12 with its inferred type and a `…JsonSchema` constant (`z.toJSONSchema`, draft 2020-12) for manifests and OpenAPI; functions `contractHash`, `interfaceOf`, `interfaceHash`, `diffContracts`, `toDecisionQuestion`, `outcomePorts`, `buildPacket`, `estimateTokens`, `ablatePacket`, `planBundle`, `route`, `rolloutDisposition`, `policyVerdict`, `blindRetryKey`, `buildOptionSet`, `optionKey`, `normalizeToolProposal`, `toolPolicy`, `buildReceipt`, `reconstruct`, `planReplay`, `reliabilityBins`, `calibrationMetrics`, `sampleForLabel`, `adjudicate`, `driftAlarms`, `recommendThresholds`, `compareShadow`, `summarizeShadow`, `lintContract`, `readiness`, `analyzeDefinition`, `inventoryHiddenDecisions`, `FAILURE_MODES`, `JEV_DIAGNOSTIC_CODES`, `incidentReview`.

Until RFC-0014 is accepted, lint functions return `JevDiagnostic` (= `Diagnostic` with `code: JevDiagnosticCode`, a string enum of the §13.2 codes); after J-08 `JevDiagnostic` is exactly `Diagnostic`.

### 3.3 What can be built now

The repository today has `shared`, `env`, `workflow-core` 0.3.0 and `ui`. Everything in the left column depends only on those and is therefore buildable immediately, with full unit tests, before the compiler, database, runtime or providers exist:

| Buildable now in `@flowaid/jev` (J-01…J-07)                                                                                                                  | Needs another package first                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| All schemas and JSON Schemas of §4–§12, the RFC-0013 wire types (temporary copy)                                                                             | Persisting them — `database` (P1-02 → J-10)                                        |
| Contract hashing, interface hash, semantic diff, question mapping, contract lint, review checklist, readiness report                                         | Running lints inside `compile()` — `workflow-compiler` (P1-01 → J-09)              |
| Packet builder, estimator, report, ablation generator, packet lints                                                                                          | Calling it from a node executor — `node-sdk`/`nodes-core` (P1-03, P2-04 → J-13)    |
| Routing engine, rollout disposition, policy verdict, blind-retry key, tool proposal normalizer and tool policy                                               | Enforcing them at run time — `workflow-runtime` (P2-01 → J-12)                     |
| Option-set builder (FlowExpr lambdas through workflow-core's evaluator), keys, freshness                                                                     | Live candidates from tools/models — `mcp`, `providers` (P2-05, P1-04 → J-11, J-20) |
| Bundle planner (TypeSafe 32k/64k partitioning)                                                                                                               | Sending requests — `provider-typesafe` (P2-02 → J-11)                              |
| Receipt builder, reconstruction checker, counterfactual replay planner                                                                                       | Replay jobs — `apps/worker` (P3-03 → J-15)                                         |
| Calibration metrics, sampling, adjudication, drift alarms, threshold recommendation                                                                          | Snapshots from production data — `database` + worker (J-10, J-15)                  |
| Shadow comparison and summary                                                                                                                                | Shadow nodes and deferred shadow jobs (J-13, J-15)                                 |
| Failure-mode catalog; static analyzers over `WorkflowDefinition` (+ an optional `ExecutionPlan`, tested with the hand-written plan fixture in workflow-core) | Diagnostics on the canvas (J-09, J-18)                                             |
| Presentational UI components in `packages/ui` against these types (J-17, partly)                                                                             | Data-bound pages (J-18)                                                            |

---

## 4. Decision contracts as code

### 4.1 Identity, versioning, lifecycle

- **Key**: `support.router` — dotted snake_case, unique per workspace. **Version**: positive integer, one per semantic change (the handbook's `router@1` broad options → `@2` adds none-of-the-above → `@3` separates billing from account access → `@4` consequence-specific thresholds). **Label**: `support.router@4`.
- **Hash**: `sha256Json(body)` over the canonical body (keys sorted). **Interface hash**: `sha256Json(interfaceOf(body))` — kind, routable ports (static outcome keys, score band ports, `yes`/`no`, `selected`, `improve`, `human`, `stop` when it routes auto), escape keys, level count, menu source and the state fields' names, roles, schemas and `required` flags. Instructions, descriptions, thresholds, governance, model, tests and changelog are **not** interface: they change behaviour without changing wiring, which is exactly why they are versioned, reviewed and rolled out separately (§III.C).
- **Lifecycle**: a contract head (`decision_contracts`) holds an editable **draft**; `POST …/versions` freezes the draft into an immutable version in `in_review`; review (§4.6) moves it to `approved` or `rejected`; `approved` versions can be deployed per environment (§11.3); superseded versions become `deprecated` (still resolvable for replay). Bodies never change after creation.

### 4.2 Schemas (exact, `@flowaid/jev/src/contract.ts`)

```ts
import { z } from "zod";
import {
  DataClassSchema,
  DiagnosticSchema,
  JsonPointerSchema,
  PortNameSchema,
  ProviderHopSchema,
} from "@flowaid/workflow-core";
import {
  ConsequenceClassSchema,
  ContractKeySchema,
  ContractRefSchema,
  HashSchema,
} from "./wire.js";
import { StateSpecSchema } from "./packet/spec.js";

/** Routing port names a contract outcome may not use. */
export const JEV_RESERVED_PORTS: ReadonlySet<string> = new Set([
  "done",
  "failed",
  "improve",
  "human",
  "legacy",
  "selected",
]);
/** Outcome keys become control ports (static menus, score bands) — PortName regex minus the reserved routing ports. */
export const OutcomeKeySchema = PortNameSchema.refine(
  (k) => !JEV_RESERVED_PORTS.has(k),
  "reserved routing port name",
);

export const EscapeKindSchema = z.enum(["none", "other", "stop", "review", "escalate"]);
export type EscapeKind = z.infer<typeof EscapeKindSchema>;

export const OutcomeSpecSchema = z.object({
  /** Evidence conditions under which this outcome is the correct branch — distinguishing, never praise (§II.A, §VIII.F). */
  description: z.string().min(1).max(2000),
  /** Marks an escape hatch (§II.A, §X.B). */
  escape: EscapeKindSchema.optional(),
  /** Stricter consequence than the contract default for this outcome (e.g. `refund` high while `faq` low). */
  consequenceClass: ConsequenceClassSchema.optional(),
  /** false ⇒ never routed `auto` (kept behind review; e.g. during rollout, or `escalate`). */
  automatable: z.boolean().default(true),
});
export const EscapeOutcomeSpecSchema = OutcomeSpecSchema.extend({ escape: EscapeKindSchema });
export type OutcomeSpec = z.infer<typeof OutcomeSpecSchema>;

export const StaticMenuSchema = z.object({
  source: z.literal("static"),
  /** 2..255 outcomes including escapes (TypeSafe choice limit). Keys are control ports. */
  outcomes: z.record(OutcomeKeySchema, OutcomeSpecSchema),
});
export const DynamicMenuSchema = z.object({
  source: z.literal("dynamic"),
  /** Escape outcomes appended to every live option set; at least one (E_JEV_DYNAMIC_MENU_NO_ESCAPE). */
  escapes: z.record(OutcomeKeySchema, EscapeOutcomeSpecSchema),
  /** Live options before escapes; maxOptions + |escapes| ≤ 255. */
  maxOptions: z.int().min(1).max(254).default(50),
  /** Candidate ids never reach the model as keys: `ordinal` ⇒ o1…oN, `slug` ⇒ slugified id (≤ 48 chars, collision suffix). */
  keyStrategy: z.enum(["ordinal", "slug"]).default("ordinal"),
  /** Option sets older than this at evaluation are stale ⇒ route improve (rebuild) (Table VII). */
  maxAgeMs: z.int().min(1).default(60_000),
  /** Guidance shown to authors of the menu node's description lambda (§VIII.F). */
  descriptionGuidance: z.string().max(2000).optional(),
});

/** Ordinal band that turns a score into a routable outcome: levels minLevel..maxLevel (inclusive) fire `port` in the auto zone. */
export const ScoreBandSchema = z.object({
  port: OutcomeKeySchema,
  minLevel: z.int().min(0),
  maxLevel: z.int().min(0),
  consequenceClass: ConsequenceClassSchema.optional(),
  automatable: z.boolean().default(true),
});

export const ContractQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    /** Operational definition; identifiers are not instructions (§III.A). */
    instructions: z.string().min(1).max(8000),
    menu: z.discriminatedUnion("source", [StaticMenuSchema, DynamicMenuSchema]),
  }),
  z.object({
    kind: z.literal("score"),
    instructions: z.string().min(1).max(8000),
    /** 2..10 ordered verbal anchors of observable evidence; 3–5 preferred (§II.B, §II.G). */
    levels: z.array(z.string().min(1).max(2000)).min(2).max(10),
    /** Bands must cover 0..levels.length-1 exactly once; absent ⇒ the score is a measurement, routed by confidence only. */
    bands: z.array(ScoreBandSchema).min(2).max(10).optional(),
  }),
  z.object({
    kind: z.literal("boolean"), // TypeSafe "noul": P(yes); 0.5 = evidence does not separate yes from no (§II.C)
    instructions: z.string().min(1).max(8000),
    /** `true.description`/`false.description` are sent as the noul criteria; ports are fixed `yes`/`no`. */
    outcomes: z.object({
      true: OutcomeSpecSchema.omit({ escape: true }),
      false: OutcomeSpecSchema.omit({ escape: true }),
    }),
    /** value = pYes ≥ yesAt — the application-defined band (§II.C). */
    yesAt: z.number().min(0).max(1).default(0.5),
  }),
]);
export type ContractQuestion = z.infer<typeof ContractQuestionSchema>;

export const ZoneThresholdsSchema = z
  .object({
    /** confidence ≥ autoAt ⇒ auto; null ⇒ this class never automates. */
    autoAt: z.number().min(0).max(1).nullable(),
    /** improveAt ≤ confidence < autoAt ⇒ improve; null ⇒ no improve zone. Below ⇒ human. */
    improveAt: z.number().min(0).max(1).nullable(),
    /** choice/score bands: top1 − top2 < minMargin demotes one zone (auto → improve → human). */
    minMargin: z.number().min(0).max(1).optional(),
  })
  .refine(
    (t) => t.autoAt === null || t.improveAt === null || t.improveAt <= t.autoAt,
    "improveAt must be ≤ autoAt",
  );
export type ZoneThresholds = z.infer<typeof ZoneThresholdsSchema>;

export const RollbackTriggerSchema = z.object({
  metric: z.enum([
    "override_rate",
    "auto_error_rate",
    "review_rate",
    "escape_rate",
    "ece",
    "stale_option_rate",
    "recovery_cost_usd",
  ]),
  op: z.enum([">", ">="]),
  value: z.number(),
  window: z.enum(["1h", "24h", "7d"]),
  minSamples: z.int().min(1).default(50),
  action: z
    .enum(["pause_candidate", "rollback_active", "pause_active", "alert_only"])
    .default("pause_candidate"),
});
export type RollbackTrigger = z.infer<typeof RollbackTriggerSchema>;

/** Thresholds are production configuration (§V.C Threshold Governance). */
export const ThresholdGovernanceSchema = z.object({
  owner: z.string().min(1),
  rationale: z.string().min(1).max(4000),
  evaluationWindow: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    source: z.enum(["shadow", "canary", "production", "evaluation", "illustrative"]),
    labeled: z.int().min(0),
    calibrationSnapshotIds: z.array(z.uuid()).default([]),
  }),
  rollbackCondition: RollbackTriggerSchema,
  approvedBy: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
});

export const ImproveActionSchema = z.object({
  kind: z.enum([
    "collect_evidence",
    "deterministic_check",
    "narrow_options",
    "ask_user",
    "stronger_model",
  ]),
  /** How the state will improve — "Confidence without a different next action is decoration" (§V.B). */
  description: z.string().min(1).max(500),
});

export const RoutingPolicySchema = z.object({
  /** Default consequence class of the action this judgment may authorise (§III.B field 6). */
  consequenceClass: ConsequenceClassSchema,
  /** Operating zones per class (§V.A, Table V). `irreversible` is not configurable: always human (§III.E). */
  thresholds: z
    .object({
      low: ZoneThresholdsSchema.optional(),
      medium: ZoneThresholdsSchema.optional(),
      high: ZoneThresholdsSchema.optional(),
    })
    .prefault({}),
  /** Required before a version may run as `canary` or become `active` in an environment. */
  governance: ThresholdGovernanceSchema.optional(),
  /** Routes of escape outcomes; `review` and `escalate` always route human. */
  escapeRoutes: z
    .object({
      none: z.enum(["improve", "human"]).default("human"),
      other: z.enum(["improve", "human"]).default("human"),
      stop: z.enum(["auto", "human"]).default("auto"),
    })
    .prefault({}),
  improve: z
    .object({
      actions: z.array(ImproveActionSchema).min(1),
      /** Improve rounds per decision lineage; each must change the packet, the option set or the contract (§V.B, §X.E). */
      maxRounds: z.int().min(1).max(5).default(2),
    })
    .optional(),
  /** Applies when `calibrated` is false (§6.4): llm/rule/custom hops, fuzzy-mapped answers, or versions without calibration evidence in a protected environment. */
  uncalibratedProviders: z.enum(["human", "improve", "allow"]).default("human"),
  /** Provider resolved a model other than `model.expectResolved` (semantic drift source). */
  onModelChange: z.enum(["continue", "human"]).default("continue"),
});
export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;

export const ActionKindSchema = z.enum([
  "internal_routing",
  "select_model",
  "select_worker",
  "retrieval_filter",
  "annotate",
  "tool_call",
  "external_message",
  "publish",
  "purchase",
  "delete",
  "permission_change",
  "data_write",
  "money_movement",
  "represent_user",
]);
/** Upper bound on the authority the result may lead to (§III.B field 7). Proven by the compiler (§6.6). */
export const AllowedActionSchema = z.object({
  kinds: z.array(ActionKindSchema).min(1),
  /** Tool capabilities an auto route may reach, e.g. ['github.write']; [] ⇒ none. */
  capabilities: z.array(z.string().regex(/^[a-z0-9_-]+\.[a-z0-9_*.-]+$/)).default([]),
  /** Ceiling for every node reachable from an auto port. */
  maxConsequence: ConsequenceClassSchema,
  externalSideEffects: z.boolean().default(false),
});

/** Where uncertain or consequential cases go (§III.B field 8). */
export const EscalationSchema = z.object({
  /** HumanNode.assignees format: user ids, "role:<r>", "group:<id>"; [] = anyone with runs:approve. */
  assignees: z.array(z.string()).default([]),
  /** choice: reviewer picks an outcome (becomes a label); approval: approve/reject the proposed outcome. */
  mode: z.enum(["choice", "approval"]).default("choice"),
  expiresInMs: z.int().min(1).optional(),
  onExpire: z.enum(["fail", "route", "escalate"]).default("route"),
  /** Written review/labeling rubric (§IX.E Labels and Adjudication). */
  rubric: z.string().max(8000).default(""),
});

/** Model version (§III.B field 9). The alias is requested; the resolved version is recorded on every receipt. */
export const ContractModelSchema = z.object({
  primary: ProviderHopSchema.default({ provider: "typesafe", model: "jev-latest" }),
  failover: z.array(ProviderHopSchema).default([]),
  /** Resolved model the calibration was measured on, e.g. 'jev-1.13.0'. */
  expectResolved: z.string().optional(),
});

export const FixtureCategorySchema = z.enum([
  "normal",
  "ambiguous",
  "missing_evidence",
  "adversarial",
  "stale_options",
  "rare_class",
  "no_fit",
  "incident",
  "ladder",
]);
export const ContractTestsSchema = z.object({
  /** §III.F / §IX.C categories; `stale_options` applies to dynamic menus, `rare_class`/`no_fit` to choice. */
  requiredCategories: z
    .array(FixtureCategorySchema)
    .default([
      "normal",
      "ambiguous",
      "missing_evidence",
      "adversarial",
      "stale_options",
      "rare_class",
      "no_fit",
    ]),
  minPerCategory: z.int().min(1).default(3),
  minAccuracy: z.number().min(0).max(1).default(0.9),
  requireMonotonicity: z.boolean().default(true),
});

export const DecisionContractBodySchema = z.object({
  key: ContractKeySchema,
  version: z.int().min(1),
  title: z.string().min(1).max(120),
  /** The branch this contract controls and why it is semantic (inventory entry, §I.G). */
  purpose: z.string().min(1).max(2000),
  /** Accountable owner for review, thresholds and incidents. */
  owner: z.string().min(1),
  question: ContractQuestionSchema, // fields 2–3: instructions, options or rubric
  /** Field 4: used when evaluation cannot run (hops exhausted, over budget without improve, stale menu). An escape key; null ⇒ human. */
  fallbackOutcome: z.string().nullable().default(null),
  state: StateSpecSchema, // field 1 (§5.2)
  routing: RoutingPolicySchema, // fields 5–6
  allowedAction: AllowedActionSchema, // field 7
  escalation: EscalationSchema.prefault({}), // field 8
  model: ContractModelSchema.prefault({}), // field 9 (field 10 = key@version + hash)
  tests: ContractTestsSchema.prefault({}),
  /** Required when version > 1: what changes in behaviour and why (§III.D Review). */
  changelog: z.string().max(4000).default(""),
  lintSuppressions: z
    .array(
      z.object({
        code: z.string(),
        path: JsonPointerSchema.optional(),
        reason: z.string().min(10),
      }),
    )
    .default([]),
  tags: z.array(z.string().max(40)).max(20).default([]),
});
export type DecisionContractBody = z.infer<typeof DecisionContractBodySchema>;

/** Node config field of every contract-bound node. `'deployed'` follows the environment's deployment; a number pins a version. */
export const ContractBindingSchema = z.object({
  key: ContractKeySchema,
  version: z.union([z.int().min(1), z.literal("deployed")]).default("deployed"),
});
export type ContractBinding = z.infer<typeof ContractBindingSchema>;

export const ReviewCheckSchema = z.enum([
  "fields_necessary",
  "outcomes_distinguishable",
  "escape_hatch",
  "ranges_routed",
  "action_narrower",
  "exact_rules_in_code",
  "regression_replayed",
  "changes_explained",
]);
export const ContractReviewSchema = z.object({
  by: z.string(),
  at: z.iso.datetime(),
  verdict: z.enum(["approved", "changes_requested"]),
  checklist: z.record(ReviewCheckSchema, z.boolean()),
  comment: z.string().max(4000).nullable(),
  /** jev.replay job whose report was reviewed (required for version > 1 with labeled history). */
  replayJobId: z.uuid().nullable(),
  contractTestJobId: z.uuid().nullable(),
});
export const ContractVersionStatusSchema = z.enum([
  "in_review",
  "approved",
  "rejected",
  "deprecated",
]);
export const DecisionContractVersionSchema = z.object({
  contractId: z.uuid(),
  ref: ContractRefSchema,
  interfaceHash: HashSchema,
  body: DecisionContractBodySchema,
  status: ContractVersionStatusSchema,
  diagnostics: z.array(DiagnosticSchema),
  review: ContractReviewSchema.nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type DecisionContractVersion = z.infer<typeof DecisionContractVersionSchema>;
```

Semantic validation beyond the schema (`lintContract`, errors are `E_JEV_CONTRACT_INVALID`): static menus have 2–255 outcomes including escapes; dynamic `maxOptions + |escapes| ≤ 255` and `|escapes| ≥ 1`; score bands partition `0..n−1`; the escape of kind `stop` (at most one per menu) is keyed `stop`, so its routing port is always `stop`; `fallbackOutcome` is an escape key (or null); a declared `improveAt` without `routing.improve` is reported (`W_JEV_IMPROVE_UNWIRED`: that zone would route human); every consequence class reachable by the contract's outcomes has a thresholds entry or is `irreversible`; `allowedAction.maxConsequence` ≥ every outcome's consequence class; `model.primary` is a decision hop; `changelog` non-empty when `version > 1`; `state.fields` has at most one `goal` role (or `state.goal` literal).

### 4.3 Handbook fields → schema

| Handbook field (§III.B; §IX.B; §XI.A step 4) | `DecisionContractBody` path                                                    | Enforced by                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| State schema                                 | `state` (fields, roles, schemas, data classes, budget, privacy/latency class)  | `contractPorts` makes it the node's `state` port schema (§4.4); packet builder (§5) |
| Instructions                                 | `question.instructions`                                                        | `W_JEV_INSTRUCTIONS_WEAK`                                                           |
| Option descriptions or rubric                | `question.menu.outcomes` / `escapes` / `levels` / `bands` / boolean `outcomes` | `W_JEV_OPTIONS_UNDISTINGUISHED`, `W_JEV_RUBRIC_*`                                   |
| Fallback outcome (escape hatch)              | `fallbackOutcome`, escape outcomes                                             | `W_JEV_NO_ESCAPE_HATCH`, `E_JEV_DYNAMIC_MENU_NO_ESCAPE`                             |
| Confidence thresholds                        | `routing.thresholds`, `routing.governance`                                     | `E_JEV_THRESHOLDS_UNMAPPED`, `W_JEV_THRESHOLDS_ILLUSTRATIVE`                        |
| Consequence class                            | `routing.consequenceClass`, per-outcome/band overrides                         | routing precedence (§6.4)                                                           |
| Allowed action                               | `allowedAction`                                                                | `E_JEV_AUTHORITY_EXCEEDED`, `E_JEV_IRREVERSIBLE_AUTO`                               |
| Escalation path                              | `escalation` + the node's `human` route                                        | `E_JEV_ESCALATION_UNWIRED`                                                          |
| Model version                                | `model` (+ resolved version on every receipt)                                  | `onModelChange`, drift alarm `model_version_changed`                                |
| Contract version                             | `key@version` + `hash`                                                         | registry, receipts, deployments                                                     |
| Owner (flowaid addition)                     | `owner`, `routing.governance.owner`                                            | review, notifications                                                               |

### 4.4 How decision nodes reference contracts

1. **Authoring.** Every contract-bound node (`flowaid.jev.*`, §9.1) has config `contract: ContractBinding` (the bundle node: `contracts: Record<questionKey, ContractBinding>`). Creating such a node in the builder opens the contract picker; _"Write the contract before calling the model"_ (§IX.B) is the default path: "New contract…" creates a registry draft through the API first.
2. **Compile.** A new port rule `{ kind: 'contractPorts', path: '/contract' }` (RFC-0015) asks `CompileOptions.resolveContract(binding)` for `{ ref, interfaceHash, body, status }` — the pinned version, or for `'deployed'` the latest `approved` version (the _compile reference_). While a contract has no approved version yet, the resolver returns its latest version that is not `rejected`: a draft-level compile accepts it with `W_JEV_CONTRACT_UNREVIEWED` (the workflow can be built and run in a non-protected environment while the contract is in review), a publish-level compile answers `E_JEV_CONTRACT_UNRESOLVED`; a pinned version that is not `approved` gets the same treatment. From it the compiler derives: the `state` input port schema (object of the declared fields), the optional `options` input (dynamic menus), the control-outs (§4.5) and the outputs. It embeds the snapshot in the plan: `PlanNode.jev.contracts[q] = { ref, interfaceHash, via: 'pinned' | 'deployed', body }`, so `planHash` covers the exact semantic program and exported code runs offline. Unknown key/version → `E_JEV_CONTRACT_UNRESOLVED`; interface mismatch with the node's wiring → `E_JEV_INTERFACE_MISMATCH`. The browser compiler gets `resolveContract` from `GET /v1/decision-contracts?include=compile` (per key the compile reference with status, hash, interface hash and body; cached like the tool catalog); the CLI caches the same list.
3. **Deploy.** Deploying a workflow version to a **protected** environment (API.md §3.3) additionally requires, for every contract key in the plan, a `decision_contract_deployments` row in that environment whose active or candidate version has the plan's `interfaceHash` (422 `E_JEV_INTERFACE_MISMATCH` / `E_JEV_CONTRACT_UNRESOLVED` with the list). In a non-protected environment a missing row is allowed (run start falls back to the compile reference, step 4) and the deploy response lists those keys; a row whose versions have a different interface is refused there too. Deploying a contract version (§11.3) is refused when a workflow deployed in that environment was compiled against a different interface.
4. **Run start.** The API resolves `RUN_CREATED.contracts[key]` (RFC-0013) for every registry contract of the plan: `active` and `candidate` versions with their hashes, interface hashes, stages and `calibrated` flags (§6.4), plus the guardrails and their hash. The worker loads the immutable bodies by `(key, version)` (cached) and verifies the hashes against the plan snapshots and the resolution.

   | Situation                                                                                  | `via`        | Acting version                                          | Stage                                                                                                                                            | Guardrails                                                                                                  |
   | ------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
   | Deployment row in the run's environment                                                    | `deployed`   | the row's active (and candidate)                        | the row's stages                                                                                                                                 | the row's                                                                                                   |
   | Binding pins version _v_                                                                   | `pinned`     | _v_                                                     | the row's stage when the row's active or candidate is _v_; `shadow` when the row deploys another version; without a row as in the next two lines | the row's, else defaults                                                                                    |
   | No row, environment not protected (builder runs in `dev`, experiments)                     | `undeployed` | the compile reference (`PlanNode.jev.contracts[q].ref`) | `active`                                                                                                                                         | `RolloutGuardrailsSchema` defaults (`maxConsequence: 'low'`, so only low-consequence outcomes can automate) |
   | No row, protected environment (defensive only: a validated deploy always has rows, step 3) | `undeployed` | the compile reference                                   | `shadow`: receipts only, `legacy`/`human` carries the traffic                                                                                    | defaults                                                                                                    |
   | `runLocally` and exported code (`CODE_EXPORT.md`)                                          | `local`      | the plan snapshot                                       | `active`                                                                                                                                         | defaults; `environmentId: null`                                                                             |

   Evaluation runs (`origin: 'evaluation'`) resolve like their target environment, but their receipts carry `mode: 'evaluation'` and never feed production calibration, rollout checks or label queues. Replays re-use the source run's resolution (`recorded`) or resolve afresh (`reexecute`, `restart`, `fork`), and receipts say which.

5. **Implicit contracts for legacy nodes.** `flowaid.decision.{boolean,choice,score,batch,consensus,validator}` keep their config **and their wire behaviour**: `state` is still sent verbatim (ARCH §6.1). `implicitContract(plan, nodeId, question?)` in `@flowaid/jev` synthesises `implicit.<nodeId>[.<question>]@1` as a pure function of the plan node (`op.config`, `op.manifest`, the plan's `execution.decisions`, the node's redaction classes): the question from the node config, `state` = one `fact` field describing the bound state (data class = max of the producers'), no thresholds (routing is done by downstream gates/branches), `allowedAction.maxConsequence: 'irreversible'` (no authority proofs), the workflow's decision chain as model; its hash is `contractHash` of that body. The compiler calls it only for diagnostics and the runtime calls it again when it writes receipts, so **nothing is added to the plan**: a plan without `flowaid.jev.*` nodes is byte-identical to today's (same `planHash`), and implicit keys are unique only within a workflow (receipts carry `workflowId`; implicit contracts have no registry row, deployment or calibration snapshot). Legacy nodes therefore still write receipts (with `contract.origin = 'implicit'`, empty `routings` unless a gate/router routes them, §6.8; §12.2 says who appends them). At publish the compiler reports `W_JEV_IMPLICIT_CONTRACT` with a quick fix _Extract to decision contract_ (the UI creates the registry draft through the API and rewrites the node to `flowaid.jev.decide` with `routing: 'external'` so existing gates keep working).

### 4.5 Contract → question → ports

| Contract            | `DecisionQuestion` sent (CONTRACTS §15)                                                                               | TypeSafe question                                   | Control-outs of `flowaid.jev.decide` (inline routing)                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| choice, static      | `{ kind: 'choice', instructions, options: { [key]: description } }` incl. escapes                                     | `{ type: 'choice', instructions, criteria }`        | one per non-escape outcome (fired in the auto zone), `stop` if `escapeRoutes.stop = 'auto'`, `improve` (if `routing.improve`), `human`, `legacy` (if enabled) |
| choice, dynamic     | options = live option set (keys per `keyStrategy`) + escapes                                                          | same, ≤ 255 criteria                                | `selected`, `stop` (as above), `improve`, `human`, `legacy`                                                                                                   |
| score with bands    | `{ kind: 'score', instructions, levels }`                                                                             | `{ type: 'score', instructions, criteria: levels }` | one per band port, `improve`, `human`, `legacy`                                                                                                               |
| score without bands | same                                                                                                                  | same                                                | `done` (measurement; route by a downstream `flowaid.jev.route` with a stricter class, or by expressions)                                                      |
| boolean             | `{ kind: 'boolean', instructions, criteria: { true: outcomes.true.description, false: outcomes.false.description } }` | `{ type: 'noul', instructions, criteria }`          | `yes`, `no`, `improve`, `human`, `legacy`                                                                                                                     |

With `routing: 'external'` the node fires only `done` and a `flowaid.jev.route` node (same contract) owns the routing ports. Outputs are identical in both modes: `decision` (`DecisionResult`), `receipt` (`ReceiptRef`, §12.1), `packet` (`{ stateVersion, packetHash, tokens }`) and, for dynamic menus, `selection` (`{ key, sourceId, item }`).

### 4.6 Review like code

1. **Draft edits** are autosaved on the head (`decision_contracts.draft`, optimistic `If-Match` like workflow drafts); `lintContract` runs on every save (browser and server identical).
2. **Submit** (`POST /v1/decision-contracts/:id/versions`) freezes the draft into version _n_ (`in_review`), stores diagnostics and the **semantic diff** against the latest approved version: instructions (text diff), outcomes/escapes/levels/bands added · removed · description changed, thresholds per class before → after, consequence class, allowed action, state fields added · removed · schema/role/data class changed, model, `interfaceChanged: boolean`.
3. **Evidence** attached before approval: a passing contract test run (`jev.contract_test`, §14.5) over fixtures covering `tests.requiredCategories`; and, when the previous version has labeled receipts, a **counterfactual replay** (`jev.replay`, §12.4) that reports outcome flips, route flips and class-specific accuracy/calibration before and after (§III.D Review: "Re-run labeled examples from the previous version, inspect class-specific accuracy and calibration, and require an explanation for behavior changes").
4. **Approve** (`POST …/versions/:v/review`) with the checklist of §III.D (`fields_necessary`, `outcomes_distinguishable`, `escape_hatch`, `ranges_routed`, `action_narrower`, `exact_rules_in_code`) plus `regression_replayed` and `changes_explained`. The first four and `action_narrower` are pre-filled from lints (the reviewer confirms); a version deployed to a **protected** environment must be approved by someone other than its author.
5. _"A shorter prompt is not automatically a safer or more maintainable contract"_: the diff UI shows instruction shortening as a behaviour change that needs replay evidence like any other.

### 4.7 Example: `support.router@4`

```json
{
  "key": "support.router",
  "version": 4,
  "title": "Support ticket router",
  "purpose": "Routes inbound support tickets to one team queue. Internal routing only; no customer-visible action.",
  "owner": "team:support-ops",
  "question": {
    "kind": "choice",
    "instructions": "Which team queue should receive this support ticket? Judge only from the customer's message and the account facts; the queue must be able to resolve the request without handing it on.",
    "menu": {
      "source": "static",
      "outcomes": {
        "billing": {
          "description": "Invoices, charges, refunds or subscription changes on an account the customer can already access."
        },
        "account_access": {
          "description": "The customer cannot sign in, lost 2FA, or reports a takeover; any request whose resolution needs identity verification."
        },
        "technical": {
          "description": "A product defect, error message, outage or integration failure with observable symptoms."
        },
        "general": {
          "description": "A clear request that fits none of the teams above but needs no specialist (how-to, feedback)."
        },
        "none": {
          "description": "The message is not a support request, is empty, or no listed queue can act on it.",
          "escape": "none"
        }
      }
    }
  },
  "fallbackOutcome": "none",
  "state": {
    "goal": "Route the ticket to the queue that can resolve it without a hand-off.",
    "fields": {
      "message": {
        "role": "evidence",
        "description": "Customer message as received (the evidence being judged).",
        "schema": { "type": "array" },
        "dataClass": "pii",
        "selection": { "maxItems": 1 }
      },
      "tier": {
        "role": "fact",
        "description": "Plan tier: context for billing and access questions (exact tier rules stay in code).",
        "schema": { "type": "string" },
        "required": false
      },
      "channel": {
        "role": "fact",
        "description": "Inbound channel; chat messages are shorter and less formal than email.",
        "schema": { "type": "string", "enum": ["email", "chat", "api"] },
        "required": false
      }
    },
    "maxTokens": 2000,
    "privacyClass": "pii",
    "latencyClass": "interactive"
  },
  "routing": {
    "consequenceClass": "low",
    "thresholds": { "low": { "autoAt": 0.9, "improveAt": 0.7, "minMargin": 0.2 } },
    "governance": {
      "owner": "team:support-ops",
      "rationale": "Shadow window: auto precision 0.974 (Wilson 95 % lower bound 0.961) at 0.90 on 1 212 labeled tickets; 8 % of traffic within ±0.03 of the boundary.",
      "evaluationWindow": {
        "from": "2026-08-01T00:00:00Z",
        "to": "2026-08-29T00:00:00Z",
        "source": "shadow",
        "labeled": 1212,
        "calibrationSnapshotIds": []
      },
      "rollbackCondition": {
        "metric": "override_rate",
        "op": ">",
        "value": 0.05,
        "window": "24h",
        "minSamples": 100,
        "action": "pause_candidate"
      },
      "approvedBy": "u_7f3a",
      "approvedAt": "2026-08-30T09:12:00Z"
    },
    "improve": {
      "actions": [
        {
          "kind": "collect_evidence",
          "description": "Fetch the last three invoices and the sign-in log summary for the account, then ask again."
        }
      ],
      "maxRounds": 1
    }
  },
  "allowedAction": {
    "kinds": ["internal_routing"],
    "maxConsequence": "low",
    "externalSideEffects": false
  },
  "escalation": {
    "assignees": ["role:support_lead"],
    "mode": "choice",
    "rubric": "Pick the queue that can resolve the ticket end to end. Use none when no queue can act."
  },
  "model": {
    "primary": { "provider": "typesafe", "model": "jev-latest" },
    "expectResolved": "jev-1.13.0"
  },
  "changelog": "@4: thresholds per consequence class with governance from the August shadow window (was one global 0.8 in @3). @3 split account_access out of billing. @2 added the none escape."
}
```

In the example the `message` evidence field is a one-item array of `EvidenceItem` (`{ id: 'msg', kind: 'customer_message', summary: <text>, observedAt }`) built by the workflow's binding; §5.1 explains why evidence is itemised.

---

## 5. State packets

### 5.1 Packet shape (`@flowaid/jev/src/packet/spec.ts`)

The object sent as TypeSafe `state` for a contract-bound question is **always** a `StatePacket` — the handbook's seven functional fields (Table IV) in canonical order:

```ts
export const EvidenceItemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/), // cited by verifiers and generation prompts (§VIII.E)
  kind: z.string().min(1).max(64), // 'official_docs' | 'launch_post' | 'tool_result' | 'customer_message' | …
  supports: z.array(z.string().max(64)).max(32).default([]), // claims / aspects this item bears on (support relations)
  summary: z.string().max(4000).optional(), // observable content, not a conclusion (§IV.B)
  source: z
    .object({ uri: z.string().max(2048).optional(), ref: z.string().max(256).optional() })
    .optional(),
  observedAt: z.iso.datetime().optional(), // freshness (§IV.D)
  version: z.string().max(128).optional(), // content version or hash (Table VII "Re-fetch and version")
  verified: z.boolean().optional(),
});
export const ArtifactItemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
  kind: z.string().min(1).max(64), // 'draft' | 'report' | 'patch' | 'file' | …
  ref: z.string().max(512).optional(), // artifact id / path
  hash: z.string().max(128).optional(), // Table VII "Resolve current path and hash"
  summary: z.string().max(2000).optional(),
});
export const StatePacketSchema = z.object({
  goal: z.string().max(2000).optional(), // defines success for the current task
  facts: JsonObjectSchema.optional(), // what the system currently knows (exact values)
  artifacts: z.array(ArtifactItemSchema).optional(), // outputs that already exist
  evidence: z.array(EvidenceItemSchema).optional(), // supports the next semantic judgment
  constraints: JsonObjectSchema.optional(), // boundaries the system may not cross
  options: JsonObjectSchema.optional(), // what can happen now (context; the menu itself is in the question)
  stateVersion: z.string(), // "<runId>:<scope>@<seq>" — the exact evaluated snapshot
});
export type StatePacket = z.infer<typeof StatePacketSchema>;
```

The handbook's compact packet (§IV.C) in flowaid form:

```json
{
  "goal": "prepare a cited briefing on three tools",
  "facts": {
    "sources_collected": 7,
    "official_sources": 3,
    "pricing_verified": true,
    "security_claim": "unresolved",
    "draft_exists": true,
    "fact_check_complete": false
  },
  "evidence": [
    {
      "id": "s1",
      "kind": "official_docs",
      "supports": ["pricing"],
      "observedAt": "2026-09-23T07:58:00Z"
    },
    { "id": "s2", "kind": "launch_post", "supports": ["availability"] }
  ],
  "constraints": { "publish": false, "deadline": "09:00 UTC", "max_sources": 12 },
  "options": { "available_workers": ["research", "write", "fact_check", "review"] },
  "stateVersion": "0199a3c1-…:@57"
}
```

### 5.2 State spec (part of the contract)

```ts
export const PacketRoleSchema = z.enum([
  "goal",
  "fact",
  "artifact",
  "evidence",
  "constraint",
  "option",
]);
export const PacketFieldSpecSchema = z.object({
  role: PacketRoleSchema,
  /** Why the field is present (§IV.E "If developers cannot explain why a field is present…"); shown in review and the packet viewer. */
  description: z.string().min(1).max(500),
  /** JSON Schema of the bound value; `contractPorts` makes it the `state.<field>` port schema. evidence/artifact roles expect arrays of Evidence/ArtifactItem. */
  schema: JsonSchemaSchema,
  required: z.boolean().default(true),
  /** Highest data class the field may carry; the compiler takes max(this, producer x-dataClass). */
  dataClass: DataClassSchema.default("internal"),
  /** Applied before sending when the provider is not eligible for the field's class (§5.6); 'error' fails the node. */
  redact: z.enum(["error", "mask", "hash", "drop"]).default("error"),
  /** Declared minimization (§IV.E): max serialized characters of this field. */
  maxChars: z.int().min(1).max(120_000).optional(),
  overflow: z.enum(["error", "truncate_marked"]).default("error"),
  /** Freshness (§IV.D): evidence/artifact items or option data older than maxAgeMs are stale. */
  freshness: z
    .object({ maxAgeMs: z.int().min(1), requireVersion: z.boolean().default(false) })
    .optional(),
  /** role evidence/artifact: declared selection — never ad-hoc truncation. */
  selection: z
    .object({
      maxItems: z.int().min(1).max(200).default(20),
      order: z.enum(["as_bound", "observed_desc"]).default("as_bound"),
    })
    .optional(),
});
export const LatencyClassSchema = z.enum(["interactive", "standard", "batch"]);
export const StateSpecSchema = z.object({
  /** Constant goal text; alternatively one field with role 'goal'. */
  goal: z.string().max(2000).optional(),
  fields: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), PacketFieldSpecSchema)
    .refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 64, "1..64 fields"),
  /** Compactness budget in estimated tokens (chars / 3.5). ≤ 30 000 so the longest question fits TypeSafe's 32k state + question limit. */
  maxTokens: z.int().min(256).max(30_000).default(8_000),
  /** Declared maximum data class of the packet — least privilege and the batching privacy class (§IV.C, §VI.D). */
  privacyClass: DataClassSchema,
  /** Batching latency class (§VI.D): interactive = a user is waiting; standard; batch = background. */
  latencyClass: LatencyClassSchema.default("standard"),
  /** 'strict' re-checks versioned sources after evaluation and routes improve on a change; 'record' records the race (§VI.C). */
  consistency: z.enum(["record", "strict"]).default("record"),
});
export type StateSpec = z.infer<typeof StateSpecSchema>;
```

Placement: `goal` → `packet.goal`; `fact` → `packet.facts[name]`; `constraint` → `packet.constraints[name]`; `option` → `packet.options[name]`; `evidence` → items appended to `packet.evidence` (ids must be unique across fields); `artifact` → items appended to `packet.artifacts`. The node's `state` binding is an `object` binding whose keys are exactly the declared field names (extra keys → `W_JEV_PACKET_UNDECLARED_FIELD` and dropped; missing required → `E_INPUT_REQUIRED_MISSING` on `state.<field>`).

### 5.3 Builder algorithm (`buildPacket`, pure)

`buildPacket(spec, bound, { stateVersion, eligibleClass, isSecret, now, provenance }) → { packet, packetHash, tokens, report } | PacketError`:

1. **Declared fields only.** Keep the keys of `spec.fields`; everything else is excluded (`reason: 'undeclared'`). Least privilege is a declaration, not a filter over whatever the parent context holds (§IV.C).
2. **Secrets never.** Any value produced by an `x-secret` port or recognised by the run's `Redactor` as a learned secret fails the node (`PacketError{ reason: 'secret_value' }`, non-retryable).
3. **Data class policy.** Effective class = `max(field.dataClass, producer x-dataClass)` (compile time; runtime re-checks the producer's `PlanNode.redact` classes). Effective class above `spec.privacyClass` is a compile error (`E_JEV_PACKET_DATA_CLASS`). Effective class above the provider's eligible class (§5.6) applies `field.redact` (`mask` → `"[REDACTED:<class>]"`, `hash` → `"sha256:<first 16>"`, `drop` → excluded) or fails (`error`).
4. **Freshness.** Items with `observedAt` older than `freshness.maxAgeMs`, or without `version` when `requireVersion`, are marked stale in the report (the packet is still built; routing caps the zone at `improve` with reason `stale_evidence`, §6.4).
5. **Declared minimization.** Evidence/artifact `selection` (order, `maxItems`; dropped ids listed); `maxChars` → `overflow: 'error'` fails, `'truncate_marked'` keeps a prefix and appends `…[truncated <n> chars]` (listed in the report).
6. **Assemble** the seven sections in canonical order, `stateVersion` last; omit empty sections.
7. **Canonicalize and hash**: `canonical = stableStringify(packet)`, `packetHash = sha256Hex(canonical)`, `tokens = ceil(canonical.length / 3.5)` (the same estimator as the provider guard, ARCH §6.3).
8. **Budget**: `tokens > spec.maxTokens` → `PacketError{ reason: 'over_budget' }` (routing reason `packet_over_budget`: improve when the contract declares a `narrow_options`/`collect_evidence` action that the graph wires, otherwise fallback/human — never silent truncation). The hard provider limit is checked per request by the bundle planner (§8.2).
9. **Report** (`PacketReport`): included fields, excluded (`undeclared` · `data_class` · `empty_optional`), redacted (field, mode, class), truncated (field, original/kept chars), dropped evidence ids, stale items (id, age), tokens, effective data class, provenance.

### 5.4 Size budget against the Jev limits

Live limits (`TYPESAFE_API.md`): 64k tokens per request; **32k tokens for state plus the longest question**; ~1 200 rpm; text only. flowaid rules:

- `spec.maxTokens` defaults to **8 000** (compactness target — a flowaid default; _"compact, current, and evidence-based"_ has no number in the handbook) and may not exceed **30 000**, leaving ≥ 2 000 tokens for the longest question.
- The planner (§8.2) enforces per request: `tokens(packet) + max_i tokens(question_i) ≤ 32 000` and `tokens(packet) + Σ_i tokens(question_i) ≤ 64 000`, where `tokens(question) = ceil(chars(instructions + criteria) / 3.5)`. When the sum exceeds 64k the questions are split over several requests that share the same packet and `stateVersion` (one bundle, several `batchId`s).
- Static check: when every bound field has a finite bound (`maxLength`/`maxItems` in the producer schema or `maxChars`), the compiler proves the worst case and reports `E_JEV_PACKET_BUDGET` (> 30 000) or `W_JEV_PACKET_LARGE` (> `maxTokens`); unbounded fields get `W_JEV_PACKET_LARGE` with the hint "declare maxChars".

### 5.5 Provenance and inspectability

- **Static provenance**: the compiler stores `PlanNode.jev.provenance[field] = ['start.message', 'fetch_account.body', …]` (formatted refs of every `Ref` inside the field's binding).
- **Runtime provenance**: `DECISION_PACKET_BUILT.provenance[field] = { refs, nodeRunIds }` — the runtime knows the producing node runs when it resolves bindings.
- **Inspectable**: the packet viewer (§17) shows each section with the field description, provenance chips, data-class badges, redaction markers, stale markers and a token bar against `maxTokens` and the 32k limit. A field nobody can explain is a review finding (`fields_necessary`).

### 5.6 What is sent versus what is persisted

- **Provider eligibility** (`WorkspaceSettings.jev.providerEligibility: Record<hopKey, DataClass>`, hop keys `typesafe`, `llm:<provider>`, `custom:<id>`) — the highest class a provider may receive. Default `{}` means every configured provider is eligible up to `pii` (today's behaviour); security-conscious workspaces lower it and the compiler reports `E_JEV_PACKET_DATA_CLASS` at publish for contracts whose declared fields would be sent above eligibility with `redact: 'error'`. The same table prunes ineligible model/worker candidates in menus before Jev chooses (§VII.G).
- **Sent packet**: exactly the canonical packet; `packetHash` identifies it.
- **Persisted snapshot** (`decision_snapshots`, keyed by `packetHash`): the packet after write-time redaction (ARCH §10.6: `pii` masked, `sensitive` hashed; `doNotPersist` nodes store nothing). `fidelity` = `exact` (no value changed), `redacted`, or `not_persisted`. Counterfactual replays over `redacted` snapshots are reported as approximate; over `not_persisted` they are impossible and the receipt says so.

### 5.7 Packet lints and tests

Static lints (§13.2): `W_JEV_TRANSCRIPT_STATE`, `W_JEV_CONCLUSION_AS_EVIDENCE`, `I_JEV_INHERITED_JUDGMENT`, `E_JEV_PACKET_BUDGET`, `W_JEV_PACKET_LARGE`, `E_JEV_PACKET_DATA_CLASS`, `W_JEV_PACKET_UNDECLARED_FIELD`, `W_JEV_EVIDENCE_UNVERSIONED`.

Ablation (`ablatePacket(packet, spec) → Variant[]`, §IV.F): for each field — **remove** (optional fields and each evidence item), **corrupt** (type-preserving: empty string/array, shuffled evidence `supports`, swapped fact values between fields of the same type), **stale** (`observedAt` shifted past `maxAgeMs`). The contract test runner (§14.5) evaluates the variants and reports per field `{ removeFlipRate, corruptFlipRate, staleFlipRate, meanConfidenceDelta }`; findings: _required field with no effect_ ("either the field is unnecessary or the contract is not using it reliably") and _context field that flips the answer_ ("the packet is not sufficiently isolated").

---

## 6. Confidence × consequence routing

### 6.1 Consequence classes

The handbook never enumerates consequence classes (study guide §15 item 5); flowaid defines four, ordered:

| Class          | Meaning                                                                                                       | Typical actions                                                                                                                                             | Default authority                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `low`          | Internal and reversible; no customer-visible or external effect                                               | queue assignment, internal labels, retrieval filtering, worker/model selection among eligible candidates, completion checks that gate further internal work | may automate after calibration (illustrative zones from Table V until governed)                      |
| `medium`       | Reversible external effect or bounded cost; correctable                                                       | public issue comment, internal notification, ticket creation, bounded spend                                                                                 | automates only with governed thresholds (no illustrative auto zone)                                  |
| `high`         | Represents the user or organisation, moves money, changes access or exposes data; reversible only with effort | customer email, refunds under a cap, publishing, granting access                                                                                            | human by default; auto only with governed thresholds **and** a deterministic policy step on the path |
| `irreversible` | Cannot be undone                                                                                              | deletion, payment, irreversible external calls (`idempotency: 'none'`)                                                                                      | human at every confidence (§III.E, §V.A) — not configurable                                          |

Compiler inference (legacy implicit contracts and authority proofs, §6.6): `idempotency: 'none'` ⇒ `irreversible`; `keyed` with an external write (HTTP non-GET/HEAD, tool with a `*.write` capability, MCP/OpenAPI operations that are not `safe`) ⇒ `medium`; `ToolDefinition.approvalRequired` ⇒ `high`; `safe` nodes and generation without tools ⇒ `low`.

### 6.2 Routing confidence per primitive

| Primitive           | Selected outcome                               | Routing confidence `c`                                        | Margin `m`                               | Calibration target (§7.2)                                                                   |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Choice              | `decision.value` (option key)                  | `decision.confidence` (provider's distribution-derived value) | `p(1) − p(2)` of the sorted distribution | top-label (`c` vs correct) and classwise (`p_k` vs label = k)                               |
| Boolean (Noul)      | `true` iff `pYes ≥ yesAt`                      | `max(pYes, 1 − pYes)` (ARCH D15)                              | —                                        | **raw `pYes`** vs label (Brier, reliability of P(yes)); top-label of `c` for routing checks |
| Score with bands    | band with the largest mass `M_b = Σ_{l∈b} p_l` | `M_selected`                                                  | `M(1) − M(2)`                            | band top-label accuracy, RPS on levels                                                      |
| Score without bands | `level = round(value)` (measurement)           | `decision.confidence` (informational)                         | —                                        | RPS; not routable to auto ports                                                             |

`ScoreDecision.normalized` stays in the contract for display only (a position between neighbouring level descriptions, §II.B); arithmetic on it is `W_JEV_SCORE_AS_MEASURE`.

### 6.3 Illustrative defaults and governance

When a contract omits a class's zones, the routing engine uses these values and adds the reason `thresholds_illustrative` (Table V is explicitly illustrative):

| Class          | `autoAt`    | `improveAt` | Below `improveAt` |
| -------------- | ----------- | ----------- | ----------------- |
| `low`          | 0.90        | 0.70        | human             |
| `medium`       | — (no auto) | 0.70        | human             |
| `high`         | —           | —           | human             |
| `irreversible` | —           | —           | human (always)    |

A version with illustrative or ungoverned thresholds may run in `shadow` anywhere and act (`active`/`canary`) only in non-protected environments; protected environments require `routing.governance` with `approvedBy` set and an evaluation window whose source is not `illustrative` (`PUT …/deployments` answers 422 otherwise). _"A threshold chosen from a small demo set should never silently become permanent policy"_ (§V.C).

### 6.4 Routing algorithm (`route`, pure)

```ts
export interface RouteInput {
  contract: DecisionContractBody;
  decision: DecisionResult | null; // null ⇒ evaluation could not run (hops exhausted, over budget, stale menu without improve)
  outcome: string | null; // option key | band port | 'true' | 'false'
  escape: EscapeKind | null;
  consequenceOverride: ConsequenceClass | null; // a route node may only RAISE the class
  calibrated: boolean; // see the definition below the algorithm
  fuzzy: boolean; // LLM adapter fuzzy-mapped the label
  modelChanged: boolean; // resolved model ≠ model.expectResolved
  improveRoundsUsed: number;
  blindRetry: boolean; // same (contractHash, packetHash, optionSetVersion) already evaluated in this lineage
  stale: { evidence: boolean; optionSet: boolean };
  overBudget: boolean;
}
export interface RouteResult {
  route: JevRoute;
  reasons: RouteReason[];
  consequenceClass: ConsequenceClass;
  threshold: ThresholdApplied;
  outcome: string;
}

// Precedence (each step may only lower authority: auto > improve > human):
// 0. overBudget and routing.improve declares narrow_options|collect_evidence and `improve` is wired
//                                        → improve                   (packet_over_budget) — the graph narrows the evidence
//    decision === null or overBudget     → outcome := contract.fallbackOutcome ?? null; route by its escape (else human)
//                                          reasons: fallback_outcome (+ packet_over_budget)
// 1. blindRetry                          → human                     (blind_retry_blocked; no provider call was made)
// 2. escape outcome                      → review|escalate ⇒ human; stop ⇒ escapeRoutes.stop; none|other ⇒ escapeRoutes.none|other
//                                          (escape_outcome | stop_outcome). `stop` authorises no action, so it may be auto at any class.
// 3. cc := max(contract class, outcome/band class, consequenceOverride)
//    cc === 'irreversible'               → human                     (consequence_irreversible)          ← §V.E: before any confidence test
// 4. fuzzy                               → treat as escape `other`   (provider_uncalibrated)
// 5. zone from thresholds[cc] (or §6.3 illustrative defaults, + thresholds_illustrative):
//       c ≥ autoAt → auto ; c ≥ improveAt → improve ; else human   (zone_auto | zone_improve | zone_human)
//    minMargin set and m < minMargin     → demote one zone           (margin_below_min)
// 6. !outcome.automatable                → cap at improve            (outcome_not_automatable)
// 7. stale.evidence | stale.optionSet    → cap at improve            (stale_evidence | stale_option)
// 8. !calibrated                         → cap per uncalibratedProviders ('human' | 'improve' | no cap)   (provider_uncalibrated)
// 9. modelChanged && onModelChange==='human' → human                (model_version_changed)
// 10. route === 'improve' and (no routing.improve, or improveRoundsUsed ≥ maxRounds, or the improve port is unwired)
//                                        → human                     (improve_budget_exhausted)
```

Why this order: consequence precedes confidence (§V.E code sketch), escapes are declared safe routes (§II.A), and staleness means the harness evaluated an invalid graph (§VIII.A) so it may at most improve (rebuild) — never automate.

**`calibrated`** is true iff (a) the answer came from a `typesafe` hop of the contract's model chain and was not fuzzy-mapped, and (b) the acting version's run-start resolution (§4.4 step 4) carries `calibrated: true`. The API computes (b) per version and environment: true in a non-protected environment and for `local` runs (where illustrative thresholds may act, flagged `thresholds_illustrative`); in a protected environment true only with calibration evidence for that version there — a `shadow_baseline` snapshot, or a rolling snapshot with ≥ 50 labeled decisions (flowaid default, Appendix A). An LLM, rule or custom hop, a fuzzy-mapped label or a version without evidence therefore cannot automate under the default `uncalibratedProviders: 'human'` (conflict C3).

### 6.5 Improve-state paths and the blind-retry guard

- **Graph pattern.** flowaid graphs are acyclic; improvement is a bounded `loop` whose body builds the packet, decides and, on `improve`, runs the evidence-producing step named by the contract's `ImproveAction` (a search, a deterministic check, a narrower menu, a precise question to the user through a `human` form, or a stronger model hop). `carry` accumulates the new evidence; `exitWhen: "decide.receipt.route != 'improve'"`; `bounds.maxIterations = improve.maxRounds + 1`. Template: _Decide with evidence_ (§9.8).
- **Blind-retry key** `sha256Json({ contractHash, packetHash, optionSetVersion })`. The runtime reduces `DECISION_RECEIPT` events into `SchedulerState.jev.evaluated[lineage]`, where the lineage is the node id plus the scope path with iteration indices removed. A decision whose key is already in its lineage makes **no provider call** and receives a receipt with route `human`, reason `blind_retry_blocked` and the earlier distribution (marked `reused: true`) — _"repeating the same uncertain question against the same state is not learning"_ (§IV.D).
- **Transport retries are not semantic retries**: `NODE_RETRIED` after `PROVIDER_RATE_LIMITED`/`PROVIDER_OVERLOADED`/timeouts obtained no answer and may repeat the same key.
- **Static check**: `E_JEV_BLIND_RETRY` when a loop re-evaluates a contract node and no node in the loop body feeds that node's `state`/`options` bindings with a value that can change between iterations (only refs outside the loop, `$vars` or `$scope.iteration`).

### 6.6 Authority: allowed actions, policy verdicts, the safe order

**Compile-time proof** (J-09). For every contract node and each of its auto-capable ports (static outcomes, band ports, `yes`/`no`, `selected`, `stop` when auto), the compiler computes the _authority region_: nodes reachable through control edges from the port, and nodes activated only through that port's guard, stopping at `human` nodes, `flowaid.jev.tool_gate`, other contract routers and `output` nodes. For every task node `T` in the region:

- `T.idempotency === 'none'` ⇒ `E_JEV_IRREVERSIBLE_AUTO` (an irreversible action must be behind a human or a tool gate whose policy requires approval);
- `T` has a tool capability not in `allowedAction.capabilities`, or an external side effect while `externalSideEffects: false`, or an inferred class (§6.1) above `allowedAction.maxConsequence` ⇒ `E_JEV_AUTHORITY_EXCEEDED`;
- the node's outcome names imply authorisation (`allow`, `approve`, `permit`, `execute`, `grant`, `deny`) and the region reaches side effects without a policy node ⇒ `W_JEV_POLICY_IN_CLASSIFIER` (§X.G).

The proof id (`sha256Json` of the region and the contract's `allowedAction`) is stored in `PlanNode.jev` and cited by every receipt.

**Run-time verdict** (`policyVerdict`): the deterministic checks applied to one decision, recorded as `routings[].policy = { id, verdict, checks[] }`:

| Check                        | Source                                                          | Effect when it fails                              |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `allowed_action_proof`       | plan proof id                                                   | cannot fail at run time (compile error otherwise) |
| `rollout_guardrails`         | §6.7                                                            | auto → holdback (legacy/human)                    |
| `consequence_ceiling`        | guardrails `maxConsequence`                                     | auto → human                                      |
| `budget`                     | `ctx.budget` remaining cost/tokens/time                         | auto → human (reason `policy_review`)             |
| `escalation_available`       | `human` port wired or inline escalation                         | compile error `E_JEV_ESCALATION_UNWIRED`          |
| tool policy (tool gate only) | allow-lists, destinations, data class, approvals, scopes (§9.3) | `review` or `deny`                                |

A verdict can only lower authority (`allow` → `review` → `deny`); _"A low-risk prediction cannot override an allowlist, a repository boundary, an account permission, or a requirement for human confirmation"_ (§VII.B). The authorised action is the only control port the runtime fires.

### 6.7 Rollout disposition

Per decision the contract node computes with `rolloutDisposition()` (the runtime re-checks it when it validates the node's facts, §12.2), from `RUN_CREATED.contracts[key]` (§11.3) and deterministic inputs only (§IX.I _"Guardrails should be deterministic and independent of Jev confidence"_), which versions it evaluates and which one may act. Filters that need no answer are applied before the provider call; the guardrails that depend on the answer (`outcomes`, `maxConsequence`) are applied after it to the route the answer produced — never to its confidence.

```
u          = parseInt(sha256Hex(sampleSalt|runId|nodeId|question|lineage).slice(0, 13), 16) / 2^52   // 52 bits: exact as a double
filters    = (tenants absent ∨ tenant ∈ tenants) ∧ (languages absent ∨ language ∈ languages)
drawn      = candidate.stage = 'canary' ∧ filters ∧ u < trafficShare                                  // before evaluation
inScope(r) = r.route ≠ 'auto' ∨ (filters ∧ r.consequenceClass ≤ maxConsequence
                                   ∧ (outcomes absent ∨ r.outcome ∈ outcomes))                        // after evaluation; automate ONE outcome first (§IX.F)
```

| Deployment (run-start resolution)               | Evaluated on the same snapshot (one bundle) | Acting receipt                                                                                                | Other receipts                                       |
| ----------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| active `active`, no candidate                   | active                                      | active, disposition `active`                                                                                  | —                                                    |
| active `active` + candidate `shadow`            | active, candidate                           | active                                                                                                        | candidate: mode `shadow`, disposition `shadow`       |
| active `active` + candidate `canary`, `drawn`   | active, candidate                           | the candidate when `inScope(candidate)` (disposition `canary`), else the active                               | the other one: mode `shadow`, disposition `holdback` |
| active `active` + candidate `canary`, not drawn | active                                      | active                                                                                                        | —                                                    |
| no active, candidate `shadow`                   | candidate                                   | none: `legacy` if wired, else `human` (reason `rollout_shadow`)                                               | candidate: mode `shadow`, disposition `shadow`       |
| no active, candidate `canary`, `drawn`          | candidate                                   | the candidate when `inScope`, else none: `legacy`/`human` (disposition `holdback`, reason `rollout_scope`)    | —                                                    |
| no active, candidate `canary`, not drawn        | nothing (no provider call)                  | none: `legacy`/`human`; the receipt has `distribution: {}`, disposition `holdback`, reason `rollout_holdback` | —                                                    |
| active `paused` or `shadow` (± candidate)       | active (+ candidate)                        | none: `legacy`/`human` (reason `rollout_shadow`)                                                              | all: mode `shadow`, disposition `shadow`             |

The guardrail scope also bounds the active version when it acts: an auto route with `inScope(r) = false` fires `legacy` when wired, else `human` (reason `rollout_scope`); `trafficShare` applies to the canary only. `tenant` and `language` come from run labels (`labels.tenant`, `labels.language`) or, for language, from a packet fact named `language`; they are never inferred by a model. Automated receipts are additionally sampled for post-hoc review with probability `guardrails.reviewSampleRate` (label queue, §7.1); sampling never changes the action. When two versions are evaluated they share one request if their bodies build the same packet (same interface; a different `maxChars` or `selection` yields a second packet of the same snapshot, §8.2).

### 6.8 Legacy gates and routers

`flowaid.decision.confidence_gate` and `flowaid.decision.router` keep their semantics (ARCH §6.3). After either completes, the runtime appends `DECISION_ROUTED` for the receipt of the decision it consumed (resolved through the plan's data dependency): gate `pass → auto`, `review → human`, `fail → human`; router option → `auto`, `review → human`; reason `legacy_gate`, threshold recorded as the gate's `threshold`/`reviewBand`, consequence class from the implicit contract. The critic proposes the migration to `flowaid.jev.route` (quick fix) and reports `W_JEV_SINGLE_THRESHOLD` when one gate threshold controls actions of different classes.

---

## 7. Calibration

Calibration answers _"whether events predicted near a probability occur at roughly that frequency on the target workload"_ (§V.C) — per contract version, never globally.

### 7.1 Labels

```ts
export const LabelSourceSchema = z.enum([
  "reviewer",
  "override",
  "sampled_review",
  "fixture",
  "adjudication",
]);
export const DecisionLabelSchema = z.object({
  id: z.uuid(),
  receiptId: z.uuid(),
  labeler: z.string(), // user id; 'system' for fixtures
  source: LabelSourceSchema,
  /** The semantic answer under the contract (option key | 'true'/'false' | band port | level index). */
  outcome: z.string(),
  /** Dual label for consequence ≥ medium: the route the case should have taken (§IX.E Labels and Adjudication). */
  permittedRoute: JevRouteSchema.nullable(),
  /** Version of the written labeling rubric (contract.escalation.rubric hash). */
  rubricVersion: z.string(),
  /** Short human rationale — never a chain-of-thought (§IV.F). */
  rationale: z.string().max(1000).nullable(),
  /** Inclusion probability when the receipt reached the labeler through sampling (for inverse-probability weighting). */
  inclusionProbability: z.number().min(0).max(1).nullable(),
  createdAt: z.iso.datetime(),
});
export const LabelSamplingPolicySchema = z.object({
  baseRate: z.number().min(0).max(1).default(0.02),
  strata: z
    .array(
      z.object({
        when: z.enum([
          "near_threshold",
          "rare_outcome",
          "consequence_high",
          "escape_outcome",
          "auto_route",
          "new_version",
          "shadow_disagreement",
        ]),
        rate: z.number().min(0).max(1),
      }),
    )
    .default([
      { when: "near_threshold", rate: 0.25 },
      { when: "rare_outcome", rate: 0.5 },
      { when: "consequence_high", rate: 0.5 },
      { when: "escape_outcome", rate: 0.2 },
      { when: "auto_route", rate: 0.05 },
      { when: "new_version", rate: 0.2 },
      { when: "shadow_disagreement", rate: 0.5 },
    ]),
  nearThresholdBand: z.number().min(0).max(0.2).default(0.03),
  rareOutcomeShare: z.number().min(0).max(0.2).default(0.02),
});
```

- **Sources.** Reviewers label from the labeling queue with the contract's written rubric; in-run human review of a `human`-routed receipt yields a `reviewer` label (confirmation) or an `override` label (different outcome); automated receipts sampled by `guardrails.reviewSampleRate` yield `sampled_review`; contract fixtures are `fixture` labels and never mix with production calibration; `adjudication` resolves disputes.
- **Adjudication** (§IX.E): a receipt with two or more labels from different labelers is `agreed` or `disputed`; disputed receipts are excluded from accuracy until adjudicated but always counted in the inter-rater metric — _"Preserve disagreement instead of forcing premature consensus"_. Systematic disagreement on an outcome raises `label_disagreement` (§7.5), which points at the contract, not the model.
- **Sampling with correction** (§V.F _"Oversample rare, consequential, and near-threshold examples"_): a receipt enters the queue when `hash(receiptId) < max(rate of the matching strata, baseRate)`; the queue item records that inclusion probability `π`. Aggregate metrics weight each labeled receipt by `1/π` (Horvitz–Thompson), so oversampling sharpens the boundary without biasing the global numbers. Selection bias of human-routed labels (only low-confidence cases reach reviewers) is corrected the same way, and the auto region is measured only through `sampled_review` and shadow labels.

### 7.2 Metrics (exact definitions; flowaid's, the handbook names only Brier and top-label/classwise)

For a segment with labeled receipts `i = 1..N`, weights `w_i = 1/π_i` (1 for unsampled full labeling), routing confidence `c_i`, correctness `y_i = 1[outcome_i = label_i]`:

- **Reliability bins**: 10 equal-width bins over `[0,1]`; per bin `n_b = Σ w`, `conf_b = Σ w·c / n_b`, `acc_b = Σ w·y / n_b` (the reliability diagram of Fig. 2).
- **ECE** `= Σ_b (n_b / N_w) · |acc_b − conf_b|`; **MCE** `= max_b |acc_b − conf_b|` over bins with ≥ 10 labels; **ACE** = ECE over 10 equal-mass bins.
- **Noul** (§V.D): reliability and ECE of **raw `pYes`** against `label = true`; **Brier** `= Σ w (pYes − y_true)² / N_w`.
- **Choice**: top-label ECE as above; **classwise ECE** per option `k` over all receipts using `p_k` vs `1[label = k]`, with support; multiclass Brier `Σ_k (p_k − 1[label = k])²` averaged.
- **Score**: band top-label ECE (banded contracts); **RPS** `= (1/(K−1)) Σ_{j<K} (F_j − O_j)²` with cumulative predicted `F` and observed `O` over levels.
- **Auto precision**: accuracy over labeled receipts with route `auto`, with the Wilson 95 % lower bound `(p + z²/2n − z·√(p(1−p)/n + z²/4n²)) / (1 + z²/n)`, `z = 1.96`.
- **Route correctness** (dual labels): share of labeled receipts whose route equals `permittedRoute`.
- **Near-threshold mass**: share of decisions with `autoAt ≤ c < autoAt + δ` and with `autoAt − δ ≤ c < autoAt` (δ = `nearThresholdBand`) — _"A large mass just above an automation boundary makes the system sensitive to small calibration drift"_ (§V.C).
- **Confidence shift**: PSI between the window's and the baseline's 10-bin confidence histograms, `Σ (a − e)·ln(a/e)` with ε = 1e-4 smoothing.
- **Monotonicity**: over fixture _ladders_ (same case with evidence quality rising by rank), share of adjacent pairs where the expected outcome's probability drops by more than 0.02 (§III.F _"whether confidence changes monotonically with evidence quality"_).
- **Operational rates**: route shares, escape rate, override rate (overrides / auto receipts), stale-option rate, blind-retry-blocked rate, inter-rater disagreement.

```ts
export const ReliabilityBinSchema = z.object({
  lo: z.number(),
  hi: z.number(),
  weight: z.number(),
  labeled: z.int(),
  meanConfidence: z.number().nullable(),
  accuracy: z.number().nullable(),
});
export const CalibrationMetricsSchema = z.object({
  decisions: z.int().min(0),
  labeled: z.int().min(0),
  accuracy: z.number().nullable(),
  ece: z.number().nullable(),
  ace: z.number().nullable(),
  mce: z.number().nullable(),
  brier: z.number().nullable(),
  rps: z.number().nullable(),
  classwise: z
    .record(
      z.string(),
      z.object({
        support: z.int(),
        ece: z.number().nullable(),
        accuracy: z.number().nullable(),
        meanConfidence: z.number().nullable(),
      }),
    )
    .nullable(),
  bins: z.array(ReliabilityBinSchema),
  routeShare: z.object({ auto: z.number(), improve: z.number(), human: z.number() }),
  autoPrecision: z.object({ value: z.number(), lower95: z.number(), n: z.int() }).nullable(),
  routeCorrectness: z.number().nullable(),
  nearThreshold: z.object({ band: z.number(), above: z.number(), below: z.number() }),
  confidenceHistogram: z.array(z.object({ lo: z.number(), hi: z.number(), count: z.int() })),
  psi: z.number().nullable(),
  monotonicity: z.object({ ladders: z.int(), violations: z.int() }).nullable(),
  rates: z.object({
    escape: z.number(),
    override: z.number(),
    staleOption: z.number(),
    blindRetryBlocked: z.number(),
    interRaterDisagreement: z.number().nullable(),
  }),
});
```

### 7.3 Segmentation

Every snapshot is keyed by contract key **and version** plus a segment: `environmentId`, `consequenceClass`, `language`, `outcome` (per option — rare options get their own row), `resolvedModel`, `mode` (`live` | `shadow`), `disposition`. _"A global average can hide the branch that matters most"_ (§V.D). The UI never shows an unsegmented number without the per-outcome breakdown next to it.

### 7.4 Snapshots

```ts
export const CalibrationSegmentSchema = z.object({
  environmentId: z.uuid().nullable(),
  consequenceClass: ConsequenceClassSchema.nullable(),
  language: z.string().nullable(),
  outcome: z.string().nullable(),
  resolvedModel: z.string().nullable(),
  mode: z.enum(["live", "shadow"]).nullable(),
  disposition: RolloutDispositionSchema.nullable(),
});
export const DriftAlarmSchema = z.object({
  kind: z.enum([
    "ece_rise",
    "review_rate_rise",
    "escape_rate_rise",
    "near_threshold_mass",
    "confidence_shift",
    "override_rate",
    "model_version_changed",
    "label_disagreement",
    "stale_options",
    "monotonicity",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  value: z.number(),
  baseline: z.number().nullable(),
  threshold: z.number(),
  message: z.string(),
  inspectFirst: z.array(
    z.enum([
      "state_freshness",
      "menu_completeness",
      "new_option_class",
      "evidence",
      "calibration",
      "contract_wording",
      "policy_order",
    ]),
  ),
});
export const CalibrationSnapshotSchema = z.object({
  id: z.uuid(),
  contract: ContractRefSchema,
  segment: CalibrationSegmentSchema,
  window: z.object({
    kind: z.enum(["rolling_7d", "rolling_28d", "shadow_baseline", "canary", "evaluation"]),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  }),
  metrics: CalibrationMetricsSchema,
  alarms: z.array(DriftAlarmSchema),
  baselineSnapshotId: z.uuid().nullable(),
  computedAt: z.iso.datetime(),
});
```

The `jev.calibrate` job (RFC-0016, queue `maintenance`, `JEV_CALIBRATION_CRON` default hourly) computes `rolling_7d` and `rolling_28d` snapshots for every (contract version, segment) with activity; promotion to `canary`/`active` freezes the current shadow numbers as a `shadow_baseline` snapshot (the comparison baseline of §IX.F).

### 7.5 Drift alarms (flowaid defaults; the handbook gives no numbers)

| Alarm                   | Fires when (window 7 d vs baseline)                | Severity | Inspect first (Table IX)                                                          |
| ----------------------- | -------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `ece_rise`              | ECE +0.03 with ≥ 50 labeled (+0.06 ⇒ critical)     | warning  | evidence, menu completeness, calibration                                          |
| `review_rate_rise`      | human share × 1.5 with ≥ 200 decisions             | warning  | state freshness, new option classes (§IX.H)                                       |
| `escape_rate_rise`      | escape share × 2 with ≥ 200 decisions              | warning  | new option class the contract cannot express                                      |
| `near_threshold_mass`   | ≥ 15 % of decisions in `[autoAt, autoAt + 0.03)`   | warning  | "improve the contract or widen the review zone before increasing autonomy" (§V.C) |
| `confidence_shift`      | PSI ≥ 0.2 (≥ 0.3 critical)                         | warning  | state freshness, workload change                                                  |
| `override_rate`         | overrides / auto ≥ 5 % with ≥ 50 auto              | critical | evidence, calibration, policy order                                               |
| `model_version_changed` | resolved model ≠ baseline's                        | info     | recompute segments; re-shadow if `onModelChange: 'human'`                         |
| `label_disagreement`    | inter-rater disagreement ≥ 20 % on an outcome      | warning  | contract wording                                                                  |
| `stale_options`         | `stale_option` reasons ≥ 1 %                       | warning  | menu construction and invalidation                                                |
| `monotonicity`          | ladder violations > 10 % in the last contract test | warning  | criteria and representative tests                                                 |

Alarms appear on the contract page, raise the notification events `jev.drift_alarm` (warning/critical), and feed the rollout controller when they match a rollback trigger (§11.3).

### 7.6 Threshold recommendation (`recommendThresholds`)

For a contract version, environment and consequence class `cc` (never `irreversible`), over labeled live and shadow receipts:

1. Targets (flowaid defaults): precision τ = 0.95 (`low`), 0.98 (`medium`), 0.995 (`high`); minimum labeled receipts in the candidate auto region `n_min` = 100 / 200 / 400; ECE of the segment ≤ 0.05.
2. For `t` from 0.50 to 0.99 in steps of 0.01: `A_t = {c ≥ t}`; weighted precision and Wilson lower bound on labeled members.
3. Recommended `autoAt` = the smallest `t` with lower bound ≥ τ, `|labeled ∩ A_t| ≥ n_min` and near-threshold mass above `t` ≤ 15 %; none ⇒ recommend "no auto" with the reason.
4. Recommended `improveAt` = the largest `t' < autoAt` below which accuracy falls under 0.6 (evidence collection unlikely to help) — only when the contract declares improve actions.
5. Output `ThresholdRecommendation { contract, consequenceClass, current, recommended, target, achieved: { precision, lower95, coverage, n }, nearThresholdMass, basis: { snapshotIds, labeled, window }, warnings }`.

Recommendations are **never applied automatically**: accepting one creates a new contract draft whose `routing.governance` is prefilled (owner, rationale citing the numbers, evaluation window, a rollback condition), which then goes through review (§4.6) and rollout (§11) like any other change.

### 7.7 Calibration rollout rules (§V.F)

- Calibration is first estimated in **shadow** (§11); a version may leave shadow in a protected environment only when its shadow snapshots meet the promotion rule for the outcomes it will automate (§11.4); leaving shadow freezes them as the version's `shadow_baseline`.
- After automation starts, `canary` snapshots are compared with the baseline; the rollout controller pauses the candidate on a matching rollback trigger.
- Any change of contract version, state spec (a new interface) or resolved model starts new segments; the previous curve is not reused (_"moving the same contract to a new language, product area, or user population may invalidate the previous curve"_).

---

## 8. Parallel question bundles and state boundaries

### 8.1 Definitions

- **Snapshot**: the reduced run state after event `seq`, where `seq` is the `NODE_SCHEDULED.seq` of the evaluating node run (for a compiler batch group, the lowest `NODE_SCHEDULED.seq` of its members, which the runtime schedules in one step); `stateVersion = "<runId>:<scope>@<seq>"`. A node is scheduled only when its dependencies have settled, so every input it resolves comes from outputs completed at or before that `seq`; node outputs are immutable, so the snapshot is an immutable version of reality. Mutable sources (state entries, artifacts replaced by path, live menus) are handled by §8.4. Legacy decision nodes get their `stateVersion` the same way.
- **Bundle** (`bundleId`): the questions evaluated against one snapshot — the questions of one `flowaid.jev.bundle` node, or the members of one compiler batch group. _"Batching is not merely an optimization. It provides a semantic transaction boundary"_ (§VI.C).
- **Request** (`batchId`): one `POST /v1/systemone` = one packet + the questions that share it. A bundle has one request per distinct packet (contracts with different projections produce different packets of the same snapshot).

### 8.2 Mapping to TypeSafe batching (`planBundle`)

```
input:  snapshot, questions q_i = (key_i, contract_i, packet_i, providerHop_i, credential_i)
1. group by (packetHash, providerHop, credential, privacyClass, latencyClass)            → candidate requests
2. per group: tokens(packet) + max tokens(question) ≤ 32 000, else the offending question fails
   with BoundsExceededError('maxTokens') and the chunking hint (ARCH §6.3) before any call
3. per group: while tokens(packet) + Σ tokens(question) > 64 000 → split the questions (largest first)
   into further requests with the same packet and stateVersion
4. each request → { model, state: packet, questions: { key_i: SystemOneQuestion_i } }  (ARCH §6.3 mapping)
output: requests[] (batchId = bundleId + '#' + n), all DECISION_REQUESTED events carry bundleId, stateVersion, packetHash
```

The runtime issues the requests of a bundle concurrently (subject to the token bucket, ~1 200 rpm), and the receipts of a bundle are shown side by side (Decisions tab, §17): _"urgency, approval likelihood, and worker choice can be inspected together"_ (§VI.D).

### 8.3 Formation rules

- The compiler's batch-group key (ARCH §4.4) becomes `(scope, packetSpecHash, primary hop, credential secret, privacyClass, latencyClass, guard)` with no dependency path between members; `packetSpecHash` replaces `stateBindingHash` for contract nodes (legacy nodes keep `stateBindingHash`). RFC-0015 adds optional `privacyClass`, `latencyClass`, `packetSpecHash` to `BatchGroupSchema`; `I_JEV_BUNDLE` reports each formed bundle.
- An explicit `flowaid.jev.bundle` node whose contracts differ in `privacyClass` or `latencyClass`, or whose providers have different eligibility, is `E_JEV_BUNDLE_CLASS_MIX` — _"A sensitive approval judgment should not inherit a provider route chosen for a low-cost internal classification"_ (§VI.D).
- Independence is structural: a bundle's questions all read the same snapshot, so none can consume another's fresh answer (§VI.B). Anything that needs new evidence is a later node with a later `stateVersion`.
- Consensus nodes stay excluded from batch groups (ARCH §4.4).

### 8.4 Snapshot discipline (§VI.C)

1. Every packet, request and receipt carries `stateVersion` and `packetHash`.
2. Relevant writes: node outputs cannot change; the mutable sources are `ctx.state` entries, artifacts replaced by path, and live external state (menus). Packet fields bound from `flowaid.state.get` outputs and artifacts carry their entry version/hash; with `consistency: 'strict'` the runtime re-reads those versions after the provider answers and, on a change, sets `staleness.raceRecorded = true` and caps the route at `improve` (reason `state_race`); with `'record'` it only records the race.
3. **Evidence scope per question**: every receipt lists the packet paths and evidence ids its contract's projection exposed (`evidenceScope`), so a bundle's receipts say which evidence each question was allowed to inspect.

### 8.5 Dependent sequences are visible

_"Each arrow that creates evidence must be visible in the trace"_ (§VI.E). The Decisions tab of a run (§17) lists receipts ordered by `stateVersion` and draws, between consecutive snapshots of the same lineage, the nodes whose completions created the new evidence (from `DECISION_PACKET_BUILT.provenance`), rendering the handbook's `STATE v7 → decide → search → STATE v8 → decide → route` chain from real events.

### 8.6 Decision parallelism versus execution parallelism (§VI.F)

Evaluating routes together is safe; executing their actions concurrently may not be. `W_JEV_PARALLEL_SIDE_EFFECTS` fires when two auto regions of one bundle can run concurrently and contain side-effecting nodes (`keyed`/`none`) that share a tool capability, credential slot binding or HTTP host. The fix is deterministic serialization in the graph (a control edge or a `join`), not another model call. Cross-run contention (budgets, accounts) stays the tools' responsibility through idempotency keys (ARCH §5.8); a resource-lock policy is out of scope for this addendum.

---

## 9. Harness insertion points: node types and patterns

_"Jev sits at semantic transitions; authority remains deterministic"_ (Table VI). flowaid ships each insertion point as a node type plus a template, so the pattern is the default way to build it.

### 9.1 Node catalog `flowaid.jev.*` (nodes-core, `src/jev/*.ts`)

Common to all nine: category `decision` (cobalt, `DecisionNodeCard`), `decision: { kind: 'contract' }` (RFC-0015), port rule `contractPorts{ path: '/contract' }` (bundle: `/contracts`), `idempotency: 'safe'` (evaluating a question has no external effect), pool `general`, credential slots `typesafe` (`typesafe.api_key`, optional) and `llm` (`openai.api_key | anthropic.api_key | ollama.host`, optional) exactly like the existing decision nodes, capabilities `['network', 'credentials', 'decision']` (`route` and `menu` without a `models` source need only `['decision']`; + `suspend` when `escalation: 'inline'`). They are provider-neutral: the contract's `model` chain applies, and non-TypeSafe hops are simply uncalibrated (§6.4 step 8). `LambdaSource` below is a FlowExpr lambda (`c => …`) that the node composes into `filter`/`sort`/`map` calls, so the compiler type-checks it against the candidate schema.

| Node type               | Purpose (insertion point)                                                               | Config (beyond `contract`)                                                                                                                                                                                                                                                               | Inputs                                                                                                             | Outputs                                                                                                       | Control-outs                                                        |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flowaid.jev.decide`    | Contract-bound decision (routing, completion, retry strategy, …)                        | `routing: 'inline' \| 'external'` (default inline), `escalation: 'wired' \| 'inline'`, `legacyPort: boolean`, `consequenceClass?` (raise only)                                                                                                                                           | `state` (contract fields), `options?` (dynamic menus)                                                              | `decision`, `receipt`, `packet`, `selection?`                                                                 | §4.5 (inline) or `done`                                             |
| `flowaid.jev.bundle`    | Several contracts over one snapshot (§VI.A)                                             | `contracts: Record<questionKey, ContractBinding>` (1–32)                                                                                                                                                                                                                                 | `state` (union of fields; each contract projects its own), `options_<q>?` (dynamic inputs)                         | `answers`, `receipts`, `packets` (keyed by question)                                                          | `done`                                                              |
| `flowaid.jev.route`     | Consequence router over an existing decision (evaluation separate from routing, §III.E) | `question?` (bundle answer key), `consequenceClass?` (raise only), `legacyPort`, `escalation`                                                                                                                                                                                            | `decision`, `receipt`                                                                                              | `route` (`{ route, reasons, consequenceClass, threshold, disposition }`), `decision` (pass-through)           | as `decide` inline                                                  |
| `flowaid.jev.menu`      | Live option menu (§VIII.A–B)                                                            | `source: { kind: 'binding' } \| { kind: 'models', filter? }`, `keep?`, `id`, `description`, `label?`, `shortlist?: { by, topK, order }`, `cost?: { by, respectBudget }`, `eligibility?: { dataClassBy }`, `observedAt?`, `cache?: { key: TemplateSource, invalidateOn: string[] (≥ 1) }` | `candidates` (array; not with `source: models`)                                                                    | `optionSet` (§10.1), `counts`                                                                                 | `done`, `empty` (only escapes left)                                 |
| `flowaid.jev.packet`    | Explicit packet (share and inspect one packet)                                          | —                                                                                                                                                                                                                                                                                        | `state`                                                                                                            | `packet`, `packetHash`, `stateVersion`, `tokens`, `report`                                                    | `done`, `over_budget`                                               |
| `flowaid.jev.tool_gate` | Before tool: semantic risk + deterministic policy (§VII.B)                              | `policy: ToolPolicy` (§9.3)                                                                                                                                                                                                                                                              | `proposal` (`{ tool, args }`), `context?`                                                                          | `normalized` (`ToolProposal`), `args` (pass-through for the executing node), `verdict`, `decision`, `receipt` | `allow`, `review`, `deny`                                           |
| `flowaid.jev.verify`    | After tool / post-generation verification (§VII.C–D)                                    | `checks: { name, when: FlowExpr, onFail: 'repair' \| 'collect_evidence' \| 'escalate' }[]`                                                                                                                                                                                               | `artifact`, `evidence?`, `goal?`                                                                                   | `checks`, `decision`, `receipt`                                                                               | `pass`, `repair`, `collect_evidence`, `human`                       |
| `flowaid.jev.relevance` | Retrieval relevance (§VII.E, §VIII.E)                                                   | `keepBands: string[]`, `maxEvidence` (1–50, default 8), `groupSize` (1–64, default 16)                                                                                                                                                                                                   | `question`, `candidates` (`{ id, kind, summary, source?, observedAt? }[]`, already exact-filtered and shortlisted) | `evidence` (`EvidenceItem[]` with `supports`), `dropped` (`{ id, band, confidence }[]`), `counts`             | `done`, `insufficient`                                              |
| `flowaid.jev.shadow`    | Shadow beside an authoritative path (§IX.D)                                             | `production: { source: 'llm' \| 'rule' \| 'code' \| 'human' \| 'jev', answerMap? }`, `mode: 'inline' \| 'deferred'`                                                                                                                                                                      | `state`, `options?`, `productionAnswer`, `productionConfidence?`                                                   | `comparison`                                                                                                  | `done` only (default policy `timeoutMs: 5000`, `onError: 'ignore'`) |

Interface requirements the compiler checks for the specialised nodes: `verify` needs a static choice contract with outcomes ⊇ {`pass`, `repair`} (optional `collect_evidence`; escapes → `human`; its improve zone fires `collect_evidence` when present, else `human`); `relevance` needs a banded score contract and `keepBands` ⊆ its band ports; `tool_gate` needs a contract whose packet declares the `ToolProposal` fields (§9.3); `route` needs the same contract (key and interface) as the decision it routes.

### 9.2 Pattern A — before the model: task and model routing (§VII.A, §VII.G)

```jsonc
{ "id": "eligible_models", "kind": "task", "type": "flowaid.jev.menu", "typeVersion": "1.0.0", "name": "Live model menu",
  "config": { "contract": { "key": "assist.model_router" },
              "source": { "kind": "models", "filter": { "kind": "chat" } },            // ProviderAccess.models() — live catalog + health (RFC-0015)
              "keep": "m => m.health != 'down' && m.capabilities.tools",              // availability (code)
              "cost": { "by": "m => m.pricing.inputPerMTok", "respectBudget": true },  // budget (code)
              "eligibility": { "dataClassBy": "m => m.maxDataClass" },               // provider trust (code, §VII.G)
              "id": "m => m.provider + ':' + m.model", "description": "m => m.description" } },
{ "id": "pick_model", "kind": "task", "type": "flowaid.jev.decide", "typeVersion": "1.0.0", "name": "Route task",
  "config": { "contract": { "key": "assist.model_router" } },                          // escapes: review, none
  "inputs": { "state": { "kind": "object", "fields": { "request": { "kind": "ref", "ref": "start.message" },
                                                         "constraints": { "kind": "ref", "ref": "start.constraints" } } },
              "options": { "kind": "ref", "ref": "eligible_models.optionSet" } } },
{ "id": "answer", "kind": "task", "type": "flowaid.ai.generate", "typeVersion": "1.1.0", "name": "Answer",
  "config": { "model": { "kind": "object", "fields": { "provider": { "kind": "ref", "ref": "pick_model.selection.item.provider" },
                                                  "model": { "kind": "ref", "ref": "pick_model.selection.item.model" } } } } } // `model` becomes bindable (J-20)
// edges: pick_model.selected → answer ; pick_model.human → review ; pick_model.improve → clarify (ask the user a precise question)
```

Code decides which models may exist (availability, budget, data-class eligibility); Jev resolves semantic fit within that set; the menu is built in the same step, never from yesterday's catalog (_"Routing over a stale menu is an invalid graph"_).

### 9.3 Pattern B — before the tool: semantic risk, then policy (§VII.B, §VII.D)

```ts
export const ExternalSideEffectSchema = z.enum([
  "publish",
  "purchase",
  "delete",
  "permission_change",
  "external_message",
  "data_write",
  "money_movement",
  "represent_user",
]);
/** Normalized before judgment (§VII.D Tool Semantics); deterministic, from ToolDefinition + args + tool hints. */
export const ToolProposalSchema = z.object({
  tool: z.string(),
  source: z.enum(["mcp", "openapi", "workflow", "builtin", "http"]),
  capability: z.string().nullable(),
  operation: z.string().max(200), // intended operation, e.g. 'http.post', 'github.delete_branch'
  target: z.string().max(500), // resource acted on
  destination: z.string().max(500).nullable(), // host / channel / recipient data goes to
  dataClass: DataClassSchema, // highest class in the arguments (producer x-dataClass, redactor hits)
  reversibility: z.enum(["reversible", "compensatable", "irreversible"]), // from ToolDefinition.idempotency (none ⇒ irreversible) + hints
  externalSideEffects: z.array(ExternalSideEffectSchema),
  argsHash: z.string(),
  summary: z.string().max(2000), // deterministic rendering of the above for the packet
});
export const ToolPolicySchema = z.object({
  allowTools: z.array(z.string()).min(1), // tool-name / capability globs permitted at all
  denyDestinations: z.array(z.string()).default([]),
  maxDataClass: DataClassSchema.default("internal"),
  requireApprovalFor: z
    .array(ExternalSideEffectSchema)
    .default([
      "publish",
      "purchase",
      "delete",
      "permission_change",
      "money_movement",
      "represent_user",
    ]),
  irreversible: z.enum(["review", "deny"]).default("review"),
  maxCostUsd: z.number().positive().optional(),
});
```

`tool_gate` order: **normalize** (code) → **hard policy** (tool not allowed, destination denied, data class exceeded ⇒ `deny` without calling Jev) → **judge** (the risk contract over a packet built from the normalized proposal and `context`; e.g. `tool_risk@1`, a banded score _no external effect / reversible internal change / external or user-visible change / irreversible or sensitive_) → **route** (§6.4) → **verdict** = the most restrictive of the route and the policy (`requireApprovalFor` ∩ side effects ≠ ∅ ⇒ at least `review`; `reversibility = irreversible` ⇒ `policy.irreversible`; auto ⇒ `allow`; improve or human ⇒ `review`). `deny` can never become `allow`.

```jsonc
{ "id": "propose", "kind": "task", "type": "flowaid.ai.structured_generate", "config": { "schema": { "type": "object", "required": ["tool", "args"], "properties": { "tool": { "type": "string" }, "args": { "type": "object" } } } } },
{ "id": "gate", "kind": "task", "type": "flowaid.jev.tool_gate", "config": { "contract": { "key": "ops.tool_risk" },
    "policy": { "allowTools": ["github.*"], "denyDestinations": ["*.internal.example.com"], "maxDataClass": "internal" } },
  "inputs": { "proposal": { "kind": "ref", "ref": "propose.structured" } } },
{ "id": "run_tool", "kind": "task", "type": "flowaid.tools.mcp", "config": { "serverId": "$template.mcp.github", "tool": "create_issue" },
  "inputs": { "title": { "kind": "ref", "ref": "gate.args.title" }, "body": { "kind": "ref", "ref": "gate.args.body" } } },   // one binding per tool argument
{ "id": "approve", "kind": "human", "mode": { "type": "approval" }, "title": { "kind": "template", "source": "Approve: {{ gate.normalized.summary }}" },
  "context": { "receipt": { "kind": "ref", "ref": "gate.receipt" } } }
// edges: gate.allow → run_tool ; gate.review → approve ; approve.approved → run_tool ; gate.deny → out_blocked ; approve.rejected → out_blocked
```

In the agent node (P6-10 → J-20) the same functions run inside the tool loop when `config.tools[].approval = 'jev'`: every proposed call is normalized, judged and verdicted in-process, `review` suspends through the existing approval mechanism, and each proposal gets a receipt.

### 9.4 Pattern C — after the tool and after generation: builder and verifier (§VII.C–D, §X.K)

```jsonc
{ "id": "build", "kind": "loop", "name": "Draft until verified",
  "carrySchema": { "type": "object", "properties": { "feedback": { "type": "string" }, "evidence": { "type": "array" } } },
  "carry": { "initial": { "feedback": "", "evidence": [] },
             "next": { "feedback": { "kind": "expr", "source": "json(check.checks)" },
                       "evidence": { "kind": "expr", "source": "$scope.carry.evidence + coalesce(more.body.results, [])" } } },
  "result": { "report": { "kind": "ref", "ref": "draft.structured" }, "outcome": { "kind": "ref", "ref": "check.decision.value", "default": "repair" } },
  "exitWhen": "check.decision.value == 'pass' || check.receipt.route == 'human'",
  "bounds": { "maxIterations": 3, "maxCostUsd": 0.5 }, "onExhausted": "route" },
{ "id": "draft", "parent": "build", "kind": "task", "type": "flowaid.ai.structured_generate", "…": "report { body, citations[] } from $scope.carry.evidence and feedback" },
{ "id": "check", "parent": "build", "kind": "task", "type": "flowaid.jev.verify",
  "config": { "contract": { "key": "research.report_verifier" },
              "checks": [ { "name": "has_citations", "when": "len(draft.structured.citations) > 0", "onFail": "repair" },
                          { "name": "sections", "when": "contains(draft.structured.body, '## Findings')", "onFail": "repair" } ] },
  "inputs": { "artifact": { "kind": "ref", "ref": "draft.structured" }, "evidence": { "kind": "ref", "ref": { "kind": "scope", "field": "carry", "path": "/evidence" } } } },
{ "id": "more", "parent": "build", "kind": "task", "type": "flowaid.tools.http", "…": "search for the missing evidence" }
// edges (inside build): check.collect_evidence → more ; after build: branch on build.result.outcome → pass: out_report ; else → human review
```

Deterministic checks run first and route without a Jev call; the verifier inspects **new evidence** (artifact present, sections, citations, destination, unresolved approvals), never the tool's HTTP status (`W_JEV_TRANSPORT_VERIFICATION`). Every failed check routes to repair, evidence collection or escalation inside a bounded loop (§VII.D), and the blind-retry guard stops a repair round that did not change the artifact.

### 9.5 Pattern D — escalation (§V.A, §XI.C "The system can stop or escalate safely")

- **Wired**: the `human` port of `decide`/`route` connects to a `human` node (mode `choice` with the contract's outcomes, or `approval`); its `context` includes `receipt` and `packet` refs. The compiler links the human node to the receipt (`PlanNode.jev.reviewOf`) so the runtime records `DECISION_ACTION_RECORDED{human_review}` and, when the reviewer picks another outcome, `DECISION_OVERRIDDEN` plus an `override` label.
- **Inline** (`escalation: 'inline'`): the node suspends itself with `HumanRequest{ origin: 'decision_route', receiptId }` (RFC-0013) using the contract's `escalation` (assignees, mode, expiry, rubric); on resume it fires the reviewer's outcome port.
- A contract node whose `human` route is neither wired nor inline is `E_JEV_ESCALATION_UNWIRED`.

### 9.6 Pattern E — retrieval relevance (§VII.E, §VIII.E)

`search` (exact filters and access control in code: date, ACL, source type) → shortlist (embedding retriever top-k, or the search API's own ranking) → `flowaid.jev.relevance` (one packet per group with the question as `goal` and the candidates as `evidence`; one banded score question per candidate — _"same evidence may be evaluated together"_) → generation prompt renders the surviving `evidence` with ids → `flowaid.jev.verify` checks every material claim cites a surviving id. The relevance node's `counts` (`original`, `filtered`, `shortlisted`, `survived`) and per-candidate receipts explain why each item survived. Question formation is exact and reproducible: each candidate is one question keyed by its evidence id (≤ 64 characters, unique in the group) whose instructions are the contract's instructions followed by the fixed suffix `\n\nJudge only evidence item <id>; the other items are context.`, so reconstruction (§12.3) rebuilds it from the contract and the id; each receipt's `question` is that id and its `evidenceScope.evidenceIds` lists the whole group (what the question could inspect, §VI.C).

### 9.7 Pattern F — next-step / worker routing with stop (§VIII.A, §VIII.C, §VIII.G)

```
loop act (maxIterations 12, maxCostUsd …):
  observe   (tool: current page controls / worker registry with availability, capability, cost, latency, trust, load)
  menu      (flowaid.jev.menu: keep "c => c.visible && c.enabled" / "w => w.available && w.load < 0.9", shortlist topK 40)
  next      (flowaid.jev.decide: contract ui.next_control or ops.next_worker — escapes stop ('goal is complete or no safe action exists'), review)
  do        (tool on next.selection) — failures (control gone) route back into the loop as stale_option evidence
  exitWhen: next.receipt.outcome == 'stop' || next.receipt.route == 'human'
```

_"In browser and tool agents, a safe stop route is often more important than another recovery branch"_ (§VIII.G): `W_JEV_NO_STOP` fires when a dynamic action menu inside a loop has no `stop` escape.

### 9.8 Templates and demo upgrades (J-13)

New templates (`packages/nodes-core/templates/jev-*.json`, compiled in CI with fixture contracts from `@flowaid/jev/testing`):

| Template                    | Shows                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jev-first-contract-shadow` | The handbook's first integration (§IX.A, §XI suggested prompt): an existing `flowaid.ai.structured_generate` ticket classifier stays authoritative; `flowaid.jev.shadow` evaluates `support.ticket_router@1` beside it; nothing else changes. |
| `jev-decide-with-evidence`  | Three-zone routing with an improve loop (§6.5).                                                                                                                                                                                               |
| `jev-tool-gate`             | Pattern B.                                                                                                                                                                                                                                    |
| `jev-verified-builder`      | Pattern C.                                                                                                                                                                                                                                    |
| `jev-retrieval-relevance`   | Pattern E (the RAG variant uses P6-09 retriever nodes).                                                                                                                                                                                       |
| `jev-model-router`          | Pattern A (with J-20).                                                                                                                                                                                                                        |

Demo upgrades (ARCH §11 templates; the P5-03 acceptance workflow of ARCH §2.9 is unchanged and gets implicit-contract receipts):

- **Intelligent Support Triage**: `judgments` becomes `flowaid.jev.bundle` with `support.intent@1` (choice with a `review` escape instead of relying on `general: "Anything else"`), `support.urgency@1` (4 verbal levels), `support.escalate@1` (boolean); `esc_gate`/`route` become `flowaid.jev.route` nodes; `safety` becomes `support.reply_safety@1` (consequence `high`: an external message) routed by `flowaid.jev.route` — the template declares `high: { autoAt: 0.95, improveAt: 0.8 }` (flagged `W_JEV_THRESHOLDS_ILLUSTRATIVE`) and its `dev` deployment raises `guardrails.maxConsequence` to `high`, so replies auto-send in `dev` only; protected environments require shadow calibration and governance first (conflict C7).
- **GitHub Issue Triage**: `actionable` becomes a contract; duplicate detection becomes a dynamic menu over `similar.result.items` with a `none` escape (consequence `medium`: a public comment) instead of a boolean over the top candidate; `classify` becomes a bundle.
- **Research Agent**: `judge` becomes `flowaid.jev.relevance`; `completeness` becomes `flowaid.jev.verify` with `collect_evidence` feeding the loop's carry.

**Templates carry their contracts.** `templates.required_resources` gains `decisionContracts: { key: string; description: string; body: DecisionContractBody }[]` (§15), and `POST /v1/templates/:id/instantiate` provisions them, per key, before it rewrites the definition:

| Workspace state for the key                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| no contract with that key                                                       | head + version 1 from the template body. Built-in templates (`workspace_id` null): version 1 is `approved` by `system:template` (checklist pre-filled from lints) and deployed `active` with default guardrails and the rollback trigger `override_rate > 0.05` over 24 h in every **non-protected** environment; protected environments get no row, so nothing acts there before a person deploys it after shadow (§11.4). Workspace templates: version 1 is `in_review` (draft-level compiles accept it, §4.4 step 2). |
| a contract whose latest approved version has the template body's interface hash | reused; bindings stay `'deployed'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| a contract with another interface                                               | 409 `E_JEV_INTERFACE_MISMATCH` listing the keys, unless the request maps them: `contracts: Record<templateKey, workspaceKey>` rewrites the bindings to compatible existing contracts                                                                                                                                                                                                                                                                                                                                     |

`POST /v1/templates { fromVersionId, … }` captures the bodies the version's plan snapshots (`PlanNode.jev.contracts[q].body`) into `decisionContracts`.

---

## 10. Live option menus

### 10.1 Option set

```ts
export const OptionEntrySchema = z.object({
  key: OutcomeKeySchema, // model-facing key (ordinal o1…oN or slug); never the raw candidate id
  sourceId: z.string().max(512), // candidate id — returned to the graph in `selection.sourceId`
  label: z.string().max(200).optional(),
  description: z.string().min(1).max(2000), // distinguishing evidence conditions (§VIII.F)
  escape: EscapeKindSchema.optional(), // escapes come from the contract, never from candidates
  observedAt: z.iso.datetime().optional(),
  data: JsonValueSchema.optional(), // the candidate itself (for `selection.item`); persisted redacted
});
export const OptionSetSchema = z.object({
  version: HashSchema, // sha256Json(entries minus data/observedAt) — the option-set version (§VIII.H)
  entries: z.array(OptionEntrySchema).min(1).max(255),
  counts: z.object({
    original: z.int().min(0),
    kept: z.int().min(0),
    eligible: z.int().min(0),
    shortlisted: z.int().min(0),
    final: z.int().min(0),
  }),
  builtAt: z.iso.datetime(),
  builtAtSeq: z.int().min(0),
});
export type OptionSet = z.infer<typeof OptionSetSchema>;
```

### 10.2 Construction (`buildOptionSet`, used by `flowaid.jev.menu`)

1. `original` = all candidates (from the binding, or `ProviderAccess.models()` for `source: models`).
2. **Deterministic exclusion** (`keep` lambda; availability, enabled/visible, permissions) → `kept`.
3. **Eligibility** (code, §VII.G): drop candidates whose data class is below the packet's class (`eligibility.dataClassBy`) and, with `cost.respectBudget`, whose cost exceeds `ctx.budget.remainingCostUsd` → `eligible`.
4. **Shortlist** (`shortlist.by` score, `topK`) → `shortlisted`; cap at the contract's `maxOptions`.
5. **Keys**: `ordinal` (`o1…oN` in shortlist order) or `slug` (lower-case, `[a-z0-9_]`, ≤ 48 chars, `_2`, `_3` on collision; a slug that equals a reserved port or escape key is suffixed). Descriptions from the `description` lambda; empty or duplicate descriptions fail the node (the menu would be under-specified).
6. **Escapes** from the contract are appended **always** — including when nothing survived (`empty` fires; the decision can still choose `stop`/`review`) — _"The shortlist process must preserve an escape hatch"_ (§VIII.B). Total ≤ 255.
7. `version` computed; `OPTION_SET_BUILT` records `version`, `counts`, escape keys and a snapshot id (`decision_snapshots`, kind `option_set`), so a failure can be assigned to filtering, shortlisting or semantic choice.

### 10.3 Freshness, invalidation, caching (§IV.D, §VIII.H)

- Default: the menu is rebuilt in the same step as the decision (the `menu` node is the decision's data dependency), so the option set is never older than one step.
- `decide` rejects an option set older than the contract's `maxAgeMs` or built at a `seq` below the decision's inputs' own snapshot (reason `stale_option`, zone capped at `improve`: rebuild).
- Caching (`menu.cache`) is allowed only with event-driven invalidation (`invalidateOn` ≥ 1 event name delivered through `POST /v1/events/:eventName`); a cache entry is keyed by the rendered `cache.key` in `state_entries` and dropped when one of the events arrives. TTL-only caching is not accepted by the config schema (_"Time-based expiry alone is insufficient for permissions, budgets, and live controls"_).

### 10.4 Staleness hazards (Table VII) in flowaid

| Object                        | Invalidation                 | flowaid correction                                                                                                                                |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker (subflow, tool, model) | Unavailable or overloaded    | Menu from the live registry: `ProviderHealth`, tool catalog, subflow deployments, load; failover/re-route on execution failure                    |
| Browser control               | Hidden, disabled, removed    | Observe the page in the same loop iteration; `keep` filters visible and enabled; a failed action returns to the loop with `stale_option` evidence |
| Source                        | Content or timestamp changed | Evidence items carry `version`/`observedAt`; `freshness.maxAgeMs` marks them stale ⇒ improve (re-fetch and version)                               |
| Budget                        | Spend increased              | `cost.respectBudget` reads `ctx.budget` at build time; run bounds still apply (ARCH §5.3)                                                         |
| Permission                    | Scope revoked                | Deterministic policy at execution (`ctx.tools.call` capability check, tool gate) — never the model                                                |
| File                          | Moved or replaced            | Artifact items carry `hash`; `consistency: 'strict'` re-checks after evaluation                                                                   |

### 10.5 Menu-builder tests (§VIII.D Option-Set Tests)

`buildOptionSet` is tested separately from the choice, with fixtures for unavailable workers, disabled controls, expired sources, exhausted budgets and revoked permissions; the expected result may be a smaller menu or only the escapes. The contract test runner's `stale_options` category (§14.5) replays such option sets through the whole contract, so _"menu-construction defects"_ are never _"blamed on Jev"_.

---

## 11. Shadow mode and staged rollout

### 11.1 Two ways to shadow

1. **Beside an existing path** — `flowaid.jev.shadow` next to the production decision (an LLM classifier, a rule, a `branch`, a human step). The production path stays authoritative; the shadow node builds the packet, evaluates the contract, computes the route it _would_ take and compares it with `productionAnswer` (mapped through `answerMap`). Guarantees: the node's only control-out is `done`; its outputs may feed only `output` values, `flowaid.dev.metric`/`log` nodes (`E_JEV_SHADOW_LEAK` otherwise); receipts have `mode: 'shadow'`, `disposition: 'shadow'`, `authorizedAction: { kind: 'none', reason: 'shadow' }`; default policy `onError: 'ignore'`, `timeoutMs: 5000`, so it can neither fail nor block the run. `mode: 'deferred'` records only the packet and the production answer during the run (no provider call) and enqueues `jev.shadow_eval` (RFC-0016) after it; the comparison lands in `shadow_comparisons` without run events (nothing follows a terminal event), for latency-critical paths.
2. **A candidate version beside the active one** — a contract deployment with `candidate.stage = 'shadow'` (§11.3): every decision that runs the active version also evaluates the candidate on the same snapshot (second receipt, `mode: 'shadow'`). This is the live counterpart of counterfactual replay (§12.4).

### 11.2 Shadow record (§IX.D)

```ts
export const ShadowComparisonSchema = z.object({
  id: z.uuid(),
  receiptId: z.uuid(), // the shadow receipt
  contract: ContractRefSchema, // decision_contract: 'ticket-router@3'
  runId: z.uuid(),
  nodeRunId: z.uuid(),
  question: z.string(),
  stateHash: HashSchema, // packetHash
  jevModel: z.string(), // resolved model, e.g. 'jev-1.13.0' (requested alias on the receipt)
  shadow: z.object({
    outcome: z.string(),
    confidence: z.number(),
    distribution: z.record(z.string(), z.number()),
    wouldRoute: JevRouteSchema,
  }),
  production: z.object({
    source: z.enum(["llm", "rule", "code", "human", "jev"]),
    nodeId: NodeIdSchema,
    nodeRunId: z.uuid().nullable(),
    answer: z.string().nullable(), // mapped into the contract's outcome space
    confidence: z.number().nullable(),
  }),
  agree: z.boolean().nullable(), // null when the production answer is not mappable
  humanLabel: z.string().nullable(), // joined from decision_labels when available
  actionTaken: z.literal(false),
  deferred: z.boolean(),
  at: z.iso.datetime(),
});
```

`summarizeShadow` reports, per contract version and window: agreement rate, a production × shadow confusion matrix (`ConfusionMatrix`), accuracy of each side against human labels where labeled, shadow calibration (§7), and the disagreement list (oversampled for labeling, stratum `shadow_disagreement`). Agreement is **not** accuracy: the production path can be wrong.

### 11.3 Contract deployments per environment

```ts
export const RolloutGuardrailsSchema = z.object({
  trafficShare: z.number().min(0).max(1).default(0), // share of eligible decisions the canary may automate
  tenants: z.array(z.string()).optional(), // run label `tenant` allow-list
  languages: z.array(z.string()).optional(), // run label `language` / packet fact `language`
  maxConsequence: ConsequenceClassSchema.default("low"), // canary ceiling (§IX.I)
  outcomes: z.array(z.string()).optional(), // automate ONE outcome first (§IX.F)
  reviewSampleRate: z.number().min(0).max(1).default(0.05), // automated cases sampled for review
  sampleSalt: z.string().default(""),
});
export const ContractDeploymentSchema = z.object({
  contractKey: ContractKeySchema,
  environmentId: z.uuid(),
  active: z
    .object({ version: z.int().min(1), stage: z.enum(["shadow", "active", "paused"]) })
    .nullable(),
  candidate: z.object({ version: z.int().min(1), stage: z.enum(["shadow", "canary"]) }).nullable(),
  guardrails: RolloutGuardrailsSchema,
  rollbackTriggers: z.array(RollbackTriggerSchema), // ≥ 1 before any version may act (canary or active)
  previousActiveVersion: z.int().min(1).nullable(), // immediate rollback target
  pausedReason: z.string().nullable(),
  updatedBy: z.string(),
  updatedAt: z.iso.datetime(),
});
```

Semantics (disposition per decision in §6.7):

| Deployment state                     | What decisions do                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| no active, candidate `shadow`        | First integration: candidate evaluated for receipts only; the graph's `legacy` port (or `human`) carries the traffic |
| no active, candidate `canary`        | Sampled, eligible decisions automated by the candidate; the rest → `legacy`/`human` (holdback)                       |
| active `active`                      | Active version routes normally within `guardrails.maxConsequence`/`outcomes` when those are set                      |
| active `active` + candidate `shadow` | Active acts; candidate evaluated alongside (live counterfactual)                                                     |
| active `active` + candidate `canary` | Sampled, eligible decisions use the candidate; the rest the active version                                           |
| active `paused` or `shadow`          | No Jev authority: `legacy`/`human` for everything; receipts still written                                            |

Transitions are API calls (§16) and audit events (`decision_contract.deploy | promote | rollback | pause`): **promote** makes the candidate active (the old active becomes `previousActiveVersion`, a `shadow_baseline` snapshot is frozen); **rollback** restores `previousActiveVersion` in one step; **pause** sets the active stage `paused`. The `jev.rollout_check` job (every 5 min) evaluates `rollbackTriggers` on the latest snapshots and applies their `action` (`pause_candidate`, `rollback_active`, `pause_active`, `alert_only`), emitting `jev.rollback_triggered`. Triggers must exist **before** a version can act — _"define a rollback trigger before launch"_ (§IX.I).

### 11.4 Promotion rules and the completion criterion

| Step                   | Requirement (protected environments; non-protected ones warn instead)                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| draft → approved       | lints clean, fixtures cover the required categories, contract test passed, replay report when history exists, reviewer ≠ author (§4.6)                                                                                                                                                                   |
| → candidate `shadow`   | approved version; interface compatible with deployed workflows                                                                                                                                                                                                                                           |
| shadow → `canary`      | rolling shadow snapshots (mode `shadow`) for each outcome in `guardrails.outcomes` with ≥ 200 labeled shadow decisions and segment ECE ≤ 0.05 (flowaid defaults), frozen as the `shadow_baseline` by this promotion; governed thresholds; ≥ 1 rollback trigger; `trafficShare ≤ 0.05` for the first step |
| canary share increases | no open critical alarm; canary snapshot not worse than the baseline beyond the trigger thresholds; steps 0.05 → 0.25 → 1.0 (defaults)                                                                                                                                                                    |
| candidate → `active`   | canary at 1.0 for ≥ 7 days (default) and a rollout report (below) with verdict `pass`                                                                                                                                                                                                                    |
| next boundary          | one boundary at a time in the order internal routing → retrieval filtering → completion verification → model selection → low-risk tool gating (§IX.G); the critic flags a plan that automates a later boundary first                                                                                     |

**Rollout report** (`GET /v1/decision-contracts/:id/deployments/:environmentId/rollout-report`): end-to-end task outcomes before (shadow baseline window) and after (canary/active window) — completed-task rate, cost and latency per completed task, human review rate, recovery cost (§14.5) — with verdict `pass` only when the expected gain appears _"without an offsetting increase in recovery work"_ (§IX.I). Classifier agreement alone never completes a rollout.

---

## 12. Decision receipts

_"Every production decision should produce a receipt… It is the minimum unit for auditing, calibration, incident review, and comparison between contract versions"_ (§III.D The Decision Receipt).

### 12.1 Wire types (CONTRACTS.ts §7.1 via RFC-0013; `workflow-core/src/jev.ts`)

These are the only Jev types that enter `CONTRACTS.ts`, because run events, node outputs and plans must carry them; everything else lives in `@flowaid/jev`. They are placed right after `DecisionResultJsonSchema` (before §8) so the §11 event union can reference them.

```ts
export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const ContractKeySchema = z
  .string()
  .max(96)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,4}$/);
export const ConsequenceClassSchema = z.enum(["low", "medium", "high", "irreversible"]);
export const JevRouteSchema = z.enum(["auto", "improve", "human"]);
export const RolloutDispositionSchema = z.enum(["active", "canary", "holdback", "shadow"]);
export const DecisionModeSchema = z.enum(["live", "shadow", "replay", "evaluation"]);
export const PolicyVerdictSchema = z.enum(["allow", "review", "deny"]);
export const RouteReasonSchema = z.enum([
  "zone_auto",
  "zone_improve",
  "zone_human",
  "margin_below_min",
  "thresholds_illustrative",
  "consequence_irreversible",
  "outcome_not_automatable",
  "escape_outcome",
  "stop_outcome",
  "provider_uncalibrated",
  "model_version_changed",
  "improve_budget_exhausted",
  "blind_retry_blocked",
  "packet_over_budget",
  "stale_evidence",
  "stale_option",
  "state_race",
  "fallback_outcome",
  "rollout_shadow",
  "rollout_holdback",
  "rollout_scope",
  "policy_review",
  "policy_deny",
  "legacy_gate",
]);
export type ConsequenceClass = z.infer<typeof ConsequenceClassSchema>;
export type JevRoute = z.infer<typeof JevRouteSchema>;
export type RouteReason = z.infer<typeof RouteReasonSchema>;

/** Identifies the semantic program (Table III contract_version). */
export const ContractRefSchema = z.object({
  key: ContractKeySchema,
  version: z.int().min(1),
  hash: HashSchema,
  origin: z.enum(["registry", "implicit"]),
});
export type ContractRef = z.infer<typeof ContractRefSchema>;

/** Links to the evaluated evidence snapshot (Table III state_reference). */
export const StateReferenceSchema = z.object({
  stateVersion: z.string().max(200), // "<runId>:<scope>@<seq>"
  packetHash: HashSchema, // sha256 of the packet as sent
  snapshotId: z.string().nullable(), // decision_snapshots key; null when not persisted
  fidelity: z.enum(["exact", "redacted", "not_persisted"]),
});
/** Explains the operating zone (Table III selected_threshold). */
export const ThresholdAppliedSchema = z.object({
  consequenceClass: ConsequenceClassSchema,
  autoAt: z.number().min(0).max(1).nullable(),
  improveAt: z.number().min(0).max(1).nullable(),
  minMargin: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(), // routing confidence used (§6.2); null without an evaluation
  margin: z.number().min(0).max(1).nullable(),
  illustrative: z.boolean(),
  source: z.string().max(300), // "support.router@4#/routing/thresholds/low" | "legacy:<gateNodeId>"
});
/** Identifies the option-set version (§VIII.H). */
export const OptionSetRefSchema = z.object({
  version: HashSchema,
  source: z.enum(["static", "dynamic"]),
  size: z.int().min(1).max(255),
  escapeKeys: z.array(z.string()),
  counts: z
    .object({
      original: z.int().min(0),
      kept: z.int().min(0),
      eligible: z.int().min(0),
      shortlisted: z.int().min(0),
      final: z.int().min(0),
    })
    .nullable(),
  ageMs: z.int().min(0).nullable(),
});
/** Connects judgment to execution (Table III resulting_action): what the policy permitted and the runtime fired. */
export const AuthorizedActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fire_port"), port: PortNameSchema }),
  z.object({ kind: z.literal("tool_call"), tool: z.string(), proposalHash: HashSchema }),
  z.object({
    kind: z.literal("human_review"),
    port: PortNameSchema.nullable(),
    inline: z.boolean(),
  }),
  z.object({ kind: z.literal("improve"), port: PortNameSchema }),
  z.object({ kind: z.literal("legacy"), port: PortNameSchema }),
  z.object({ kind: z.literal("none"), reason: z.enum(["shadow", "denied", "external_routing"]) }),
]);
export const PolicyRecordSchema = z.object({
  id: z.string().max(200), // 'jev.default@1' | 'tool_gate:<nodeId>' | 'legacy_gate'
  verdict: PolicyVerdictSchema,
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().nullable() })),
  proofId: HashSchema.nullable(), // compile-time authority proof (§6.6)
});
/** One authority policy applied to the distribution (§III.E: one judgment, several policies). */
export const RoutingRecordSchema = z.object({
  routedBy: z.object({ nodeId: NodeIdSchema, nodeRunId: z.uuid() }),
  consequenceClass: ConsequenceClassSchema, // Table III consequence_class
  threshold: ThresholdAppliedSchema,
  route: JevRouteSchema, // Table III route
  reasons: z.array(RouteReasonSchema),
  disposition: RolloutDispositionSchema,
  policy: PolicyRecordSchema,
  authorizedAction: AuthorizedActionSchema,
  at: z.iso.datetime(),
});
export const ExecutedActionSchema = z.object({
  kind: z.enum(["node", "tool_call", "human_task"]),
  nodeId: NodeIdSchema.nullable(),
  nodeRunId: z.uuid().nullable(),
  toolCallId: z.string().nullable(),
  humanTaskId: z.uuid().nullable(),
  status: z.enum(["completed", "failed", "skipped", "cancelled"]),
  failure: z.enum(["stale_option", "error"]).nullable(),
  at: z.iso.datetime(),
});
export const DecisionOverrideSchema = z.object({
  by: z.string(),
  at: z.iso.datetime(),
  from: z.string().nullable(),
  to: z.string(),
  route: JevRouteSchema.nullable(),
  reason: z.string().max(4000).nullable(),
  source: z.enum(["human_task", "api"]),
});
export const DecisionReceiptSchema = z.object({
  receiptId: z.uuid(),
  runId: z.uuid(),
  nodeRunId: z.uuid(),
  nodeId: NodeIdSchema,
  scope: ScopePathSchema,
  question: z.string().min(1).max(64), // node id for single decisions, the author's key in bundles
  bundleId: z.string().max(200),
  batchId: z.string().max(200).nullable(), // provider request; null when no request was made
  mode: DecisionModeSchema,
  contract: ContractRefSchema,
  kind: z.enum(["boolean", "choice", "score"]),
  stateReference: StateReferenceSchema,
  evidenceScope: z.object({ fields: z.array(z.string()), evidenceIds: z.array(z.string()) }), // §VI.C
  optionSet: OptionSetRefSchema.nullable(), // choice only
  rubric: z.array(z.string()).nullable(), // score level texts as evaluated (§II.G)
  outcome: z.string().nullable(),
  escape: z.enum(["none", "other", "stop", "review", "escalate"]).nullable(),
  distribution: z.record(z.string(), z.number().min(0).max(1)), // Table III full_distribution; {} only for a fallback or an unevaluated holdback (§6.7)
  bandMass: z.record(z.string(), z.number().min(0).max(1)).nullable(),
  value: JsonPrimitiveSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  model: z.object({ provider: z.string(), requested: z.string(), resolved: z.string().nullable() }),
  requestId: z.string().nullable(),
  latencyMs: z.int().min(0),
  costUsd: z.number().min(0),
  attempts: z.array(ProviderAttemptSchema),
  reused: z.boolean(), // blind-retry guard reused an earlier distribution
  staleness: z.object({
    optionSetAgeMs: z.int().min(0).nullable(),
    staleEvidence: z.array(z.string()),
    raceRecorded: z.boolean(),
  }),
  routings: z.array(RoutingRecordSchema), // [] until routed
  at: z.iso.datetime(),
});
export type DecisionReceipt = z.infer<typeof DecisionReceiptSchema>;
/** Compact output port `receipt` of contract nodes. */
export const ReceiptRefSchema = z.object({
  receiptId: z.uuid(),
  contract: ContractRefSchema,
  outcome: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  route: JevRouteSchema.nullable(),
  disposition: RolloutDispositionSchema.nullable(),
  consequenceClass: ConsequenceClassSchema.nullable(),
  stateVersion: z.string(),
});
/** Run-start resolution of one contract key in the run's environment (RUN_CREATED.contracts). */
export const ResolvedContractSchema = z.object({
  key: ContractKeySchema,
  via: z.enum(["deployed", "pinned", "undeployed", "local"]), // §4.4 step 4; implicit contracts are never resolved here (§4.4 step 5)
  environmentId: z.uuid().nullable(),
  /** `calibrated`: computed per version and environment at run start (§6.4). */
  active: z
    .object({
      version: z.int().min(1),
      hash: HashSchema,
      interfaceHash: HashSchema,
      stage: z.enum(["shadow", "active", "paused"]),
      calibrated: z.boolean(),
    })
    .nullable(),
  candidate: z
    .object({
      version: z.int().min(1),
      hash: HashSchema,
      interfaceHash: HashSchema,
      stage: z.enum(["shadow", "canary"]),
      calibrated: z.boolean(),
    })
    .nullable(),
  guardrails: JsonObjectSchema, // RolloutGuardrails, validated by @flowaid/jev
  guardrailsHash: HashSchema,
});
```

Coverage of the handbook's receipt requirements:

| Requirement                                  | Receipt path                                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract_version` (Table III)               | `contract` (`key@version`, `hash`)                                                                                                                                     |
| `state_reference`                            | `stateReference` (`stateVersion`, `packetHash`, snapshot, fidelity)                                                                                                    |
| `full_distribution`                          | `distribution` (+ `bandMass`) — never winner-only (§X.F)                                                                                                               |
| `selected_threshold`                         | `routings[].threshold`                                                                                                                                                 |
| `consequence_class`                          | `routings[].consequenceClass`                                                                                                                                          |
| `route` (auto, improve, human)               | `routings[].route` + `reasons`                                                                                                                                         |
| `resulting_action`                           | `routings[].authorizedAction` + `DECISION_ACTION_RECORDED` → `executedAction`                                                                                          |
| Original rubric level descriptions (§II.G)   | `rubric`                                                                                                                                                               |
| Evidence each question could inspect (§VI.C) | `evidenceScope`                                                                                                                                                        |
| Option-set version (§VIII.H)                 | `optionSet.version`                                                                                                                                                    |
| Each boundary of the safe order (§X.N)       | judgment (distribution) · policy (`routings[].policy`) · execution (`executedAction`) · trace (events)                                                                 |
| Model version (§III.B)                       | `model.requested` + `model.resolved`                                                                                                                                   |
| Shadow record fields (§IX.D)                 | `mode`, `contract`, `stateReference.packetHash`, `model.resolved`, `outcome`, `confidence`, `shadow_comparisons.production*`, labels, `authorizedAction.kind = 'none'` |
| Overrides                                    | `DECISION_OVERRIDDEN` → `overrides[]` + `override` labels                                                                                                              |

### 12.2 Lifecycle: events, projections, immutability

1. The contract node builds the packet and option set → `DECISION_PACKET_BUILT`, `OPTION_SET_BUILT`.
2. The provider call → `DECISION_REQUESTED` (with `bundleId`, `stateVersion`, `packetHash`, `contracts`, `mode`) and `DECISION_COMPLETED` (with `receiptId`).
3. The node routes (inline) or not (external) → `DECISION_RECEIPT` with `routings` of length 1 or 0. External routers and legacy gates append `DECISION_ROUTED`.
4. The runtime observes execution of the authorised action: when the first node activated by the fired port finishes (or the human task opens, or the tool call returns) it appends `DECISION_ACTION_RECORDED`; when a reviewer of a `human`-routed receipt picks a different outcome it appends `DECISION_OVERRIDDEN`.
5. Shadow evaluations append `SHADOW_COMPARED`.

Nodes emit steps 1 and 3 as **facts** through `ctx.events.emit` (RFC-0015 extends `NodeEmittable`); the runtime validates each fact (the receipt's distribution equals the node run's `DECISION_COMPLETED` decision; a routed port is one of the router's control ports and is the port it fires; the contract ref is in `PlanNode.jev.contracts` or `RUN_CREATED.contracts`) and appends them in the same transaction as `NODE_COMPLETED`. Invalid facts fail the node with `NODE_EXECUTION_ERROR` (never silently dropped).

**Legacy decision nodes** emit no facts: after their `DECISION_COMPLETED` events the runtime appends, in the same transaction as `NODE_COMPLETED`, a `DECISION_PACKET_BUILT` whose snapshot is the **verbatim** `state` as sent (snapshot kind `state`; `packetHash = sha256Hex(stableStringify(state))`) and one `DECISION_RECEIPT` per question against the implicit contract (§4.4 step 5). For every decision node `DECISION_REQUESTED.stateHash` equals the `packetHash` of what was sent. **Modes**: run receipts are `live`, `shadow` (§6.7, §11) or `evaluation` (runs with `origin: 'evaluation'`); `replay` marks the provider calls of counterfactual replay (`jev.replay`, §12.4), which produce a report and no receipts.

Projections (J-10, `DATABASE.md` addendum §15): `DECISION_RECEIPT` inserts `decision_receipts`; `DECISION_ROUTED` appends to `routings` and fills the first-routing columns once; `DECISION_ACTION_RECORDED` sets `executed_action` once; `DECISION_OVERRIDDEN` appends `overrides` and inserts an `override` label; `SHADOW_COMPARED` inserts `shadow_comparisons`; `DECISION_PACKET_BUILT`/`OPTION_SET_BUILT` insert `decision_snapshots` if absent, from the body the event carries (so snapshots, like every projection, can be rebuilt from `run_events`, ARCH D1). A trigger (`decision_receipts_write_once`) rejects updates to judgment columns, second writes of write-once columns and deletes outside the retention role. Recorded replays do not mint new receipts for reused nodes; the trace links to the source receipt through `reusedFromNodeRunId`.

### 12.3 Trace reconstruction (§VI.H)

```ts
export const ReconstructionStepSchema = z.enum([
  "load_snapshot",
  "recover_contract",
  "reproduce_options",
  "inspect_distribution",
  "apply_thresholds",
  "compare_action",
]);
export const ReconstructionSchema = z.object({
  receiptId: z.uuid(),
  steps: z.record(ReconstructionStepSchema, z.object({ ok: z.boolean(), detail: z.string() })),
  observable: z.enum(["full", "partial"]),
});
```

`reconstruct(receipt, loaders)`: (1) the snapshot exists and its hash matches (`not_persisted` ⇒ partial); (2) the contract version loads and its hash matches; (3) static options come from the contract, dynamic ones from the option-set snapshot with the recorded version; (4) the distribution is present and sums to 1 ± 0.01 (or the receipt is an explicit fallback); (5) re-running `route()` on the recorded inputs reproduces each routing's route and reasons (the engine is deterministic); (6) each authorised port is the port the router fired and an executed action (or an explicit `none`) is recorded. Any failed step makes the decision **partially observable**, which TraceReviewer reports as an operational defect _"even when no user-visible error occurred"_.

### 12.4 Counterfactual replay (§III.G)

`POST /v1/decision-contracts/:id/versions/:v/replay` enqueues `jev.replay` (RFC-0016). The planner selects receipts (window, environment, source version, labeled only, limit default 2 000, cost estimate returned first), loads their snapshots (`exact` or `redacted`; `not_persisted` receipts are skipped and counted), rebuilds questions from version _v_ (stored option sets for dynamic menus; escapes appended), calls the provider with `mode: 'replay'` — **no run, no node, no side effect** — routes with _v_'s routing policy and compares with what happened. The report (a JSON artifact attached to the job) contains counts, outcome flips, route flips, accuracy and calibration before/after on labeled receipts, per-outcome breakdowns, flips at the automation boundary, examples (receipt ids) and an `approximate` flag when redacted snapshots were used. Review of a new version cites the replay (§4.6).

### 12.5 Viewing receipts

API: `GET /v1/decision-receipts` (filters), `GET /v1/decision-receipts/:id` (receipt, redacted packet, option set, labels, overrides, executed action, reconstruction), `GET /v1/runs/:id/decisions` (the run's receipts grouped by bundle and `stateVersion`). UI (§17): the **Receipt** tab of `NodeRunDetail`, the run's **Decisions** tab, the receipt page, and receipt lists per contract.

---

## 13. Failure-mode catalog → diagnostics, runtime checks, TraceReviewer

### 13.1 The catalog (`@flowaid/jev/src/catalog/failureModes.ts`, as data)

Rows 1–12 are §X.A–§X.L; rows 13–31 are the warnings of other sections (study guide §11.1). "Static" = compiler/critic diagnostics (§13.2); "Runtime" = route reasons or receipt checks; "Review" = TraceReviewer signals (§13.3); "Inspect first" follows Table IX.

| #   | Failure mode                                                         | Static                                                                              | Runtime                                                         | Review signal                   | Inspect first                    | Correction                                                                        |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Conclusions stored as evidence (§X.A)                                | `W_JEV_CONCLUSION_AS_EVIDENCE`, `I_JEV_INHERITED_JUDGMENT`                          | —                                                               | `override_on_auto`              | evidence                         | Observable evidence: source count and type, verified/unresolved claims, freshness |
| 2   | No escape hatch (§X.B)                                               | `W_JEV_NO_ESCAPE_HATCH`, `E_JEV_DYNAMIC_MENU_NO_ESCAPE`                             | escape rate 0 with overrides                                    | `override_on_auto`              | menu completeness                | Add none/other/stop/review                                                        |
| 3   | One threshold for every consequence (§X.C)                           | `W_JEV_SINGLE_THRESHOLD`, `W_JEV_THRESHOLDS_ILLUSTRATIVE`                           | `consequence_irreversible`                                      | `unsafe_action`                 | authority boundary, policy order | Per-class thresholds; irreversible review-gated                                   |
| 4   | Stale options (§X.D)                                                 | `W_JEV_EVIDENCE_UNVERSIONED`                                                        | `stale_option`, `stale_evidence`, action failure `stale_option` | `stale_choice`                  | state freshness                  | Rebuild from live state; version every decision                                   |
| 5   | Blind retries (§X.E)                                                 | `E_JEV_BLIND_RETRY`, `W_JEV_IMPROVE_UNWIRED`                                        | `blind_retry_blocked`, `improve_budget_exhausted`               | `repeated_loop`                 | stop option, retry evidence      | Each retry adds evidence, changes the contract, narrows the menu or escalates     |
| 6   | Winner-only logging (§X.F)                                           | by construction (receipts)                                                          | reconstruction step 4 fails                                     | `partially_observable_decision` | —                                | Complete receipt                                                                  |
| 7   | Policy inside the classifier (§X.G)                                  | `W_JEV_POLICY_IN_CLASSIFIER`, `E_JEV_AUTHORITY_EXCEEDED`, `E_JEV_IRREVERSIBLE_AUTO` | policy record                                                   | `unsafe_action`                 | authority boundary, policy order | Permissions, budgets, scopes, side effects in deterministic policy                |
| 8   | Exact rules delegated to Jev (§X.H)                                  | `W_JEV_EXACT_RULE`                                                                  | —                                                               | —                               | criteria                         | Code (`branch`, FlowExpr)                                                         |
| 9   | Unknown values hidden inside a label (§X.I Unknown Values)           | `W_JEV_FREE_VALUE`                                                                  | —                                                               | —                               | criteria                         | Extraction/generation, then Jev over the known set                                |
| 10  | Multi-step plan in one answer (§X.J)                                 | `W_JEV_OPTIONS_UNDISTINGUISHED` (multi-step descriptions)                           | —                                                               | —                               | contract wording                 | Tool creates evidence → new snapshot → next contract                              |
| 11  | Verifier checks transport success (§X.K)                             | `W_JEV_TRANSPORT_VERIFICATION`                                                      | —                                                               | —                               | artifact checks                  | `flowaid.jev.verify` over new evidence                                            |
| 12  | Contract change without evaluation (§X.L)                            | `W_JEV_CONTRACT_UNREVIEWED`; review gate (§4.6)                                     | —                                                               | —                               | —                                | Version, replay history, shadow, rollback                                         |
| 13  | Transcript as state (§IV.A)                                          | `W_JEV_TRANSCRIPT_STATE`                                                            | `packet_over_budget`                                            | —                               | evidence                         | Compact packet                                                                    |
| 14  | Over-privileged state (§IV.C)                                        | `W_JEV_PACKET_UNDECLARED_FIELD`, `E_JEV_PACKET_DATA_CLASS`                          | `secret_value` failure                                          | —                               | —                                | Declared fields, eligibility                                                      |
| 15  | Early flattening (§V.A)                                              | `W_JEV_CONFIDENCE_UNUSED`                                                           | —                                                               | —                               | —                                | Route on the distribution                                                         |
| 16  | Decorative confidence (§V.B)                                         | `W_JEV_IMPROVE_UNWIRED`                                                             | `improve_budget_exhausted`                                      | —                               | —                                | Name the state-improving action                                                   |
| 17  | Demo-set thresholds become policy (§V.C)                             | `W_JEV_THRESHOLDS_ILLUSTRATIVE`; protected deploy refused                           | `thresholds_illustrative`                                       | —                               | calibration                      | Governance record                                                                 |
| 18  | Global-average calibration (§V.D)                                    | —                                                                                   | segmentation by construction                                    | —                               | calibration                      | Segment by version, class, language, option                                       |
| 19  | Stale calibration (§V.F)                                             | —                                                                                   | `model_version_changed`; new segments per version               | drift alarm                     | calibration                      | Re-estimate after changes                                                         |
| 20  | Dependent batching, mixed versions, evaluation after a write (§VI.G) | structural (no dependency paths in bundles)                                         | `state_race`                                                    | `partially_observable_decision` | state freshness                  | Snapshot discipline                                                               |
| 21  | Mixed latency/privacy class batch (§VI.D)                            | `E_JEV_BUNDLE_CLASS_MIX`                                                            | —                                                               | —                               | —                                | Batch within one class                                                            |
| 22  | Unlocked execution after parallel decisions (§VI.F)                  | `W_JEV_PARALLEL_SIDE_EFFECTS`                                                       | —                                                               | —                               | execution                        | Serialize in the graph                                                            |
| 23  | Risk judged from command names (§VII.D)                              | `W_JEV_UNGATED_TOOL`                                                                | tool-gate normalization                                         | —                               | —                                | Normalized proposal                                                               |
| 24  | Jev at every edge / exact restatement / open-ended content (§VII.F)  | `W_JEV_PLACEMENT`, `W_JEV_EXACT_RULE`, `W_JEV_GENERATION_FOR_DECISION` (inverse)    | route entropy ≈ 0 over 30 d                                     | `costs_rising`                  | wrong routes, recovery work      | Placement discipline                                                              |
| 25  | Faulty menu builder blamed on Jev (§VIII.D)                          | menu tests (§10.5)                                                                  | `OPTION_SET_BUILT.counts`, `empty` port                         | —                               | menu construction                | Test the builder separately                                                       |
| 26  | TTL-only cache (§VIII.H)                                             | `E_CONFIG_INVALID` (menu `cache` without `invalidateOn`)                            | —                                                               | —                               | —                                | Event-driven invalidation                                                         |
| 27  | Praise-style descriptions (§VIII.F)                                  | `W_JEV_OPTIONS_UNDISTINGUISHED`                                                     | —                                                               | `label_disagreement` alarm      | contract wording                 | Evidence conditions; review/none on overlap                                       |
| 28  | No stop outcome (§VIII.G)                                            | `W_JEV_NO_STOP`                                                                     | —                                                               | `repeated_loop`                 | stop option                      | Declared stop                                                                     |
| 29  | Primitive mismatch (§II.G)                                           | `W_JEV_PRIMITIVE_MISMATCH`                                                          | —                                                               | —                               | criteria                         | Pick by answer shape; decompose                                                   |
| 30  | Fake Score precision (§II.B)                                         | `W_JEV_SCORE_AS_MEASURE`                                                            | —                                                               | —                               | —                                | Ordinal bands                                                                     |
| 31  | Guardrails depending on confidence (§IX.I)                           | impossible by schema (`RolloutGuardrailsSchema` has no confidence input)            | —                                                               | —                               | —                                | Deterministic guardrails                                                          |

Related flowaid-specific entries: generation used for a decision (§I.A) → `W_JEV_GENERATION_FOR_DECISION`; uncalibrated auto (conflict C3) → `W_JEV_UNCALIBRATED_AUTO`; consensus reassurance (C6) → `W_JEV_CONSENSUS_REASSURANCE`; shadow isolation → `E_JEV_SHADOW_LEAK`; escalation → `E_JEV_ESCALATION_UNWIRED`.

### 13.2 Diagnostic codes (RFC-0014, 45 additions to `DiagnosticCodeSchema`)

Contract diagnostics raised while compiling a workflow point at the node (`location.nodeId`, `path` to its `contract` config) and name the contract in `related`; the same functions run on `POST /v1/decision-contracts/:id/versions/:v/lint`, where `location.path` points into the contract body and `fix.patch` patches the contract draft. Heuristic lints (marked ◊) are warnings only and can be suppressed per contract (`lintSuppressions`, with a reason).

| Code                              | Fires when                                                                                                                                              | Quick fix                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `E_JEV_CONTRACT_UNRESOLVED`       | unknown key/version; at publish level also a referenced version that is not `approved` (§4.4 step 2)                                                    | open the contract picker                                  |
| `E_JEV_CONTRACT_INVALID`          | resolved body fails the schema or §4.2 semantic validation                                                                                              | open the contract                                         |
| `E_JEV_INTERFACE_MISMATCH`        | node wiring or bindings disagree with the contract interface; deployed interface differs                                                                | re-sync ports from the contract                           |
| `E_JEV_ESCALATION_UNWIRED`        | the `human` route is neither wired nor inline                                                                                                           | add a human node on `human` / set inline                  |
| `W_JEV_IMPLICIT_CONTRACT`         | legacy decision node without a registry contract (publish level)                                                                                        | _Extract to decision contract_                            |
| `W_JEV_CONTRACT_UNREVIEWED`       | referenced version not `approved`                                                                                                                       | open review                                               |
| `W_JEV_NO_ESCAPE_HATCH`           | static choice without an escape outcome                                                                                                                 | add `none`                                                |
| `E_JEV_DYNAMIC_MENU_NO_ESCAPE`    | dynamic menu without escapes                                                                                                                            | add `stop` and `review`                                   |
| `E_JEV_MENU_LIMIT`                | outcomes incl. escapes outside 2–255; `maxOptions + escapes > 255`                                                                                      | lower `maxOptions`                                        |
| `W_JEV_OPTIONS_UNDISTINGUISHED` ◊ | descriptions near-duplicate (token Jaccard ≥ 0.8), < 4 words, praise-only, or describe a multi-step plan                                                | —                                                         |
| `W_JEV_NO_STOP`                   | dynamic action menu inside a loop without `stop`                                                                                                        | add a `stop` escape                                       |
| `W_JEV_RUBRIC_LEVELS`             | score with fewer than 3 or more than 5 levels                                                                                                           | —                                                         |
| `W_JEV_RUBRIC_ANCHORS` ◊          | a level is numeric-only, a single word, or repeats its neighbour                                                                                        | —                                                         |
| `W_JEV_INSTRUCTIONS_WEAK` ◊       | instructions under 8 words with a vague predicate (safe, good, ok, appropriate, valid) or restating an identifier                                       | —                                                         |
| `W_JEV_PRIMITIVE_MISMATCH` ◊      | "select all / all that apply / one or more" on choice; `pYes` compared against ≥ 2 thresholds for ≥ 3 branches; score levels without ordinal vocabulary | split the question                                        |
| `W_JEV_SCORE_AS_MEASURE`          | arithmetic on a score's `value`/`normalized`, or comparison of scores from different contracts                                                          | use bands                                                 |
| `W_JEV_EXACT_RULE` ◊              | instructions compare counts, dates, amounts, allowlists or exact strings, or the state has only exact-typed fields compared with constants              | replace with `branch` (FlowExpr suggested when derivable) |
| `W_JEV_FREE_VALUE` ◊              | instructions ask for a name, URL, id, number, email or date not on the menu                                                                             | extract/generate, then decide                             |
| `W_JEV_TRANSCRIPT_STATE`          | a packet field is `ChatMessage[]`/`{role, content}[]`, or unbounded text named transcript/history/messages/conversation/log                             | bind evidence items or a summary                          |
| `W_JEV_CONCLUSION_AS_EVIDENCE` ◊  | an evidence/fact field name or literal expresses a conclusion (probably, likely, seems, enough, sufficient, looks_good, done, ok)                       | bind the observations                                     |
| `I_JEV_INHERITED_JUDGMENT`        | a packet field is bound to another decision's `value`/`levelLabel`                                                                                      | bind the evidence or the receipt ref                      |
| `E_JEV_PACKET_BUDGET`             | provable worst-case packet > 30 000 tokens                                                                                                              | declare `maxChars`/`selection`                            |
| `W_JEV_PACKET_LARGE`              | estimate > `maxTokens`, or unbounded fields                                                                                                             | declare `maxChars`                                        |
| `E_JEV_PACKET_DATA_CLASS`         | producer class above field class or `privacyClass`; secret producer; ineligible provider with `redact: 'error'`                                         | set `redact` / reduce the field                           |
| `W_JEV_PACKET_UNDECLARED_FIELD`   | a state binding key the contract does not declare (dropped)                                                                                             | remove or declare                                         |
| `W_JEV_EVIDENCE_UNVERSIONED`      | freshness requires `observedAt`/`version` the producer schema does not provide                                                                          | —                                                         |
| `E_JEV_THRESHOLDS_UNMAPPED`       | some confidence range has no route; bands do not partition the levels                                                                                   | —                                                         |
| `W_JEV_THRESHOLDS_ILLUSTRATIVE`   | auto-capable contract on illustrative or ungoverned thresholds                                                                                          | open threshold recommendation                             |
| `W_JEV_SINGLE_THRESHOLD`          | one threshold controls actions of ≥ 2 consequence classes                                                                                               | per-class zones / route node with a class                 |
| `E_JEV_IRREVERSIBLE_AUTO`         | an irreversible node in an auto region without human or tool gate                                                                                       | insert an approval                                        |
| `E_JEV_AUTHORITY_EXCEEDED`        | an auto region reaches a capability, side effect or class outside `allowedAction`                                                                       | narrow the region, or change the contract (review)        |
| `W_JEV_POLICY_IN_CLASSIFIER` ◊    | authorisation-named outcomes reach side effects without a policy node                                                                                   | insert a tool gate                                        |
| `W_JEV_CONFIDENCE_UNUSED`         | a decision is consumed only through `value`; nothing routes on confidence                                                                               | add `flowaid.jev.route`                                   |
| `W_JEV_IMPROVE_UNWIRED`           | an improve zone is possible but `improve` is unconnected or leads to no evidence-producing node                                                         | wire it / remove the zone                                 |
| `E_JEV_BLIND_RETRY`               | a loop re-evaluates a decision whose inputs cannot change between iterations                                                                            | add an evidence step                                      |
| `W_JEV_UNCALIBRATED_AUTO`         | auto region reachable with `uncalibratedProviders: 'allow'` and a non-TypeSafe primary hop                                                              | keep `human`                                              |
| `W_JEV_CONSENSUS_REASSURANCE`     | consensus `agreed` reaches side effects at consequence ≥ medium                                                                                         | route through a contract                                  |
| `I_JEV_BUNDLE`                    | a bundle was formed (members, packet, classes)                                                                                                          | —                                                         |
| `E_JEV_BUNDLE_CLASS_MIX`          | an explicit bundle mixes privacy/latency classes or provider eligibility                                                                                | split the bundle                                          |
| `W_JEV_PARALLEL_SIDE_EFFECTS`     | concurrent auto regions of one bundle share a capability, credential binding or host                                                                    | serialize                                                 |
| `W_JEV_GENERATION_FOR_DECISION`   | a generative node acts as a classifier: boolean/enum/small-ordinal output, or text compared only against literals, feeding control flow                 | _Replace with a Jev contract (shadow first)_              |
| `W_JEV_TRANSPORT_VERIFICATION`    | success declared from `status`/`ok`/`exitCode` of a side-effecting node without a verifier                                                              | insert `flowaid.jev.verify`                               |
| `W_JEV_UNGATED_TOOL`              | a `keyed`/`none` tool receives arguments from generation without a tool gate or approval                                                                | insert `flowaid.jev.tool_gate`                            |
| `W_JEV_PLACEMENT`                 | a decision whose outputs are unused, whose outcomes all lead to the same node, or that restates an exact condition                                      | remove / move to code                                     |
| `E_JEV_SHADOW_LEAK`               | shadow outputs feed a non-shadow node or a control edge                                                                                                 | remove the dependency                                     |

### 13.3 TraceReviewer and incident review

**TraceReviewer** (ARCH §10.5, P1-06/P6-04 → J-16):

- The compact trace summary gains `decisions: { receiptId, contract, outcome, confidence, route, reasons, disposition, overridden, executed, observable }[]`.
- New deterministic short-circuits before the judged question: a partially observable decision → `REVIEW` (`partially_observable_decision`); an irreversible action executed with a route other than `human` → `PRIORITY_REVIEW` (a harness defect); `DECISION_OVERRIDDEN` on an auto receipt → `REVIEW` and the receipt joins the labeling queue; ≥ 2 `blind_retry_blocked` in a run → `REVIEW` (`repeated_loop`); an action that failed with `stale_option` → `REVIEW` (`stale_choice`).
- Verdict `reasons` carry failure-mode ids (§13.1) and Table IX hints: _High confidence, wrong branch_ → evidence, menu completeness, calibration; _Review rate rising_ → state freshness, new option classes; _Costs rising_ → wrong routes, recovery work; _Repeated loops_ → stop option, retry evidence; _Unsafe action_ → authority boundary, policy order; _Schema valid, meaning wrong_ → criteria, representative tests.
- The reviewer dogfoods contracts: `observability.trace_review@1` (choice `NO_ACTION | REVIEW | PRIORITY_REVIEW | FILE_BUG | PAGE_ON_CALL` + `review` escape) and `observability.wrong_outcome@1` (boolean), with receipts.

**Incident review** (`POST /v1/runs/:id/jev/incident-review`, §X.O and §X.I):

```ts
export const IncidentBoundarySchema = z.enum([
  "state_construction",
  "menu_generation",
  "contract_wording",
  "calibration",
  "policy",
  "execution",
  "model_capability",
]);
export const IncidentReviewSchema = z.object({
  runId: z.uuid(),
  receipts: z.array(z.object({ receiptId: z.uuid(), reconstruction: ReconstructionSchema })),
  diagnosticOrder: z.array(
    z.object({
      step: z.enum([
        "evidence_present",
        "option_set_valid",
        "instructions_distinguish",
        "threshold_mapped",
        "model_capability",
      ]),
      verdict: z.enum(["ok", "defect", "unknown"]),
      evidence: z.string(),
    }),
  ),
  earliestIncorrectBoundary: IncidentBoundarySchema.nullable(),
  correctiveLoci: z.array(IncidentBoundarySchema),
  fixtureCandidates: z.array(z.uuid()),
});
```

The diagnostic order is fixed — _"first ask whether the state contained the necessary evidence, whether the option set was valid, whether the instructions distinguished outcomes, and whether the threshold mapped to the correct route. Only after those checks should the defect be assigned to model capability"_: (1) evidence — required fields present, nothing stale, ablation sensitivity from the last contract test; (2) option set — snapshot version, counts, action failures; (3) instructions — label disagreement, near-duplicate descriptions, escape usage; (4) threshold mapping — recomputed route, governance, segment calibration; (5) model — only when 1–4 are `ok`. The workbench records the earliest incorrect boundary and the corrective loci, and **Promote to regression fixture** writes a `decision_fixtures` row (`category: 'incident'`, redacted packet, expected outcome and route, short rationale). Incident fixtures are mandatory in every later contract test of that contract — _"A fix is incomplete until the revised system produces the intended judgment and route on those fixtures without weakening unrelated cases"_.

---

## 14. AI builder, critic, cost optimizer and evaluation

The advisor (P6-02 → J-19) applies the handbook's rules; everything deterministic comes from `@flowaid/jev` so the canvas, API and CLI agree.

### 14.1 Hidden-decision inventory and the boundary test (§I.G, §XI suggested prompt)

```ts
export const HiddenDecisionSchema = z.object({
  nodeId: NodeIdSchema,
  kind: z.enum([
    "request_clarity",
    "worker_selection",
    "model_selection",
    "retrieval_survival",
    "tool_risk",
    "completion",
    "retry",
    "escalation",
    "stop",
    "other",
  ]),
  currentOwner: z.enum(["llm", "jev", "code", "human", "implicit"]),
  shape: z.enum(["creates_language", "interprets_meaning", "enforces_exact_rule"]),
  answerShape: z
    .enum([
      "one_winner",
      "ordered_quality",
      "yes_no",
      "free_string",
      "exact_arithmetic",
      "artifact",
    ])
    .nullable(),
  recommendation: z.enum(["keep_llm", "jev_contract", "code", "decompose"]),
  consequenceClass: ConsequenceClassSchema,
  volumePerDay: z.number().nullable(), // from node_runs when the workflow has runs
  labelable: z.boolean(), // a correct answer can be labeled later
  firstContractScore: z.number().nullable(), // ranks "one high-volume, low-consequence, labelable" candidates (§IX.A)
  rationale: z.string(),
  fix: z.object({ title: z.string(), patch: z.array(JsonPatchOpSchema) }).nullable(),
});
```

`inventoryHiddenDecisions(definition, plan?, stats?)` scans for: generation whose output is an enum/boolean/small ordinal or is compared only against literals (→ `jev_contract`); `branch` cases over generated text (→ `jev_contract` or `code`); loop `exitWhen` on generated values (completion); agent tool approvals `never` on `keyed`/`none` tools (tool risk); human escalations decided by generated values; loops without a stop outcome; decision nodes whose questions are exact rules (→ `code`); legacy decision nodes (→ contract extraction). Answer shape → owner follows Table II (one winner → Choice, ordered quality → Score, yes/no → Noul, free string → extraction/generation, exact arithmetic → code). `firstContractScore = volumePerDay × (low ? 1 : 0.2) × (labelable ? 1 : 0) × (currentOwner = llm ? 1.5 : 1)`.

The critic action **Map hidden decisions** is the handbook's suggested agent prompt: it returns the inventory and proposes **one** low-consequence contract to run in shadow first — a registry draft plus a JSON patch adding a `flowaid.jev.shadow` node beside the existing logic.

### 14.2 Critic rules and the readiness report (§XI.B–C)

The critic returns every Jev diagnostic of §13.2 plus a readiness report per contract node — the sixteen checklist items as automated checks:

```ts
export const LaunchCheckSchema = z.enum([
  "semantic_not_generative_or_exact",
  "state_compact_current_evidence",
  "instructions_define_meaning",
  "choice_escape_hatch",
  "score_verbal_anchors",
  "noul_uncertainty",
  "confidence_changes_route",
  "code_retains_authority",
  "independent_share_state_version",
  "dependent_follow_state_update",
  "thresholds_consequence_specific",
  "full_distribution_in_receipt",
  "shadow_mode_run",
  "representative_tests",
  "retry_adds_evidence",
  "can_stop_or_escalate",
]);
export const ReadinessReportSchema = z.object({
  nodeId: NodeIdSchema,
  contract: ContractRefSchema.nullable(),
  environmentId: z.uuid().nullable(),
  checks: z.record(
    LaunchCheckSchema,
    z.object({
      status: z.enum(["pass", "warn", "fail", "unknown"]),
      evidence: z.string(),
      codes: z.array(z.string()),
    }),
  ),
  ready: z.boolean(),
});
```

| Check                                           | Evidence                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| semantic, not generative or exact               | no `W_JEV_EXACT_RULE`/`W_JEV_FREE_VALUE`; answer shape is one winner / ordered / yes-no                                |
| state compact, current, evidence-based          | within `maxTokens`; no transcript/conclusion lints; freshness declared where evidence can go stale                     |
| instructions define meaning                     | no `W_JEV_INSTRUCTIONS_WEAK`; review approved                                                                          |
| Choice has an escape hatch                      | escape outcome present (dynamic menus: required)                                                                       |
| Score uses ordered verbal anchors               | no rubric lints                                                                                                        |
| Noul is yes/no uncertainty                      | no `W_JEV_PRIMITIVE_MISMATCH` on `pYes`                                                                                |
| confidence changes the route                    | inline routing or a route node; no `W_JEV_CONFIDENCE_UNUSED`                                                           |
| code retains authority over side effects        | no `E_JEV_AUTHORITY_EXCEEDED`, `E_JEV_IRREVERSIBLE_AUTO`, `W_JEV_POLICY_IN_CLASSIFIER`                                 |
| independent questions share one state version   | bundles formed; no `E_JEV_BUNDLE_CLASS_MIX`                                                                            |
| dependent questions follow a state update       | structural; no `E_JEV_BLIND_RETRY`                                                                                     |
| thresholds consequence-specific                 | zones for the class with governance; no `W_JEV_SINGLE_THRESHOLD`                                                       |
| full distribution in the receipt                | by construction (receipts always carry it)                                                                             |
| contract ran in shadow                          | a `shadow_baseline`/shadow snapshot exists for the version (or an interface-compatible predecessor) in the environment |
| representative tests incl. ambiguity and no-fit | latest contract test passed with the required categories and all incident fixtures                                     |
| every retry adds evidence                       | improve actions declared and wired; blind-retry guard active                                                           |
| system can stop or escalate                     | escalation wired or inline; `stop` escape on action menus                                                              |

The publish dialog shows the report next to the diagnostics; deploying to a **protected** environment is refused (422 with the report) while any contract node on an auto-capable path has a `fail`. The critic also enforces _"expand one boundary at a time"_ (§IX.G): automating a later boundary (e.g. tool gating) while an earlier one (internal routing) of the same workflow is still in shadow is a critic warning. P6-02's rubric rule _irreversible tool after a decision without a gate_ is subsumed by `E_JEV_IRREVERSIBLE_AUTO` for contract nodes and stays for legacy decision nodes.

### 14.3 AI builder rules

The builder's system prompt carries the boundary test, Table II, the contract schema summary and the harness templates. Its repair loop treats the Jev lints as blocking for generated output: it may not emit a generative node acting as a classifier (`W_JEV_GENERATION_FOR_DECISION`), a choice without an escape hatch, a Jev question that is an exact rule (it emits a `branch`), or a contract node without escalation. Contracts it proposes are created as registry **drafts** (never approved by the builder), thresholds are left illustrative (governance is a human act), consequence classes are inferred from the downstream nodes (§6.1), and a contract that replaces existing logic is wired in shadow first.

### 14.4 Cost optimizer and honest economics

`optimize()` (P6-02) gains Jev suggestions, each with `estimatedSavingsUsdPerRun`, `latencyDeltaMs`, `risk` and `fix`:

| Suggestion                          | Detected by                                                                                                        | Estimate from measured data                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `replace_generation_with_contract`  | `W_JEV_GENERATION_FOR_DECISION`                                                                                    | node's 30-day mean generation cost − (mean packet tokens × $0.042/1M); latency from the node's p50 vs measured Jev p50 (unknown until shadow data exists). Fix: contract draft + shadow node — never a direct swap |
| `batch_decisions` (P6-02, extended) | decisions over the same snapshot in separate requests, now including contract nodes that can share a bundle (§8.3) | (n − 1) × packet tokens × price, plus sequential latency removed                                                                                                                                                   |
| `move_rule_to_code`                 | `W_JEV_EXACT_RULE`                                                                                                 | the decision's cost and latency; fix: `branch`                                                                                                                                                                     |
| `remove_low_value_decision`         | `W_JEV_PLACEMENT`, route entropy ≈ 0 over 30 days                                                                  | the decision's cost; _"A small graph with high-quality boundaries is better than a dense graph of low-value classifiers"_ (§IX.H)                                                                                  |
| `add_improve_path`                  | high human share within 0.1 below `improveAt`                                                                      | review load moved to evidence collection                                                                                                                                                                           |
| `tighten_packet`                    | fields with zero ablation sensitivity, packets ≫ needed tokens                                                     | tokens removed                                                                                                                                                                                                     |
| `enable_shadow`                     | contract replacing existing logic without shadow data                                                              | — (risk reduction)                                                                                                                                                                                                 |

Economics are reported honestly (Abstract, Source [2]): TypeSafe's 70–500 ms, $0.042/M input tokens and 20–200× / 40–400× figures appear only labelled _vendor-reported, workload-dependent ceilings_; savings and latency come from flowaid's own measurements; the headline KPIs are cost and reliability **per completed task**, human review rate, recovery cost and _generative calls removed_ — never the number of Jev calls (§VII.F, §IX.H).

### 14.5 Evaluation extensions (P2-07 → J-14)

- `ExpectationSchema.decisions[nodeId]` (ARCH §10.4) gains `outcome?`, `route?: JevRoute`, `permittedRoute?` (dual labels), and cases gain a `category: FixtureCategory` tag; the regression report's `flips` include route flips.
- **Contract test runner** (`jev.contract_test`): evaluates `decision_fixtures` directly against a contract version — no workflow run — and reports accuracy per category, route correctness, monotonicity over ladders, ablation sensitivity (§5.7), small-sample calibration (flagged), required-category coverage and incident fixtures; verdict per `contract.tests`.
- **Table VIII economics** in `EvaluationSummary.jev` and in production metrics (J-16):

| Metric                   | Definition                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Decision latency         | p50/p95 of `DECISION_REQUESTED.at → DECISION_COMPLETED.at`                                         |
| Decision cost            | Σ decision `costUsd` per run                                                                       |
| Branch accuracy          | labeled/expected outcome correctness                                                               |
| Route correctness        | route = `permittedRoute` (dual labels)                                                             |
| Calibration              | ECE per contract version (§7.2)                                                                    |
| Downstream tool cost     | Σ cost of tool nodes inside authority regions                                                      |
| Recovery cost            | Σ cost of node runs executed after a receipt later overridden or labeled wrong, until the run ends |
| Review rate              | human-route share and human tasks per run                                                          |
| Completed-task rate      | runs completed with a success outcome / all runs                                                   |
| Cost per completed task  | total run cost / completed runs                                                                    |
| Generative calls removed | generation nodes replaced by contracts × runs, per workflow version                                |

---

## 15. Persistence (DATABASE.md addendum, J-10)

Nine tenant tables (all `workspace_id NOT NULL`, forced RLS like every tenant table, uuid v7 ids). They ship in `0001_init.sql` if J-10 lands before the first deployment (the rule DATABASE.md applies to its v1.1 additions), otherwise as `0005_jev.sql`.

```ts
/* ───────────────────────── decision contracts (Jev) — JEV_ENGINEERING.md ───────────────────────── */
import type {
  DecisionContractBody,
  ContractReview,
  RolloutGuardrails,
  RollbackTrigger,
  CalibrationMetrics,
  CalibrationSegment,
  DriftAlarm,
  StatePacket,
  OptionSet,
} from "@flowaid/jev";
import type {
  DecisionReceipt,
  RoutingRecord,
  ExecutedAction,
  DecisionOverride,
} from "@flowaid/workflow-core";

export const decisionContracts = pgTable(
  "decision_contracts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // "support.router"
    title: text("title").notNull(),
    owner: text("owner").notNull(), // user id | "role:<r>" | "team:<name>"
    draft: jsonb("draft").$type<DecisionContractBody>().notNull(), // editable head, like workflows.draft
    draftRevision: integer("draft_revision").notNull().default(1), // If-Match
    draftDiagnostics: jsonb("draft_diagnostics").$type<Diagnostic[]>().notNull().default([]),
    latestVersion: integer("latest_version").notNull().default(0),
    latestApprovedVersion: integer("latest_approved_version"),
    archivedAt: ts("archived_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("decision_contracts_ws_key_uq").on(t.workspaceId, t.key)],
);

export const decisionContractVersions = pgTable(
  "decision_contract_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => decisionContracts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: jsonb("body").$type<DecisionContractBody>().notNull(), // immutable
    hash: text("hash").notNull(),
    interfaceHash: text("interface_hash").notNull(),
    status: text("status", { enum: ["in_review", "approved", "rejected", "deprecated"] })
      .notNull()
      .default("in_review"),
    diagnostics: jsonb("diagnostics").$type<Diagnostic[]>().notNull().default([]),
    diff: jsonb("diff").$type<JsonObject>(), // ContractDiff vs the latest approved version
    review: jsonb("review").$type<ContractReview>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("dcv_contract_version_uq").on(t.contractId, t.version),
    index("dcv_ws_status_idx").on(t.workspaceId, t.status),
  ],
);

export const decisionContractDeployments = pgTable(
  "decision_contract_deployments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => decisionContracts.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    activeVersion: integer("active_version"),
    activeStage: text("active_stage", { enum: ["shadow", "active", "paused"] }),
    candidateVersion: integer("candidate_version"),
    candidateStage: text("candidate_stage", { enum: ["shadow", "canary"] }),
    guardrails: jsonb("guardrails").$type<RolloutGuardrails>().notNull(),
    rollbackTriggers: jsonb("rollback_triggers").$type<RollbackTrigger[]>().notNull().default([]),
    previousActiveVersion: integer("previous_active_version"),
    pausedReason: text("paused_reason"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("dcd_contract_env_uq").on(t.contractId, t.environmentId),
    check(
      "dcd_has_version",
      sql`${t.activeVersion} IS NOT NULL OR ${t.candidateVersion} IS NOT NULL`,
    ),
  ],
);

export const decisionSnapshots = pgTable(
  "decision_snapshots",
  {
    // content-addressed packets and option sets (redacted copies)
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(), // packetHash | optionSet.version
    kind: text("kind", { enum: ["packet", "state", "option_set"] }).notNull(), // state = a legacy node's verbatim DecisionState (§12.2)
    body: jsonb("body").$type<StatePacket | OptionSet | JsonValue>().notNull(),
    fidelity: text("fidelity", { enum: ["exact", "redacted"] }).notNull(),
    dataClass: dataClassEnum("data_class").notNull(),
    bytes: integer("bytes").notNull(),
    tokens: integer("tokens"),
    firstRunId: uuid("first_run_id"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at"),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.hash] }),
    index("decision_snapshots_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
);

export const decisionReceipts = pgTable(
  "decision_receipts",
  {
    id: uuid("id").primaryKey(), // receiptId (uuid v7)
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    nodeRunId: uuid("node_run_id").notNull(),
    nodeId: text("node_id").notNull(),
    scope: text("scope").notNull().default(""),
    question: text("question").notNull(),
    bundleId: text("bundle_id").notNull(),
    batchId: text("batch_id"),
    mode: text("mode", { enum: ["live", "shadow", "replay", "evaluation"] }).notNull(),
    workflowId: uuid("workflow_id").notNull(),
    workflowVersionId: uuid("workflow_version_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    contractId: uuid("contract_id").references(() => decisionContracts.id, {
      onDelete: "set null",
    }), // null for implicit contracts
    contractKey: text("contract_key").notNull(),
    contractVersion: integer("contract_version").notNull(),
    contractHash: text("contract_hash").notNull(),
    contractOrigin: text("contract_origin", { enum: ["registry", "implicit"] }).notNull(),
    kind: text("kind", { enum: ["boolean", "choice", "score"] }).notNull(),
    outcome: text("outcome"),
    escape: text("escape"),
    confidence: numeric("confidence", { precision: 6, scale: 5 }),
    distribution: jsonb("distribution").$type<Record<string, number>>().notNull(),
    stateVersion: text("state_version").notNull(),
    packetHash: text("packet_hash").notNull(),
    snapshotHash: text("snapshot_hash"),
    fidelity: text("fidelity", { enum: ["exact", "redacted", "not_persisted"] }).notNull(),
    optionSetVersion: text("option_set_version"),
    modelProvider: text("model_provider").notNull(),
    modelRequested: text("model_requested").notNull(),
    modelResolved: text("model_resolved"),
    route: text("route", { enum: ["auto", "improve", "human"] }), // first routing (filters); all routings in `routings`
    consequenceClass: text("consequence_class", {
      enum: ["low", "medium", "high", "irreversible"],
    }),
    disposition: text("disposition", { enum: ["active", "canary", "holdback", "shadow"] }),
    policyVerdict: text("policy_verdict", { enum: ["allow", "review", "deny"] }),
    routings: jsonb("routings").$type<RoutingRecord[]>().notNull().default([]), // append-only
    executedAction: jsonb("executed_action").$type<ExecutedAction>(), // write-once
    overrides: jsonb("overrides").$type<DecisionOverride[]>().notNull().default([]), // append-only
    receipt: jsonb("receipt").$type<DecisionReceipt>().notNull(), // DECISION_RECEIPT payload (write-once)
    labelState: text("label_state", {
      enum: ["none", "single", "agreed", "disputed", "adjudicated"],
    })
      .notNull()
      .default("none"),
    labelOutcome: text("label_outcome"), // agreed/adjudicated label (cache of decision_labels)
    language: text("language"),
    tenant: text("tenant"), // segmentation (run labels / packet fact)
    latencyMs: integer("latency_ms").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    at: ts("at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("dr_contract_at_idx").on(t.workspaceId, t.contractKey, t.contractVersion, t.at.desc()),
    index("dr_run_idx").on(t.runId),
    index("dr_node_run_idx").on(t.nodeRunId),
    index("dr_route_idx").on(t.workspaceId, t.route, t.at.desc()),
    index("dr_label_queue_idx")
      .on(t.workspaceId, t.contractKey, t.labelState)
      .where(sql`${t.labelState} IN ('none', 'disputed')`),
  ],
);
// Trigger decision_receipts_write_once: an UPDATE may only append to routings/overrides, set route/consequence_class/disposition/
// policy_verdict or executed_action while they are NULL, and change label_state/label_outcome; DELETE only under app.bypass_rls (sweep).

export const decisionLabels = pgTable(
  "decision_labels",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => decisionReceipts.id, { onDelete: "cascade" }),
    labeler: text("labeler").notNull(),
    source: text("source", {
      enum: ["reviewer", "override", "sampled_review", "fixture", "adjudication"],
    }).notNull(),
    outcome: text("outcome").notNull(),
    permittedRoute: text("permitted_route", { enum: ["auto", "improve", "human"] }),
    rubricVersion: text("rubric_version").notNull(),
    rationale: text("rationale"),
    inclusionProbability: numeric("inclusion_probability", { precision: 6, scale: 5 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("dl_receipt_idx").on(t.receiptId),
    uniqueIndex("dl_receipt_labeler_source_uq").on(t.receiptId, t.labeler, t.source),
  ],
);

export const shadowComparisons = pgTable(
  "shadow_comparisons",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    nodeRunId: uuid("node_run_id").notNull(),
    question: text("question").notNull(),
    contractKey: text("contract_key").notNull(),
    contractVersion: integer("contract_version").notNull(),
    contractHash: text("contract_hash").notNull(),
    stateHash: text("state_hash").notNull(),
    jevModel: text("jev_model").notNull(),
    shadowOutcome: text("shadow_outcome"),
    shadowConfidence: numeric("shadow_confidence", { precision: 6, scale: 5 }),
    shadowDistribution: jsonb("shadow_distribution").$type<Record<string, number>>().notNull(),
    wouldRoute: text("would_route", { enum: ["auto", "improve", "human"] }),
    productionSource: text("production_source", {
      enum: ["llm", "rule", "code", "human", "jev"],
    }).notNull(),
    productionNodeId: text("production_node_id").notNull(),
    productionNodeRunId: uuid("production_node_run_id"),
    productionAnswer: text("production_answer"),
    productionConfidence: numeric("production_confidence", { precision: 6, scale: 5 }),
    agree: boolean("agree"),
    deferred: boolean("deferred").notNull().default(false),
    actionTaken: boolean("action_taken").notNull().default(false),
    at: ts("at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("shadow_comparisons_receipt_uq").on(t.receiptId),
    index("sc_contract_at_idx").on(t.workspaceId, t.contractKey, t.contractVersion, t.at.desc()),
    check("shadow_comparisons_no_action", sql`${t.actionTaken} = false`),
  ],
);

export const calibrationSnapshots = pgTable(
  "calibration_snapshots",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => decisionContracts.id, { onDelete: "cascade" }),
    contractKey: text("contract_key").notNull(),
    contractVersion: integer("contract_version").notNull(),
    environmentId: uuid("environment_id"),
    segment: jsonb("segment").$type<CalibrationSegment>().notNull(),
    segmentKey: text("segment_key").notNull(), // canonical string of `segment`
    windowKind: text("window_kind", {
      enum: ["rolling_7d", "rolling_28d", "shadow_baseline", "canary", "evaluation"],
    }).notNull(),
    windowFrom: ts("window_from").notNull(),
    windowTo: ts("window_to").notNull(),
    metrics: jsonb("metrics").$type<CalibrationMetrics>().notNull(),
    alarms: jsonb("alarms").$type<DriftAlarm[]>().notNull().default([]),
    baselineSnapshotId: uuid("baseline_snapshot_id"),
    computedAt: ts("computed_at").notNull(),
  },
  (t) => [
    uniqueIndex("cs_window_uq").on(
      t.contractId,
      t.contractVersion,
      t.segmentKey,
      t.windowKind,
      t.windowTo,
    ),
    index("cs_contract_idx").on(
      t.workspaceId,
      t.contractKey,
      t.contractVersion,
      t.computedAt.desc(),
    ),
  ],
);

export const decisionFixtures = pgTable(
  "decision_fixtures",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => decisionContracts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category", {
      enum: [
        "normal",
        "ambiguous",
        "missing_evidence",
        "adversarial",
        "stale_options",
        "rare_class",
        "no_fit",
        "incident",
        "ladder",
      ],
    }).notNull(),
    packet: jsonb("packet").$type<StatePacket>().notNull(), // redacted or synthetic only
    optionSet: jsonb("option_set").$type<OptionSet>(),
    expected: jsonb("expected")
      .$type<{
        outcome?: string;
        outcomeIn?: string[];
        route?: "auto" | "improve" | "human";
        minConfidence?: number;
        maxConfidence?: number;
      }>()
      .notNull(),
    rationale: text("rationale").notNull(), // short human rationale, not chain-of-thought
    ladder: jsonb("ladder").$type<{ id: string; rank: number }>(),
    sourceReceiptId: uuid("source_receipt_id"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("df_contract_idx").on(t.contractId, t.category)],
);
```

Changes to existing tables and types: `jobs.kind` gains `'jev.contract_test' | 'jev.replay'`; `artifacts.kind` gains `'report'` (test and replay reports); `templates.required_resources` gains `decisionContracts: { key: string; description: string; body: DecisionContractBody }[]` (readers treat a missing key as `[]`, §9.8); `WorkspaceSettings` gains `jev?: { providerEligibility?: Record<string, DataClass>; labelSampling?: LabelSamplingPolicy; calibrationCron?: string }`; the notification event catalogue gains `jev.drift_alarm`, `jev.rollback_triggered`, `jev.review_requested`, `jev.label_backlog`; audit actions gain `decision_contract.create | version | review | deploy | promote | rollback | pause`, `decision_receipt.label | adjudicate`, `decision_fixture.create`.

Projections added to DATABASE.md "Projections":

| Event                                        | Projection                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DECISION_PACKET_BUILT` / `OPTION_SET_BUILT` | insert `decision_snapshots` if absent from the event's `packet`/`body` (redacted body, kind, fidelity, class, `expires_at` from the run's retention and data class) |
| `DECISION_RECEIPT`                           | insert `decision_receipts` (segmentation columns from the run's labels and the packet fact `language`)                                                              |
| `DECISION_ROUTED`                            | append `routings`; set the first-routing columns when NULL                                                                                                          |
| `DECISION_ACTION_RECORDED`                   | set `executed_action` when NULL                                                                                                                                     |
| `DECISION_OVERRIDDEN`                        | append `overrides`; insert `decision_labels{ source: 'override' }`; recompute `label_state`                                                                         |
| `SHADOW_COMPARED`                            | insert `shadow_comparisons`                                                                                                                                         |

Retention: `decision_receipts`, `decision_labels`, `shadow_comparisons` 400 days (they hold keys, distributions and metrics — no raw payloads; dynamic-menu source ids live only in snapshots); `decision_snapshots` follow the run's retention class and the data-class rule (`pii`/`sensitive` 7 days unless `privacy.persistPII`); `calibration_snapshots` 2 years; contracts, versions, deployments and fixtures until deleted (versions referenced by receipts are archived, never hard-deleted; fixture packets are redacted or synthetic by construction).

---

## 16. API addendum (API.md, J-15)

New OpenAPI tags `decisions` (contracts, versions, deployments, calibration, fixtures, replay) and `decision-receipts` (receipts, labels, shadow comparisons); CLI nouns follow (`flowaid decisions …`, `flowaid decision-receipts …`) plus hand-written `flowaid decisions lint <file.json>` (offline, `@flowaid/jev`). New scopes `decisions:read | decisions:write | decisions:review | decisions:label | decisions:deploy`; roles: viewer + `decisions:read`; operator + `decisions:label`; editor + `decisions:write`, `decisions:review`, `decisions:deploy` (non-protected environments); admin — deploys to protected environments. `FeatureKeySchema` gains `decision_contracts` (true when J-15 ships), which gates the **Decisions** navigation entry.

| Method           | Path                                                                                    | Scope                                 | Request → Response                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST         | `/v1/decision-contracts`                                                                | decisions:read / write                | `?q&tag&status&include=body                                                                                                                                                                                                                          | compile`→`DecisionContractSummary[]` (`compile`: per key the compile reference of §4.4 step 2 with status, hashes and body — the browser compiler's `resolveContract`source); POST`CreateDecisionContractRequest { key, title, owner, draft }`→`DecisionContract` (409 key exists) |
| GET/PATCH/DELETE | `/v1/decision-contracts/:id`                                                            | read / write                          | head with draft, revision, diagnostics, versions, deployments; PATCH `{ title?, owner?, archived? }`; DELETE archives (409 while a deployed workflow references it)                                                                                  |
| PUT              | `/v1/decision-contracts/:id/draft`                                                      | write (`If-Match`)                    | `{ draft }` → `{ draftRevision, diagnostics }` (412 on revision mismatch)                                                                                                                                                                            |
| POST             | `/v1/decision-contracts/:id/lint`                                                       | read                                  | `{ body? }` → `{ diagnostics, interfaceHash }`                                                                                                                                                                                                       |
| GET/POST         | `/v1/decision-contracts/:id/versions`                                                   | read / write                          | list; POST freezes the draft → `DecisionContractVersion` (`in_review`, diff); 422 with diagnostics on lint errors                                                                                                                                    |
| GET              | `/v1/decision-contracts/:id/versions/:version`                                          | read                                  | version with body, diagnostics, diff, review                                                                                                                                                                                                         |
| POST             | `/v1/decision-contracts/:id/versions/:version/review`                                   | decisions:review                      | `{ verdict, checklist, comment?, replayJobId?, contractTestJobId? }` → version (409 not `in_review`; 403 author reviewing a version deployed to a protected environment)                                                                             |
| GET              | `/v1/decision-contracts/:id/diff/:a/:b`                                                 | read                                  | `ContractDiff`                                                                                                                                                                                                                                       |
| POST             | `/v1/decision-contracts/:id/versions/:version/test`                                     | write                                 | `{ fixtureIds?, hop?, ablations? }` → 202 `{ job_id }` (`jev.contract_test`)                                                                                                                                                                         |
| POST             | `/v1/decision-contracts/:id/versions/:version/replay`                                   | write                                 | `ReplayRequest { from, to, environmentId?, sourceVersion?, labeledOnly?, limit? }` → 202 `{ job_id, estimate }` (`jev.replay`)                                                                                                                       |
| GET              | `/v1/decision-contracts/:id/deployments`                                                | read                                  | `ContractDeployment[]`                                                                                                                                                                                                                               |
| PUT              | `/v1/decision-contracts/:id/deployments/:environmentId`                                 | decisions:deploy (admin if protected) | `ContractDeployRequest { active?, candidate?, guardrails, rollbackTriggers }` → `ContractDeployment`; 422 on interface mismatch with deployed workflows, unapproved version, missing governance, missing shadow baseline or rollback trigger (§11.4) |
| POST             | `/v1/decision-contracts/:id/deployments/:environmentId/{promote,rollback,pause}`        | decisions:deploy                      | promote candidate; `{ toVersion? }`; `{ reason }` → `ContractDeployment`                                                                                                                                                                             |
| GET              | `/v1/decision-contracts/:id/deployments/:environmentId/rollout-report`                  | read                                  | `RolloutReport` (§11.4)                                                                                                                                                                                                                              |
| GET              | `/v1/decision-contracts/:id/calibration`                                                | read                                  | `?version&environmentId&segment.*&window` → `CalibrationSnapshot[]`; POST `…/calibration/recompute` → 202                                                                                                                                            |
| GET              | `/v1/decision-contracts/:id/threshold-recommendations`                                  | read                                  | `?version&environmentId&consequenceClass` → `ThresholdRecommendation[]`; POST `…/:class/accept` → new draft with governance prefilled                                                                                                                |
| GET/POST         | `/v1/decision-contracts/:id/fixtures` · PATCH/DELETE `/v1/decision-fixtures/:fixtureId` | read / write                          | `DecisionFixture` (POST accepts arrays and JSONL)                                                                                                                                                                                                    |
| GET              | `/v1/decision-receipts`                                                                 | read                                  | `?contractKey&version&environmentId&workflowId&runId&route&mode&disposition&labelState&agree&from&to&cursor` (keyset `at desc, id desc`) → `DecisionReceiptSummary[]`                                                                                |
| GET              | `/v1/decision-receipts/:id`                                                             | read                                  | `DecisionReceiptDetail { receipt, packet?, optionSet?, labels, overrides, executedAction, reconstruction, shadow? }` (packet redacted; `sensitive` values hidden from non-admins)                                                                    |
| POST             | `/v1/decision-receipts/:id/labels`                                                      | decisions:label                       | `{ outcome, permittedRoute?, rationale?, rubricVersion }` → `DecisionLabel` (409 same labeler twice)                                                                                                                                                 |
| POST             | `/v1/decision-receipts/:id/adjudicate`                                                  | decisions:review                      | `{ outcome, permittedRoute?, rationale }` → `DecisionLabel`                                                                                                                                                                                          |
| POST             | `/v1/decision-receipts/:id/fixture`                                                     | decisions:write                       | `{ name, category, expected, rationale }` → `DecisionFixture` (packet redacted on copy)                                                                                                                                                              |
| GET              | `/v1/decision-labels/queue`                                                             | decisions:label                       | `?contractKey&limit` → `LabelQueueItem[]` (stratified, with inclusion probability)                                                                                                                                                                   |
| GET              | `/v1/shadow-comparisons` · `/v1/shadow-comparisons/summary`                             | read                                  | filters → list; `?contractKey&version&environmentId&window` → `ShadowSummary`                                                                                                                                                                        |
| GET              | `/v1/runs/:id/decisions`                                                                | runs:read                             | receipts of the run grouped by bundle and `stateVersion`                                                                                                                                                                                             |
| POST             | `/v1/runs/:id/jev/incident-review`                                                      | runs:read + decisions:read            | → `IncidentReview`                                                                                                                                                                                                                                   |
| POST             | `/v1/workflows/:id/jev/inventory`                                                       | workflows:read                        | `{ definition? }` → `{ decisions: HiddenDecision[], proposal: { contractDraft, patch } \| null }`                                                                                                                                                    |
| POST             | `/v1/workflows/:id/jev/readiness`                                                       | workflows:read                        | `{ environmentId }` → `ReadinessReport[]`                                                                                                                                                                                                            |
| GET              | `/v1/jev/metrics`                                                                       | runs:read                             | `?workflowId&contractKey&environmentId&from&to&bucket` → `JevMetrics` (Table VIII, §14.5)                                                                                                                                                            |

Existing routes change as follows: workflow deploy/promote (API.md §3.3) validates contract deployments in protected environments and lists undeployed keys otherwise (§4.4 step 3); `POST /v1/templates/:id/instantiate` provisions the template's decision contracts and accepts `contracts?: Record<string, string>`, `POST /v1/templates { fromVersionId }` captures the version's contract bodies (§9.8); `POST /v1/workflows/:id/run` resolves `RUN_CREATED.contracts` (§4.4 step 4); `add-to-evaluation` prefills `outcome`/`route` per decision; `JobSchema.kind` gains `jev.contract_test | jev.replay`; `GET /v1/me.features` includes `decision_contracts`.

---

## 17. UI addendum (UI.md, J-17/J-18)

**Routes** (`apps/web`, behind `features.decision_contracts`; nav entry **Decisions** after Runs):

```
(app)/[ws]/decisions/                          contracts: key, title, owner, per-environment chips (active v·stage, candidate v·stage),
                                               7-day volume, route mix (auto/improve/human), ECE chip, open alarms, last review
(app)/[ws]/decisions/new                       blank | from template (router, verifier, tool risk, relevance) | from an inventory proposal
(app)/[ws]/decisions/[contractId]              tabs: Overview · Draft · Versions · Rollout · Calibration · Shadow · Receipts · Fixtures
(app)/[ws]/decisions/[contractId]/versions/[v] body, diagnostics, semantic diff, review panel, contract-test and replay reports
(app)/[ws]/decisions/[contractId]/compare      ?a=&b= semantic diff + replay report
(app)/[ws]/decisions/receipts/[receiptId]      receipt page
(app)/[ws]/decisions/labeling                  labeling queue (keyboard-first, rubric side panel, dual labels for consequence ≥ medium)
runs/[runId]                                   new tab "Decisions" (bundles by stateVersion, evidence arrows §8.5); NodeRunDetail gains a
                                               "Receipt" tab; "Incident review" sheet
workflows/[id]                                 inspector "Contract" tab; node card meta row `support.router@4 · 5 outcomes · low`;
                                               live overlay shows route and disposition chips; Problems panel lists Jev diagnostics
                                               with quick fixes; PublishDialog embeds the readiness report; critic panel "Hidden decisions"
settings/workspace                             provider eligibility by data class; label sampling policy
```

**Components** — a new `@flowaid/ui` group `jev` (added to `UI_GROUPS` in `scripts/ui-inventory.ts` when the first export ships, J-17), presentational only, typed against `@flowaid/jev` and `@flowaid/workflow-core`:

| Component                                                                                                                                                                                                         | Used by                                       | Builds on                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `ContractEditor` (sections: question, outcomes/rubric, state spec, routing, allowed action, escalation, model, tests)                                                                                             | Draft tab                                     | `SchemaForm`, `CriteriaEditor`, `LevelsList`           |
| `OutcomeListEditor` (escape toggle, automatable, per-outcome class) · `RubricEditor` (levels + bands, 3–5 guidance) · `StateSpecEditor` (role, description, schema, data-class badge, `maxChars`, freshness)      | Draft tab                                     | `ReorderableList`, `JsonSchemaEditor`                  |
| `ThresholdTable` (zones per class, illustrative badge) · `GovernanceForm` · `AllowedActionEditor` · `RollbackTriggerEditor`                                                                                       | Draft, Rollout                                | `ConfidenceGateEditor` visuals                         |
| `ContractDiffView` · `ReviewChecklist` · `ContractTestReport` · `ReplayReport`                                                                                                                                    | Versions, compare                             | `DiffView`, `DataTable`                                |
| `RolloutStepper` (stages per environment) · `GuardrailsForm`                                                                                                                                                      | Rollout                                       | `Tabs`, `Slider`                                       |
| `ReliabilityDiagram` (segment picker) · `NearThresholdHistogram` (zones) · `DriftAlarmList` · `ThresholdRecommendationCard`                                                                                       | Calibration                                   | `CalibrationChart`, `ConfidenceHistogram`, `GATE_ZONE` |
| `ShadowSummaryPanel` (agreement, confusion matrix, disagreement list)                                                                                                                                             | Shadow                                        | `ConfusionMatrix`                                      |
| `ReceiptCard` · `ReceiptReconstruction` (six steps) · `PacketViewer` (sections, provenance chips, redaction/stale markers, token bar vs `maxTokens` and 32k) · `OptionSetTable` (candidate funnel) · `BundleView` | Receipt tab/page, Decisions tab               | `DecisionCard`, `ProbabilityRuler`, `JsonView`         |
| `LabelForm` (semantic answer + permitted route) · `LabelQueue`                                                                                                                                                    | Labeling                                      | `ReviewForm` patterns                                  |
| `IncidentWorkbench` (diagnostic-order stepper, boundary picker, promote to fixture)                                                                                                                               | Run incident sheet                            | `TraceTimeline`                                        |
| `ReadinessChecklist` · `HiddenDecisionInventoryTable` · `RouteChip` · `ConsequenceBadge` · `JevMetricsTiles`                                                                                                      | Publish dialog, critic, node cards, dashboard | `GateBadge`, `MetricTile`                              |

Visual rules follow `brand/IDENTITY.md`: cobalt stays the decision colour; routes reuse the gate tones (`auto` = ok, `improve` = info, `human` = warn); consequence badges `low` ink, `medium` warn, `high` danger-soft, `irreversible` danger; probabilities keep the single-hue ramp; vendor figures appear only with the "vendor-reported" label (§14.4).

---

## 18. Contract changes (RFC-0013 … RFC-0016) — exact diffs

All four are **additive** (new union members, new optional fields without defaults, new enum members), so no stored definition changes its `definitionHash` and plans without Jev nodes keep their `planHash`; `@flowaid/workflow-core` 0.3.0 → **0.4.0** when they are accepted together (J-08). They depend on RFC-0001 for the `jobs` and `maintenance` queues.

### 18.1 RFC-0013 — Jev wire types, decision events, human-request link (§7.1, §9, §11)

- **§7.1 (new)**: the schemas of §12.1 verbatim (`HashSchema`, `ContractKeySchema`, `ConsequenceClassSchema`, `JevRouteSchema`, `RolloutDispositionSchema`, `DecisionModeSchema`, `PolicyVerdictSchema`, `RouteReasonSchema`, `ContractRefSchema`, `StateReferenceSchema`, `ThresholdAppliedSchema`, `OptionSetRefSchema`, `AuthorizedActionSchema`, `PolicyRecordSchema`, `RoutingRecordSchema`, `ExecutedActionSchema`, `DecisionOverrideSchema`, `DecisionReceiptSchema`, `ReceiptRefSchema`, `ResolvedContractSchema`) and their types, placed after `DecisionResultJsonSchema`.
- **§9**: `HumanRequestSchema.origin` → `z.enum(['human_node', 'task_suspend', 'decision_failover', 'decision_route'])`; `HumanRequestSchema.receiptId: z.uuid().optional()`.
- **§11** (`RunEventSchema`):

```ts
// RUN_CREATED — additive optional field
contracts: z.record(ContractKeySchema, ResolvedContractSchema).optional(),
// DECISION_REQUESTED — additive optional fields
bundleId: z.string().optional(), stateVersion: z.string().optional(), packetHash: HashSchema.optional(),
contracts: z.record(z.string(), ContractRefSchema).optional(), mode: DecisionModeSchema.optional(),
// DECISION_COMPLETED — additive optional field
receiptId: z.uuid().optional(),

// ── decision engineering (new members) ──
z.object({ ...NodeEventBase, type: z.literal('DECISION_PACKET_BUILT'),
  bundleId: z.string(), stateVersion: z.string(), packetHash: HashSchema, snapshotId: z.string().nullable(),   // snapshotId = packetHash; null when not persisted (doNotPersist)
  snapshotKind: z.enum(['packet', 'state']),                   // state = a legacy node's verbatim DecisionState (§12.2)
  packet: JsonValueSchema,                                     // the packet as sent, redacted at write time; inline ≤ 64 KiB else { "$artifact": id } (ARCH §5.5)
  contracts: z.array(ContractRefSchema).min(1), tokens: z.int().min(0), maxTokens: z.int().min(1),
  dataClass: DataClassSchema, latencyClass: z.enum(['interactive', 'standard', 'batch']),
  fields: z.object({
    included: z.array(z.string()),
    excluded: z.array(z.object({ field: z.string(), reason: z.enum(['undeclared', 'data_class', 'empty_optional']) })),
    redacted: z.array(z.object({ field: z.string(), mode: z.enum(['mask', 'hash', 'drop']), dataClass: DataClassSchema })),
    truncated: z.array(z.object({ field: z.string(), originalChars: z.int().min(0), keptChars: z.int().min(0) })),
    stale: z.array(z.object({ field: z.string(), itemId: z.string().nullable(), ageMs: z.int().min(0) })),
  }),
  evidenceIds: z.array(z.string()), droppedEvidenceIds: z.array(z.string()),
  provenance: z.record(z.string(), z.object({ refs: z.array(z.string()), nodeRunIds: z.array(z.uuid()) })) }),
z.object({ ...NodeEventBase, type: z.literal('OPTION_SET_BUILT'), question: z.string(), optionSet: OptionSetRefSchema, snapshotId: z.string().nullable(),
  body: JsonValueSchema }),                                    // the OptionSet (§10.1), redacted at write time; inline ≤ 64 KiB else { "$artifact": id }
z.object({ ...NodeEventBase, type: z.literal('DECISION_RECEIPT'), receipt: DecisionReceiptSchema }),
z.object({ ...NodeEventBase, type: z.literal('DECISION_ROUTED'), receiptId: z.uuid(), routing: RoutingRecordSchema }),
z.object({ ...NodeEventBase, type: z.literal('DECISION_ACTION_RECORDED'), receiptId: z.uuid(), action: ExecutedActionSchema }),
z.object({ ...NodeEventBase, type: z.literal('DECISION_OVERRIDDEN'), receiptId: z.uuid(), override: DecisionOverrideSchema }),
z.object({ ...NodeEventBase, type: z.literal('SHADOW_COMPARED'), receiptId: z.uuid(), comparison: z.object({
  production: z.object({ source: z.enum(['llm', 'rule', 'code', 'human', 'jev']), nodeId: NodeIdSchema, nodeRunId: z.uuid().nullable(),
                         answer: z.string().nullable(), confidence: z.number().min(0).max(1).nullable() }),
  shadowOutcome: z.string().nullable(), agree: z.boolean().nullable(), wouldRoute: JevRouteSchema.nullable() }) }),
```

Addresses: `DECISION_PACKET_BUILT`, `OPTION_SET_BUILT`, `DECISION_RECEIPT`, `SHADOW_COMPARED` carry the evaluating node run; `DECISION_ROUTED` the router's; `DECISION_ACTION_RECORDED` the executing node run (or the router when the action is a human task it created); `DECISION_OVERRIDDEN` the reviewing human node run. Payloads stay well under the 256 KiB `run_events` check (a receipt holds at most 255 distribution entries). Consumers: `@flowaid/ui` `foldRunEvents`/`EVENT_FAMILIES`/`summarizeEvent` gain a `decision_engineering` family (P0-15 parity test); the SDK narrows the new types.

### 18.2 RFC-0014 — Jev diagnostics (§12)

`DiagnosticCodeSchema` gains the 45 codes of §13.2 in a new group `// decision engineering (Jev)`, appended after `E_INTERNAL`; the parity test pins **141** codes. Severity follows the prefix.

### 18.3 RFC-0015 — manifests, plans, compile options, node SDK (§4, §13, §16)

```ts
// §4 PortRuleSchema — new member
z.object({ kind: z.literal('contractPorts'), path: JsonPointerSchema }),   // config[path]: ContractBinding (or Record<question, ContractBinding>)
// §4 NodeManifestSchema.decision.kind — new member 'contract'
decision: z.object({ kind: z.enum(['boolean', 'choice', 'score', 'batch', 'gate', 'router', 'consensus', 'validator', 'contract']) }).optional(),

// §13 PlanNodeSchema — additive optional field
jev: z.object({
  role: z.enum(['decide', 'bundle', 'route', 'menu', 'packet', 'tool_gate', 'verify', 'relevance', 'shadow', 'review_of']),   // never on legacy nodes (§4.4 step 5)
  contracts: z.record(z.string(), z.object({ ref: ContractRefSchema, interfaceHash: HashSchema, via: z.enum(['pinned', 'deployed']), body: JsonObjectSchema })),
  bundle: z.string().nullable(),
  routes: z.object({ node: NodeIdSchema, question: z.string() }).nullable(),      // route node → the decision it routes (legacy gates: from dataIn, §6.8)
  reviewOf: z.object({ node: NodeIdSchema, question: z.string() }).nullable(),    // human node wired from a `human` port
  provenance: z.record(z.string(), z.array(z.string())),
  authority: z.record(PortNameSchema, z.object({ proofId: HashSchema, maxConsequence: ConsequenceClassSchema, reaches: z.array(NodeIdSchema) })),
}).optional(),
// §13 BatchGroupSchema — additive optional fields
packetSpecHash: HashSchema.optional(), privacyClass: DataClassSchema.optional(), latencyClass: z.enum(['interactive', 'standard', 'batch']).optional(),
// §13 CompileOptions — additive optional members
resolveContract?: (binding: { key: string; version: number | 'deployed' }) => { ref: ContractRef; interfaceHash: string; body: JsonObject; status: 'in_review' | 'approved' | 'deprecated' } | undefined;   // §4.4 step 2
providerEligibility?: Readonly<Record<string, DataClass>>;

// §16 NodeEmittable — Jev facts (capability 'decision'); DECISION_ACTION_RECORDED / DECISION_OVERRIDDEN stay runtime-only
export type JevFact = DistributiveOmit<
  Extract<DurableRunEvent, { type: 'DECISION_PACKET_BUILT' | 'OPTION_SET_BUILT' | 'DECISION_RECEIPT' | 'DECISION_ROUTED' | 'SHADOW_COMPARED' }>,
  'runId' | 'seq' | 'at' | 'nodeRunId' | 'nodeId' | 'scope' | 'attempt'>;
export type NodeEmittable = /* existing members */ | JevFact;

// §16 ExecutionContext — additive optional member (present iff the node declares capability 'decision')
readonly jev?: JevAccess;
export interface JevAccess {
  /** Run-start resolution (RUN_CREATED.contracts, §4.4 step 4) with the bodies, for a question of this node. */
  contract(question?: string): {
    via: 'deployed' | 'pinned' | 'undeployed' | 'local';
    active: { ref: ContractRef; body: JsonObject; stage: 'shadow' | 'active' | 'paused'; calibrated: boolean } | null;
    candidate: { ref: ContractRef; body: JsonObject; stage: 'shadow' | 'canary'; calibrated: boolean } | null;
    guardrails: JsonObject;
  };
  /** "<runId>:<scope>@<seq>" of the snapshot this node's inputs were resolved from. */
  stateVersion(): string;
  /** Evaluations already made in this lineage (blind-retry keys with their receipts, §6.5) and improve rounds used. */
  lineage(question: string): {
    evaluated: readonly { key: string; receiptId: string; outcome: string | null; confidence: number | null; distribution: Readonly<Record<string, number>> }[];
    improveRoundsUsed: number;
  };
  /** Deterministic rollout sample u ∈ [0, 1) (§6.7). */
  sample(question: string): number;
  /** Highest data class a provider hop may receive (workspace policy, §5.6). */
  eligibleClass(hop: ProviderHop): DataClass;
  /** Run labels used by guardrails (tenant, language). */
  labels(): Readonly<Record<string, string>>;
}
// §16 ProviderAccess — additive optional member (live model menu, §9.2)
models?(filter?: { kind?: ModelInfo['kind']; provider?: string }): Promise<(ModelInfo & { health: ProviderHealth; maxDataClass: DataClass })[]>;
```

`calibrated` (JevAccess) is the version-and-environment half of §6.4's definition, resolved at run start (true in non-protected environments and `local` runs; in protected environments only with calibration evidence for the version); RFC-0013's `ResolvedContractSchema` carries it as `active.calibrated` / `candidate.calibrated` so replays reproduce it, and the node adds the per-answer half (a `typesafe` hop, not fuzzy-mapped). `DistributiveOmit<T, K> = T extends unknown ? Omit<T, K> : never`.

### 18.4 RFC-0016 — Jev jobs (§17)

```ts
export type Job =
  /* existing members, RFC-0001 members */
  | {
      type: "jev.contract_test";
      jobId: string;
      workspaceId: string;
      contractId: string;
      version: number;
      fixtureIds: string[] | null;
      hop: ProviderHop | null;
      ablations: boolean;
      requestedBy: string;
    } // queue 'jobs'
  | {
      type: "jev.replay";
      jobId: string;
      workspaceId: string;
      contractId: string;
      version: number;
      filter: {
        from: string;
        to: string;
        environmentId: string | null;
        sourceVersion: number | null;
        labeledOnly: boolean;
        limit: number;
      };
      requestedBy: string;
    } // queue 'jobs'
  | {
      type: "jev.calibrate";
      workspaceId: string | null;
      contractId: string | null;
      windowTo: string;
    } // queue 'maintenance' (JEV_CALIBRATION_CRON, default hourly)
  | { type: "jev.rollout_check"; at: string } // queue 'maintenance' (every 5 min)
  | { type: "jev.shadow_eval"; runId: string; nodeRunId: string; question: string }; // queue 'evaluation'
```

---

## 19. Observability (J-16)

Prometheus (ARCH §10.5 list gains): `flowaid_jev_decisions_total{contract,version,route,disposition,consequence}`, `flowaid_jev_decision_latency_ms{contract}` (histogram), `flowaid_jev_confidence{contract,version}` (histogram), `flowaid_jev_near_threshold_ratio{contract,version,class}`, `flowaid_jev_escape_total{contract,escape}`, `flowaid_jev_overrides_total{contract,version}`, `flowaid_jev_blind_retry_blocked_total{contract}`, `flowaid_jev_stale_total{contract,kind}`, `flowaid_jev_packet_tokens{contract}` (histogram), `flowaid_jev_ece{contract,version,environment}`, `flowaid_jev_shadow_agreement{contract,version}`, `flowaid_jev_partial_receipts_total`, `flowaid_jev_generative_calls_removed_total{workflow}`. OTel `flowaid.node_run` spans gain `jev.contract`, `jev.route`, `jev.disposition`, `jev.state_version`. Notification events: `jev.drift_alarm`, `jev.rollback_triggered`, `jev.review_requested`, `jev.label_backlog`. Dashboard tiles: automation share, review rate, override rate, worst-contract ECE, generative calls removed, cost per completed task.

---

## 20. Delivery: track J and the handbook's playbook

### 20.1 Track J (full text in `docs/UPGRADE_PLAN.md` §6 and `docs/upgrade-plan.json` `tracks[0]`)

Track J is phase-independent: an item starts as soon as its hard dependencies are done, whichever phase they belong to; _coordinates with_ names items that touch the same files and should be sequenced with it, not waited for. _Buildable now_ means every hard dependency is on disk today (`shared`, `env`, `workflow-core` 0.3.0, `ui`). Items marked _`@flowaid/jev` only_ touch nothing but the new standalone package, which depends only on `@flowaid/workflow-core` and `@flowaid/shared` (§3.3).

| Item | Title                                                                                                    | Effort | Hard dependencies                                                                          | Coordinates with    | Buildable now                        | `@flowaid/jev` only |
| ---- | -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------ | ------------------- |
| J-01 | `@flowaid/jev` package: core schemas, contract hashing, interface, question mapping                      | M      | —                                                                                          | P0-01, P0-03        | **yes**                              | yes                 |
| J-02 | Contract lint, semantic diff, review checklist, readiness report                                         | M      | J-01                                                                                       | —                   | **yes**                              | yes                 |
| J-03 | State packets: builder, budget, report, ablation, packet lints                                           | M      | J-01                                                                                       | —                   | **yes**                              | yes                 |
| J-04 | Routing, authority and rollout engine; tool proposals; blind-retry key                                   | M      | J-01                                                                                       | —                   | **yes**                              | yes                 |
| J-05 | Calibration metrics, label sampling/adjudication, drift alarms, threshold recommendation                 | M      | J-01                                                                                       | —                   | **yes**                              | yes                 |
| J-06 | Receipts, reconstruction, replay planner, live option sets, shadow comparison, bundle planner            | L      | J-01, J-03, J-04                                                                           | —                   | **yes**                              | yes                 |
| J-07 | Failure-mode catalog, static analyzers, hidden-decision inventory, incident diagnostic order             | L      | J-01, J-02, J-03, J-04                                                                     | —                   | **yes**                              | yes                 |
| J-08 | RFC-0013…0016 applied to `CONTRACTS.ts`; workflow-core 0.4.0                                             | M      | J-01; RFC-0013, RFC-0014 and RFC-0015 accepted; RFC-0001 accepted (the RFC-0016 part only) | P0-15, P3-03, P4-04 | **yes** (once the RFCs are accepted) | no                  |
| J-09 | Compiler integration: contract resolution, Jev pass, bundles, authority proofs                           | L      | P1-01, J-02, J-03, J-04, J-07, J-08                                                        | —                   | no                                   | no                  |
| J-10 | Database: nine tables, projections, write-once receipts, RLS, retention                                  | M      | P1-02, J-08                                                                                | —                   | no                                   | no                  |
| J-11 | Providers: contract bundles, alias vs resolved model, fuzzy/uncalibrated flags, eligibility, live models | M      | P1-04, P2-02, J-06, J-08                                                                   | P6-01               | no                                   | no                  |
| J-12 | Runtime integration: resolution, `stateVersion`, `ctx.jev`, facts, legacy receipts, blind-retry guard    | L      | P2-01, J-04, J-06, J-08                                                                    | J-11                | no                                   | no                  |
| J-13 | `flowaid.jev.*` nodes, harness templates, demo upgrades                                                  | XL     | P1-03, P2-04, J-09, J-11, J-12                                                             | P0-14               | no                                   | no                  |
| J-14 | Evaluation: contract tests, fixtures, dual labels, monotonicity, Table VIII economics                    | L      | P2-07, J-03, J-05, J-06                                                                    | —                   | no                                   | no                  |
| J-15 | API and worker: contracts, receipts, labels, shadow, calibration, replay; scopes, feature key, jobs      | XL     | P3-01, P3-02, P3-03, J-08, J-10, J-14                                                      | P4-01               | no                                   | no                  |
| J-16 | Observability: TraceReviewer signals, incident review, metrics, alerts                                   | M      | P1-06, P6-04, J-05, J-07, J-10                                                             | —                   | no                                   | no                  |
| J-17 | `@flowaid/ui` `jev` component group (presentational)                                                     | L      | J-01, P1-07, P4-02                                                                         | —                   | **partly**                           | no                  |
| J-18 | Web surfaces: Decisions section, receipts, calibration, rollout, labeling, builder integration           | XL     | P5-01, P5-02, J-15, J-16, J-17                                                             | —                   | no                                   | no                  |
| J-19 | Advisor: critic, builder and optimizer rules                                                             | M      | P6-02, J-07, J-09, J-14                                                                    | —                   | no                                   | no                  |
| J-20 | Agent pre-tool gate, retrieval relevance, live model menus                                               | L      | P6-01, P6-09, P6-10, J-13                                                                  | —                   | no                                   | no                  |
| J-21 | Rollout controller and rollback                                                                          | M      | J-12, J-15, J-16                                                                           | —                   | no                                   | no                  |
| J-22 | Docs, contract examples, first-integration playbook, `flowaid decisions lint`                            | M      | P4-01, P6-05, J-15                                                                         | —                   | no                                   | no                  |

Longest dependency chain inside the track: J-01 → J-02, J-03, J-04 → J-07 → J-09 (after P1-01, J-08) → J-13 (after P1-03, P2-04, J-11, J-12) → J-20 (after P6-01, P6-09, P6-10); J-06 and J-08 feed J-11 and J-12 on a parallel branch, and the surfaces J-15 → J-18 follow the services and the web app (P3, P5). The seven standalone items J-01…J-07 (≈ 6 engineer-weeks) can land before any platform package they will plug into exists; J-09…J-16 then wire them in as the P1–P3 items complete, and J-17…J-22 follow the web app and the P6 advisor, agent and knowledge items.

### 20.2 The ten-step sequence (§XI.A) in flowaid

| Step                                                                        | flowaid mechanism                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Map the loop and mark every hidden choice, score, yes/no, retry and stop | Critic **Map hidden decisions** (§14.1)                                                         |
| 2. Creation in the LLM, invariants in code                                  | Boundary lints: `W_JEV_GENERATION_FOR_DECISION`, `W_JEV_EXACT_RULE`, `W_JEV_FREE_VALUE` (§13.2) |
| 3. One repeated, low-consequence branch first                               | `firstContractScore` and the inventory's single proposal                                        |
| 4. Define the contract                                                      | Registry draft in `ContractEditor`, review (§4.6)                                               |
| 5. Compact evidence packets                                                 | `StateSpec` + packet builder (§5)                                                               |
| 6. Batch independent questions against one snapshot                         | Bundles (§8)                                                                                    |
| 7. Route into automate, improve-state, human                                | `flowaid.jev.decide` / `route` (§6)                                                             |
| 8. Shadow mode and calibration                                              | `flowaid.jev.shadow` or a shadow candidate; calibration snapshots (§7, §11)                     |
| 9. Automate the safest branch; keep rollback                                | Canary with `guardrails.outcomes`, rollback triggers, one-step rollback (§11.3)                 |
| 10. Expand one boundary at a time; watch completed-task economics           | Critic expansion order (§14.2); Table VIII dashboards and rollout report (§11.4, §14.5)         |

---

## Appendix A. Numbers: handbook, API, flowaid defaults

| Value                                                                                                                                              | Origin                                                                                                | Where used                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 70–500 ms latency; $0.042 per million input tokens, output free; 20–200× speed, 40–400× cost                                                       | Vendor-reported (Abstract, §I.C, Source [2]; `TYPESAFE_API.md` pricing) — workload-dependent ceilings | Shown only with the vendor label (§14.4); cost math uses the catalog price |
| 64k tokens per request; 32k state + longest question; ~1 200 rpm; ≤ 255 choice options; 2–10 score levels                                          | `TYPESAFE_API.md` (live API)                                                                          | §5.4, §8.2, §10                                                            |
| `jev-latest` → `jev-1.13.0`                                                                                                                        | `TYPESAFE_API.md`                                                                                     | `model.expectResolved` example                                             |
| Table V zones (low ≥ 0.90 auto, 0.70–0.89 evidence/check, < 0.70 human, irreversible human)                                                        | Handbook, _illustrative_                                                                              | §6.3 illustrative defaults only                                            |
| Prefer 3–5 rubric levels                                                                                                                           | Handbook §II.G (a preference)                                                                         | `W_JEV_RUBRIC_LEVELS` warning                                              |
| `stateSpec.maxTokens` 8 000 default, 30 000 max                                                                                                    | flowaid                                                                                               | §5.4                                                                       |
| chars / 3.5 token estimate                                                                                                                         | flowaid (ARCH §6.3 guard)                                                                             | §5.3, §8.2                                                                 |
| Option-set `maxOptions` 50, `maxAgeMs` 60 000                                                                                                      | flowaid                                                                                               | §4.2, §10                                                                  |
| Improve `maxRounds` 2                                                                                                                              | flowaid                                                                                               | §4.2                                                                       |
| Illustrative medium zone (`improveAt` 0.70, no auto), high (human)                                                                                 | flowaid reading of Table V and §V.A                                                                   | §6.3                                                                       |
| Reliability bins 10 (equal width), ACE 10 equal-mass, MCE min 10 labels per bin, PSI ε 1e-4, monotonicity tolerance 0.02, near-threshold band 0.03 | flowaid (the handbook names no bin count, no ECE)                                                     | §7.2                                                                       |
| Label sampling rates (0.02 base; 0.25 near-threshold; 0.5 rare/high/disagreement; 0.2 escape/new version; 0.05 auto)                               | flowaid                                                                                               | §7.1                                                                       |
| Drift alarm thresholds (§7.5 table)                                                                                                                | flowaid                                                                                               | §7.5                                                                       |
| Recommendation targets 0.95 / 0.98 / 0.995; `n_min` 100 / 200 / 400; ECE ≤ 0.05; near-threshold ≤ 15 %                                             | flowaid                                                                                               | §7.6                                                                       |
| Promotion: ≥ 200 labeled shadow decisions per automated outcome, ECE ≤ 0.05, first canary ≤ 5 %, steps 0.05 → 0.25 → 1.0, ≥ 7 days at 1.0          | flowaid (the handbook gives no shadow duration, sample size or traffic shares)                        | §11.4                                                                      |
| Rollback trigger example `override_rate > 5 %` over 24 h, ≥ 100 samples                                                                            | flowaid example                                                                                       | §4.7                                                                       |
| Review sample rate 0.05 of automated cases                                                                                                         | flowaid                                                                                               | §11.3                                                                      |
| Shadow node timeout 5 s, `onError: 'ignore'`                                                                                                       | flowaid                                                                                               | §11.1                                                                      |
| Replay limit 2 000 receipts                                                                                                                        | flowaid                                                                                               | §12.4                                                                      |
| Calibration evidence in protected environments: a `shadow_baseline` snapshot or ≥ 50 labeled decisions                                             | flowaid                                                                                               | §6.4                                                                       |
| Rollout sample `u`: 52 bits of `sha256Hex`                                                                                                         | flowaid                                                                                               | §6.7                                                                       |
| Built-in template deployments: default guardrails and `override_rate > 0.05` over 24 h, non-protected environments only                            | flowaid                                                                                               | §9.8                                                                       |
| Heuristic lint thresholds (Jaccard ≥ 0.8, < 4 words, < 8 words)                                                                                    | flowaid                                                                                               | §13.2                                                                      |
| Calibration cron hourly; rollout check every 5 min                                                                                                 | flowaid                                                                                               | §7.4, §11.3                                                                |

## Appendix B. Traceability: handbook section → addendum

| Handbook                                       | Addendum                                       |
| ---------------------------------------------- | ---------------------------------------------- |
| Abstract, Fig. 1, §I.A–§I.F                    | §0, §1, §2.2 (§I rows), §14.4                  |
| §I.G Inventory / Boundary Test, Table I        | §1.1, §14.1                                    |
| §II.A–§II.G, Table II                          | §4.2, §4.5, §6.2, §13                          |
| §III.A–§III.C                                  | §4.1–§4.4                                      |
| §III.D Review the Contract Like Code           | §4.6                                           |
| §III.D The Decision Receipt, Table III, §III.G | §12                                            |
| §III.E Lifecycle                               | §1.2, §6, §9.1                                 |
| §III.F Testing Contracts                       | §4.6, §14.5                                    |
| §IV, Table IV                                  | §5                                             |
| §V.A–§V.B, Table V                             | §6.1–§6.5                                      |
| §V.C Threshold Governance                      | §4.2 (`ThresholdGovernanceSchema`), §6.3, §7.6 |
| §V.C Calibration, Fig. 2, §V.D, §V.F           | §7                                             |
| §V.E                                           | §6.4, §6.6                                     |
| §VI.A–§VI.H                                    | §8, §12.3                                      |
| §VII.A–§VII.G, Table VI                        | §9                                             |
| §VIII.A–§VIII.H, Table VII                     | §10, §9.6–§9.7                                 |
| §IX.A–§IX.C                                    | §14.1, §14.5, §4.4                             |
| §IX.D                                          | §11.1–§11.2                                    |
| §IX.E Labels and Adjudication                  | §7.1                                           |
| §IX.E Evaluate the Whole System, Table VIII    | §14.5                                          |
| §IX.F–§IX.I                                    | §11.3–§11.4, §7.5                              |
| §X.A–§X.L                                      | §13.1 rows 1–12                                |
| §X.M Table IX, §X.I Distinguish, §X.O          | §13.3                                          |
| §X.N Safe Operating Order                      | §1.2, §6.6, §12.1                              |
| §XI.A, §XI.B–C, suggested prompt               | §20.2, §14.2, §14.1                            |
