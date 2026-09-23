# Jev Engineering: Expert Guide for the FlowAId Team

A complete study guide to *Jev Engineering for Production Agents: A Practical Handbook on Typed Semantic Decisions* (2026 Working Handbook on Jev Engineering Practice, September 2026; "Independent study edition. Not affiliated with or endorsed by TypeSafe AI."; companion to Rari, *Jev Engineering: Stop Using LLMs for Every Decision*).

- Source text: `docs/research/jev/jev-engineering-for-production-agents.txt`
- Source PDF (figures and tables): `docs/research/jev/jev-engineering-for-production-agents.pdf` (12 pages)
- Verified live API: `docs/design/TYPESAFE_API.md`
- Handbook index terms (verbatim): "Jev, TypeSafe AI, system one model, decision contract, typed judgment, calibration, confidence routing, agent harness, shadow mode, semantic verification, Choice, Score, Noul."
- FlowAId design: `docs/design/` (ARCHITECTURE.md, CONTRACTS.ts, UI.md, API.md, DATABASE.md, RFCS.md), `docs/UPGRADE_PLAN.md`

## How to read this guide

- Every claim is cited to a handbook section as `§<Roman>.<Letter> <Title>`. Ten sections of the handbook (§I to §X) each print one subsection letter twice (see §15 item 1 of this guide). Where that happens the citation includes the title, for example `§III.D Review the Contract Like Code` versus `§III.D The Decision Receipt`.
- Direct quotations are verbatim from the handbook. Anything marked **FlowAId note** or **Interpretation** is this guide's inference and is not in the handbook.
- The handbook is typeset in two columns. The raw `.txt` extraction interleaves the columns. Reading order in this guide follows the PDF: left column top to bottom, then right column.
- Some tables in this guide synthesize material from several handbook sections. Where they do, the table says so, and any wording not quoted from the handbook is paraphrase or is marked **Interpretation**.
- Code sketches in the handbook are pseudocode. The live API field names differ (see §1.6).

## Contents

1. The core model and the decision-layer thesis
2. Concept catalog: definitions and supporting quotes
3. Decision primitives in depth (Choice, Score, Noul, Table II)
4. The decision contract specification
5. State packets and evidence
6. Confidence, consequence and calibration
7. Parallel questions and state boundaries
8. Harness insertion points
9. Live menus and retrieval
10. Evaluation, shadow mode and production rollout
11. Failure modes and corrections
12. The implementation playbook and launch checklist
13. Numeric claims and their caveats
14. Glossary
15. Open questions and ambiguities in the source
16. Appendix: what this means for FlowAId

---

## 1. The core model and the decision-layer thesis

### 1.1 Fig. 1: three responsibilities over one state

The handbook's cover figure (PDF p.1) is four boxes connected left to right:

```
STATE              LLM               JEV                CODE
facts + evidence   creates work      typed judgment     enforces policy
```

Caption: *"Fig. 1. Generation, semantic judgment, and authority are separate responsibilities."*

The figure is drawn as a pipeline, but the text never requires every flow to pass through the LLM before Jev. Jev can sit before the model (task routing), before a tool, after a tool, or around retrieval (§VII). Read the arrows as a separation of duties, not as a mandatory execution order. The execution order the handbook does mandate is the **safe order** (§1.4).

The conclusion restates the figure as a division of labor:

> "The LLM turns context into new work. Jev turns state into typed judgment. Code turns judgment into controlled action." (§XI.D Conclusion)

### 1.2 What Jev is

> "Jev is a decision model, not a conversational model. It receives structured state together with typed questions and returns constrained answers plus probability distributions." (Abstract)

- TypeSafe describes Jev as "a system one model trained with Reinforcement Learning for Calibrated Decisions. The objective is decision quality together with useful uncertainty, not attractive prose." (§I.C Latency, Cost, and Integration)
- It has three primitives: **Choice** (one winner from a declared menu), **Score** (a position on an ordered verbal rubric) and **Noul** (a yes-or-no probability) (§II).
- It does not author artifacts: "Jev does not draft the email, write the report, or produce the code patch. It can decide which queue should receive the email, whether the report has enough evidence, or whether the proposed patch should be reviewed before execution." (§I.B A Different Primitive)

### 1.3 The decision-layer thesis

1. **The expensive assumption.** "Most agent stacks assume that every intelligent judgment deserves another generative call." Internally such an agent is "a large collection of small branches implemented as prose generation." (§I.A The Expensive Assumption)
2. **The cost is hidden.** It "appears as sequential latency, repeated context, JSON repair, schema retries, and recovery after a weak branch. One additional call may be acceptable. Twenty dependent calls can dominate the workflow even when the visible artifact is short." (§I.A)
3. **A different primitive.** "Jev changes the primitive from text generation to typed semantic judgment." Software "does not need to recover a decision from prose, infer a confidence score from tone, or hope that an ad hoc JSON schema survives generation." "This restriction is the point." (§I.B)
4. **Three owners.** "The generative LLM creates open-ended artifacts. Jev interprets ambiguous meaning when the answer shape is known. Deterministic code enforces exact invariants. Mixing the three collapses distinct failure modes into one opaque model call." (§I.D Three Owners Inside the Agent)
5. **Authority stays outside the model.** "A confidence score is an operating signal, not permission." (§I.E Authority Remains Outside the Model)
6. **The objective is boundary design, not Jev usage.** "The objective is not to replace the LLM. It is to stop using generation where generation is unnecessary... Every removed prose call makes the graph smaller, the schema simpler, and the decision easier to evaluate. Jev engineering is therefore boundary design: deciding where language creates value, where typed judgment resolves ambiguity, and where code must remain non-negotiable." (§I.F The Engineering Objective). And: "The goal is not to maximize Jev usage. The goal is to remove generative calls from decisions that never required a sentence." (Abstract)
7. **Speed and price enable the pattern but do not replace design.** The reported latency and price "make high-frequency semantic branching plausible." But "Those service characteristics do not eliminate system design. A cheap decision that selects the wrong worker can create more downstream cost than an expensive correct decision. A fast verifier that passes incomplete work can add latency later. The unit of analysis is therefore the completed task, not the isolated call." (§I.C)
8. **The central engineering unit is the decision contract**, "a versioned specification of state, instructions, declared outcomes, fallbacks, thresholds, allowed actions, and escalation behavior. A contract turns a hidden judgment into production logic that can be evaluated, logged, reviewed, and rolled back." (Abstract)
9. **The deepest gain is structural.** "The deepest improvement is not a single latency or cost number. It is the conversion of hidden judgments into versioned, testable components with evidence, thresholds, fallbacks, receipts, and rollback. That is the difference between adding another model call and engineering an agent." (§XI.D Conclusion)

### 1.4 The safe operating order

> "The safe order is stable across integrations: Jev judges; code checks policy; the tool executes; the trace records. Reversing that order turns probabilistic judgment into unbounded authority. The classifier then contains the policy, and application code merely obeys it. That design is difficult to audit and unsafe to extend." (§I.E)

The handbook repeats this in §X.N Safe Operating Order: "A production architecture should make each boundary visible in code and in the decision receipt." It then adds a five-layer framing:

> "The model provides a new primitive. The graph decides where it sits. The loop decides what happens after uncertainty. The harness decides what the system is allowed to do. The trace tells the team whether the architecture worked." (§X.N)

The distinction "matters most for publishing, purchasing, deletion, account access, permission changes, database writes, money movement, and representation of the user." (§I.E)

### 1.5 Ownership table (Table I) and the boundary test

**Table I** (§I.D, PDF p.2). Caption: *"Workload ownership follows output shape and authority, not model capability alone."*

| Question | Owner | Reason |
|---|---|---|
| Draft a research summary | LLM | The output itself must be created |
| Choose the next worker | Jev | Meaning is fuzzy; the menu is known |
| Rate evidence quality | Jev | The rubric is ordered and semantic |
| Stop after three attempts | Code | The rule is exact |
| Approve a payment | Code + human | The side effect is consequential |
| Verify a report | Jev + code | A rubric and artifact checks are both needed |

**Operational boundary test** (§I.G An Operational Boundary Test):

1. "Must the output itself be authored? If yes, use a generative model."
2. "Is the meaning ambiguous while the answer shape is already known? If yes, use Jev."
3. "Must the condition be obeyed exactly? If yes, use code."
4. "Branches that appear to need all three should be decomposed into generation, judgment, and enforcement steps."

Decomposition gives **failure attribution**: "A failure can then be assigned to artifact creation, semantic judgment, or policy enforcement rather than attributed vaguely to the agent." (§I.G An Operational Boundary Test)

**Hidden-decision inventory** (§I.G Inventory the Hidden Decisions): "Before integrating Jev, write down every semantic branch already present in the agent: request clarity, worker selection, model selection, retrieval survival, tool risk, completion, retry, escalation, and stop. Record which component makes each branch today and whether the branch creates language, interprets meaning, or enforces an exact rule." The inventory "exposes decisions that were previously buried inside prompts" and "prevents indiscriminate migration... Only the remaining semantic branches are Jev candidates."

### 1.6 Mapping handbook pseudocode to the live API

| Handbook | Live API (`TYPESAFE_API.md`) | FlowAId (`CONTRACTS.ts`) |
|---|---|---|
| `Choice(instructions, criteria={key: desc})` | `{"type":"choice","instructions","criteria":{key:desc}}`, criteria required, at most 255 options. Response has `choice`, `confidence`, `probabilities` | `kind: 'choice'`, `options: Record<string,string>` |
| `Score(criteria=[...])` | `{"type":"score","instructions","criteria":[...]}`, 2 to 10 ordered levels. Response has fractional `score` in [0, levels-1], `confidence`, `legend`, `probabilities` | `kind: 'score'`, `levels: string[]` (2..10) |
| `Noul(instructions)` | `{"type":"noul","instructions","criteria"?:{true,false}}`. Response is `noul` = P(yes), **no separate confidence** | `kind: 'boolean'`, `pYes`, `value`, `confidence` derived |
| `system_one(state, questions={...})` | `POST /v1/systemone` with `state` + `questions` map. This is the native batching mechanism | `flowaid.decision.batch` and compiler batch groups |

The handbook's Score sketch omits `instructions`. The live API and FlowAId both require it (§II.B Score; TYPESAFE_API.md).

---

## 2. Concept catalog: definitions and supporting quotes

Grouped by handbook section. Sections 3 to 11 of this guide give the operating rules. This section defines the terms.

### 2.1 Why a decision layer (§I)

| Concept | Definition | Supporting quote |
|---|---|---|
| Decision model | Takes structured state plus typed questions and returns constrained answers with probability distributions. It does not converse or author. | "Jev is a decision model, not a conversational model." (Abstract) |
| Expensive assumption | Routing every judgment through another generative call to the same frontier model. | "Most agent stacks assume that every intelligent judgment deserves another generative call." (§I.A) |
| Hidden branch cost | Cost of prose-implemented branches that shows up outside the visible answer. | "It appears as sequential latency, repeated context, JSON repair, schema retries, and recovery after a weak branch." (§I.A) |
| Typed semantic judgment | The primitive that replaces text generation for decisions: declared answer types plus distributions. | "Jev changes the primitive from text generation to typed semantic judgment." (§I.B) |
| Restriction is the point | Jev decides about artifacts and never produces them, which makes outputs composable with program logic. | "Constrained outputs make those decisions composable with ordinary program logic." (§I.B) |
| System one model / RLCD | TypeSafe's description of Jev: trained with Reinforcement Learning for Calibrated Decisions. | "The objective is decision quality together with useful uncertainty, not attractive prose." (§I.C) |
| Completed task as unit | Evaluate the whole task, because cheap wrong decisions cost more downstream. | "The unit of analysis is therefore the completed task, not the isolated call." (§I.C) |
| Hidden-decision inventory | A list of every semantic branch, its current owner and its class (creates language / interprets meaning / enforces exact rule). | "Only the remaining semantic branches are Jev candidates." (§I.G Inventory) |
| Three owners | LLM for open-ended artifacts, Jev for ambiguous meaning with a known answer shape, code for exact invariants. | "Mixing the three collapses distinct failure modes into one opaque model call." (§I.D) |
| Authority outside the model | Confidence informs; a deterministic policy engine permits. | "A confidence score is an operating signal, not permission." (§I.E) |
| Safe order | Judge, check policy, execute, record. | "Jev judges; code checks policy; the tool executes; the trace records." (§I.E) |
| Boundary design | The engineering objective of placing language, judgment and code correctly. | "Jev engineering is therefore boundary design" (§I.F) |
| Failure attribution | Assigning a failure to artifact creation, semantic judgment or policy enforcement. | "rather than attributed vaguely to the agent." (§I.G Boundary Test) |

