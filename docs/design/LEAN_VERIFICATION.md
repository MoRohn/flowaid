# flowaid — Lean 4 verified evaluation: a self-critical assurance layer

Status: **authoritative addendum** to `ARCHITECTURE.md` (v1.0, 2026-09-23). Product requirement
from the owner: _FlowAId must gain an advanced, self-critical evaluation process of its results
using Lean 4 concepts and strategies._ Contract changes are proposed as RFC-0017 in `RFCS.md`;
`CONTRACTS.ts` stays frozen until it is accepted. Delivery is track **L** in
`docs/UPGRADE_PLAN.md` and `docs/upgrade-plan.json`.

Sources: the owner's article (`docs/research/lean4/lambdaclass-lean4-article.md`, cited
[ART]), the expert guide (`docs/research/lean4/LEAN4_EXPERT_GUIDE.md`, cited [GUIDE §n]) and
the hands-on report with measurements on this machine (`docs/research/lean4/HANDS_ON.md`, cited
[HANDS §n / Gn]). Every Lean fact below was either measured on Lean 4.34.0 or comes from those
documents.

---

## 0. Summary for implementers

The article's thesis: Lean "guarantee[s] that the specification is correct and consistent before
writing a single line of low-level code", it separates compile-time from execution errors, and
through certified code extraction it produces a binary that is both an "armored library" for
production and a "witness calculator" or "black box of truth" for certified computation [ART].
FlowAId applies this to **its own results**. Every claim the platform makes about a run, a
decision, an evaluation or a compiled plan gets an assurance tier. The strongest tiers are
backed by a small Lean checker whose soundness is proved for all inputs.

Ten rules every FlowAId component follows from now on:

| #   | Rule                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V1  | **Only the checker's verdict is truth.** An LLM or Jev critic may _explain_ or _propose_; a claim is `CHECKED` only when `flowaid-certify` accepted it, and `PROVEN` only when a Lean theorem covers it for all inputs.                                                                                                        |
| V2  | **Every reported claim carries a tier**: `PROVEN`, `CHECKED`, `TESTED` or `ASSUMED` (§2). Reports list what they do **not** cover, the way the article's range-constraint caveat should have been listed [ART; HANDS §3.2].                                                                                                    |
| V3  | **Unverified is never pass.** If the checker is unavailable, times out or rejects its input as malformed, the verdict is `unverified`. It blocks wherever `pass` is required.                                                                                                                                                  |
| V4  | **Spec first.** A Lean model and its theorems are written and reviewed before the TypeScript that they constrain grows further; the TS stays the production implementation and is tested against the model, never the other way round [GUIDE §11.1, §13.3].                                                                    |
| V5  | **Proofs on Lean, logic in TypeScript.** The reducer, compiler and routing engine stay in TypeScript (they also run in the browser). Lean checks them by differential testing and by checking the certificates they emit; it does not replace them [GUIDE §7.3].                                                               |
| V6  | **The certified core is `Init`-only** (no `import Lean`, no Mathlib): 2.4 MB binaries, ~2.5 ms per spawn, ~52 ns per in-process check [HANDS §3.4, G14]. JSON lives in a thin, separately tested shell.                                                                                                                        |
| V7  | **Numbers are exact.** Probabilities are parts per million (`Nat`), money is integer micro-USD (`Int`), thresholds are `Rat` or ppm. Never `Float` in a spec: it has no laws in Lean [GUIDE §12.3].                                                                                                                            |
| V8  | **The trust gate is layered**: `lake build --wfail`, an axiom allow-list (`propext`, `Quot.sound`, `Classical.choice`), and `leanchecker`. None alone is enough [HANDS G5, G9; GUIDE §10]. `sorry`, `native_decide`, `partial`, `unsafe`, `extern`, `implemented_by` and custom axioms are forbidden in the certified package. |
| V9  | **Self-critique is part of every proof review**: unused hypotheses (the linter), vacuity, a kernel-checked counterexample for each hypothesis showing it is necessary, and model fidelity ("is this the thing we deploy?") [HANDS §3.2, §5].                                                                                   |
| V10 | **The boundary is the weak point.** Canonical JSON numbers, no duplicate keys, explicit exit codes 0/1/2, every IO error caught [HANDS G11–G13]. The proof covers the checker, not the parser, and the tier of anything crossing the boundary says so.                                                                         |