### 2.2 Decision primitives (§II)

| Concept | Definition | Supporting quote |
|---|---|---|
| Choice | Exactly one declared option wins. The design work is in the option descriptions (criteria). Not for inventing undeclared identifiers, URLs, numbers or names (§3.1). | "Choice applies when exactly one declared option should win. The important design work is not the option label but the option description." (§II.A) |
| Escape hatch | A none / other / stop / escalate (elsewhere: review) outcome that absorbs probability mass when reality is not on the menu. | "Without none, other, stop, or escalate, probability mass is forced onto the least-wrong option. The result remains type-valid but can be operationally false." (§II.A) |
| Score | A position on an ordered semantic rubric whose levels are verbal descriptions. | "Score applies when the decision lives on an ordered semantic rubric. The levels should be verbal descriptions, not vague numbers." (§II.B) |
| Ordinal interpolation | A fractional score is a position between two descriptions. It is not a percentage, a ratio, or comparable across contracts. | "A value of 1.6 is a position between two descriptions. It is not automatically 80 percent good, 1.6 times better, or equivalent across different contracts." (§II.B) |
| Noul | A yes-or-no probability. Near 0.5 means the evidence does not separate yes from no. Used for completion checks, approval likelihood, evidence sufficiency, request ambiguity and external side effects. The application sets the probability bands. | "It does not mean medium severity or partial permission. Ordered risk categories belong in Score." (§II.C) |
| Selection discipline | The primitive is chosen from the declared answer shape (Table II, reproduced in §3.4). Unknown free strings and exact arithmetic are "Not Jev". | "Table II. Primitive selection begins with the declared answer shape." (§II.D) |
| Type safety is not truth | Type validity removes parsing failures but does not make an answer correct. Wrong evidence, stale options, ambiguous criteria or an incomplete menu produce type-valid wrong answers (§3.5). | "Type safety removes parsing and schema failures. It does not remove the need to test the meaning of the decision." (§II.E) |
| Primitive composition | Several primitives may be asked in one call over the same snapshot. Dependent questions may not be chained in one call. | "The primitives may be asked together when they inspect the same snapshot." (§II.F) |
| Rubric design | Levels describe observable evidence differences and have meaningful boundaries between neighbors. Prefer three to five well-separated levels, because more levels reduce inter-rater agreement. If reviewers cannot place examples consistently, the rubric is unusable (§3.7). | "Rubric levels should describe observable differences in evidence, not emotional intensity." (§II.G Rubric Design) |
| Primitive anti-patterns | Primitive/semantics mismatches that produce plausible but misread numbers. | "Each mismatch can produce plausible numbers that the application reads with the wrong semantics." (§II.G Primitive Anti-Patterns) |
| Question decomposition | Split a question that fits no single primitive. | "A risk workflow might use Noul to detect the presence of an external side effect, Score to rate consequence, and Choice to select the permitted route." (§II.G Primitive Anti-Patterns) |

### 2.3 Decision contracts (§III)

| Concept | Definition | Supporting quote |
|---|---|---|
| Decision contract | The production form of a Jev question: visible state, meaning of instructions, outcomes, escape path, confidence interpretation, allowed follow-on action, version. | "A production Jev question is a decision contract." (§III.A) |
| Question as program | Question text and criteria are program logic. | "Treating the question as casual prompting discards the main advantage of typed judgment." (§III.A) |
| Identifiers are not instructions | A field name conveys nothing to the model. The operational definition must be in instructions/criteria. | "Internal identifiers are not instructions. A field named safe_to_publish helps application code but does not teach the model what safe means." (§III.A) |
| Allowed action | Contract field capping the authority a judgment may lead to. The harness enforces it. | "It prevents a classification result from silently expanding into authority." (§III.B) |
| Contract versioning | Contracts are versioned separately from application code. | "Version the decision contract separately so that changes can be reviewed, evaluated against historical examples, deployed gradually, and rolled back." (§III.C) |
| Decision receipt | Per-decision record linking judgment to state and policy at that moment. | "Every production decision should produce a receipt." (§III.D The Decision Receipt) |
| Contract lifecycle | Define, evaluate on one immutable snapshot, route through consequence-aware thresholds and deterministic policy, record. | "No stage should be hidden inside another." (§III.E) |
| Evaluation separate from routing | One distribution can feed several authority policies. | "The semantic judgment is reusable; the authority policy remains context-specific." (§III.E) |
| Confidence monotonicity | Confidence should rise and fall with evidence quality. | "whether confidence changes monotonically with evidence quality" (§III.F) |
| Counterfactual replay | Re-running a new contract version on historical snapshots without side effects. | "A new contract version can be replayed against historical state snapshots without repeating the original side effects." (§III.G) |
| Faulty boundary localization | Receipts let a team find which link failed. | "Without those links, teams can observe the failure but cannot locate the faulty boundary." (§III.G) |

### 2.4 State (§IV)

| Concept | Definition | Supporting quote |
|---|---|---|
| State engineering | Deliberate construction of the decision input. | "Jev can only judge the state it receives." (§IV.A) |
| Type-valid, context-invalid | A well-typed answer resting on stale or misleading context. | "The output may still satisfy the declared type while the underlying judgment is based on stale or misleading context." (§IV.A) |
| State packet | Compact, current, evidence-based input with separated functional fields. | "A state packet should be compact, current, and evidence-based." (§IV.A) |
| Inherited confidence | A prior conclusion passed as a fact. | "'The research is probably enough' asks Jev to trust an earlier judgment." (§IV.B) |
| Least privilege | Only contract-required fields reach the model. | "The decision model receives only fields required for the contract." (§IV.C State Access Control) |
| Projection | A contract-specific view of the same run state. | "Different decision families may receive different projections of the same underlying state." (§IV.C A Compact State Packet) |
| Invalidation condition | Every option set can go stale. | "Every option set has an invalidation condition." (§IV.D) |
| Invalid graph | Deciding over stale state is categorically wrong, not merely weak. | "A decision over stale state is not merely a weak inference; it is an inference over an invalid graph." (§IV.D) |
| Minimization as relevance | Code pre-filters and Jev resolves what remains. | "Minimization is not aggressive deletion. It is a declaration of relevance." (§IV.E) |
| State ablation testing | Remove, corrupt and stale fields to find what drives the branch. | "State tests should remove, corrupt, and stale individual fields to measure which evidence actually drives the branch." (§IV.F) |
| Decision fixture | Common and edge-case state versions with expected route and short human rationale. | "The fixture should include the expected route and a short human rationale, not a chain-of-thought trace." (§IV.F) |

### 2.5 Confidence and calibration (§V)

| Concept | Definition | Supporting quote |
|---|---|---|
| Confidence as routing signal | The distribution changes what the harness does next. | "The distribution should change what the harness does next." (§V.A) |
| Three operating zones | Automate / improve state / escalate. | "A useful policy has three operating zones." (§V.A) |
| Consequence class | The stakes class of the authorized action; thresholds are keyed to it. | "Thresholds belong to the consequence class, not only to the output type." (§V.A) |
| Improving the state | The medium zone must name an action that changes evidence or options. | "Confidence without a different next action is decoration." (§V.B) |
| False reassurance | Re-asking on unchanged evidence looks like consensus. | "The retry budget should purchase information, not merely another sample from the same uncertainty." (§V.B) |
| Threshold governance | Thresholds are owned, justified, windowed, classed and reversible configuration. | "Thresholds are production configuration." (§V.C Threshold Governance) |
| Near-threshold mass | Share of traffic just above a boundary. | "A large mass just above an automation boundary makes the system sensitive to small calibration drift." (§V.C Threshold Governance) |
| Calibration | Whether predicted probability matches observed frequency on the target workload. | "Automation depends on whether higher confidence actually identifies safer cases." (§V.C Calibration) |
| Reliability diagram | Confidence bins versus observed correctness, compared to the diagonal. | "a curve below it indicates overconfidence, and a curve above it indicates underconfidence." (§V.C Calibration) |
| Brier score | Squared error between probability and binary outcome, for Noul. | "For binary Noul decisions, the Brier score measures squared error between probability and outcome." (§V.D) |
| Top-label / classwise calibration | Calibration of the winner / of each option, for Choice. | "can expose rare options that are systematically over- or under-confident." (§V.D) |
| Confidence is not authority | Calibration measures; it does not permit. | "Calibration makes automation measurable; it does not transfer authority to the model." (§V.E) |
| Calibration rollout | Shadow estimate, post-automation recheck, recompute after changes. | "Confidence is conditional on the workload" (§V.F) |

### 2.6 Parallel decisions (§VI)

| Concept | Definition | Supporting quote |
|---|---|---|
| One snapshot, many questions | Several typed questions over one state in one request. | "Jev can evaluate multiple typed questions against the same state in one request." (§VI.A) |
| Independence boundary | A question cannot consume another's fresh answer in the same evaluation. | "Parallel does not mean dependent." (§VI.B) |
| Snapshot discipline | Version or hash each batch; fence or record writes; record per-question evidence scope. | "Every batch should carry a state version or content hash." (§VI.C) |
| Semantic transaction boundary | A batch fixes one version of reality. | "Batching is not merely an optimization. It provides a semantic transaction boundary." (§VI.C) |
| Latency and privacy class | Batching constraint so sensitive questions do not inherit cheap routes. | "Batch only questions that belong to the same latency and privacy class." (§VI.D Batching Economics) |
| Dependent sequence | STATE vN, decide, act, STATE vN+1, each evidence-creating arrow traced. | "Each arrow that creates evidence must be visible in the trace." (§VI.E) |
| Decision vs execution parallelism | Evaluate together, then serialize or lock actions. | "The harness should separate decision parallelism from execution parallelism." (§VI.F) |
| Partially observable decision | Any non-reconstructable trace link. | "That gap should be treated as an operational defect even when no user-visible error occurred." (§VI.H) |

### 2.7 Harness placement (§VII)

| Concept | Definition | Supporting quote |
|---|---|---|
| Insertion point | A place in the loop for a Jev judgment paired with code authority (Table VI). | "Jev sits at semantic transitions; authority remains deterministic." (Table VI caption) |
| Stale menu is an invalid graph | Routing over an outdated catalog is structural, not inferential. | "Routing over a stale menu is an invalid graph, not a weak inference." (§VII.A) |
| Classifier is not policy | Jev risk output cannot override hard constraints. | "A low-risk prediction cannot override an allowlist, a repository boundary, an account permission, or a requirement for human confirmation." (§VII.B) |
| Goal verification | Transport success is not goal achievement. | "A successful HTTP response or zero exit code proves that an operation completed, not that the user's goal was achieved." (§VII.C) |
| Normalized tool proposal | Operation, target, destination, data class, reversibility, external side effects. | "Jev interprets meaning; policy checks scope and authority against explicit fields." (§VII.D Tool Semantics) |
| Builder and verifier | Share an artifact and a rubric. | "The builder and verifier should share an artifact and a rubric, not a vague feeling of completion." (§VII.D Builder and Verifier) |
| Placement discipline | A node must earn its place. | "The quality of the graph matters more than the number of Jev calls." (§VII.F) |
| Security-aware routing | Code decides the eligible set; Jev chooses within it. | "Jev may resolve semantic fit within the allowed set, but deterministic policy decides which set is allowed to exist." (§VII.G) |

### 2.8 Live menus and retrieval (§VIII)

| Concept | Definition | Supporting quote |
|---|---|---|
| Menus are runtime state | Available actions change continuously. | "A decision model must choose from what exists now." (§VIII.A) |
| Menu builder | The component that constructs the option set; tested separately. | "Test the menu builder separately from the semantic choice." (§VIII.D Option-Set Tests) |
| Three-stage reduction | Deterministic exclusion, shortlist, Jev. | "Deterministic code removes impossible candidates. Retrieval or embeddings create a shortlist. Jev resolves the remaining ambiguity." (§VIII.B) |
| Option validity | Belongs to current state. | "Option validity is a property of current state, not the model." (Table VII caption) |
| Relevance contract | Items survive for evidentiary contribution, not topicality. | "A retrieval item should survive because it contributes evidence to a declared question, not merely because it is topically close." (§VIII.E) |
| Distinguishing descriptions | Criteria state evidence conditions, not praise. | "Descriptions must distinguish options rather than praise them." (§VIII.F) |
| Stop as an action | A declared, auditable outcome. | "Stop is not a failure; it is a declared outcome with criteria that can be evaluated and audited." (§VIII.G) |
| Option-set version | Recorded in the receipt to separate inference from invalidation failure. | "The decision receipt should identify the option-set version." (§VIII.H) |

### 2.9 Evaluation and rollout (§IX)

| Concept | Definition | Supporting quote |
|---|---|---|
| Begin with one decision | High-volume, low-consequence, later-labelable. | "Select one high-volume, low-consequence semantic decision whose correct answer can be labeled later." (§IX.A) |
| Define before integrating | Contract fields agreed before any model call. | "If the team cannot agree on those fields, the branch is not ready for automation." (§IX.B) |
| Representative set | Real distribution plus hard counterexamples. | "A polished demo set cannot reveal whether confidence is useful." (§IX.C) |
| Shadow mode | Jev evaluates but does not act; production stays authoritative. | "In shadow mode the existing production path remains authoritative. Jev evaluates the same decision but does not act." (§IX.D) |
| Adjudication | Written rubric, adjudication path, preserved disagreement. | "Preserve disagreement instead of forcing premature consensus" (§IX.E Labels and Adjudication) |
| Dual labeling | Label semantic answer and permitted route. | "This distinguishes a correct judgment from an unsafe automation policy." (§IX.E Labels and Adjudication) |
| Whole-system evaluation | Cost and reliability per completed task. | "The business objective is cost and reliability per completed task." (§IX.E Evaluate the Whole System) |
| Semantic drift | Changing users, tools, options, language. | "Treat semantic drift like software drift: inspect, test, version, and roll back." (§IX.H) |
| Downstream economics | Cheap calls still need justification. | "A small graph with high-quality boundaries is better than a dense graph of low-value classifiers." (§IX.H) |
| Rollout guardrails | Deterministic limits independent of Jev confidence. | "Guardrails should be deterministic and independent of Jev confidence." (§IX.I) |

### 2.10 Failures and conclusion (§X, §XI)

| Concept | Definition | Supporting quote |
|---|---|---|
| Harness-origin defects | Many apparent model errors come from state, menus, thresholds or policy placement. | "Many apparent model defects originate elsewhere in the harness." (Table IX caption) |
| Diagnostic order | Evidence, option set, instructions, threshold mapping, then model. | "Only after those checks should the defect be assigned to model capability." (§X.I Distinguish Model and Contract Error) |
| Earliest incorrect boundary | Incident reviews locate the first wrong link. | "It should identify the earliest incorrect boundary rather than the final visible failure." (§X.O) |
| Missing layer | Jev sits beside the LLM, not in place of it. | "Jev is not a replacement for the generative model. It is a missing layer beside it." (§XI.D) |

---

## 3. Decision primitives in depth (§II)

This section reproduces the handbook's primitive chapter (§II, PDF p.3) in full, because it is where the handbook says which answer shapes belong to Jev and which do not. Section 2.2 gives one-line definitions. This section gives the operating detail.

### 3.1 Choice (§II.A)

> "Choice applies when exactly one declared option should win. The important design work is not the option label but the option description. Each criterion must tell the model what evidence distinguishes that outcome from its neighbors. Labels such as research, write, and review are convenient for code; the descriptions make them meaningful." (§II.A)

**Escape hatch.** "Closed menus need an escape hatch whenever reality may contain an unlisted state. Without none, other, stop, or escalate, probability mass is forced onto the least-wrong option. The result remains type-valid but can be operationally false. An escape outcome preserves uncertainty and gives the harness a safe route." (§II.A)

The handbook's example, verbatim. Note the `none` escape option:

```python
Choice(
  instructions='Which worker should act next?',
  criteria={
    'research': 'important evidence is missing',
    'write': 'evidence supports drafting',
    'review': 'request is unclear or consequential',
    'none': 'no listed worker is appropriate'
  }
)
```

**Where Choice is useful** (§II.A): "worker routing, model selection, queue assignment, choosing one current interface control, selecting a retry strategy, and deciding which retrieval candidate should survive."

**Where Choice is not suitable** (§II.A): "It is not suitable for inventing an arbitrary identifier, URL, number, or name that was not declared in the menu." (Restated as a failure mode in §X.I Unknown Values Hidden Inside a Label; see §11.1 row 9 of this guide.)

### 3.2 Score (§II.B)

> "Score applies when the decision lives on an ordered semantic rubric. The levels should be verbal descriptions, not vague numbers. For evidence quality, the scale might move from no direct support to partial support with important gaps to strong support from multiple independent sources." (§II.B)

**Ordinal interpolation.** "Outputs may fall between rubric levels, but the interpolation does not convert an ordinal scale into exact measurement. A value of 1.6 is a position between two descriptions. It is not automatically 80 percent good, 1.6 times better, or equivalent across different contracts." (§II.B)

The handbook's example, verbatim (it omits `instructions`, which the live API requires; see §1.6):

```python
Score(criteria=[
   'no direct support',
   'partial support with important gaps',
   'strong support from independent sources'
])
```

### 3.3 Noul (§II.C)

> "Noul represents a yes-or-no probability. A result near one means likely yes. A result near zero means likely no. A result near one half means the available evidence does not support a confident distinction. It does not mean medium severity or partial permission. Ordered risk categories belong in Score." (§II.C)

The handbook's example, verbatim:

```python
Noul(
  instructions=(
    'Would the proposed action publish, purchase, '
    'delete, change permissions, or represent the '
    'user externally?'
  )
)
```

**Where Noul is appropriate** (§II.C): "completion checks, approval likelihood, evidence sufficiency, whether a request is ambiguous, and whether a proposed action has an external side effect."

**Who sets the bands** (§II.C): "The application must still decide what probability range triggers automation, more evidence, or human review." The handbook defines no numeric Noul bands (see §13 of this guide).

### 3.4 Selection discipline (Table II, §II.D)

**Table II** (§II.D, PDF p.3). Caption: *"Table II. Primitive selection begins with the declared answer shape."*

| Answer shape | Primitive | Design requirement |
|---|---|---|
| One winner | Choice | Describe each option; add an escape hatch |
| Ordered quality | Score | Define verbal anchors; avoid fake precision |
| Yes or no | Noul | Interpret uncertainty, not severity |
| Unknown free string | Not Jev | Use extraction or generation |
| Exact arithmetic | Not Jev | Use deterministic code |

The two **Not Jev** rows are the handbook's direct statement of where Jev does not belong. They match the boundary test (§1.5): unknown free strings must be authored or extracted, and exact conditions are enforced by code. They are restated as failure modes §X.H and §X.I (§11.1 rows 8 and 9 of this guide).

### 3.5 Type safety is not truth (§II.E)

> "Jev can guarantee that the answer matches the declared output type. It cannot guarantee that the selected valid answer is semantically correct." (§II.E)

**Four causes of a type-valid wrong answer** (§II.E): "Wrong evidence, stale options, ambiguous criteria, or an incomplete menu can produce a wrong choice that is perfectly valid at the type level."

**What production systems therefore need** (§II.E): "representative examples, confidence thresholds, deterministic checks, decision receipts, and review paths."

> "Type safety removes parsing and schema failures. It does not remove the need to test the meaning of the decision." (§II.E)

### 3.6 Primitive composition (§II.F)

> "The primitives may be asked together when they inspect the same snapshot. A router can request next worker by Choice, urgency by Score, and approval likelihood by Noul in one call. They should not be chained inside the same request when a later question depends on new evidence created by an earlier answer." (§II.F)

The same router example returns as pseudocode and a decision record in §VI.A and §VI.D Decision Record (§7.1 and §7.5 of this guide).

### 3.7 Rubric design (§II.G Rubric Design)

> "Rubric levels should describe observable differences in evidence, not emotional intensity. Adjacent levels need a meaningful boundary. If reviewers cannot place examples consistently, Jev cannot be expected to learn a stable ordering from the descriptions alone." (§II.G Rubric Design)

> "Prefer three to five well-separated levels. More levels create an appearance of precision while reducing inter-rater agreement. Preserve the original level descriptions in the receipt so later analysis can distinguish model behavior from a contract change." (§II.G Rubric Design)

Rules in short:

1. Levels describe observable evidence differences, not emotional intensity.
2. Adjacent levels need a meaningful boundary.
3. **Reviewer-consistency test:** if reviewers cannot place examples consistently, the rubric is not usable, because Jev cannot learn a stable ordering from the descriptions alone.
4. Prefer three to five well-separated levels. The reason: more levels look more precise but reduce inter-rater agreement. This is a preference, not a hard limit. The live API accepts 2 to 10 levels.
5. Keep the original level descriptions in the receipt (§4.11 of this guide).

### 3.8 Primitive anti-patterns (§II.G Primitive Anti-Patterns)

> "Do not encode a multi-label problem as Choice if several options may be true simultaneously. Do not use Score when categories are unordered. Do not interpret a Noul probability as a severity scale. Each mismatch can produce plausible numbers that the application reads with the wrong semantics." (§II.G Primitive Anti-Patterns)

> "When the required output does not match one primitive cleanly, divide the question. A risk workflow might use Noul to detect the presence of an external side effect, Score to rate consequence, and Choice to select the permitted route." (§II.G Primitive Anti-Patterns)

---

## 4. The decision contract specification

### 4.1 The field lists, reproduced exactly

The handbook gives the contract fields in four places. They overlap but are not identical. Treat the union as the schema.

| Source | Fields, verbatim order |
|---|---|
| Abstract | "a versioned specification of state, instructions, declared outcomes, fallbacks, thresholds, allowed actions, and escalation behavior" |
| §III.A A Question Is Part of the Program | "which state fields are visible, what the instructions mean, which outcomes exist, which escape path is safe, how confidence is interpreted, which action may follow, and which contract version produced the result" |
| §III.B Contract Fields (the canonical minimal list) | "state schema; instructions; option descriptions or rubric; fallback outcome; confidence thresholds; consequence class; allowed action; escalation path; model version; and contract version" |
| §IX.B Define Before Integrating | "state fields, instructions, options or rubric, fallback, confidence thresholds, consequence class, allowed action, escalation route, and version" |
| §XI.A step 4 | "state, instructions, outcomes, escape hatch, thresholds, authority, escalation, and version" |

**Canonical minimal contract (§III.B), ten fields:**

| # | Field | What it holds | Where else it is explained |
|---|---|---|---|
| 1 | State schema | Which state fields are visible to the model | §IV (packets, projections, least privilege) |
| 2 | Instructions | The question, with its operational definition written out | §III.A (identifiers are not instructions) |
| 3 | Option descriptions or rubric | Choice criteria, Score levels, Noul criteria | §II, §VIII.F |
| 4 | Fallback outcome | The safe escape path | §II.A, §X.B (escape hatch) |
| 5 | Confidence thresholds | How confidence ranges map to routes | §V |
| 6 | Consequence class | Stakes of the downstream action | §V.A, §III.E |
| 7 | Allowed action | Upper bound on the authority the result may lead to | §III.B |
| 8 | Escalation path | Where uncertain or consequential cases go | §V.A, §IX.F |
| 9 | Model version | The Jev model that produced the result | §IX.D shadow record (`jev_model`) |
| 10 | Contract version | The semantic program's version | §III.C, §III.D Receipt |

Property requirements: "The contract should be reviewable without reading the entire application." (§III.B)

### 4.2 Instructions carry the meaning

```
# weak
safe_to_publish = Noul('Is this safe?')

# stronger
safe_to_publish = Noul(
  'Does the draft contain only verified claims with '
  'citations, avoid private information, and require '
  'no unresolved legal or financial approval?'
)
```
(§III.A)

"The operational definition must appear in the instructions and criteria. Otherwise the system contains a semantic rule that is visible to developers but absent from the model input." (§III.A)