---

## 1. The article's concepts, mapped to FlowAId

| Article concept [ART]                             | What it means                                                               | FlowAId use                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layered architecture: compile vs execution errors | Errors caught while building the spec never reach production                | Three layers of error: **Lean build** (spec and proofs), **compiler diagnostics** (`E_*` before publish), **runtime** (`RUN_FAILED`). Each regression records the layer that caught it (§9.4) |
| Specification before low-level code               | The model is checked for consistency first                                  | A Lean model of decisions, gates, routing, receipts, evaluation verdicts and activation (§4), written before the matching TS grows                                                            |
| Curry–Howard: types are propositions              | A checker that returns a proof-carrying value cannot lie about the property | `certify : Input → Option {x // Spec x}`; the proof is erased at compile time [HANDS §3.3]                                                                                                    |
| Type safety as logic safety                       | If it compiles, the proof holds                                             | Only after the trust gate (V8): a green `lake build` alone passes with `sorry` [HANDS G5]                                                                                                     |
| Certified code extraction to C                    | Proven logic, compiled to a native binary                                   | `flowaid-certify`, a Lean executable built from the certified core (§5)                                                                                                                       |
| Data (Type) vs Proofs (Prop)                      | Proofs are erased; only data runs                                           | Observed in the generated C: the subtype's proof field is gone [HANDS §3.3]                                                                                                                   |
| "Armored library" (developer view)                | Critical logic in a binary that cannot accept a false result                | The checker validates receipts, gate routes, evaluation verdicts and plan certificates                                                                                                        |
| "Witness calculator" (mathematician view)         | The binary computes the object an existence theorem promises                | The checker also **recomputes** results (a gate route, an evaluation verdict, a pass rate) and returns a counterexample witness when a claim is false                                         |
| "Black box of truth"                              | A result you do not have to doubt                                           | Tier `CHECKED`: the TS result agreed with the checker's recomputation                                                                                                                         |
| Perceus-style reference counting                  | Unique ownership allows in-place updates                                    | Matters only for the checker's throughput; measured and documented, including the quadratic fall-off when a structure is shared [HANDS §3.4]                                                  |
| "Proved for all inputs, not test cases"           | Theorems quantify over every input                                          | Tier `PROVEN` vs `TESTED` in every report                                                                                                                                                     |
| The range-constraint caveat                       | A theorem holds only under its hypotheses                                   | Every certificate lists its assumptions; the hands-on study showed that the article's example needs the range constraints to be true in the field model [HANDS §3.2]                          |

**Honest limits** [GUIDE §7.2, §14]: "certified extraction" means proven logic plus a trusted
compiler, C toolchain and runtime. Theorem _statements_ are not checked for meaning, so a proof
can be right while the spec is wrong. The Lean compiler changes between versions, so
differential tests re-run on every toolchain bump. FlowAId never describes a Lean binary as
correct beyond this.

---

## 2. The assurance ledger

Every claim in an `EvaluationSummary`, a `RegressionReport`, a Jev decision receipt, a run
certificate or a publish gate carries one tier [GUIDE §13.1]:

| Tier      | Meaning                                                                                                    | Recorded with                                                    | Example                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PROVEN`  | A Lean theorem covers the claim for every input of the modelled type                                       | Theorem name, validation level (L1–L4, §8), axiom set, toolchain | "the gate returns exactly one of pass/review/fail and is monotone in confidence"               |
| `CHECKED` | This specific result was recomputed or validated by `flowaid-certify`, whose check has a soundness theorem | Checker version, theorem name, input hash                        | "run 0190…'s gate routes were recomputed and agree"                                            |
| `TESTED`  | Holds on a dataset or a differential-testing corpus only                                                   | Corpus id, size, seed                                            | "accuracy 0.94 on 200 cases"; "TS reducer and Lean model agree on 1M generated logs"           |
| `ASSUMED` | Trusted and not checked                                                                                    | The reason                                                       | provider calibration; `judge` matchers; `W_TYPE_UNVERIFIED` edges; the JSON and float boundary |

Rules:

- A report shows the tier next to each number, and a **Not covered** list (the article's caveat,
  made mandatory).
- The compiler's `verified: false` subset results (`W_TYPE_UNVERIFIED`) are treated like a
  `sorry`: recorded, surfaced, never silently passed.
- The publish gate reads tiers, not only values: a gate may demand `CHECKED` for the properties
  it names (§9.3).

---

## 3. Layered architecture

```
 SPEC        lean/FlowaidCert      Lean model + theorems (PROVEN)            ← reviewed first (V4)
   │                                    │ extraction (erases proofs)
   ▼                                    ▼
 COMPILE     workflow-compiler     diagnostics E_*/W_*  +  certificates      ← flowaid-certify checks
             (TypeScript)          (exclusivity, order, subset derivations)     each plan (translation validation)
   │
   ▼
 EXECUTE     workflow-runtime      event log, receipts, outputs              ← TS, tested against the Lean
             (TypeScript)                                                        model by DRT (§7)
   │
   ▼
 CERTIFY     flowaid-certify       per run / receipt / evaluation / plan:     ← CHECKED or a counterexample
             (Lean binary)         verdict + witness
   │
   ▼
 CRITIQUE    evaluation + critic   failed obligations → findings, regression  ← only the checker decides (V1)
                                   fixtures, publish-gate blockers