### 4.3 Fallbacks and escape hatches

- "Closed menus need an escape hatch whenever reality may contain an unlisted state." (§II.A)
- Named escape outcomes: none, other, stop, escalate (§II.A); none, other, stop, review (§X.B); review or none where options overlap (§VIII.F); stop in dynamic menus (§VIII.G).
- "An escape outcome preserves uncertainty and gives the harness a safe route." (§II.A)
- Review checklist item: "every open menu has an escape hatch" (§III.D Review the Contract Like Code).

### 4.4 Thresholds

- A contract must map "every confidence range... to an explicit route." (§III.D Review)
- Thresholds are per consequence class (§V.A, §X.C), governed (§V.C Threshold Governance). Full treatment in §6 of this guide.

### 4.5 Allowed actions and authority

> "The allowed action field is especially important. It prevents a classification result from silently expanding into authority. A contract may allow internal routing but forbid any external side effect. The harness remains responsible for verifying that the resulting action stays inside that boundary." (§III.B)

Reviewers "should also confirm that the allowed action is narrower than the model judgment and that exact constraints remain in code." (§III.D Review)

### 4.6 Escalation

- Low confidence or high consequence escalates (§V.A). Irreversible actions "may require review at every confidence level" (§III.E).
- Verification failures route "to repair, evidence collection, or escalation rather than an unbounded retry" (§VII.D Builder and Verifier).
- Retries must "add evidence, change the contract, narrow the menu, or escalate" (§X.E).
- Checklist: "The system can stop or escalate safely." (§XI.C)

### 4.7 Versioning

> "Options, users, tools, and language change. A semantic edit can alter production behavior even when no application code changes. Version the decision contract separately so that changes can be reviewed, evaluated against historical examples, deployed gradually, and rolled back." (§III.C)

The handbook shows a version history without a caption or in-text reference, under §III.F Testing Contracts:

```
router@1  broad options
router@2  adds none-of-the-above
router@3  separates billing from account access
router@4  consequence-specific thresholds
```

**Interpretation:** the naming convention is `<contract-name>@<integer>`, and each bump is one semantic change (add an escape hatch; split confusable outcomes; make thresholds consequence-specific). The shadow record in §IX.D uses the same form (`'ticket-router@3'`).

Contract changes are logic changes: "A wording or option change is deployed as a harmless prompt edit. In reality it changes production logic. Version the contract, run historical examples, compare shadow behavior, and preserve rollback." (§X.L)

### 4.8 Review like code (§III.D Review the Contract Like Code)

A contract review verifies that:

- [ ] every state field is necessary
- [ ] every outcome is distinguishable
- [ ] every open menu has an escape hatch
- [ ] every confidence range maps to an explicit route
- [ ] the allowed action is narrower than the model judgment
- [ ] exact constraints remain in code

"Changes to criteria deserve regression tests. Re-run labeled examples from the previous version, inspect class-specific accuracy and calibration, and require an explanation for behavior changes. A shorter prompt is not automatically a safer or more maintainable contract." (§III.D Review)

### 4.9 Lifecycle (§III.E)

1. Define the state and outcomes.
2. Evaluate the contract against one immutable snapshot.
3. Route the result through consequence-aware thresholds and deterministic policy.
4. Record the receipt and resulting action.

"No stage should be hidden inside another." Separating evaluation from routing "allows the same distribution to support different policies. An internal queue may automate at a lower threshold than a public statement. An irreversible action may require review at every confidence level." (§III.E)

### 4.10 Testing contracts (§III.F)

- Test cases: "ordinary cases, ambiguous cases, missing evidence, adversarial language, stale options, and examples where no option fits."
- Metrics: "both the selected answer and whether confidence changes monotonically with evidence quality."
- Readiness: "A contract that is accurate only on easy examples is not ready to control a branch."

### 4.11 The decision receipt

**Table III** (§III.D The Decision Receipt). Caption: *"A label without a receipt is difficult to evaluate or audit."*

| Receipt field | Purpose |
|---|---|
| `contract_version` | Identifies the semantic program |
| `state_reference` | Links to the evaluated evidence snapshot |
| `full_distribution` | Preserves uncertainty, not only the winner |
| `selected_threshold` | Explains the operating zone |
| `consequence_class` | Explains why a route was permitted |
| `route` | Records auto, improve, or human |
| `resulting_action` | Connects judgment to execution |

"The receipt links judgment to the state and policy that existed at the time. It is the minimum unit for auditing, calibration, incident review, and comparison between contract versions." (§III.D The Decision Receipt)

Receipt requirements added by other sections:

| Additional content | Source |
|---|---|
| Original rubric level descriptions | "Preserve the original level descriptions in the receipt so later analysis can distinguish model behavior from a contract change." (§II.G Rubric Design) |
| Which evidence each question was allowed to inspect | §VI.C |
| Option-set version | §VIII.H |
| Each boundary of the safe order (judgment, policy, execution, trace) | §X.N |
| Chosen label, distribution, threshold, state reference, route (never winner-only) | §X.F |
| Model version | §III.B contract fields; §IX.D shadow record |

**Incident questions a receipt must answer** (§III.G): "what the model saw, which contract interpreted it, how probability was distributed, which threshold fired, which deterministic policy applied, and which action followed."

**Counterfactual evaluation** (§III.G): "A new contract version can be replayed against historical state snapshots without repeating the original side effects. That comparison is essential when the goal is safer routing rather than merely different labels."

### 4.12 Consolidated contract schema (interpretation)

The handbook gives no single schema. The union of §4.1 and §4.11 above, as a FlowAId-facing sketch:

```
DecisionContract {
  id, version                    # e.g. "support.router@4"          (§III.C, router@1..4)
  stateSchema                    # projected packet fields          (§III.B, §IV.C)
  instructions                   # operational definition           (§III.A)
  kind: choice | score | noul    #                                   (§II)
  options | levels | criteria    # descriptions / verbal anchors    (§II, §VIII.F)
  fallbackOutcome                # escape hatch                     (§III.B, §II.A)
  thresholds                     # per consequence class             (§V.A, §V.C)
  thresholdGovernance            # owner, rationale, evaluation window,
                                 # consequence class, rollback condition (§V.C)
  consequenceClass               # values not enumerated            (§III.B)
  allowedAction                  # narrower than the judgment       (§III.B, §III.D)
  escalationPath                 #                                   (§III.B)
  modelVersion                   #                                   (§III.B)
}
```

---

## 5. State packets and evidence (§IV)

### 5.1 The rule

"Jev can only judge the state it receives. Sending a giant transcript forces the model to reconstruct the workflow from mixed instructions, old attempts, conclusions, and irrelevant history." A packet "should be compact, current, and evidence-based. Separate goal, facts, artifacts, evidence, constraints, options, and state version." (§IV.A)

**Table IV** (§IV.A). Caption: *"Functional state fields reduce accidental coupling between evidence and interpretation."*

| State field | Function |
|---|---|
| Goal | Defines success for the current task |
| Facts | Records what the system currently knows |
| Artifacts | Lists outputs that already exist |
| Evidence | Supports the next semantic judgment |
| Constraints | Defines boundaries the system may not cross |
| Options | Enumerates what can happen now |
| Version | Identifies the exact evaluated snapshot |

"The separation makes omissions visible and prevents an earlier agent's interpretation from becoming an unquestioned fact." (§IV.A)

### 5.2 Evidence, not inherited confidence (§IV.B)

```
BAD
  research_status: 'probably enough'

BETTER
  sources_collected: 7
  official_sources: 3
  pricing_verified: true
  security_claim: 'unresolved'
```

"'The research is probably enough' asks Jev to trust an earlier judgment. 'Seven sources collected, three official, pricing verified, security claim unresolved' gives the model material it can judge." §X.A adds the evidence dimensions: "source count, source type, verified claims, unresolved claims, and freshness."

### 5.3 The compact packet (§IV.C A Compact State Packet), verbatim

```
state = {
  goal: 'prepare a cited briefing on three tools',
  constraints: {
    publish: false, deadline: '09:00 UTC',
    max_sources: 12
  },
  completed_work: {
    sources_collected: 7, draft_exists: true,
    fact_check_complete: false
  },
  evidence: [
    {id:'s1', kind:'official_docs',
     supports:['pricing']},
    {id:'s2', kind:'launch_post',
     supports:['availability']}
  ],
  available_workers: [
    'research','write','fact_check','review'
  ],
  state_version: 'run_184:step_7'
}
```

"The packet does not need to contain every event in the run. It needs the evidence required for the declared questions. Different decision families may receive different projections of the same underlying state." (§IV.C A Compact State Packet)

**Interpretation:** the example keys do not map one-to-one onto Table IV. `completed_work` mixes facts and artifacts (`draft_exists`); `available_workers` is Options; `state_version` is Version; there is no explicit `facts` or `artifacts` key. Evidence items have the shape `{id, kind, supports[]}`.

### 5.4 Least privilege and projections (§IV.C State Access Control)

- "The decision model receives only fields required for the contract. Secrets, personal information, proprietary code, and irrelevant account data should not be included merely because they exist in the parent agent context."
- "Field-level access rules make this boundary reviewable. They also allow the same underlying run state to produce different projections for routing, retrieval, verification, and approval contracts."

### 5.5 Freshness and invalidation (§IV.D)

- "Every option set has an invalidation condition. Workers become unavailable. Buttons disappear. Budgets change. Files move. Permissions are revoked. Sources are updated."
- "Attach timestamps or versions to evidence that can become stale."
- "Rebuild live options before evaluation."
- "Prevent writes between snapshot creation and decision evaluation when consistency matters."
- "If the system retries, require new evidence or a changed contract; repeating the same uncertain question against the same state is not learning."

### 5.6 Minimization (§IV.E)

- "Minimization is not aggressive deletion. It is a declaration of relevance. Code can pre-filter exact mismatches, retrieve likely evidence, and construct a small packet. Jev then resolves the remaining semantic ambiguity. This division prevents the model from rediscovering facts the program already knows exactly."
- "The packet should be inspectable by a human. If developers cannot explain why a field is present, the state has probably absorbed transcript history rather than decision evidence."

### 5.7 Testing packets (§IV.F)

| Test | Failure signal | Meaning |
|---|---|---|
| Remove / corrupt / stale each field | Irrelevant history changes the answer | "the packet is not sufficiently isolated" |
| Remove a supposedly required field | No effect | "either the field is unnecessary or the contract is not using it reliably" |

Fixtures: "Maintain fixtures for common state versions and edge cases. The fixture should include the expected route and a short human rationale, not a chain-of-thought trace. The aim is to verify the decision boundary and evidence sufficiency." (§IV.F)

---

## 6. Confidence, consequence and calibration (§V)

### 6.1 Confidence is a routing signal (§V.A)

"Most systems flatten probability into a label too early. A result of 0.51 and a result of 0.99 may both become yes, even though they should not receive the same authority. The distribution should change what the harness does next."

**Three operating zones:** "High confidence plus low consequence may automate the declared branch. Medium confidence should improve the state by collecting evidence, running a deterministic check, narrowing options, or consulting a stronger model. Low confidence or high consequence should escalate."

**Table V** (§V.A). Caption: *"Thresholds are illustrative and must be calibrated per action class."*

| Consequence | Confidence | Route |
|---|---|---|
| Low | >= 0.90 | Automate the declared branch |
| Low or medium | 0.70-0.89 | Collect evidence or run a check |
| Any | < 0.70 | Human review |
| Irreversible | Any | Human review |

"The same confidence should not control an internal queue and a public statement. Thresholds belong to the consequence class, not only to the output type. Irreversible actions may remain review-gated regardless of confidence." (§V.A)

**Routing precedence** (§V.E Confidence Is Not Authority), verbatim:

```
if consequence == 'irreversible':
    return HUMAN_REVIEW
if confidence >= auto_threshold:
    return selected_choice
if confidence >= evidence_threshold:
    return COLLECT_MORE_EVIDENCE
return HUMAN_REVIEW
```

The consequence check runs **before** any confidence test. The three outcomes correspond to the receipt `route` values auto / improve / human (Table III).

### 6.2 Improving the state (§V.B)

- "A medium-confidence route should specify how the state will improve. Fetch another source, verify a file, run a permission check, ask the user a precise question, or reduce the option set. Confidence without a different next action is decoration."
- "Repeated evaluation with unchanged evidence can create false reassurance because several similar outputs look like consensus. The retry budget should purchase information, not merely another sample from the same uncertainty."

Improve-state actions named across §V.A and §V.B: collect evidence / fetch another source; run a deterministic check / verify a file / run a permission check; narrow options / reduce the option set; ask the user a precise question; consult a stronger model.

### 6.3 Threshold governance (§V.C Threshold Governance)

A threshold record carries: **owner, rationale, evaluation window, consequence class, rollback condition.**

- "A threshold chosen from a small demo set should never silently become permanent policy."
- "Monitor how much traffic falls near each threshold. A large mass just above an automation boundary makes the system sensitive to small calibration drift. In that case, improve the contract or widen the review zone before increasing autonomy."

### 6.4 Calibration (§V.C Calibration)

"Calibration asks whether events predicted near a probability occur at roughly that frequency on the target workload. A reliability diagram groups decisions into confidence bins and compares predicted confidence with observed correctness. Perfect calibration lies on the diagonal; a curve below it indicates overconfidence, and a curve above it indicates underconfidence. Automation depends on whether higher confidence actually identifies safer cases."

**Fig. 2** (PDF p.6): a reliability diagram with y-axis ACCURACY, x-axis PREDICTED CONFIDENCE, a dashed diagonal, and a solid line through five points lying just under the diagonal. It has no tick values and no data. Caption: *"Reliability is evaluated on labeled workload data, not inferred from confident language."* Treat it as a schematic only.

### 6.5 Calibration metrics (§V.D)

| Primitive | Metric | Handbook wording |
|---|---|---|
| Noul | Brier score | "measures squared error between probability and outcome" |
| Choice | Top-label or classwise calibration | "can expose rare options that are systematically over- or under-confident" |
| All | Reliability diagram | §V.C Calibration |
| All | Segmentation | "Segment metrics by contract version, consequence class, language, and rare option; a global average can hide the branch that matters most." |

The handbook names no Score-specific metric, no bin count and no ECE.

**FlowAId note (standard definitions, not in the handbook):** Brier = mean((p_yes - y)^2) with y in {0,1}. Top-label calibration bins decisions by winning-option probability and compares with the accuracy of the winner. Classwise calibration does this separately per option k using p_k against indicator(label == k).

### 6.6 Confidence is not authority (§V.E)

"Even a well-calibrated distribution is still a prediction. Policy, budgets, allowlists, user approvals, and deterministic checks remain downstream. Calibration makes automation measurable; it does not transfer authority to the model."

### 6.7 Calibration rollout (§V.F)

- "Calibration should be estimated in shadow mode, checked again after automation, and recalculated after material contract or state-schema changes."
- "Confidence is conditional on the workload; moving the same contract to a new language, product area, or user population may invalidate the previous curve."
- "Use human labels selectively but consistently. Oversample rare, consequential, and near-threshold examples. Random samples alone may produce a reassuring aggregate while leaving the automation boundary poorly measured."

---

## 7. Parallel questions and state boundaries (§VI)

### 7.1 One snapshot, many questions (§VI.A)

```
response = system_one(
  state=state,
  questions={
    'next_worker': Choice(...),
    'urgency': Score(...),
    'requires_approval': Noul(...)
  }
)
```

"Because the questions share one snapshot, the decision record is coherent and easier to inspect than a chain of independent generative calls." "Batching reduces repeated state transfer and prevents small timing differences from changing the evidence each question sees. It also exposes whether two contracts rely on incompatible projections of state." (§VI.A)

### 7.2 The independence boundary (§VI.B)

> "Parallel does not mean dependent. One question cannot consume another question's fresh answer inside the same evaluation. If the second decision requires a search result, tool output, or user clarification, perform that action, update the state version, and then ask again."

> "The boundary is simple: same evidence may be evaluated together; new evidence requires a new snapshot."

"Hiding a multi-step plan inside one label collapses the dependency and makes it impossible to verify which evidence supported the final branch." (§VI.B)

### 7.3 Snapshot discipline (§VI.C)

1. "Every batch should carry a state version or content hash."
2. "The runtime should prevent relevant writes between snapshot creation and evaluation, or at least record the race."
3. "The decision receipt should identify which evidence each question was allowed to inspect."
4. "Batching is not merely an optimization. It provides a semantic transaction boundary. All answers describe one version of reality, and any later action that changes reality produces a new boundary."

### 7.4 Batching economics (§VI.D Batching Economics)

- "A shared snapshot avoids sending the same state through several independent calls. More importantly, it makes disagreement visible: urgency, approval likelihood, and worker choice can be inspected together rather than reconstructed from separate traces."
- "Batch only questions that belong to the same latency and privacy class. A sensitive approval judgment should not inherit a provider route chosen for a low-cost internal classification merely because both inspect related state."

### 7.5 Decision record (§VI.D Decision Record), verbatim

```
{
  state_version: 'run_184:step_7',
  next_worker: 'fact_check',
  next_worker_distribution: {
    research: 0.05, write: 0.03,
    fact_check: 0.91, review: 0.01
  },
  urgency_score: 1.24,
  approval_probability: 0.82
}
```

"The record retains distributions rather than only winners. A later audit can determine whether the chosen threshold was reasonable, whether a rare option was ignored, and whether confidence changed after new evidence arrived."

### 7.6 Dependent sequence (§VI.E), verbatim

```
STATE v7
  -> decide: evidence missing
  -> search: obtain official source
  -> STATE v8
  -> decide: evidence sufficient
  -> route: fact_check
  -> STATE v9
```

"Each arrow that creates evidence must be visible in the trace. Otherwise the agent appears to reason continuously while the actual graph contains hidden state transitions and unrecorded assumptions."

### 7.7 Concurrency and side effects (§VI.F)

- "Independent read-only questions are natural candidates for parallel evaluation. Write-producing branches require stronger control. Two decisions may be semantically independent while their resulting actions contend for the same file, queue, budget, or external account."
- "The harness should separate decision parallelism from execution parallelism. It may evaluate routes together, then serialize or lock actions according to deterministic resource policy. A fast decision model does not remove ordinary distributed-systems concerns."

### 7.8 Failure modes (§VI.G)

"batching questions that actually depend on one another, mixing state versions in one record, evaluating after a write without rebuilding evidence, and logging only the final selected answer. Each failure weakens the audit trail even when the immediate branch appears correct."

### 7.9 Trace reconstruction (§VI.H)

A complete trace lets an investigator replay the semantic transaction:

1. load the state snapshot
2. recover the contract version
3. reproduce the declared options
4. inspect the distributions
5. apply the threshold configuration
6. compare the resulting route with the action that executed

"If any link cannot be reconstructed, the decision is only partially observable. That gap should be treated as an operational defect even when no user-visible error occurred."

---

## 8. Harness insertion points (§VII)

**Table VI** (§VII.E area, PDF p.8). Caption: *"Jev sits at semantic transitions; authority remains deterministic."*

| Insertion point | Jev judgment | Code authority |
|---|---|---|
| Before model | Route task or model | Availability, budget, provider policy |
| Before tool | Estimate semantic risk | Permission, scope, approval |
| After tool | Pass, repair, or escalate | Artifact and invariant checks |
| Retrieval | Score decision relevance | Exact filters and access control |

### 8.1 Before the generative model: task routing (§VII.A)

- "A generative model is unnecessary when the system only needs to decide whether a request is simple, ambiguous, routine, high-stakes, or outside the available capability set."
- "Jev can choose among the current workers or models, while code filters candidates that are unavailable, over budget, or forbidden by policy."
- "The router should receive the live model menu, current cost and latency budgets, task constraints, and consequence class. It should not contain a permanent prompt naming yesterday's model catalog. Routing over a stale menu is an invalid graph, not a weak inference."

### 8.2 Before the tool: semantic risk classification (§VII.B)

"The LLM proposes a tool call. Jev evaluates the meaning of the proposed action against a declared rubric. Code then checks exact permissions, scope, budget, destination, and user approval before anything executes."

```
proposal = llm.propose_tool_call()
judgment = jev.classify_semantic_risk(proposal)
route = policy.apply(judgment, proposal, user_scope)
if route == ALLOW:
    tool.execute(proposal)
elif route == REVIEW:
    queue_for_human(proposal)
else:
    block(proposal)
```

"This separation prevents the classifier from becoming the policy engine. A low-risk prediction cannot override an allowlist, a repository boundary, an account permission, or a requirement for human confirmation." (§VII.B)

### 8.3 Tool semantics: normalize first (§VII.D Tool Semantics)

A proposal records: **intended operation, target, destination, data class, reversibility, external side effects.**

"Semantic risk cannot be evaluated reliably from a command name alone when scripts, redirects, or nested calls change what the action actually does. The normalized proposal also gives deterministic policy a stable interface. Jev interprets meaning; policy checks scope and authority against explicit fields."

### 8.4 After the tool: verification (§VII.C)

"A successful HTTP response or zero exit code proves that an operation completed, not that the user's goal was achieved. Verification should inspect new evidence: the artifact exists, the expected sections are present, claims have citations, the output path is correct, and no required approval remains unresolved."

### 8.5 Builder and verifier (§VII.D Builder and Verifier)

"The builder and verifier should share an artifact and a rubric, not a vague feeling of completion. The builder may use a generative model. The verifier may combine deterministic checks with Jev scores or choices. A failed check should route to repair, evidence collection, or escalation rather than an unbounded retry."

### 8.6 Around retrieval (§VII.E)

Pipeline order:

1. cheap deterministic filters
2. embedding shortlist
3. Jev scores relevance against the current question
4. small evidence packet
5. generative model

"Embeddings identify topical similarity but do not always identify evidence that is decision-relevant... This pipeline keeps exact facts in code and reserves semantic ambiguity for Jev. The trace can explain why each item survived. The generative model receives less noise, and the retrieval decision becomes testable independently from the generated artifact."

### 8.7 Placement discipline (§VII.F)

- "Do not place Jev at every edge simply because it is inexpensive. Begin with repeated semantic decisions whose errors are measurable and whose consequences are low."
- A decision node must do at least one of: **remove a generative call, clarify a policy boundary, improve observability, or create a route that did not exist before.**
- Misplacement tests: "If a node only restates an exact condition already known to code, it adds uncertainty without adding intelligence. If a node produces open-ended content, it is being used outside its intended role."
- "The quality of the graph matters more than the number of Jev calls."

### 8.8 Security-aware routing (§VII.G)

"Model routing should consider trust in addition to quality, cost, and latency. The state packet can identify which data classes a branch may read. Code then removes providers that are not eligible for secrets, infrastructure, proprietary research, or personal data before Jev chooses among the remaining routes. This preserves the system boundary: Jev may resolve semantic fit within the allowed set, but deterministic policy decides which set is allowed to exist."

---

## 9. Live menus and retrieval (§VIII)

### 9.1 Menus are runtime state (§VIII.A)

"The available actions in an agent change continuously. Browser controls appear and disappear after each click. Workers come online and go offline. Files are created or moved. Sources become stale. Budgets shrink. Permissions change. Queues fill. A decision model must choose from what exists now."

"The option set should therefore be derived from live state immediately before evaluation. An internal menu written when the run began is not a reliable program representation. If a selected option no longer exists, the model did not necessarily infer badly; the harness evaluated an invalid graph."

```
controls = observe_current_page()
criteria = {
  control.id: control.semantic_description
  for control in controls
  if control.visible and control.enabled
}
criteria['stop'] = (
  'goal is complete or no safe action exists'
)
next_control = Choice(criteria=criteria)
```

### 9.2 Large option sets (§VIII.B)

"Deterministic code removes impossible candidates. Retrieval or embeddings create a shortlist. Jev resolves the remaining ambiguity. This sequence is more stable than asking the decision model to scan hundreds of options that the program could have excluded exactly."

"The shortlist process must preserve an escape hatch. Aggressive pre-filtering can remove the correct option before Jev sees it. Log both the original candidate count and the survivors so failures can be assigned to filtering, retrieval, or semantic choice."

API limit (not from the handbook): a choice question accepts at most 255 options (`TYPESAFE_API.md`).