```

---

## 4. The Lean model and its theorems

### 4.1 Package layout (`lean/`)

```
lean/
  lean-toolchain            leanprover/lean4:v4.34.0 (pinned; see §8.4 for the 4.35 move)
  lakefile.toml             packages: FlowaidCert (lib), FlowaidCertCli (exe), FlowaidCertTest (test driver)
  lake-manifest.json        committed; no dependencies (no Mathlib)
  FlowaidCert/              certified core — Init-only, no sorry/native_decide/partial/unsafe/extern/implemented_by/axiom
    Num.lean                ppm (Nat, 1e6 = 1), micro-USD (Int), Rat helpers; conversion lemmas
    Decision.lean           DecisionResult model; invariants; boolean confidence
    Gate.lean               confidence gate; totality, determinism, monotonicity
    Route.lean              Jev routing precedence (JEV_ENGINEERING §6.4) over a finite contract model
    Receipt.lean            receipt consistency (the checkReceipt rules) and hash-chain structure
    Evaluation.lean         pass rate, verdict, flips; calibration bin partition and ECE bounds
    Activation.lean         exclusive groups, readiness, pruning, completion over a finite plan graph
    Certificates.lean       plan certificates: guard exclusivity, topological order, subset derivations
    Property.lean           the property DSL (§6) and its decision procedure over finite plans
    Check.lean              checkers `check* : Input → Bool` with `check*_sound` theorems; `certify*` subtypes
  FlowaidCertCli/           the IO shell: Lean.Json parsing, canonical-number and duplicate-key rejection, exit codes
    Main.lean
  FlowaidCertTest/          #guard / #guard_msgs tests, pinned #print axioms, golden JSON vectors
  gate/AxiomGate.lean       allow-list gate over every exported theorem (from HANDS appendix)
  tests/vectors/*.json      golden request/certificate pairs shared with the TS side
```

The certified core imports only `Init` [HANDS G14]. `FlowaidCertCli` imports `Lean.Data.Json` and
is the only part of the binary outside the proofs; it is covered by property-based tests and
round-trip vectors rather than by proofs [GUIDE §7.2].

### 4.2 Representation

- **Probabilities**: `Nat` parts per million. A distribution is valid when every entry is ≤ 10⁶
  and the sum is within a stated tolerance of 10⁶ (renormalized input from providers is rounded,
  so `|Σ − 10⁶| ≤ n` for `n` entries) [GUIDE §12.4].
- **Money**: `Int` micro-USD; run cost is an exact sum [GUIDE §13.2 item 7].
- **Thresholds**: ppm. The TS→Lean conversion is explicit, documented and rounding-directional:
  thresholds round **up**, confidences round **down**, so conversion never turns a `review` into
  a `pass`. NaN and infinities are rejected at the boundary.
- **Identifiers**: strings compared by equality only.

### 4.3 Theorems, in priority order

Statements are sketched in Lean syntax; names are the ones the ledger records. Every theorem is
proved for all inputs of its type, pinned with `#guard_msgs` on `#print axioms`, and passes the
self-critique review (§8.3).

1. **Decision invariants** (`Decision.lean`, from ARCHITECTURE §2.8 and TYPESAFE_API):
   - `bool_confidence_ge_half : ∀ p ≤ 10⁶, max p (10⁶ - p) ≥ 500000`
   - `bool_confidence_symmetric`: the confidence of `p` equals that of `10⁶ − p`
   - `choice_value_mem : wf d → d.value ∈ d.options` and `choice_confidence_is_top : wf d → d.confidence = maxProb d`
   - `score_bounds : wf s → s.value ≤ (s.levels - 1) * 10⁶ ∧ s.level = roundDiv s.value 10⁶`
   - `renormalize_sound`: renormalizing a distribution whose sum is within [0.9, 1.1]·10⁶ yields a
     valid distribution with the same argmax (ARCHITECTURE §6.4)
2. **Confidence gate** (`Gate.lean`, ARCHITECTURE §6.3):
   - `gate_total_det`: exactly one of `pass | review | fail` for every input
   - `gate_mono`: raising confidence never moves the outcome down (fail ≤ review ≤ pass)
   - `gate_no_fail_without_band`: without `reviewBand` the gate never returns `fail`
   - `gate_bool_eq_two_choice`: a boolean decision and a two-option choice with the same
     confidence route the same way (the reason `confidence = max(p, 1−p)`)
3. **Jev routing** (`Route.lean`, JEV_ENGINEERING §6.4, handbook §V.E):
   - `route_irreversible_human`: consequence `irreversible` ⇒ route `human`, for every confidence
   - `route_auto_requires`: `route = auto` ⇒ confidence ≥ autoAt ∧ margin ≥ minMargin ∧ outcome
     automatable ∧ calibrated ∧ not an escape (except a declared automatable `stop`) ∧ a port exists
   - `route_mono_confidence`: with everything else fixed, raising confidence never lowers the route
   - `route_disposition_only_lowers`: a rollout disposition can only reduce authority
   - `route_deterministic`: the route is a function of its inputs (so reconstruction can replay it)
4. **Receipt consistency** (`Receipt.lean`, JEV_ENGINEERING §12): the six `checkReceipt` rules as
   a decidable predicate, with `checkReceipt_sound`; `chain_verify_sound`: a verified chain's links
   are contiguous and each back-pointer names its predecessor (hashes are treated as opaque
   values; collision resistance is `ASSUMED`).
5. **Evaluation verdict and calibration** (`Evaluation.lean`, ARCHITECTURE §10.4):
   - `passRate_bounds : 0 ≤ passed ≤ cases`, and the verdict is `fail ↔ passed * 10⁶ < minPassRate * cases`
   - `verdict_mono`: raising `minPassRate` never turns a `fail` into a `pass`
   - `flips_complete`: every case whose outcome differs between baseline and candidate appears in
     `flips`, and swapping the two sides mirrors the flips
   - `bins_partition`: calibration bins partition [0, 10⁶] and their counts sum to N
   - `ece_bounds`: `0 ≤ ECE ≤ 10⁶`, and ECE does not depend on the order of cases
6. **Activation semantics** (`Activation.lean`, ARCHITECTURE §2.5, §2.7, §5.3), over a finite plan
   graph and an event sequence:
   - `exclusive_group_at_most_one`: within an exclusive group at most one edge fires
   - `ready_not_pruned`: a node is never both ready and pruned
   - `prune_monotone`: once pruned, always pruned
   - `producer_before_consumer`: a data consumer runs only after its producers settle
   - `replay_deterministic`: reducing the same event log gives the same state
   - `completion_rule`: completion follows §2.7 (drained root with ≥ 1 output, or early exit)
7. **Plan certificates** (`Certificates.lean`, GUIDE §11.3): the compiler does not have to be
   proved; it **emits certificates** that a small proven checker validates:
   - `exclusive_cert_sound`: a certificate naming a contradictory literal pair for every pair of
     clauses of two guards implies the guards are never simultaneously satisfied
   - `topo_cert_sound`: a certified Kahn order respects every edge of the scope
   - `subset_cert_sound`: a derivation tree for `isSubschema(S, T) = ok, verified` (in the handled
     fragment) implies every value valid under S is valid under T
8. **Accounting**: run cost equals the sum of node costs in micro-USD; loop and foreach
   accumulators are conservative upper bounds (the same linear shape as the article's limb example).

Items 1–3 and 5 are finite and mostly linear and fit `omega`, `decide` and `grind` over `Nat`/`Rat`
in core Lean. Items 6–7 need induction over event lists and are staged after them (§12).

---

## 5. `flowaid-certify`: the certified checker

### 5.1 Pattern

For each property family: a `Prop` spec, a `Bool` checker, a soundness theorem
`check_sound : check x = true → Spec x`, and where useful a completeness theorem and a witness
calculator that recomputes the value. The same shape was built and measured in the hands-on
study: 2 s clean build, 2.4 MB core, ~52 ns per check [HANDS §3.3–3.4, §5].

### 5.2 Protocol (versioned; the only boundary)

Request (stdin, one JSON document; or NDJSON in the long-lived mode):

```json
{ "protocol": "flowaid-certify/1", "kind": "receipt" | "gate" | "route" | "evaluation" | "plan" | "property" | "run",
  "input": { … }, "inputHash": "<sha256 of the canonical input>" }
```

Response (stdout, one line):

```json
{ "protocol": "flowaid-certify/1", "verdict": "accept" | "reject", "kind": "…",
  "claims": [ { "id": "gate.route", "tier": "CHECKED", "theorem": "FlowaidCert.gate_check_sound", "ok": true } ],
  "counterexample": { "claim": "…", "witness": { … }, "explanation": "…" } | null,
  "assumptions": [ "sha256 collision resistance", "provider calibration" ],
  "checker": { "version": "0.1.0", "lean": "4.34.0", "axioms": ["propext", "Quot.sound"] },
  "inputHash": "…" }
```

Exit codes: **0** accept, **1** reject, **2** malformed input or internal error. `main` catches
every IO error and maps it to 2, so a crash can never read as a verdict [HANDS G13]. The shell
rejects numbers with exponents or fractions where integers are expected, and duplicate keys,
before the core sees anything [HANDS G11–G12]. Numbers cross the boundary as integers (ppm,
micro-USD) produced by the TS side with the §4.2 rounding rules.

### 5.3 Modes

- **Spawn per request**: ~2.5 ms for an `Init`-only binary, ~17 ms with `Lean.Json`
  [HANDS §3.4]. Used by the CLI, CI and low-volume jobs.
- **Long-lived process**: newline-delimited requests on stdin; used by the worker for per-run
  certification.
- **Optional later**: a static library with scalar-only `@[export flowaid_…]` entry points behind
  N-API, only if the first two modes prove too slow [GUIDE §7.3; HANDS G20].

### 5.4 The TypeScript bridge: `@flowaid/certify`

A new server-side package (`certify → workflow-core, shared`; not browser-safe). It contains:

- the protocol schemas in Zod, with a parity test against `lean/tests/vectors/*.json`;
- the process bridge (binary discovery through `FLOWAID_CERTIFY_BIN`, timeout, output cap,
  `AbortSignal`, long-lived pool);
- **obligation builders** that turn FlowAId objects into requests: a `DecisionResult`, a Jev
  receipt, a gate configuration, an `EvaluationSummary` + its cases, an `ExecutionPlan` with its
  certificates, a run's event log;
- a **TypeScript reference implementation** of every check, used as the second side of the
  differential tests (§7) and as a fast pre-filter, never as a verdict;
- **degradation**: when the binary is absent, the bridge returns `unverified` with the reason; it
  never returns `accept` itself (V3).

---

## 6. User properties: a small, decidable DSL

Workflow authors state properties of their own flows. Each compiles to a Lean-decidable check
over the finite `ExecutionPlan` graph, so `decide` settles it for that plan, and the result is
`CHECKED` for that plan version.

| Property (DSL)                                                         | Meaning                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `every path to tool(http, method in [POST, PUT, DELETE]) passes human` | No irreversible HTTP call is reachable without a human node on every path          |
| `every path to node(refund) where input.amount > 50 passes human`      | Consequential branches are review-gated (guards are path conditions from the plan) |
| `gate(safe).threshold >= 0.9 in environment production`                | Governance of thresholds per environment                                           |
| `no decision(kind: choice) without escape`                             | Every Choice menu has an escape hatch (Jev failure mode 2)                         |
| `every jev.decide has consequence != irreversible or routes human`     | Jev rule R3 as a plan property                                                     |
| `loop(*) has maxIterations <= 10 and maxCostUsd <= 0.50`               | Bounded loops                                                                      |
| `output(*) exclusive`                                                  | No two output nodes can both complete (W_OUTPUT_AMBIGUOUS as a checked property)   |

Grammar (EBNF sketch): `property := quantifier target (condition)? requirement`, with
quantifiers `every path to`, `no`, `every`; targets `node(id|*)`, `tool(kind, filter)`,
`decision(filter)`, `gate(id)`, `loop(id|*)`, `output(*)`; requirements `passes human`,
`passes node(id)`, `has <field> <op> <value>`, `exclusive`, `routes human`. The DSL lives in
`WorkflowDefinition.execution.properties` (RFC-0017) and in evaluation sets. A violated property
returns a **counterexample witness**: the path, the guard assignment or the node that breaks it.

---

## 7. Differential testing against the Lean model (Cedar-style)

Following Cedar's verification-guided development [GUIDE §11.1–11.2]:

- **Generators** (fast-check, type-directed): definition → compiled plan → valid event sequences,
  plus an ill-typed generator. Watch the distribution of generated conditions; line coverage is
  not enough.
- **Targets**: TS gate vs Lean gate; TS `route()` (from `@flowaid/jev`) vs Lean route; TS
  `checkReceipt` vs Lean; TS evaluation summary vs Lean recomputation; TS reducer vs Lean
  activation model on generated logs; compiler certificates vs the Lean checker.
- **Comparison modes**: exact for states, routes and verdicts; code-level for diagnostics; a
  stated tolerance only where the TS side uses floats, with the tolerance recorded in the report.
- **Cadence**: a fast corpus in every PR, a minimized corpus per release, a nightly long run;
  **re-run on every Lean toolchain bump** because the Lean compiler changes [GUIDE §7.2].
- **Conformance replay**: golden and recorded run logs go through the Lean model, which validates
  the spec itself against real behaviour [GUIDE §11.1 LNSym].

Differential testing is evidence (tier `TESTED`), not proof.

---

## 8. Trust gate and self-critique

### 8.1 CI job `lean` (Linux)

1. Install elan with `--no-modify-path`, pinned toolchain [HANDS G1].
2. `lake build --wfail FlowaidCert FlowaidCertCli` (list both targets) [HANDS G5–G7].
3. `lake test` (pinned `#print axioms` through `#guard_msgs`, golden vectors).
4. `lake env lean gate/AxiomGate.lean`: allow-list `propext`, `Quot.sound`, `Classical.choice`;
   matches forbidden names by pattern (`sorryAx`, `_native`, `trustCompiler`) because names change
   between versions [HANDS G8].
5. `lake env leanchecker` on changed modules; `--fresh` nightly [HANDS §3.4].
6. A source lint forbidding `sorry`, `native_decide`, `axiom`, `partial`, `unsafe`, `extern` and
   `implemented_by` in `FlowaidCert/`.
7. The `@flowaid/certify` differential suite against the freshly built binary.

### 8.2 Validation levels recorded in the ledger

L1 `--wfail` build · L2 pinned axioms · L3 `leanchecker` · L4 `lake comparator` with independent
kernels (Linux, from 4.35) [GUIDE §10]. A `PROVEN` claim records the level it reached.

### 8.3 The self-critique review (every theorem, every change)

From the hands-on study of the article's own theorem [HANDS §3.2]:

1. **Unused hypotheses**: the linter flags them; either the hypothesis is removed or the theorem
   is too weak. (The article's carry-bit hypotheses were unused over `Nat`.)
2. **Necessity**: for each hypothesis, a kernel-checked counterexample shows the theorem is false
   without it. (The field-level limb theorem is false without range constraints.)
3. **Vacuity**: the hypotheses are satisfiable (a concrete instance is exhibited).
4. **Model fidelity**: a written argument that the modelled type and semantics are the ones the
   TS implementation and the deployed system use, plus the conformance replay of §7.
5. **Statement review** by a person other than the author; AI-generated proofs are welcome, but
   AI-generated _statements_ are not accepted without human sign-off [GUIDE §11.6].

### 8.4 Toolchain policy

Pin `v4.34.0`. Move to 4.35 once stable (it adds `lake check` and bundled independent kernels),
as a separate PR that re-runs every differential test [GUIDE §9, §14 item 34]. Mathlib is not
used; if real-valued statements are ever needed they go in a separate `FlowaidSpec` package that
the production binary never links [GUIDE §12.4].

---

## 9. The self-critical evaluation loop

### 9.1 Obligations

Each FlowAId result generates obligations:

| Result                  | Obligations                                                                                                              | Checked when                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Compiled plan (publish) | exclusivity, order and subset certificates; user properties (§6)                                                         | On publish, and at the worker's plan-hash re-check |
| Run                     | every gate route and Jev route recomputed; receipts consistent; receipt chain verifies; accounting sums; completion rule | After the terminal event, by the `certify.run` job |
| Jev decision receipt    | the §4.3 item 3–4 claims                                                                                                 | With the run; also on replay                       |
| Evaluation run          | pass rate, verdict, flips, calibration bins and ECE recomputed from the cases                                            | Before a report is shown or used as a publish gate |

### 9.2 What happens with a verdict

- `accept` → the claims are stored with tier `CHECKED` and shown with a certificate badge.
- `reject` → the counterexample becomes a **critic finding** (severity from the property), a
  **regression fixture** (the witness input, added to the workflow's evaluation set through the
  existing `add-to-evaluation` path), a **TraceReviewer** input (`FILE_BUG` for a checker
  rejection of a platform invariant, since that is a platform defect), and a **publish-gate
  blocker** when the property is required.
- `unverified` → shown as such; blocks wherever the gate requires `CHECKED`.

The LLM or Jev critic may attach an explanation to a rejection (why the counterexample happens,
which node to change), but the finding exists because the checker rejected, not because a model
said so (V1). The critic's suggested fix is re-checked before it can close the finding.

### 9.3 Publish gate

`requireEvaluation` (ARCHITECTURE §10.4) gains `requireCertified: string[]` (property or claim
ids). Publish fails with 422 and the counterexamples when any required claim is `reject` or
`unverified`.

### 9.4 Which layer caught it

Every regression records the layer that caught it: `lean_build` (spec or proof), `compiler`
(an `E_*` diagnostic), `certify` (a checker rejection), `runtime` (`RUN_FAILED`), `evaluation`
(a failed case). Trends show whether errors move left, towards compile time, as the article's
layered architecture intends.

---

## 10. Integration points

| Area                     | Change                                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lean/` (new)            | The Lake project of §4.1                                                                                                                                                                                                                                        |
| `@flowaid/certify` (new) | Protocol, bridge, obligation builders, TS reference checks, DRT suite (§5.4, §7)                                                                                                                                                                                |
| Compiler                 | Emits certificates for exclusivity, order and subset results; evaluates user properties through `@flowaid/certify` at publish; new diagnostics `E_PROPERTY_VIOLATED`, `W_PROPERTY_UNVERIFIED` (RFC-0017)                                                        |
| Evaluation               | Tiered summaries; recomputation obligations; `requireCertified` in the gate                                                                                                                                                                                     |
| Worker                   | `certify.run` job after terminal events; long-lived checker pool; the binary at `/opt/flowaid/bin/flowaid-certify`                                                                                                                                              |
| Jev                      | Receipts, routes and chains certified (`@flowaid/jev` already provides the TS side: `route`, `checkReceipt`, `verifyReceiptChain`)                                                                                                                              |
| Database                 | `certificates (id, workspace_id, subject_kind, subject_id, input_hash, verdict, claims jsonb, counterexample jsonb, checker_version, lean_version, created_at)`, indexed by subject                                                                             |
| API                      | `GET /v1/runs/:id/certificate`, `GET /v1/workflows/:id/versions/:v/certificate`, `POST /v1/certify` (ad hoc, scope `workflows:read`)                                                                                                                            |
| CLI                      | `flowaid verify <workflow                                                                                                                                                                                                                                       | run | evaluation>`with`--property`and`--json` |
| UI                       | `CertificateBadge` (certified / violated / unverified), `CertificateView` (claims, tiers, witness, assumptions, checker and axioms), `PropertyEditor` (DSL with inline validation), `SelfCritiqueTimeline` (run → obligations → verdicts → findings → fixtures) |
| Code export              | The Download-code package includes `properties.json` and, in vendored mode, the checker binary, and its tests run `flowaid verify` (CODE_EXPORT.md)                                                                                                             |
| Docker                   | A `lean` build stage in `docker/Dockerfile`: toolchain only in the build stage; the worker image copies only the binary                                                                                                                                         |
| CI                       | The `lean` job of §8.1                                                                                                                                                                                                                                          |

---

## 11. What this layer does not claim

- It does not prove the TypeScript implementation correct. It proves the Lean model, checks
  individual results, and tests the TS against the model.
- It does not make providers calibrated or correct; that stays `ASSUMED` and is measured by the
  Jev calibration work.
- It does not trust the Lean compiler, the C toolchain or the JSON shell beyond §1's limits.
- It does not replace evaluation datasets; `TESTED` claims keep their place, labelled as such.

---

## 12. Work items (track L)

| Item | Title                                                                                                                       | Effort | Hard dependencies                | Buildable now                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------- | -------------------------------- |
| L-01 | `lean/` Lake project, pinned toolchain, trust gate (build `--wfail`, axiom gate, `leanchecker`, source lint), CI job        | M      | —                                | **yes**                          |
| L-02 | Numeric model (ppm, micro-USD, Rat) with conversion lemmas; decision invariants (§4.3 item 1)                               | M      | L-01                             | **yes**                          |
| L-03 | Gate and Jev routing theorems (§4.3 items 2–3)                                                                              | M      | L-02                             | **yes**                          |
| L-04 | Receipt consistency and chain structure (§4.3 item 4)                                                                       | S      | L-02                             | **yes**                          |
| L-05 | Evaluation verdict and calibration theorems (§4.3 item 5)                                                                   | M      | L-02                             | **yes**                          |
| L-06 | `flowaid-certify` shell and protocol v1, golden vectors, exit codes (§5.2)                                                  | M      | L-02…L-05                        | **yes**                          |
| L-07 | `@flowaid/certify`: schemas, bridge, obligation builders, TS reference checks, degradation (§5.4)                           | M      | L-06                             | **yes**                          |
| L-08 | Differential testing: `@flowaid/jev` route and receipts, gate, evaluation summary vs Lean (§7)                              | M      | L-07                             | **yes** (against `@flowaid/jev`) |
| L-09 | Activation model and replay determinism (§4.3 item 6)                                                                       | L      | L-02                             | **yes**                          |
| L-10 | Plan certificates: compiler emission + Lean checkers (§4.3 item 7)                                                          | L      | L-09, P1-01                      | no                               |
| L-11 | Property DSL: parser, compilation to Lean checks, counterexamples (§6)                                                      | L      | L-07, L-10                       | no                               |
| L-12 | Platform integration: worker job, DB table, API, CLI `verify`, publish gate `requireCertified`, tiers in evaluation (§9–10) | L      | L-07, P1-02, P2-07, P3-01, P3-03 | no                               |
| L-13 | UI: certificate badge and view, property editor, self-critique timeline                                                     | M      | L-07 (types)                     | **yes** (components)             |
| L-14 | Code export and Docker stage for the checker                                                                                | S      | L-06, P4-04                      | no                               |
| L-15 | Toolchain move to 4.35: `lake check`, comparator with independent kernels, re-run DRT                                       | S      | L-01…L-08, Lean 4.35 stable      | no                               |

Contract changes (RFC-0017): `WorkflowDefinition.execution.properties`, the `AssuranceTier`
enum and the `certificates` jsonb shapes, `EvaluationSummary.assurance`, the two diagnostic codes,
and the `certify.run` job in the job union.