### 9.3 Dynamic worker routing (§VIII.C)

Worker menus include **availability, capability, cost, latency, trust policy, and current load.** "The semantic description explains when each worker is appropriate; deterministic fields rule out workers that cannot legally or operationally receive the task."

### 9.4 Option-set tests (§VIII.D Option-Set Tests)

"Test the menu builder separately from the semantic choice. Fixtures should cover unavailable workers, disabled controls, expired sources, exhausted budgets, and permission changes. The expected result may be a smaller menu or only the stop and review outcomes. A correct Choice cannot recover an option removed by a faulty builder. Separating these tests prevents menu-construction defects from being blamed on Jev."

### 9.5 Staleness hazards (§VIII.D Staleness Hazards)

**Table VII.** Caption: *"Option validity is a property of current state, not the model."*

| Object | Invalidation | Correction |
|---|---|---|
| Worker | Unavailable or overloaded | Refresh registry and load |
| Browser control | Hidden, disabled, or removed | Observe the current page |
| Source | Content or timestamp changed | Re-fetch and version |
| Budget | Spend increased | Read the current ledger |
| Permission | Scope revoked | Re-evaluate policy |
| File | Artifact moved or replaced | Resolve current path and hash |

### 9.6 Retrieval as decision support (§VIII.E)

- "A retrieval item should survive because it contributes evidence to a declared question, not merely because it is topically close."
- The relevance contract "may score whether a source directly supports a claim, whether it is authoritative enough for the consequence, and whether it is fresh enough for the decision." (The text says "may": these are examples, not required dimensions.)
- "The packet passed to the generative model should record source identifiers and support relationships. That structure allows the verifier to ask whether every material claim has evidence and whether the evidence type satisfies the contract."

### 9.7 Option descriptions (§VIII.F)

"Descriptions must distinguish options rather than praise them. Two workers described as fast and capable create an under-specified menu. Criteria should state the evidence conditions under which each worker is the correct branch. Where options overlap, add a review or none outcome."

### 9.8 Stop as an action (§VIII.G)

"Dynamic menus should usually include stop. Without it, the agent is forced to keep acting after the goal is complete or when no safe action exists. Stop is not a failure; it is a declared outcome with criteria that can be evaluated and audited. In browser and tool agents, a safe stop route is often more important than another recovery branch. It prevents the loop from spending tokens or creating side effects merely because an action menu cannot represent completion."

### 9.9 Caching dynamic state (§VIII.H)

"Caching may be useful when option construction is expensive, but every cache entry needs an explicit invalidation rule. Time-based expiry alone is insufficient for permissions, budgets, and live controls. Prefer event-driven invalidation where the underlying system exposes a reliable change signal."

"The decision receipt should identify the option-set version. When an incident involves a stale choice, the team can then distinguish inference error from invalidation failure."

---

## 10. Evaluation, shadow mode and production rollout (§IX)

### 10.1 Start small (§IX.A, §IX.B)

- "Do not replace every hidden branch at once. Select one high-volume, low-consequence semantic decision whose correct answer can be labeled later. Internal ticket routing, worker selection, retrieval filtering, and completion checks are common starting points. Payment approval without human review is not." (§IX.A)
- "Write the contract before calling the model... If the team cannot agree on those fields, the branch is not ready for automation." (§IX.B)

### 10.2 Representative evaluation set (§IX.C)

Must contain: **normal examples, ambiguous cases, missing evidence, adversarial language, stale options, rare classes, and cases where no option fits.** "Include examples from the real distribution and deliberately difficult counterexamples. A polished demo set cannot reveal whether confidence is useful."

Compare §III.F (contract tests): ordinary, ambiguous, missing evidence, adversarial language, stale options, no option fits. §IX.C adds rare classes and the real-distribution requirement.

### 10.3 Shadow mode (§IX.D)

"In shadow mode the existing production path remains authoritative. Jev evaluates the same decision but does not act. The system logs its distribution, selected answer, confidence, state reference, contract version, existing production answer, and later human label when available."

```
{
  decision_contract: 'ticket-router@3',
  state_hash: 'b476...',
  jev_model: 'jev-latest',
  answer: 'technical',
  confidence: 0.87,
  production_answer: 'technical',
  human_label: null,
  action_taken: false
}
```

"Shadow mode reveals disagreements without exposing users to them. It also produces the data needed to test whether higher confidence actually corresponds to higher accuracy."

Note: the prose says the distribution is logged, but the example record has no distribution field. Log it anyway (§X.F).

### 10.4 Labels and adjudication (§IX.E Labels and Adjudication)

- "Human labels need a written rubric and an adjudication path. If reviewers disagree systematically, the contract may be ambiguous rather than the model inaccurate. Preserve disagreement instead of forcing premature consensus; it indicates where the decision boundary requires clarification."
- "For consequential branches, have reviewers label both the semantic answer and the permitted route. This distinguishes a correct judgment from an unsafe automation policy."

### 10.5 Evaluate the whole system (§IX.E Evaluate the Whole System)

"Average decision accuracy is insufficient. Measure decision latency, decision cost, branch accuracy, downstream tool cost, recovery cost, human review rate, and completed-task rate. The business objective is cost and reliability per completed task."

**Table VIII.** Caption: *"Per-call price is only one component of completed-task economics."*

| Metric | Operational meaning |
|---|---|
| Decision latency | Time to a typed result |
| Branch accuracy | Correct next action under the contract |
| Calibration | Observed correctness by confidence |
| Recovery cost | Cost after a wrong branch |
| Review rate | Load transferred to humans |
| Completed-task rate | End-to-end success |

Full metric set (union of prose and table): decision latency, decision cost, branch accuracy, calibration, downstream tool cost, recovery cost, human review rate, completed-task rate.

### 10.6 Automate the safest branch (§IX.F)

"After shadow evaluation, automate one outcome with low consequence and strong calibration. Keep rare, uncertain, or consequential cases behind the existing review path. Compare production behavior with the shadow baseline and preserve an immediate rollback."

### 10.7 Expand one boundary at a time (§IX.G)

Typical sequence: **internal routing, then retrieval filtering, then completion verification, then model selection, then low-risk tool gating.** "Consequential actions arrive later and remain surrounded by explicit policy and approval. This sequence keeps each new failure mode observable."

### 10.8 Monitor drift (§IX.H)

- "Users, tools, options, and language change. Track accuracy and calibration by contract version and recent time window."
- "Rising human-review rate may indicate degraded state quality, a stale menu, or a new class that the contract cannot express."
- "Treat semantic drift like software drift: inspect, test, version, and roll back."
- "TypeSafe's published price can make individual decisions extremely cheap. That does not justify unnecessary calls. The economics are downstream. A small graph with high-quality boundaries is better than a dense graph of low-value classifiers."

### 10.9 Rollout guardrails (§IX.I)

- Limit the first automated branch by **traffic share, tenant, language, and consequence.**
- "Sample automated cases for review, retain the old path as a fallback, and define a rollback trigger before launch."
- "Guardrails should be deterministic and independent of Jev confidence."
- **Completion criterion:** "A rollout is complete only when the team can compare end-to-end task outcomes, not merely classifier agreement. The expected gain should appear in latency, cost, review load, or completed-task rate without an offsetting increase in recovery work."

### 10.10 Rollout state machine (interpretation)

```
inventory (§I.G) -> contract defined (§IX.B) -> offline eval on representative set (§IX.C, §III.F)
  -> shadow (§IX.D; calibration estimated §V.F)
  -> automate ONE safe outcome with deterministic guardrails (§IX.F, §IX.I)
  -> re-check calibration post-automation (§V.F); compare with shadow baseline (§IX.F)
  -> expand next boundary (§IX.G)
  -> on drift or rollback trigger: roll back to previous contract or old path (§IX.H, §IX.I)
```

---

## 11. Failure modes and corrections

### 11.1 The catalog (§X.A-§X.L plus related sections)

Rows 1 to 12 are the handbook's own failure modes, §X.A to §X.L, in order. Rows 13 to 31 are **synthesized by this guide** from warnings in other handbook sections. Each row cites its source, but the handbook does not present them as a catalog. In rows 13 to 31, text in the "What goes wrong" column that is not in quotation marks is this guide's paraphrase.

| # | Failure mode | What goes wrong | Correction | Source |
|---|---|---|---|---|
| 1 | Conclusions stored as evidence | "Jev then confirms the conclusion because it was presented as a fact." | Store observable evidence: source count, source type, verified claims, unresolved claims, freshness | §X.A; §IV.B |
| 2 | No escape hatch | "The result looks confident because probability must sum over the closed menu." | Add none, other, stop or review whenever the menu can be incomplete | §X.B; §II.A |
| 3 | One threshold for every consequence | "This confuses prediction quality with authority." | Thresholds by action class; irreversible actions review-gated | §X.C; §V.A |
| 4 | Stale options | Worker unavailable, control gone, source changed | Rebuild the option set from live state; version every decision | §X.D; §VIII.A, §VIII.D Staleness Hazards |
| 5 | Blind retries | "Nothing new is learned." | Each retry adds evidence, changes the contract, narrows the menu, or escalates | §X.E; §IV.D; §V.B |
| 6 | Winner-only logging | "Calibration and audit become impossible." | Store a complete decision receipt | §X.F; §III.D Receipt; §VI.D |
| 7 | Policy inside the classifier | "This gives probabilistic judgment authority." | Permissions, budgets, scopes and external side effects in deterministic policy | §X.G; §I.E; §VII.B |
| 8 | Exact rules delegated to Jev | Attempt counts, dates, balances, allowlists, exact strings sent to a semantic model | "Use code." | §X.H; Table I; Table II |
| 9 | Unknown values hidden inside a label | Asking Jev for an undeclared name, URL, identifier or number: "extraction or generation, not typed choice" | Use the appropriate tool, then return to Jev when the outcome set is known | §X.I Unknown Values; §II.A |
| 10 | Multi-step plan compressed into one answer | Label implies search, verification and execution with no intermediate evidence | "Decompose the graph. Run the tool that creates evidence, update state, and ask the next contract." | §X.J; §VI.B |
| 11 | Verifier checks transport success | 200 / exit 0 declared success | Verify the goal: artifact presence, required structure, evidence, destination, unresolved approvals | §X.K; §VII.C |
| 12 | Contract changes without evaluation | Wording or option edit shipped as a harmless prompt edit | Version the contract, run historical examples, compare shadow behavior, preserve rollback | §X.L; §III.C |
| 13 | Transcript as state | Model reconstructs the workflow from mixed history | Compact evidence packet | §IV.A |
| 14 | Over-privileged state | Secrets / PII / proprietary code leak into decisions | Field-level access rules, projections | §IV.C State Access Control |
| 15 | Early flattening | 0.51 and 0.99 both become "yes" | Route on the distribution | §V.A |
| 16 | Decorative confidence | Medium zone changes nothing | Name the state-improving action | §V.B |
| 17 | Demo-set thresholds become policy | Unjustified automation boundaries | Threshold governance record | §V.C Threshold Governance |
| 18 | Global-average calibration | Hides the rare or consequential branch | Segment by contract version, consequence class, language, rare option | §V.D |
| 19 | Stale calibration | Old curve reused after changes or in a new workload | Re-estimate after contract/schema changes and new populations | §V.F |
| 20 | Batching dependent questions / mixing versions / evaluating after a write | Incoherent record, weak audit trail | Snapshot discipline, new state version for new evidence | §VI.G; §VI.C |
| 21 | Mixed latency/privacy class batch | Sensitive judgment inherits a cheap route | Batch only within one class | §VI.D Batching Economics |
| 22 | Unlocked execution after parallel decisions | Actions contend for file, queue, budget, account | Serialize or lock by deterministic resource policy | §VI.F |
| 23 | Evaluating risk from command names | Scripts, redirects, nested calls hide the real action | Normalize the tool proposal | §VII.D Tool Semantics |
| 24 | Jev at every edge / restating exact conditions / open-ended content from Jev | Uncertainty without intelligence; role misuse | Placement discipline | §VII.F |
| 25 | Faulty menu builder blamed on Jev | Correct Choice cannot recover a removed option | Test the builder separately | §VIII.D Option-Set Tests |
| 26 | TTL-only cache for permissions, budgets, live controls | Stale menus | Event-driven invalidation | §VIII.H |
| 27 | Praise-style option descriptions | Under-specified menu | Evidence conditions; review/none where options overlap | §VIII.F |
| 28 | No stop outcome | Agent keeps acting after completion | Declared stop with criteria | §VIII.G |
| 29 | Primitive mismatch | Multi-label as Choice; Score on unordered categories; Noul read as severity | Pick by answer shape; decompose | §II.G Primitive Anti-Patterns |
| 30 | Fake Score precision | 1.6 read as "80 percent good" | Treat as ordinal position | §II.B |
| 31 | Guardrails that depend on Jev confidence | The handbook states only the rule: "Guardrails should be deterministic and independent of Jev confidence." **Interpretation:** a guardrail tied to confidence gives no protection when that confidence is miscalibrated | Deterministic guardrails, independent of Jev confidence | §IX.I |

### 11.2 Operational correction table (Table IX, §X.M)

Caption: *"Many apparent model defects originate elsewhere in the harness."*

| Observed symptom | Inspect first |
|---|---|
| High confidence, wrong branch | Evidence, menu completeness, calibration |
| Review rate rising | State freshness and new option classes |
| Costs rising | Wrong routes and recovery work |
| Repeated loops | Stop option and retry evidence |
| Unsafe action | Authority boundary and policy order |
| Schema valid, meaning wrong | Criteria and representative tests |

### 11.3 Diagnostic order (§X.I Distinguish Model and Contract Error)

When a decision is wrong, check in this order:

1. Did the state contain the necessary evidence?
2. Was the option set valid?
3. Did the instructions distinguish outcomes?
4. Did the threshold map to the correct route?
5. Only then: model capability.

"This diagnostic order avoids compensating for harness errors with larger models, longer prompts, or repeated calls. Those responses increase cost while preserving the faulty boundary."

### 11.4 Incident review (§X.O)

- Reconstruct: **state, contract, distribution, threshold, policy, action, outcome.**
- "Identify the earliest incorrect boundary rather than the final visible failure."
- Corrective-action loci: **state construction, menu generation, contract wording, calibration, policy, execution.**
- "Store representative incident states as permanent regression fixtures. A fix is incomplete until the revised system produces the intended judgment and route on those fixtures without weakening unrelated cases."

---

## 12. The implementation playbook (§XI)

### 12.1 Ten-step sequence (§XI.A), verbatim

1. Map the agent loop and mark every hidden choice, score, yes-or-no judgment, retry, and stop decision.
2. Keep open-ended creation in the generative LLM and exact invariants in deterministic code.
3. Select one repeated, low-consequence semantic branch for the first Jev integration.
4. Define the decision contract: state, instructions, outcomes, escape hatch, thresholds, authority, escalation, and version.
5. Build compact evidence packets instead of passing transcript blobs.
6. Batch independent questions against one immutable state snapshot.
7. Route confidence into automate, improve-state, and human-review paths.
8. Run shadow mode and measure calibration on representative examples.
9. Automate the safest branch first and preserve rollback.
10. Expand one boundary at a time while monitoring completed-task economics.

Cross-references: step 1 = §I.G; step 2 = §I.D; step 3 = §IX.A, §VII.F; step 4 = §III; step 5 = §IV; step 6 = §VI; step 7 = §V; step 8 = §IX.D, §V.F; step 9 = §IX.F; step 10 = §IX.G, §IX.E.

### 12.2 Launch checklist (§XI.B, §XI.C), verbatim, 16 items

- [ ] The decision is semantic rather than generative or exact.
- [ ] State is compact, current, and evidence-based.
- [ ] Instructions define meaning explicitly.
- [ ] Choice has an escape hatch where needed.
- [ ] Score uses ordered verbal anchors.
- [ ] Noul is interpreted as yes-or-no uncertainty.
- [ ] Confidence changes the route.
- [ ] Code retains authority over side effects.
- [ ] Independent questions share one state version.
- [ ] Dependent questions follow a state update.
- [ ] Thresholds are consequence-specific.
- [ ] The full distribution is stored in the receipt.
- [ ] The contract has run in shadow mode.
- [ ] Representative tests include ambiguity and no-fit cases.
- [ ] Every retry adds evidence or changes the graph.
- [ ] The system can stop or escalate safely.

### 12.3 Suggested agent prompt (§XI, verbatim)

> "Read this handbook and the companion article. Map every hidden choice, score, yes-or-no judgment, and side-effect boundary in this repository. Propose one low-consequence decision contract to run in shadow mode first."

### 12.4 Sources (§XI, verbatim summary)

1. Rari. "Jev Engineering: Stop Using LLMs for Every Decision." X Article, 21 September 2026. https://x.com/0xwhrrari/status/2102020016539324501
2. TypeSafe AI launch materials and posts by Diogo Almeida, as quoted and summarized in [1]. "Reported latency, pricing, and 20-200x / 40-400x ranges are vendor claims and workload-dependent."
3. "Jev Engineering for Coding Agents." Independent working note supplied with the handbook's project. The handbook "uses its harness framing while remaining aligned with the system-boundary, primitive, calibration, and rollout guidance in [1]."

---

## 13. Numeric claims and their caveats

| Claim | Value | Source | Caveat |
|---|---|---|---|
| End-to-end latency | ~70-500 ms for Jev-shaped queries | Abstract; §I.C | "TypeSafe reports". Vendor-reported, not independently measured in the handbook (Source [2]). The handbook says latency and price "make high-frequency semantic branching plausible", but "do not eliminate system design" |
| Price | $0.042 per million input tokens, no metered output-token cost | Abstract; §I.C | Vendor-reported. Matches `TYPESAFE_API.md` ("output free") |
| Speed improvement | 20-200x | Abstract | "come from favorable workflow evaluations"; "workload-dependent ceilings rather than promises for every integration". Baseline not stated |
| Cost improvement | 40-400x | Abstract | Same caveat. "The architectural value of typed judgment does not depend on reaching the headline maximum." |
| Dependent calls | "One additional call may be acceptable. Twenty dependent calls can dominate the workflow" | §I.A | Illustrative, not a measured threshold |
| Retry rule example | "Stop after three attempts" | Table I | Example of an exact rule, not a recommended limit |
| Score interpolation | 1.6 is not "80 percent good" or "1.6 times better" | §II.B | Illustrative |
| Rubric size | "Prefer three to five well-separated levels" | §II.G Rubric Design | A preference, not a limit. Rationale: "More levels create an appearance of precision while reducing inter-rater agreement." The API accepts 2-10 |
| Noul midpoint | ~0.5 = evidence does not separate yes from no | §II.C | No numeric bands defined: "The application must still decide what probability range triggers automation, more evidence, or human review." |
| Flattening example | 0.51 vs 0.99 | §V.A | Illustrative |
| Threshold table | >= 0.90 automate (low); 0.70-0.89 evidence/check (low or medium); < 0.70 human (any); irreversible human at any confidence | Table V | "Thresholds are illustrative and must be calibrated per action class." |
| Decision record | research 0.05, write 0.03, fact_check 0.91, review 0.01; urgency 1.24; approval 0.82 | §VI.D | Illustrative. Urgency scale unstated |
| Shadow record | confidence 0.87 | §IX.D | Illustrative, not a threshold |
| Packet example | 7 sources, 3 official, max_sources 12, deadline 09:00 UTC | §IV.B, §IV.C | Illustrative |
| Structural counts | 3 owners, 3 boundary questions, 9 inventory branch types, 3 primitives, 5 Table II rows (2 "Not Jev"), 6 Choice use cases, 5 Noul use cases, 4 causes of type-valid wrong answers, 5 production needs (§II.E), 10 contract fields, 7 receipt fields, 7 state fields, 6 normalized proposal fields, 4 insertion points, 4 node purposes, 6 staleness object types, 6 Table VIII metrics, 6 Table IX rows, 10 playbook steps, 16 checklist items | Various | Counts of lists, not claims |

The handbook gives **no** numeric value for: "strong calibration", ECE targets, bin counts, shadow-mode duration, sample sizes, traffic-share percentages, sampling rates, drift windows or rollback triggers (§IX, §X, §XI). Any such number in FlowAId is FlowAId's own choice.

Related API facts (from `TYPESAFE_API.md`, not the handbook): `jev-latest` currently resolves to `jev-1.13.0`; 64k tokens per request, 32k tokens for state plus the longest question; about 1,200 rpm; text only; choice at most 255 options; score 2-10 levels; noul returns P(yes) with no separate confidence.

---

## 14. Glossary

| Term | Meaning | Section |
|---|---|---|
| Adjudication path | Process for resolving reviewer label disagreements while preserving systematic disagreement as a signal | §IX.E Labels |
| Allowed action | Contract field bounding what a result may authorize | §III.B |
| Boundary design | Deciding where language, typed judgment and code each belong | §I.F |
| Boundary test | Three questions: authored? ambiguous with known shape? exact? | §I.G Boundary Test |
| Brier score | Squared error between probability and binary outcome (Noul) | §V.D |
| Builder / verifier | Generative producer and rubric-plus-checks verifier sharing one artifact and rubric | §VII.D Builder and Verifier |
| Calibration | Agreement between predicted probability and observed frequency on the target workload | §V.C Calibration |
| Choice | Primitive: exactly one declared option wins | §II.A |
| Classwise / top-label calibration | Per-option / winner-only calibration for Choice | §V.D |
| Completed-task rate | End-to-end success | Table VIII |
| Consequence class | Stakes class of the downstream action; keys thresholds | §III.B, §V.A |
| Contract lifecycle | Define, evaluate on one snapshot, route, record | §III.E |
| Counterfactual evaluation | Replaying a new contract version on historical snapshots without side effects | §III.G |
| Decision contract | Versioned spec of state, instructions, outcomes, fallbacks, thresholds, allowed actions, escalation | Abstract, §III |
| Decision parallelism vs execution parallelism | Evaluate together; serialize or lock actions | §VI.F |
| Decision receipt | Per-decision record of contract version, state reference, distribution, threshold, consequence class, route, resulting action | §III.D Receipt |
| Decision record | Batch output keeping distributions plus state version | §VI.D Decision Record |
| Dependent sequence | STATE vN, decide, act, STATE vN+1 | §VI.E |
| Escape hatch | none / other / stop / escalate / review outcome | §II.A, §X.B |
| Evidence packet | Compact, observable, source-identified evidence passed to a decision or to generation | §IV, §VIII.E |
| Fixture | Stored state with expected route and short human rationale | §IV.F |
| Hidden-decision inventory | List of semantic branches, current owner and class | §I.G Inventory |
| Improve-state route | Medium-confidence path that changes evidence or options | §V.B |
| Inherited confidence | A prior conclusion passed as a fact | §IV.B |
| Insertion point | Before model, before tool, after tool, retrieval | §VII, Table VI |
| Invalid graph | Decision over stale state or options; a harness fault | §IV.D, §VII.A, §VIII.A |
| Least privilege | Only contract-required fields reach the model | §IV.C State Access Control |
| Menu builder | Component constructing the live option set | §VIII.D Option-Set Tests |
| Near-threshold mass | Traffic just above an automation boundary | §V.C Threshold Governance |
| Normalized tool proposal | Operation, target, destination, data class, reversibility, external side effects | §VII.D Tool Semantics |
| Not Jev | Table II's label for answer shapes Jev should not own: unknown free strings (use extraction or generation) and exact arithmetic (use deterministic code) | §II.D |
| Noul | Primitive: yes-or-no probability (FlowAId kind `boolean`; API type `noul`) | §II.C |
| Option-set version | Version of the menu evaluated, stored in the receipt | §VIII.H |
| Projection | Contract-specific view of run state | §IV.C |
| Recovery cost | Cost after a wrong branch | Table VIII |
| Reliability diagram | Confidence bins vs observed accuracy against the diagonal | §V.C Calibration, Fig. 2 |
| RLCD | Reinforcement Learning for Calibrated Decisions (TypeSafe's description of Jev's training) | §I.C |
| Route | auto, improve or human | Table III |
| Safe operating order | Jev judges; code checks policy; tool executes; trace records | §I.E, §X.N |
| Score | Primitive: position on an ordered verbal rubric | §II.B |
| Semantic drift | Degradation from changes in users, tools, options, language | §IX.H |
| Semantic transaction boundary | A batch's single version of reality | §VI.C |
| Shadow mode | Jev evaluates without acting; production path authoritative | §IX.D |
| State packet | Goal, facts, artifacts, evidence, constraints, options, version | §IV.A |
| State version | Identifier of the evaluated snapshot, e.g. `run_184:step_7` | §IV.C, §VI.D |
| Stop | Declared, auditable terminal outcome | §VIII.G |
| System one model | TypeSafe's framing of Jev as a fast judgment model | §I.C |
| Threshold governance | Owner, rationale, evaluation window, consequence class, rollback condition | §V.C Threshold Governance |
| Type safety is not truth | Well-typed answers can still be wrong (wrong evidence, stale options, ambiguous criteria, incomplete menu) | §II.E |

---

## 15. Open questions and ambiguities in the source

**Layout and lettering**

1. Duplicate subsection letters, confirmed in the PDF: §I has two "G" (Inventory the Hidden Decisions; An Operational Boundary Test); §II has two "G" (Rubric Design; Primitive Anti-Patterns); §III has two "D" (Review the Contract Like Code; The Decision Receipt); §IV has two "C" (State Access Control; A Compact State Packet); §V has two "C" (Threshold Governance; Calibration); §VI has two "D" (Batching Economics; Decision Record); §VII has two "D" (Tool Semantics; Builder and Verifier); §VIII has two "D" (Option-Set Tests; Staleness Hazards); §IX has two "E" (Labels and Adjudication; Evaluate the Whole System); §X has two "I" (Distinguish Model and Contract Error; Unknown Values Hidden Inside a Label). These are lettering defects in the source. Cite by title.
2. §I "Inventory the Hidden Decisions" is placed after §I.C in the left column but logically precedes the ownership model ("Before integrating Jev").
3. The `router@1..4` listing (§III.F area) has no caption and is never referenced in the text.
4. Fig. 1 is drawn as a linear pipeline. The text does not say every flow passes the LLM before Jev.

**Undefined vocabularies**

5. `consequence_class` values are never enumerated. Table V uses Low, "Low or medium", Any, Irreversible; the prose says "high consequence". There is no explicit "high (reversible)" row.
6. The route "improve" is named in Table III but defined only through §V.B's examples.
7. "Latency class" and "privacy class" (§VI.D) are not defined.
8. "Data class" in the normalized tool proposal (§VII.D) and the provider-eligibility categories in §VII.G (secrets, infrastructure, proprietary research, personal data) are not tied to a taxonomy.
9. "Incompatible projections of state" (§VI.A) has no operational definition or resolution procedure.
10. "Relevant writes" (§VI.C) and the mechanism for preventing writes between snapshot and evaluation (§IV.D) are unspecified.
11. The format of `state_reference` (Table III) is unspecified. Examples use `run_184:step_7` and `state_hash: 'b476...'`; §VI.C allows "state version or content hash".
12. Whether "model version" means the requested alias (`jev-latest`) or the resolved version (`jev-1.13.0`) is unspecified. The shadow record stores `jev-latest`.
13. The option-set version format and the escape-hatch mechanism for shortlisting (§VIII.B) are unspecified.

**Numeric gaps**

14. Table V leaves (0.89, 0.90) unassigned; the code sketch's `>=` comparisons resolve it.
15. No Table V row for medium consequence at >= 0.90.
16. The §V.E code sketch encodes only irreversibility plus two thresholds; it does not show how thresholds vary by class or encode "high consequence escalates" other than for irreversible.
17. Routing uses "confidence", but the live Noul API returns only P(yes). The handbook does not define Noul routing confidence. (FlowAId uses `max(pYes, 1 - pYes)`; calibration should still use raw P(yes) with Brier.)
18. No definitions of top-label or classwise calibration formulas, no bin counts, no ECE, no Score calibration metric.
19. No numeric targets for "strong calibration", sampling rate, traffic share, drift window or rollback trigger.
20. The 20-200x / 40-400x baselines are not stated.

**Internal inconsistencies**

21. The Score sketch's top level ("strong support from independent sources") differs from the prose ("strong support from multiple independent sources") (§II.B).
22. The Score sketch has no `instructions`; the live API requires them.
23. Table VIII lists six metrics; the prose lists seven, with different members (decision cost and downstream tool cost only in prose; calibration only in the table) (§IX.E).
24. The §IX.D prose says to log the distribution; the example record has no distribution field.
25. §VII.D Builder and Verifier routes failures to "repair, evidence collection, or escalation"; Table VI says "Pass, repair, or escalate".
26. §VII.C does not say explicitly that Jev performs verification; that role comes from Table VI and §VII.D.
27. "Consulting a stronger model" appears as a medium-confidence action in §V.A but not in §V.B's list; "stronger model" is undefined.
28. The §VII.B code sketch names ALLOW and REVIEW; the third outcome is an implicit else/block. `user_scope` and the `judgment` shape are undefined.
29. The example packet keys (§IV.C) do not match Table IV's field names one-to-one.
30. Escape-hatch vocabularies vary by section: none/other/stop/escalate (§II.A), none/other/stop/review (§X.B), review/none (§VIII.F), stop (§VIII.G).

**Scope**

31. Stop "should usually" be included (§VIII.G), not always. The relevance contract "may" score support, authority and freshness (§VIII.E), so these are permissive.
32. The handbook is an independent study edition, not TypeSafe documentation. For API field names and behavior, `TYPESAFE_API.md` is authoritative.
33. The handbook does not address how the consensus pattern (several voters, same state) relates to its warning about false reassurance from repeated evaluation (§V.B). That is a FlowAId-specific question (§16).

---

## 16. Appendix: what this means for FlowAId

This appendix is **interpretation**. It compares the handbook with FlowAId's design and plan as of this writing (design docs describe intended behavior, not necessarily shipped code) (`docs/design/CONTRACTS.ts`, `ARCHITECTURE.md`). Changes to frozen contracts go through `docs/design/RFCS.md`.

### 16.1 Where FlowAId already aligns

| Handbook requirement | FlowAId today |
|---|---|
| Typed answers with full distributions (§II, §X.F) | `DecisionResultSchema` (boolean/choice/score) carries `probabilities`, `confidence`; `DECISION_COMPLETED` persists the full result |
| One snapshot, many questions (§VI.A) | `flowaid.decision.batch` and compiler batch groups keyed by state binding; `DECISION_REQUESTED` carries `batchId` and `stateHash` |
| Choice keys limited to declared options (§II.A, §X.I) | Choice keys become control ports (CONTRACTS.ts); returned keys validated against declared options (planned in UPGRADE_PLAN, TypeSafe provider item) |
| Score keeps level texts (§II.G) | `ScoreDecision.levels` |
| Confidence routing (§V.A) | `confidence_gate` (`threshold`, optional `reviewBand`, outcomes pass/review/fail); `router.minConfidence` |
| Irreversible side effects recognized (§V.A) | Node idempotency `'none'` = irreversible; `E_RETRY_ON_IRREVERSIBLE` |
| Calibration (§V.C) | `EvaluationSummary.calibration` with ECE and bins |
| Failover to other providers | `DecisionPolicySchema` primary + failover |

### 16.2 Gaps, ordered by the handbook's emphasis

1. **Versioned DecisionContract artifact** (§III). `DecisionQuestionSchema` has only `kind`, `instructions`, and `options`/`levels`/`criteria`. Missing: state schema/projection, fallback outcome, thresholds with governance, consequence class, allowed action, escalation path, pinned model version, and a contract id@version independent of workflow versions.
2. **Decision receipt** (Table III, §VI.C, §VIII.H, §X.N). No persisted record of contract version, state reference/snapshot, selected threshold, consequence class, route (auto/improve/human), option-set version, per-question evidence scope, policy verdict and resulting action.
3. **Three-zone routing** (§V.A). `confidence_gate` sends the middle band to `review` (human) and the lowest band to `fail`. The handbook sends the middle band to **improve state** and the low band to **human review**. Add a mode with outcomes `automate | improve | human` and a consequence-first check.
4. **Consequence-specific thresholds and governance** (§V.A, §V.C). Thresholds are plain variables or literals. They need an owner, rationale, evaluation window, consequence class and rollback condition, and must be keyed by class.
5. **Score semantics** (§II.B). `ScoreDecision.normalized = value / (levels - 1)` invites the "80 percent good" reading the handbook rejects. Keep it only as a display position; the UI should show the position between neighbouring level descriptions.
6. **State packets** (§IV). `DecisionState` is "string | JsonObject | string[]" and "Objects are sent verbatim". Add a StatePacket shape (goal, facts, artifacts, evidence[], constraints, options, version), per-contract field allowlists (least privilege, using `x-dataClass`), freshness metadata on evidence, and lints for transcript-as-state and conclusion-as-evidence.
7. **Snapshot discipline** (§VI.C). Add a human-readable state version beside `stateHash`, write fencing or race recording, and a retrievable immutable snapshot for replay.
8. **Latency/privacy class in batch grouping** (§VI.D). Batch groups should also require the same privacy/data class and latency class.
9. **Blind-retry guard** (§IV.D, §V.B, §X.E). Refuse or escalate re-evaluation of the same (contract version, state hash, question) unless evidence or the contract changed. Distinguish transport retries (429/529/timeouts) from semantic retries.
10. **Live menus** (§VIII). Choice options are static config today. Add an option-set producer run immediately before evaluation, reserved `stop`/`review`/`none` outcomes, candidate-count telemetry (original, filtered, shortlisted, final), option-set versioning, post-choice validity checks per Table VII, and menu-builder fixtures.
11. **Harness insertion points** (§VII). Normalized `ToolProposal` for agent tool calls; a pre-tool semantic-risk gate whose output feeds deterministic `policy.apply` and can never turn a deny into an allow; a goal verifier that does not treat 2xx/exit 0 as success; a Jev relevance stage in RAG; provider eligibility pruning by data class before the router sees the menu.
12. **Shadow mode** (§IX.D). No shadow concept exists in the design docs. Add a per-decision mode where Jev evaluates alongside the authoritative path and logs the shadow record, with later human-label backfill.
13. **Evaluation** (§IX.C, §IX.E, §V.D). Case-category tags (normal, ambiguous, missing evidence, adversarial, stale options, rare class, no fit); Brier on raw pYes for boolean; top-label and classwise calibration for choice; segmentation by contract version, consequence class, language and option; recovery cost and downstream tool cost; cost per completed task as the headline KPI; confidence-monotonicity checks.
14. **Rollout and drift** (§IX.F-§IX.I). Automate one outcome at a time; deterministic guardrails (traffic share, tenant, language, consequence cap, review sampling, rollback trigger defined before launch); per-contract rollback; drift alerts on review rate, confidence shifts and escape-answer rate.
15. **Diagnostics and critique** (§I.G, §II.D, §VII.F, §XI.B). Compiler/critique rules for: generation used for a Jev-shaped decision (enum/boolean/ordinal output from `ai.*`); Jev used for exact conditions or free strings; Choice without an escape outcome; rubrics outside three to five levels (a warning, not an error: the handbook only says "Prefer three to five", and the API accepts 2-10); Noul used as severity; decisions whose confidence never changes the route; consequential side effects reachable from a decision without a deterministic policy step; decision loops without an evidence-producing node. The 16-item launch checklist maps to a publish-time readiness check.
16. **Hidden-decision inventory** (§I.G, §XI.A step 1). An AI-builder/import feature that lists every semantic branch, its current owner and its class, and proposes one low-consequence contract for shadow mode first.
17. **Incident review** (§X.O). A view that reconstructs state, contract, distribution, threshold, policy, action and outcome, walks the §X.I diagnostic order, records the earliest incorrect boundary and corrective locus, and promotes the incident state to a permanent regression fixture.
18. **Consensus node** (§V.B). All voters see the same state, so agreement can be the false reassurance the handbook warns about. Document this, and do not let consensus alone upgrade a higher-consequence action to automate.
19. **Honest economics in UI and docs** (Abstract, Source [2]). Show TypeSafe's figures as vendor-reported, workload-dependent ceilings. Report measured latency and cost from FlowAId runs, and report "generative calls removed" plus task outcome, never "Jev call count" as a success metric (§VII.F, §IX.H).
