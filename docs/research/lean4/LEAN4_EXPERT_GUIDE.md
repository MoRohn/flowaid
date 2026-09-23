# Lean 4 expert guide for FlowAId

Status: research synthesis, 2026-09-23, revised the same day after two examiner reviews and the hands-on log [HANDS]. Audience: FlowAId engineers designing the self-critical evaluation layer (ARCHITECTURE §10.4), the decision contracts (§2.8, and the parallel Jev contracts/receipts/calibration work), and the compiler/runtime semantics (§2.5, §4, §5).

This guide merges five study notes: the owner's article, Theorem Proving in Lean 4, Functional Programming in Lean, the Lean 4 Language Reference, Mathematics in Lean with the Mathlib docs, and a survey of production uses of Lean. It also merges the measurements in [HANDS] and the corrections from two examiner reviews that checked the guide against the manual, the release notes and the Lean source. Where an examiner's claim disagreed with a measurement or a primary source, the measurement or source wins, and the guide says so (§10, L3). It is written to be critical: every claim has a citation, and where the sources disagree or overclaim, the guide says so. §16 is a self-test of 25 questions with short answers.

> **Read this first: what has and has not been compiled.** The first version of this guide was written with no Lean toolchain. Since then `leanprover/lean4:v4.34.0` has been installed on the owner's Mac, and [HANDS] compiled the article's theorem, a certified checker and a JSON CLI. This revision compiled every snippet marked *verified 4.34.0* in a scratch Lake project on the same toolchain [REV]; the `#print axioms` lines and C signatures quoted with them are copied from real output. Snippets marked *upstream* are copied from a cited source. Snippets marked *sketch* are still uncompiled illustrations, and they must pass `lake build --wfail` and the axiom gate in §10 before anyone relies on them. Statements marked **(reviewer; verify)** come from the authors' general knowledge, not from a source they read, so they need a primary source before they are quoted.

---

## 0. Versions and citation keys

**Versions as of research date (2026-09-23):**

| Item | Version | Source |
|---|---|---|
| Latest stable Lean | v4.34.0 (released 2026-09-14) | GitHub releases API, per [REF] study note |
| Reference manual covers | v4.35.0-rc2 | [REF] index page |
| Mathlib `master` pins | `leanprover/lean4:v4.35.0-rc2` | mathlib4 `lean-toolchain` [MLSRC] |
| TPIL targets | Lean 4.33.0 | [TPIL] landing page |
| MIL built for | Lean v4.19.0 | [MIL] C01 Introduction |
| Toolchain installed and tested | v4.34.0, commit 293d5d0, `arm64-apple-darwin`; 2.7 GB in `~/.elan` | [HANDS §1, §3.4] |

Several facts in this guide depend on the version: how `native_decide` axioms are named, the `Decidable` definition, and whether `lake check` and `lake comparator` exist. The version is stated wherever it matters.

**Citation keys** (paths are relative to the key's base URL):

| Key | Source |
|---|---|
| [ART Lx] | `docs/research/lean4/lambdaclass-lean4-article.md`, line x (the owner's excerpt, verbatim) |
| [ART-FULL] | the live post, https://blog.lambdaclass.com/if-it-compiles-it-is-correct-almost-an-introduction-to-lean-4-for-zk-systems-and-engineering-2/ |
| [SRC] | `docs/research/lean4/SOURCES.md` |
| [TPIL] | Theorem Proving in Lean 4, https://lean-lang.org/theorem_proving_in_lean4/ |
| [FPIL] | Functional Programming in Lean, https://lean-lang.org/functional_programming_in_lean/ |
| [REF] | Lean 4 Language Reference, https://lean-lang.org/doc/reference/latest/ |
| [REL vX] | release notes, https://lean-lang.org/doc/reference/latest/releases/vX/ |
| [LEANSRC] | https://github.com/leanprover/lean4, `master` at 28fb510 (2026-09-23) |
| [MIL] | Mathematics in Lean, https://leanprover-community.github.io/mathematics_in_lean/ |
| [MLDOC] | https://leanprover-community.github.io/mathlib4_docs/ |
| [MLSRC] | https://github.com/leanprover-community/mathlib4, `master`, 2026-09-23 |
| [CEDAR-P] | Cedar verification-guided development paper, arXiv 2407.01688 |
| [CEDAR-B] | https://aws.amazon.com/blogs/opensource/lean-into-verified-software-development/ |
| [CEDAR-S] | Amazon Science, "How we built Cedar with automated reasoning and differential testing" |
| [CEDAR-GH] | https://github.com/cedar-policy/cedar-spec |
| [SAMP] | SampCert, arXiv 2412.01671; https://github.com/leanprover/SampCert |
| [LNSYM] | https://www.amazon.science/blog/how-the-lean-language-brings-math-to-coding-and-coding-to-math ; https://github.com/leanprover/LNSym |
| [AMO] | https://blog.lambdaclass.com/amo-lean-towards-formally-verified-optimization-via-equality-saturation-in-lean-4/ |
| [CERTALG] | McConnell, Mehlhorn, Näher, Schweitzer, "Certifying algorithms", Computer Science Review 5(2), 2011 |
| [AIPIPE] | Rust-to-Lean pipeline with AI provers, arXiv 2605.30106 |
| [LEANDOJO] / [COPILOT] | arXiv 2306.15626 / arXiv 2404.12534 |
| [AENEAS] | Aeneas/SymCrypt, arXiv 2609.15648 |
| [LEANMLIR] / [AXON] | arXiv 2407.03685 / arXiv 2605.01660 |
| [PLAUSIBLE] | https://github.com/leanprover-community/plausible |
| [ARCH §x] | `docs/design/ARCHITECTURE.md` section x |
| [PLAN Px-yy] | `docs/UPGRADE_PLAN.md` item |
| [HANDS §x / Gn] | `docs/research/lean4/HANDS_ON.md`, section x or gotcha n (measured on v4.34.0) |
| [REV] | this revision's scratch project on v4.34.0 (a Lake package plus single files compiled with `lean` and `leanc`); the sources are the *verified 4.34.0* snippets in this guide |
| [EMITC] | [LEANSRC] `src/Lean/Compiler/LCNF/EmitC.lean` (the C emitter, including the generated `main` and module initializers) |
| [PERCEUS] | Reinking, Xie, de Moura, Leijen, "Perceus: Garbage Free Reference Counting with Reuse", PLDI 2021, https://doi.org/10.1145/3453483.3454032 |
| [ZULIP-NATIVE] | Lean Zulip, "soundness bug: native_decide leakage" (Oct 2023), https://leanprover-community.github.io/archive/stream/270676-lean4/topic/soundness.20bug.3A.20native_decide.20leakage.html ; fix: lean4 PR #2654 |
| [LEAN-ACTION] | https://github.com/leanprover/lean-action, `action.yml` on `main` (2026-09-23) |
| [ROCQ-EXTR] | Rocq reference manual, "Program extraction", https://rocq-prover.org/doc/master/refman/addendum/extraction.html |
| [ISA-CODEGEN] | Haftmann, "Code generation from Isabelle/HOL theories", https://isabelle.in.tum.de/doc/codegen.pdf |
| [PM-14576] | L. de Moura, "Postmortem for Kernel Soundness Bug #14576" (2026-08-01), https://leodemoura.github.io/blog/2026-8-1-postmortem-for-kernel-soundness-bug-14576/ |

---

## 1. The article's thesis, point by point

The owner's article [ART] argues that Lean 4 gives a layered, spec-first workflow. In that workflow, proofs guarantee properties for all inputs, and the verified definitions compile to fast C. The table below checks each claim against the primary documentation.

| # | Article claim | Verdict | Qualification (cited) |
|---|---|---|---|
| 1 | Lean gives "a layered development architecture distinguishing compilation and execution errors starkly" [ART L3] | **Holds** | The pipeline is parse → macro-expand → elaborate → kernel-check → compile [REF Elaboration-and-Compilation §2.1]. Logic errors become elaboration or kernel errors; [ART-FULL] gives the example of `Fin n` ruling out an index overflow that Rust would only catch as a panic. |
| 2 | "Lean's role is to guarantee that the specification is correct and consistent before writing a single line of low-level code" [ART L3] | **Overclaim** | Lean checks that proofs follow from the stated spec and axioms. It cannot check that the spec says what you meant. The manual separates "does the theorem have a valid proof" from "what does the theorem statement mean", and lists the second as a remaining issue that no tool answers [REF ValidatingProofs, "Remaining Issues"]. "Consistent" holds only relative to the axioms in use (propext, Quot.sound, Classical.choice) [TPIL Axioms-and-Computation intro; REF Axioms §8.4]. The article's own example shows the gap: it proves an identity over `Nat`, while the circuit works in ZMod p (§1.1). |
| 3 | Lean 4 "compil[es] to C" [ART L7] | **Holds** | "A C file is produced for each Lean module; these are then compiled to native code using a bundled C compiler" [REF §2.4]. |
| 4 | "Certified Code Extraction" removes the "logical overhead" (the proofs) [ART L7, L11] | **Holds for erasure; "certified" overstates it** | "Types and proofs have no run-time representation" [REF Inductive-Types §4.4.4.2]. The manual never uses the phrase "certified code extraction". The compiler works from the *pre-definition*, not the term the kernel checked: "The compiler receives the pre-definition as-is, with recursion intact" [REF §2.3–2.4]. The Lean compiler and the C compiler are not verified, so they are in the trusted base (§8). |
| 5 | The binary is "a faithful representation of the logic verified in Lean" [ART L9] | **Holds only relative to the TCB** | Every `@[implemented_by]` and `@[extern]` in the dependency tree adds an assumption that the replacement is equivalent, and that equivalence "cannot be proved in Lean" [REF Recursive-Definitions §7.6.6.2; REF ValidatingProofs]. |
| 6 | Extraction separates Lean from "academic predecessors like Coq or Isabelle" [ART L9] | **Wrong as stated** | Both predecessors extract code. Rocq's extraction is "used to build certified and relatively efficient functional programs, extracting them from either Rocq functions or Rocq proofs of specifications", with output in "OCaml, Haskell and Scheme" [ROCQ-EXTR]. Isabelle/HOL turns specifications into "executable programs in the languages SML, OCaml, Haskell and Scala" [ISA-CODEGEN]. The defensible difference is that Lean 4 is itself the general-purpose language: the program that runs is the Lean definition, compiled to C and then native code by the toolchain's own bundled compiler, rather than a translation into a separate host language, and it has an in-language FFI [FPIL Hello-World; REF §2.4, §12.4]. Do not repeat the article's claim externally. |
| 7 | The binary "will never suffer from a buffer overflow or accept a false proof" [ART L17] | **Holds only inside the verified function, given a correct spec and a trusted TCB** | The FFI marshalling, the host process and the C runtime are not covered (§8). [AMO] says openly that it "does not verify the C compiler or the extraction mechanism". |
| 8 | Extracted code "usually exposes a C API" called over FFI [ART L18] | **Holds, with a stability warning** | `@[export sym]` and `@[extern "sym"]` exist, but the manual says "The current interface was designed for internal use in Lean and should be considered unstable" [REF Foreign-Function-Interface §12.4]. |
| 9 | "Witness Calculator": a proof of ∀x, ∃y, P(x,y) runs on a concrete x and prints y [ART L24] | **Yes, but the calculator is a `def`, never the theorem** | Lean never compiles theorems: they are erased (§2.2). So even a fully constructive proof of `∀ x, ∃ y, P x y` yields no runnable program. The calculator must be a `def` returning a `Subtype`/Sigma, `(x : α) → {y // P x y}`, or a plain `def` plus a completeness theorem. [HANDS §3.3] built exactly this: `mkWitness` with `mkWitness_complete`. `∃` is a `Prop` that "hides the witness" [TPIL Quantifiers-and-Equality §4.4]. For a *decidable* predicate over ℕ (or an encodable or finite type), a witness can still be recovered computably from an `∃` proof: a search by well-founded recursion takes its termination proof from the `∃` (Mathlib's `Nat.find`, `Encodable.choose`, `Fintype.choose`; a core-only version is *verified 4.34.0* in §2.3). In general, extraction needs `Classical.choose`, which is `noncomputable` [TPIL Axioms-and-Computation §12.5]. |
| 10 | "Black Box of Truth": the output is "correct according to the axiomatic definition" [ART L25] | **Holds, and the qualifier matters** | Correct with respect to the definition, which is the spec. It is not automatically correct with respect to what you intended (see row 2). |
| 11 | Lean 4 uses "a reference counting strategy called Perceus" [ART L31] | **Loose naming, not baseless** | The manual describes reference counting with borrowing, reuse and in-place updates, and cites Ullrich & de Moura (2019), "Counting Immutable Beans". The word "Perceus" does not appear in its Reference Counting chapter [REF Run-Time-Code/Reference-Counting §12.2], and [FPIL] never uses it. Perceus [PERCEUS] is a PLDI 2021 paper co-authored by Lean's lead developer. It generalizes the reset/reuse scheme of Counting Immutable Beans and was implemented in Koka. "Perceus-style" is fair; "Lean uses Perceus" is loose. The reuse behaviour the article describes was measured in [HANDS §3.4] (§8). |
| 12 | Limb-addition theorem and its `native_decide` examples [ART L33–71] | **The proof is fine; the spec is weaker than it looks** | It compiles unchanged in core Lean 4.34.0 once the Mathlib imports are removed [HANDS §3.1]. See §1.1 and §1.2. |
| 13 | "Curry-Howard: proofs and programs are the same thing" [ART L75] | **Holds** | "To prove that assertion, we need to exhibit a term t : p" [TPIL Propositions-and-Proofs §3.1]. |
| 14 | "If the code compiles, the proof is valid" [ART L76] | **"(Almost)"** | The live post's own title says "If It Compiles, It Is Correct (Almost)" [ART-FULL]. Exceptions: `sorry` is only a *warning* [TPIL Propositions-and-Proofs; FPIL §8.8.5]; `native_decide` trusts the compiler [REF §14.5.18], and in 2023 it was used to prove `False` with an empty `#print axioms` list [ZULIP-NATIVE]; custom `axiom`s; `partial`/`unsafe`/`implemented_by`/`extern` [REF §7.6.6]; and metaprograms that bypass the kernel, which is why `leanchecker` and `comparator` exist [REF ValidatingProofs]. |
| 15 | "formally verified software can be deployed in production" [ART L77] | **Holds, with evidence** | AWS Cedar [CEDAR-P, CEDAR-B] and SampCert, which runs in AWS Clean Rooms [SAMP]. Both depend on a stated trusted base (§11). |
| 16 | "machine-checked assurance for all inputs, not just test cases" [ART L78] | **For all inputs *of the modelled type*** | JSON, floats, bytes and LLM outputs have to be parsed into the model, and the parser is part of the trusted surface. Lean's own JSON parser is `partial`, so nothing can be proved about it [LEANSRC src/Lean/Data/Json/Parser.lean]. The article's three `native_decide` examples [ART L63–68] are themselves test cases. |
| 17 | Getting started: elan, `lake new my_project math`, `lake update && lake build` [ART L80–87] | **Holds; pin versions** | The `math` template pulls in Mathlib (§12). `lake update` may rewrite `lean-toolchain` unless you pass `--keep-toolchain` or set `fixedToolchain = true` [REF Lake §24.1.2.4]. |

### 1.1 Self-critique of the article's worked example

The theorem `add_constraint_mod32` [ART L51–61] is a good first example: explicit hypotheses, `unfold` the constants, then `omega`. As a *specification*, though, it has five weaknesses. All five are traps that FlowAId specs can fall into as well. Each one was checked on 4.34.0 [HANDS §3.1–3.2; REV].

1. **Wrong domain.** The statement is over `Nat`, but the circuit's constraint equations hold modulo p = 2^31 − 2^27 + 1 [ART L35]. Lifting them to `Nat` equalities needs the range bounds (limbs in [0, 2^16)) that the article leaves to "lookup arguments" [ART L40]. The theorem proves less than the circuit needs, and the caveat at L40 is the only place that admits it. [HANDS §3.2] states the field-faithful version, `add_constraint_mod32_field`, with the constraints taken mod p, and proves it.
2. **Hypotheses that are redundant here but load-bearing in the real theorem.** For the `Nat` statement as written, `h_c0_bit` and `h_c1_bit` [ART L55–56] are not needed. Multiplying `h_high` by 2^16 and adding `h_low` gives res + carry1·2^32 = lhs + rhs for *any* natural carries, as the article's own sketch shows [ART L71]. Lean's unused-variables linter flags both hypotheses on the verbatim proof, and the theorem still proves with both deleted (`add_constraint_mod32_no_bits`) [HANDS §3.2, G7]. **Do not conclude that the bit checks can be dropped from the spec.** In the field-level theorem the circuit needs (point 1), the carry-bit bounds and the limb range bounds are exactly what make the lift from 𝔽_p equations to ℕ equations sound. With them, every side of both equations is at most 2·(2^16 − 1) + 1 = 2^17 − 1 < p, so nothing wraps mod p, and `add_constraint_mod32_field` uses all of them. The lesson is narrower: a hypothesis that is unused in the stated model signals that the stated model is not the deployed one. Separately, hypotheses that contradict each other make every conclusion provable.
3. **Unneeded dependencies.** `import Mathlib.Data.ZMod.Basic` and `import Mathlib.Tactic` [ART L43–44] are unused. `ZMod` never appears, and `omega` and `native_decide` are core tactics [REF Tactic-Reference §14.5.18]. **Confirmed:** the theorem compiles unchanged in core Lean 4.34.0 without them, in 0.3 s [HANDS §3.1].
4. **Trust drift in the examples.** On Lean ≥ 4.29, each `native_decide` proof adds its own axiom [REF Axioms §8.4; REL v4.29.0]. On 4.34.0 it is named like `ex1_native._native.native_decide.ax_1_1` [HANDS §3.1, G8]. `lake check` rejects such axioms, and external checkers cannot re-check them [REF ValidatingProofs]. **Measured:** the same three statements prove by `decide` with *no* axioms, by `rfl` with none, and by `omega` with `[propext, Quot.sound]`. The kernel has GMP-backed `Nat` arithmetic, so 2^32-sized literals are instant [HANDS §3.1]. `native_decide` is never needed here.
5. **The range-check caveat is a soundness condition, not a detail.** Without limb range checks, the field-level statement is *false*, and a cheating prover can exploit that in two ways. Both counterexamples are kernel-checked by `decide` with no axioms:
   - *Field wrap* [HANDS §3.2, `field_needs_range`]: all inputs 0, `res0 = p ≡ 0`. The low-limb equation holds mod p, but `res = p ≢ 0 (mod 2^32)`.
   - *Fake carry* [REV, `fake_carry`]: `lhs = rhs = 0`, but the prover claims `carry0 = 1` although nothing overflowed. Then `res0 = p − 2^16 = 2013200385` satisfies `0 + 0 ≡ res0 + 1·2^16 (mod p)`, and `res1 = 1`, `carry1 = 0` satisfy the high limb. Both carries are bits, yet the "sum" is `res = p = 2013265921`, not 0.
   Uniqueness of the 32-bit decomposition also needs every limb < 2^16. The [HANDS §3.3] checker rejects both attacks because it runs the range checks. This is why a caveat pushed outside the theorem belongs in the ASSUMED tier (§13.1) until something checks it.

```lean
-- verified 4.34.0 [REV]: `'fake_carry' does not depend on any axioms`
def LIMB_BASE : Nat := 65536
def MOD_32 : Nat := 4294967296
def BABYBEAR : Nat := 2013265921
theorem fake_carry :
    let lhs0 := 0; let lhs1 := 0; let rhs0 := 0; let rhs1 := 0
    let carry0 := 1; let carry1 := 0
    let res0 := BABYBEAR - LIMB_BASE; let res1 := 1
    (lhs0 + rhs0) % BABYBEAR = (res0 + carry0 * LIMB_BASE) % BABYBEAR ∧
    (lhs1 + rhs1 + carry0) % BABYBEAR = (res1 + carry1 * LIMB_BASE) % BABYBEAR ∧
    carry0 ≤ 1 ∧ carry1 ≤ 1 ∧
    (res0 + res1 * LIMB_BASE) % MOD_32 ≠
      (lhs0 + lhs1 * LIMB_BASE + rhs0 + rhs1 * LIMB_BASE) % MOD_32 := by
  decide
```

**What FlowAId takes from this:** after proving a spec, also run a **spec review** covering the domain (are we modelling the real type?), hypothesis necessity (the unused-variables linter answers part of this for free [HANDS G7]; then drop each hypothesis in turn and see what breaks), counterexamples (for each hypothesis believed necessary, prove with `decide` that the statement fails without it), vacuity (can the hypotheses be satisfied at all? build a witness), and the axiom set (`#print axioms`).

### 1.2 Why `unfold` plus `omega` proves the limb theorem, and why `decide` cannot

- `omega` decides many problems in linear arithmetic over `Int` and `Nat`. It decomposes each side "as linear combinations of atoms", and "If we encounter `x / k` or `x % k` for literal integers `k` we introduce new auxiliary variables and the relevant inequalities" [LEANSRC src/Init/Tactics.lean, `omega` docstring].
- `LIMB_BASE` is a `def`, which `omega` does not unfold. `carry0 * LIMB_BASE` is then a product of two atoms, and `omega` treats it as one opaque nonlinear atom. **Verified:** without the `unfold` lines, `omega` fails with "omega could not prove the goal: a possible counterexample may satisfy the constraints" [REV].
- After `unfold`, `carry0 * 65536` is multiplication by a literal, which is linear. Each `e % 4294967296` is replaced by a fresh `r` with `e = 2^32·q + r` and `0 ≤ r < 2^32`. The hypotheses then give `res + carry1·2^32 = lhs + rhs` linearly, and the two remainders must agree. No bit bound is used, which is why the linter flags them (§1.1 point 2).
- `decide` cannot prove the `∀`-statement. It rejects goals with free variables: "Expected type must not contain free variables" [REV]. Even closed, a `∀` over all of ℕ has no `Decidable` instance. `decide` is for closed instances such as the article's three examples.
- **`omega` is not complete.** Its docstring says: "It is not yet a full decision procedure (no "dark" or "grey" shadows), but should be effective on many problems" [LEANSRC src/Init/Tactics.lean]. On the field-level version, `omega` alone fails and prints a "possible counterexample", although the statement is true; one manual `Nat.mod_eq_of_lt` rewrite was needed first [HANDS §3.2 item 4]. A failed `omega` means "not found", not "false".

---

## 2. Curry-Howard and the Data/Prop split

### 2.1 Propositions as types

- To state a claim, give `p : Prop`. To prove it, give a term `t : p`. Lean's task is to "verify that it is well-formed and has the correct type" [TPIL Propositions-and-Proofs §3.1].
- Implication is the function type. `∀ x : α, p x` is the dependent function type `(x : α) → p x`. `∃` corresponds to Σ ("another instance of the Curry-Howard isomorphism") [TPIL Quantifiers-and-Equality §4.1, §4.4].
- `theorem` is "really a version of the def command … To the kernel type checker, there is no difference between the two." Proofs are irreducible and can be checked in parallel [TPIL §3.2]. The *statement* is the contract, and any proof of it can replace any other.
- Lean's logic is the Calculus of Constructions with inductive types [TPIL Introduction]. It is constructive by default, and classical reasoning is opt-in through `open Classical` [TPIL Propositions-and-Proofs, Classical Logic].
- Only three axioms go beyond CIC: `propext`, `Quot.sound` (from which `funext` is derived), and `Classical.choice`. "The first two … block normalization within Lean, but are compatible with code generation, whereas the third is not amenable to computational interpretation" [TPIL Axioms-and-Computation intro, §12.2–12.5].

### 2.2 Proof irrelevance and erasure

- "Lean's kernel treats any two elements t1 t2 : p as being definitionally equal … proof irrelevance" [TPIL §3.1]. "Lean erases types and propositional information when compiling definitions to executable code" [TPIL Axioms-and-Computation §12.1].
- Run-time representation [REF Inductive-Types §4.4.4]:
  - Values of `Prop` inductives are erased, and so are all theorem statements and types (§4.4.4.2).
  - A *trivial wrapper* is an inductive type with one constructor that has exactly one run-time-relevant parameter. It is represented identically to that parameter **only in these circumstances**: the type is private; or it is public and "the public scope of the module in which it is defined contains enough information to determine that it is a trivial wrapper"; or it is defined in a file that is not a `module` (§4.4.4.3). So under the module system, a public one-field structure whose field is hidden may stay boxed. `Subtype` itself is unconditionally zero-overhead: it "is represented identically to the type of the val field". `Fin.mk` has 3 parameters, but only 2 exist at run time (§4.4.4.2).
  - `Decidable α` is represented like `Bool` (`uint8_t`) (§4.4.4.1).
- [FPIL Programming-Proving-and-Performance/Special-Types §8.7] says the same for the pre-module-system case: a structure with exactly one field that is not a type or proof compiles to that field, so `Fin` is just a `Nat`. It also warns that `Array.mk`/`.toList` and `String.toByteArray` convert in linear time. They exist to support proofs; keep them off hot paths.
- **Type-class instance arguments are run-time data.** Only `Decidable` collapses to a `uint8_t`. Any other instance is passed as a dictionary object. *Verified 4.34.0* [REV], generated C:
  - `def dbl [Add α] (x : α) : α` → `lean_object* l_dbl___redArg(lean_object* v_inst, lean_object* v_x)`: the `Add` dictionary is an argument.
  - `def chk (p : Prop) [Decidable p] : Bool` → `uint8_t l_chk___redArg(uint8_t v_inst)`: the instance is the Boolean itself.
  - `def isPos (n : Nat) (h : n > 0) : Nat` → `l_isPos___redArg(lean_object* n)`, but the full-arity symbol is `l_isPos(lean_object* n, lean_object* h)` with a placeholder for the erased proof.

  Specialization usually removes dictionaries in hot, monomorphic code. A polymorphic checker, or any FFI signature, pays for them. Never call Lean's mangled internal symbols from C (they are also package-prefixed [HANDS G20]); expose a monomorphic, scalar function with `@[export]` (§7.1).
- **Observed erasure** [HANDS §3.3]: `certify : AddWitness → Option {v // AddSpec v}` compiles to "call `checkAdd`; if false, `lean_box(0)`; else `lean_alloc_ctor(1, 1, 0)` holding only `w`". The proof field is gone, and no theorem name appears in any generated `.c` file.
- FlowAId's own one-field wrappers (a `Ppm` newtype, say) should be checked in the generated C (`.lake/build/ir/…/*.c`) before anyone claims zero overhead, especially once the package uses `module` files. The two-field `Gate` in §2.4 is an ordinary constructor object either way.
- The compiler cannot generate code for axioms. Definitions whose *non-proof* code depends on an axiom must be `noncomputable`. However, "Axioms used in proofs rather than programs do not prevent a function from being compiled" [REF Axioms §8.3; REF Definitions/Modifiers §7.1].

**For FlowAId:** an invariant kept as a `Prop` field costs nothing at run time. A check done by a `Bool` function is data and does run. Both are useful: the Prop field is the guarantee, and the Bool checker (with a soundness theorem, §2.4) is how untrusted inputs get into the guaranteed type.

### 2.3 `∃` vs `Subtype`/`Sigma`: witnesses you can use

- "We can view Exists.intro as an information-hiding operation, since it hides the witness." "Existential propositions are propositions, while sigma types are types" [TPIL §4.4].
- For inductives in `Prop`, "one can only eliminate to other types in Prop" [TPIL Inductive-Types]. `Nonempty` "can only eliminate to Prop" [TPIL §12.5].
- **Theorems are never compiled.** A `theorem` is erased (§2.2), so a proof of `∀ x, ∃ y, P x y` produces no program, however constructive it is. Any evidence the runtime has to read (a witness, a certificate, a bin assignment behind an ECE value) must come from a `def` whose type is a `Subtype {x // p x}` or a Sigma, not from an `∃`. The article's "witness calculator" [ART L24] must be stated like this:

```lean
-- sketch: a witness calculator is a def returning a subtype, not a theorem ∀ x, ∃ y
def solve (x : Input) : { y : Output // P x y } := ...
```

  [HANDS §3.3] uses the equivalent split form: `def mkWitness (a b : Nat) : AddWitness` plus `theorem mkWitness_complete : checkAdd (mkWitness a b) = true ∧ …`, which is "the constructive form of ∀ a b, ∃ w" with axioms `[propext, Quot.sound]`.

- **The exception: a decidable predicate over ℕ.** `Exists` cannot eliminate into `Type`, but `Acc` can (it is a `Prop` whose recursor eliminates into any sort). So a search can take its *termination* proof from the `∃` and still compute. That is how Mathlib's `Nat.find` works, and `Encodable.choose`/`Fintype.choose` extend it to encodable and finite types. `Nat.find` is not in core (`Unknown constant` on 4.34.0 [REV]); a core-only version, *verified 4.34.0* [REV]:

```lean
section
variable (p : Nat → Prop) [DecidablePred p]

/-- `lbp m n`: m is the next candidate after n, and nothing up to n satisfies p. -/
def lbp (m n : Nat) : Prop := m = n + 1 ∧ ∀ k, k ≤ n → ¬ p k

omit [DecidablePred p] in
theorem lbp_wf (h : ∃ n, p n) : WellFounded (lbp p) := by
  obtain ⟨n, pn⟩ := h
  suffices ∀ m k, n ≤ k + m → Acc (lbp p) k from ⟨fun _ => this _ _ (Nat.le_add_left _ _)⟩
  intro m
  induction m with
  | zero => intro k kn; exact ⟨_, fun _ ⟨_, hk⟩ => absurd pn (hk _ (by omega))⟩
  | succ m ih =>
    intro k kn
    exact ⟨_, fun y ⟨e, _⟩ => by subst e; exact ih (k + 1) (by omega)⟩

def findWitness (h : ∃ n, p n) : { n // p n } :=
  (lbp_wf p h).fix (C := fun k => (∀ j, j < k → ¬ p j) → { n // p n })
    (fun k IH al =>
      if pk : p k then ⟨k, pk⟩
      else IH (k + 1) ⟨rfl, fun j hj => fun pj =>
             if e : j = k then pk (e ▸ pj) else al j (by omega) pj⟩
           (fun j hj pj => if e : j = k then pk (e ▸ pj) else al j (by omega) pj))
    0 (fun _ h => absurd h (Nat.not_lt_zero _))
end

#eval (findWitness (fun n => n * n > 50) ⟨8, by decide⟩).val   -- 8
#print axioms findWitness   -- [propext, Quot.sound]
```

  `WellFounded.fix` is declared `noncomputable`, yet this compiles. Core's `Init/WFComputable.lean` adds `@[csimp]` theorems (`Acc.rec_eq_recC`, …) that swap in computable versions, and a `@[csimp]` swap is *proved*, so unlike `implemented_by` it adds nothing to the trusted base (§11.4) [LEANSRC src/Init/WFComputable.lean]. The search is linear in the witness, so this is for small searches and for understanding. A certified FlowAId checker should compute its witness directly, as `mkWitness` does.

- Anything built from `Classical.choice`, `choose`, `indefiniteDescription` or `propDecidable` in data position must be `noncomputable`, and it will not compile [TPIL §12.5–12.6].

### 2.4 The checker plus soundness pattern (Curry-Howard in practice)

`Decidable` is the bridge from `Prop` to `Bool`. `ite`/`dite` need `[Decidable c]`, and `of_decide_eq_true : decide p = true → p` turns a Bool result back into a proof [TPIL Type-Classes §10.8; REF Type-Classes/Basic-Classes §10.5.4]. "At run time, this case distinction code is identical to that which would be generated for a Bool-based conditional" [REF §10.5.4].

*Verified 4.34.0* [REV], adapted from the [REF] study note. Probabilities are in parts-per-million (ppm) `Nat`, not `Float` (§12.3). Axioms: `checkGate_sound` uses none (the `#guard_msgs` pin in §10 passes); `gate_monotone` uses `[propext, Quot.sound]`:

```lean
structure Gate where
  confPpm      : Nat
  thresholdPpm : Nat

def Gate.passes (g : Gate) : Prop := g.thresholdPpm ≤ g.confPpm
instance (g : Gate) : Decidable g.passes :=
  inferInstanceAs (Decidable (g.thresholdPpm ≤ g.confPpm))

def checkGate (g : Gate) : Bool := decide g.passes          -- data: ships in the binary

theorem checkGate_sound (g : Gate) (h : checkGate g = true) : g.passes :=
  of_decide_eq_true h                                        -- Prop: erased

theorem gate_monotone (g : Gate) (t : Nat) (ht : t ≤ g.thresholdPpm) (h : g.passes) :
    ({ g with thresholdPpm := t } : Gate).passes := by
  simp only [Gate.passes] at *; omega
```

Lean core ships the same pattern at production scale. The LRAT checker behind `bv_decide` is *upstream*:

```lean
def check (lratProof : Array IntAction) (cnf : CNF Nat) : Bool := Internal.check lratProof cnf
theorem check_sound (lratProof : Array IntAction) (cnf : CNF Nat) :
    check lratProof cnf → cnf.Unsat
```
[LEANSRC src/Std/Tactic/BVDecide/LRAT/Checker.lean]

**Version note:** in 4.35, `Decidable` changed from a two-constructor inductive (`isFalse`/`isTrue`) [TPIL §10.8] to a structure `Decidable.intro` with fields `decide : Bool` and `reflects_decide` [REF §10.5.4; REL v4.35.0 #8309]. Use `decide` together with `of_decide_eq_true`/`of_decide_eq_false`, and do not pattern-match on `isTrue`/`isFalse`, so code works on both sides of the change.

---

## 3. Structures, inductives and type classes

- **Inductives** come with constructors and a recursor. `match` compiles to the recursor. *Strict positivity* ("occurs only strictly positively") keeps the logic consistent [TPIL Inductive-Types intro, §7.4, §7.8]. `Eq` is itself an inductive family.
- **Structures with proof fields** make an invariant part of the type. From TPIL: `structure RedGreenPoint (α) extends Point α, RGBValue where no_blue : blue = 0` [TPIL Structures-and-Records §9.1–9.3]. "A structure constructor cannot validate or reject its arguments", so an invariant has to be a proof field or a subtype. Otherwise any value of the type may be invalid [FPIL Getting-to-Know-Lean/Structures §1.4.2].
- **Smart constructors** ("parse, don't validate"): `def Nat.asFastPos? (n : Nat) : Option FastPos := if h : n > 0 then some ⟨n, h⟩ else none` [FPIL Applicative-Functors §5.2.1.2]. FPIL's advice: use such types "internally to a library, providing an API to users that automatically ensures that all invariants are satisfied".
- **Collecting all errors.** An Applicative `Validate` reports every error, while a monadic `Except` stops at the first. FPIL deliberately does *not* make `Validate` a Monad, because that would break the Applicative/Monad consistency contract [FPIL Applicative-Functors §5.2.1.3, §5.3]. This matches FlowAId's compiler pass groups: within a group, report everything; between groups, stop [ARCH §4.1].
- **The universe pattern** for typed schemas. It uses a closed code type (`inductive DBType | int | string | bool`), a decoding function `asType`, and indexed evidence (`HasCol : Schema → String → DBType → Type`) that a column exists with a given type. The evidence is found with `by repeat constructor`. A closed universe gives exhaustiveness checks, which open type classes do not [FPIL Programming-with-Dependent-Types/Typed-Queries §7.3, Summary §7.6.2]. This is the natural model for FlowAId `Ref` resolution and the JSON Schema fragment behind `isSubschema` [ARCH §4.5].
- **Type classes:** instance search is Prolog-like; there are `outParam`s, `@[default_instance]`, `local`/`scoped instance`, and `deriving DecidableEq, BEq, Hashable, Repr, Ord, Inhabited` [TPIL Type-Classes §10.1–10.10; FPIL Overloading-and-Type-Classes §3.5, §3.8]. `Classical.propDecidable` is a *low-priority scoped* instance, so computable instances win [TPIL §12.6]. Keep `open Classical` out of checker namespaces [REF §10.5.4].
- **Monad-transformer order changes meaning.** `StateT σ (ExceptT ε Id)` rolls state back on a throw; `ExceptT ε (StateT σ Id)` keeps it [FPIL Monad-Transformers/Ordering §6.3]. FlowAId's reducer is pure and effects run after commit [ARCH §5.1, §5.3], which is the rollback form. Encode that order in the spec's types so it cannot flip silently.
- Monad and Applicative laws are prose contracts in FPIL, and a wrong instance still type-checks [FPIL Monads §4.2.3]. If a spec depends on the laws, prove them as lemmas.

---

## 4. Tactics for FlowAId-style properties

FlowAId's properties are mostly linear arithmetic over counts, basis points and micro-units; finite case analysis over node and edge states; induction over event logs; and rational inequalities for probabilities. Choose tactics with the **trust cost** in mind, not only whether they succeed.

### 4.1 Workhorses

| Tactic | Use | Source |
|---|---|---|
| `omega` | Linear arithmetic over `Nat`/`Int`, including multiplication by literals and `%`/`/` by literals. The article's main tactic [ART L61]. Unfold named constants first so omega sees numerals [ART L59–60]. | [REF Tactic-Reference §14.5.18]. Not covered in TPIL (grep finds no hit) or FPIL. |
| `simp`, `simp only [...]`, `simp at h`, `simp [*]`, `simp +arith`, `@[simp]` | Rewriting with tagged lemmas. Ordered rewriting stops AC lemmas from looping. A global `@[simp]` "persists in any file that imports" it, so prefer `attribute [local simp]` inside a `section`. | [TPIL Tactics §5.7] |
| `cases`, `induction … with`, `injection`, `<;>`, `first`, `try`, `all_goals`, `repeat` | Structural case splits and induction. `repeat (try t)` loops forever. | [TPIL Tactics §5.3–5.5; Inductive-Types §7.6] |
| `fun_induction f` / `fun_cases f` | Induction that follows f's own recursion and rules out the branches not taken. The standard way to prove an optimized function equal to its spec. | [TPIL Induction-and-Recursion §8.6; FPIL Proving-Equivalence §8.2] |
| `grind` | SMT-style closer: it either finishes the goal or fails. It contains a linear-arithmetic solver that is "complete for linear arithmetic" over ordered rings (products are atoms), a cutsat/lia solver for Int/Nat, and a ring/field solver. Core `Rat` has `Grind.Field`/`OrderedRing` instances. | [REF The-grind-tactic §16.9–16.11; FPIL Interlude; LEANSRC src/Init/Grind*/…/Rat.lean] |
| `conv` | Rewriting under binders or at a chosen position. | [TPIL The-Conversion-Tactic-Mode] |
| `rfl`, `calc`, `▸`, `Trans` instances | Definitional equality and chained reasoning. | [TPIL Quantifiers-and-Equality §4.2–4.3] |

### 4.2 Decision procedures and what each one trusts

| Tactic | How it proves | What it trusts | Allowed in certified tier? |
|---|---|---|---|
| `decide` | Reduces the `Decidable` instance in the elaborator/kernel | Kernel only | Yes |
| `decide +kernel` | Reduces in the kernel and ignores transparency | Kernel only | Yes |
| `decide_cbv` / `cbv` | Call-by-value evaluation. Proofs "only use the three standard axioms … do not require trust in the correctness of the code generator", and it handles well-founded recursion | Kernel + standard axioms | Yes |
| `omega` | Produces a checkable proof term. **Incomplete**: "not yet a full decision procedure (no "dark" or "grey" shadows)", so it can fail on true Presburger goals (§1.2) | Kernel (+ `propext`, `Quot.sound` in the proof term [HANDS §3.1]) | Yes, but a failure is "not found", never "false" |
| `bv_decide` | External SAT solver plus an in-Lean LRAT check. It "trusts the correctness of the code generator and adds a axioms asserting its result". `bv_decide?` caches the proof; `bv_check` replays a stored LRAT file | Compiler + solver certificate | Only as a separately labelled tier |
| `native_decide` (≡ `decide +native`) | Runs compiled `#eval` and admits the result "via an axiom … depends on the correctness of the Lean compiler and all definitions with an @[implemented_by] attribute" | **Whole compiler + every `implemented_by`** | **No** |

Sources: [REF Tactic-Reference §14.5.18, §14.5.18.1, §14.5.19; LEANSRC src/Init/Tactics.lean docstrings].

**`native_decide` axiom naming has changed across versions.** Do not hard-code one name in CI:
- up to **4.28.0**: all native evaluation showed up as the single axiom `Lean.trustCompiler` [REF ValidatingProofs, "On Lean.trustCompiler (up to Lean 4.28.0)"];
- from **4.29.0**: one axiom per computation, e.g. `'bigSum' depends on axioms: [bigSum._native.native_decide.ax_1]` [REL v4.29.0, PR #12217; REF Axioms §8.4]. **Measured on 4.34.0**: `ex1_native._native.native_decide.ax_1_1`, printed relative to the current namespace; `collectAxioms` returns the fully qualified name [HANDS §3.1, G8];
- in **4.35.0**, `Lean.reduceBool`, `Lean.reduceNat`, `Lean.ofReduceBool`, `Lean.ofReduceNat` and `Lean.trustCompiler` are **removed**, and native results go through `Lean.Meta.nativeEqTrue` [REL v4.35.0, PR #14953].

Some of the study notes say `native_decide` introduces `Lean.ofReduceBool`. That is out of date for current toolchains. In every version, "External checkers (lean4checker, comparator) cannot check such proofs" [REF ValidatingProofs]. (`lean4checker` is the old name of the external repository; the binary bundled in current toolchains is `leanchecker`, §10.) Note that `leanchecker` still *passes* a module that contains `native_decide` axioms, because it accepts declared axioms [HANDS G9]; only an axiom allowlist catches them.

**Why the no-`native_decide` policy is not paranoia (history):**
- **Oct 2023, proof of `False` with no axioms shown.** Mario Carneiro used `Lean.reduceBool` (the mechanism behind `native_decide`) on a function reading `IO.getRandomBytes`, proved both `reduceBool foo = true` and `= false` by `rfl`, and derived `False`. `#print axioms` showed no dependencies. The fix, lean4 PR #2654, added the artificial `Lean.trustCompiler` axiom so that the dependency became visible [ZULIP-NATIVE].
- **4.23.0, the axiom report itself was wrong.** PR #8842 "fixes the bug that collectAxioms didn't collect axioms referenced by other axioms. One of the results of this bug is that axioms collected from a theorem proved by native_decide may not include Lean.trustCompiler" [REL v4.23.0]. An axiom gate is only as good as `collectAxioms`, so pair it with `leanchecker` and pin the toolchain.
- **4.22.0, the compiler was replaced.** "The old compiler has been replaced by the new compiler (#8577)" [REL v4.22.0]; the C emitter now lives under `Lean/Compiler/LCNF/` [EMITC]. `native_decide` trusts exactly this new, fast-moving code.

**Known `decide` failures:** it rejects goals with free variables ("Expected type must not contain free variables"; `decide +revert` reverts them first) [REV]. It gets stuck on instances that use well-founded recursion or contain `Eq.rec`. Build such instances with `decidable_of_iff` [REF §14.5.18]. `propext`/`funext`/`Quot.sound` block kernel reduction, so `#reduce` can get stuck even though `#eval` gives the answer [TPIL Axioms-and-Computation §12.3–12.4]. `decide` does not work through classical instances or over unbounded domains [TPIL §10.8].

### 4.3 Mathlib's inequality tactics (only if Mathlib is adopted, §12)

- `linarith`: finds a certificate of unsatisfiability (simplex by default, Fourier-Motzkin as an option). It works over ordered fields and "does not multiply hypotheses together and is incomplete over non-dense orders like integers". Variants: `linarith [t…]`, `linarith only`, `linarith?` [MLDOC Mathlib/Tactic/Linarith/Frontend]. For products, e.g. consensus `agreement × meanConfidence`, use `nlinarith`.
- `positivity`: proves `0 ≤ e`, `0 < e` and `e ≠ 0` by following the syntax of e [MLSRC Mathlib/Tactic/Positivity/Core.lean].
- `norm_num`: decides numeral (in)equalities over ℕ, ℤ, ℚ, ℝ and ℂ, and is extensible with `@[norm_num]` [MLDOC Mathlib/Tactic/NormNum/Core].
- `rify`/`qify`, `push_cast`, `exact_mod_cast`: move a fact from ℕ/ℤ/ℚ into ℚ/ℝ, e.g. `rify at hn hk; linarith` [MLSRC Mathlib/Tactic/Rify.lean]. These are what connect an exact `Rat` checker to an ℝ-level spec.
- MIL introduces `ring` (§2.1) and `linarith`/`norm_num` plus the order lemmas (`le_trans`, `add_le_add`, `mul_pos`, `min_le_left`, `le_min`) in §2.3–2.5 [MIL C02_Basics]. MIL targets v4.19.0 and some of its names have fallen behind, so check them against [MLDOC] [MIL C01].

### 4.4 Test before proving

- **Plausible** looks for counterexamples to a Lean statement inside Lean [PLAUSIBLE]. fast-check does the same on the TS side.
- Cedar: "All bugs found by the validation soundness property were found before we had completed a soundness proof" [CEDAR-P, lessons]. Run property tests on a statement before spending effort on proving it.
- `#guard_msgs in <cmd>` pins the exact output of a command and gives golden regression tests inside the build [TPIL Interacting-with-Lean §6.1; REF Axioms §8.5].

---

## 5. Termination and well-founded recursion

- Structural recursion: "The equations used to define these functions hold definitionally" [TPIL Induction-and-Recursion §8.3].
- Well-founded recursion: `termination_by <measure>` plus an optional `decreasing_by <tactic>`. By default `decreasing_tactic` runs, and when it fails "the error message includes the remaining goal" [TPIL §8.5]. `termination_by?` suggests a measure [FPIL §8.3.2]. FPIL shows `decreasing_by` only in error suggestions, so check its syntax in [REF Recursive-Definitions].
- **Well-founded definitions do not unfold definitionally**: "this definition of div does not lead to div 8 2 being definitionally equal to 4" [TPIL §8.5]. `rfl`/`decide` may then fail. Use `unfold`, `simp [f]`, the generated equation lemmas (`f.eq_def`, `f.eq_N`) [REF §2.4], or `decide_cbv` [REF §14.5.19]. For checkers, prefer structural recursion or explicit fuel.
- Supply missing facts with a local `have` before the recursive call. FPIL's workflow: write the function `partial`, replace that with `termination_by`, copy each unproved goal into `have … := by sorry`, test, then prove each one [FPIL §8.4.3, §8.8.6]. *Upstream shape*:

```lean
def arrayMapHelper (f : α → β) (arr : Array α) (soFar : Array β) (i : Nat) : Array β :=
  if inBounds : i < arr.size then
    arrayMapHelper f arr (soFar.push (f arr[i])) (i + 1)
  else soFar
termination_by arr.size - i
```
[FPIL Arrays-and-Termination §8.3.2]

- **Escape hatches**:
  - `decreasing_by sorry` allows `def unsound (x : Nat) : False := unsound (x + 1)`, and "#print axioms unsound shows that unsound depends on the unsound axiom sorryAx" [TPIL §8.5].
  - `partial def`: "the body is discarded and only the opaque constant is retained by the kernel", so nothing can be proved about it [REF §7.6.6.1; FPIL §2.6.4].
  - `unsafe`: "exempts a definition from kernel checking" [REF §7.6.6.2].
- **A `sorry` in a bounds proof can crash at run time**: "Proving that 3 < 2 can cause an out-of-bounds array access to persist to runtime" [FPIL Summary §8.8.5].
- Tail calls: "only self-tail-calls are optimized into loops", so mutual tail calls still grow the stack. Use accumulator-passing style [FPIL Tail-Recursion §8.1.1, §8.8.1].

**For FlowAId:** `loop`/`foreach` containers [ARCH §2.6, §5.10] should use explicit fuel (`maxIterations`, remaining node-run or cost budgets as `Nat`), so termination is structural. `partial` is allowed only for the unbounded event-stream consumer, which is like FPIL's `dump` over `/dev/random` [FPIL §2.4].

---

## 6. JSON I/O and building a `lean_exe` CLI

### 6.1 JSON (not documented in the manual; facts from the Lean source)

- `inductive Json | null | bool | num (n : JsonNumber) | str | arr (Array Json) | obj (Std.TreeMap.Raw String Json)`. `JsonNumber` is `{mantissa : Int, exponent : Nat}` [LEANSRC src/Lean/Data/Json/Basic.lean].
- `Json.parse : String → Except String Json`, `Json.compress`, `Json.pretty`. `class FromJson α where fromJson? : Json → Except String α`, `class ToJson α where toJson : α → Json`, and the helpers `getObjValAs?` and `mkObj` [LEANSRC …/Json/FromToJson/Basic.lean, Printer.lean].
- `deriving ToJson, FromJson` is registered in `Lean.Elab.Deriving.FromToJson`. It is **not** in the manual's list of core deriving handlers [REF Type-Classes/Deriving-Instances §10.4.1]. **Verified 4.34.0:** `import Lean.Data.Json` alone is enough for `Json`, `Json.parse` and `deriving ToJson, FromJson` [REV]. A field whose name ends in `?` is optional, and the `?` is dropped from the key [LEANSRC src/Lean/Elab/Deriving/FromToJson.lean].
- **Cost of `Lean.Data.Json`, measured** [HANDS §3.4, G14; REV]: an exe importing it is **~99 MB** (75.6 MB stripped) and spends ~17 ms per invocation, against **2.4 MB** and 2.5 ms for an `Init`-only exe with the same checker (3.0 MB with `Std.Data.HashMap`). The cause is in the C emitter: a module that uses anything from the `Lean` package calls the full `lean_initialize` in its initializer instead of `lean_initialize_runtime_module` [EMITC, module initializer]. Keep the certified core free of `import Lean`, and keep JSON in the thin exe shell (§7.1, §7.3).
- **Parser behaviour at the edge, measured** [HANDS §3.3, G11–G12]: `Json.getNat?` accepts `1e3` as 1000 but rejects `2.0`; duplicate keys are accepted and the **last** value wins silently. Both are parser-differential risks against the TS side. FlowAId's boundary must pin one canonical number form (integers, no exponent) and reject duplicate keys before the Lean checker sees the input.
- In `Json.mkObj [...]`, the list's element type comes from the first entry, so mixing `String` and `Nat` values fails; ascribe `: List (String × Json)` [HANDS G15].
- `Float.toJson` writes NaN and ±Infinity as the *strings* `"NaN"`, `"Infinity"` and `"-Infinity"` [LEANSRC Json/FromToJson].
- **The parser is written with `partial def`** (`strCore`, `natCore`, …), so nothing can be proved about `Json.parse` [LEANSRC …/Json/Parser.lean]. The JSON boundary is trusted shell code.
- **Exact probabilities from JSON (reviewer; verify):** `JsonNumber` is a decimal mantissa/exponent pair, so it can be converted to `Rat` exactly without going through `Float`. Note that TS `JSON.stringify` writes the shortest decimal that round-trips to the double, which is generally not the double's exact dyadic value. The spec must say which of the two it treats as the true value. Finite doubles are exact dyadic rationals [MLSRC study note on Float], so either choice is well defined.

### 6.2 `main` and exit codes

- **Allowed `main` types.** FPIL lists `IO Unit`, `IO UInt32` and `List String → IO UInt32` [FPIL Hello-World/Summary §2.6.1]. The C emitter is more permissive: it accepts `main` with or without a `List String` argument, returning `IO UInt32` or `IO Unit` (it checks only the arity and whether the result type is `UInt32`) [EMITC `emitMainFn`]. So `List String → IO Unit` also works (*verified 4.34.0* [REV]). `IO.Process.exit : UInt8 → IO α` is also available [REF IO/Processes §21.9.1].
- **What the process actually returns.** The generated C `main` returns the unboxed `UInt32` for `IO UInt32`, and 0 for `IO Unit`, **only when the action succeeds**. On any uncaught IO error, whatever the return type, it calls `lean_io_result_show_error` (printing `uncaught exception: …` to stderr) and **returns 1** [EMITC]. *Verified 4.34.0* [REV]: `main : List String → IO Unit` that throws exits 1. So `IO Unit` does *not* "always exit 0", and a crash is indistinguishable from "rejected" unless `main` catches everything [HANDS G13].
- **Only 0–255 survive.** The OS truncates the `int` returned from `main` to 8 bits: `def main : IO UInt32 := pure 300` exits **44** [REV]. Use only 0, 1 and 2.
- IO actions are *descriptions*. The C run-time system executes them, and the effects are opaque constants to the logic [FPIL Running-a-Program §2.1.2; REF IO §21].
- Use the same exit-code convention as `lake check`: **0 accepted, 1 rejected, 2 could not run** [REF Lake §24.1.2.8].
- **Reading stdin**: `let raw ← (← IO.getStdin).readToEnd`, where `IO.FS.Stream.readToEnd : IO.FS.Stream → IO String` [LEANSRC src/Init/System/IO.lean]. It throws on non-UTF-8 input ("Tried to read from stream containing non UTF-8 data."), which is exactly the uncaught-exception-exits-1 trap [HANDS G13].

*Verified 4.34.0* [REV] (Lake package with the §2.4 checker in the library and this `Main.lean` as the exe). JSON on stdin, or a file path; every failure is caught and mapped to 2:

```lean
import Lean.Data.Json
import Gp                       -- the library holding `checkGate` (§2.4); name is illustrative
open Lean

structure GateIn where
  confPpm : Nat
  thresholdPpm : Nat
  deriving ToJson, FromJson

/-- Pure core: parse, check, render. Exit code 0 accept, 1 reject, 2 could not run. -/
def run (raw : String) : UInt32 × String :=
  if raw.trimAscii.isEmpty then (2, "flowaid-check: empty input") else
  match (Json.parse raw >>= fromJson? : Except String GateIn) with
  | .error e => (2, s!"flowaid-check: bad input: {e}")
  | .ok g =>
    let ok := checkGate ⟨g.confPpm, g.thresholdPpm⟩
    ((if ok then 0 else 1), (Json.mkObj [("passes", toJson ok)]).compress)

def main (args : List String) : IO UInt32 := do
  -- An uncaught IO error makes the generated C `main` print it and return 1 ("rejected").
  -- Catch everything and map it to 2.
  try
    let raw ← match args with
      | []     => do (← IO.getStdin).readToEnd   -- JSON on stdin
      | [path] => IO.FS.readFile path             -- or a file path
      | _      => throw (IO.userError "usage: flowaid-check [FILE]")
    let (code, out) := run raw
    if code == 2 then IO.eprintln out else IO.println out
    return code
  catch e =>
    IO.eprintln s!"flowaid-check: {e}"
    return 2
```

Observed behaviour [REV]:

| Input | stdout / stderr | Exit |
|---|---|---|
| `{"confPpm":900000,"thresholdPpm":850000}` | `{"passes":true}` | 0 |
| `{"confPpm":800000,"thresholdPpm":850000}` | `{"passes":false}` | 1 |
| empty stdin | `flowaid-check: empty input` | 2 |
| `{"confPpm":-1,…}` | `bad input: GateIn.confPpm: Natural number expected` | 2 |
| bytes `ff fe` (not UTF-8) | `Tried to read from stream containing non UTF-8 data.` | 2 |
| `/nonexistent` as argument | `no such file or directory (error code: 2)` | 2 |
| two arguments | `usage: flowaid-check [FILE]` | 2 |

The binary is 104 MB because of `Lean.Data.Json` (§6.1). [HANDS appendix, `Main.lean`] is a fuller version with a verdict object, reasons and a witness-calculator mode.

When benchmarking, read input from stdin or a file, because the compiler constant-folds calls whose arguments are all known [FPIL Insertion-Sort §8.6.4]. It can also move a pure `let r := f ()` out of the timed region; use `IO.lazyPure` [HANDS G17].

### 6.3 Lake targets

*Verified 4.34.0* [REV] `lakefile.toml` for a spec + checker + test package, built from [FPIL Starting-a-Project §2.3] and [REF Lake §24.1.3.1]. With a one-line checker, `lake build --wfail` builds both default targets, `lake test` exits 0, and it exits 1 once a `#guard` in `FlowaidTests` fails:

```toml
name = "flowaid_formal"
version = "0.1.0"
defaultTargets = ["FlowaidCert", "flowaid-check"]
testDriver = "FlowaidTests"

[[lean_lib]]
name = "FlowaidCert"        # core-only: specs, checkers, soundness theorems

[[lean_lib]]
name = "FlowaidTests"       # library test driver: any #guard / #guard_msgs failure fails `lake test`

[[lean_exe]]
name = "flowaid-check"
root = "Main"               # must define `main`
```

- `lake build` puts binaries in `.lake/build/bin`. `lake exe flowaid-check` builds the binary if needed and then runs it [FPIL §2.3.1].
- Library facets: `static` (.a), `static.export`, `shared` (.so/.dylib/.dll). Module facets `c`, `o` and `dynlib` expose the generated C and objects [REF Lake §24.1.1.3].
- "Lake treats a nonzero exit code as a test failure. For libraries, any elaboration error counts as a test failure, including failures of #guard-style commands" [REF Lake §24.1.1.5].
- **The TOML format silently ignores unknown fields** ("presently ignored"), so a typo can disable a setting. `extern_lib`, custom targets and facets need `lakefile.lean` [REF Lake §24.1.3.1, §24.1.3.2.4.3].
- `defaultTargets = ["<exe>"]` builds only the modules the exe imports; a library root the exe does not import is never built, and a gate that imports it fails with "object file … does not exist". List the library in `defaultTargets` (as above) or build it explicitly in CI [HANDS G6].
- `lake new` also creates `.github/workflows/lean_action_ci.yml` and a git repo; remove or adapt both when vendoring into the monorepo [HANDS G21].

---

## 7. FFI and C extraction

### 7.1 Mechanics [REF Foreign-Function-Interface §12.4]

- `@[export sym]` exposes a Lean function to C under an unmangled name. `@[extern "sym"]` binds a Lean declaration to a C symbol.
- Type mapping:
  - `UInt8…UInt64`/`USize` map to `uint8_t…uint64_t`/`size_t`, `Char` to `uint32_t`, and `Float` to `double`.
  - `Nat`/`Int` map to `lean_object*`, a boxed scalar when the low bit is 1.
  - Irrelevant (erased) arguments are dropped or passed as `lean_box(0)`.
  - Other inductives map to `lean_object*`, and "There are no guarantees about the exact layout of fields in a constructor object" [REF §12.4.1; Inductive-Types §4.4.4.4.1].
- Ownership: arguments are owned by default, and `@&` marks a borrowed one. "Return values and @[export] parameters are always owned." Since v4.30, a borrowed argument on an `@[export]` declaration is a compile error [REF §12.4.1.2; REL v4.30.0 #13017].
- Embedding code must call `initialize_<pkg>_<Module>(builtin=1)` once, check `lean_io_result_is_ok`, then call `lean_io_mark_end_initialization()`. It may also need `lean_setup_args` and `lean_init_task_manager`. Foreign threads need `lean_initialize_thread`/`lean_finalize_thread` [REF §12.4.2].
- **Initializer weight depends on imports.** "Every module initializes the runtime for itself … Modules using the `Lean` package call the full `lean_initialize` instead" [EMITC, comment above the module initializer]. A library that touches `Lean.Json` (or anything else in `Lean`) therefore brings the whole `Lean` package's initialization and binary size into the host process (§6.1: 99 MB vs 2.4 MB). The armored-library core must stay free of `import Lean`; put JSON in the exe shell or in the host.
- An `@[extern]` declaration cannot be `#eval`ed in the same file unless it is precompiled [REF §12.4.3].

*Verified 4.34.0* [REV] (compiles; the C side was not linked) scalar-only export, the safest shape:

```lean
@[export flowaid_check_gate]
def checkGateC (conf thr : UInt64) : UInt8 := if thr ≤ conf then 1 else 0
-- C side: uint8_t flowaid_check_gate(uint64_t, uint64_t);
```

*Upstream*, Cedar's differential-testing entry point exports a function from bytes to JSON string [CEDAR-GH cedar-lean/DiffTest/Main.lean]:

```lean
@[export isAuthorizedDRT] unsafe def isAuthorizedDRT (req: ByteArray) : String := ...
```

It is marked `unsafe`, so the harness glue itself is outside kernel checking. This is acceptable for a test oracle, but it is not the certified tier.

### 7.2 What is and is not verified (the trusted computing base)

| Component | Kernel-checked? | Notes / mitigation |
|---|---|---|
| Theorem statements | **No** (statements are not checked for meaning) | Human review; small, readable statements; spec review (§1.1) [REF ValidatingProofs "Remaining Issues"] |
| Proofs of those statements | **Yes**, by the kernel (C++, with independent reimplementations in Rust and Lean). The kernel itself has had soundness bugs: #14576 (nested inductives with phantom parameters) was found 2026-07-25 and fixed with patch releases by 07-28; the postmortem says "The kernel has to reject ill-typed declarations on its own, in its own process" and recommends independent kernels [PM-14576] | `leanchecker --fresh`; `comparator` with nanoda / lean4lean [REF §2.3; ValidatingProofs] |
| Axioms used | Visible with `#print axioms` / `collectAxioms`, which itself had a bug until 4.23.0 (#8842, §4.2) | Allow-list {propext, Classical.choice, Quot.sound}; everything else fails, including `sorryAx`, `*_native*` and custom axioms [REF Axioms §8.5; HANDS appendix `AxiomGate.lean`] |
| Compiled code | **No**: generated from the pre-definition by an unverified compiler, which was replaced wholesale in 4.22.0 (#8577, the new LCNF-based compiler) and keeps changing [REL v4.22.0] | Differential testing against the kernel-side meaning via `#eval` in tests, **re-run on every toolchain bump**; `@[csimp]` for proven-equal swaps (§11.4) [REF §2.4] |
| `@[implemented_by]`, `@[extern]` | **No**: equivalence "cannot be proved in Lean" | Forbid them in the certified tier [REF §7.6.6.2; ValidatingProofs] |
| `partial`, `unsafe` | **No** | Forbid in the certified tier; allow in the IO shell [REF §7.6.6] |
| `native_decide`, `bv_decide` | Result admitted by axiom | Separately labelled tier [REF §14.5.18] |
| C compiler, Lean runtime (C), FFI glue | **No** | Keep glue tiny (SampCert: "five functions (57 lines of C++)") [SAMP] |
| JSON parse/print shell | **No** (`partial`); accepts `1e3` as a `Nat`, last duplicate key wins [HANDS G11–G12] | Exit 2 on malformed input; canonical numbers and no duplicate keys enforced upstream; round-trip tests [LEANSRC Json/Parser.lean] |
| Process contract (`main`) | **No** | Catch every IO error; an uncaught one exits 1 = "rejected" [EMITC; HANDS G13] |
| TS ↔ Lean value conversion (floats → Rat/ppm) | **No** | Explicit, documented rounding; reject NaN/Inf |
| Build-time metaprograms / tactics | Can run arbitrary code | Treat AI-generated proofs as untrusted; `comparator` in a sandbox [REF ValidatingProofs] |

In short, "certified extraction" means proven logic plus trusted compilation. FlowAId documents must never describe a Lean binary as correct beyond this table.

### 7.3 Integration order for FlowAId (TypeScript/Node)

1. **Subprocess with JSON on stdin or a file, JSON on stdout, and exit codes 0/1/2** (the §6.2 program). This relies only on stable features [FPIL §2.3, §8.6.4] and keeps the unstable FFI out of the path. Measured cost: ~17 ms per spawn with `Lean.Json`, ~2.5 ms for an `Init`-only exe [HANDS §3.4]. For high volume, use a long-lived process reading newline-delimited requests, or move JSON to the TS side and pass scalars.
2. *Optionally, later*: `lake build FlowaidCert:static` plus scalar-only `@[export]` entry points in a Node N-API addon, following the initialization protocol [REF §12.4.2]. How to bridge Node to Lean, whether through N-API or WASM, is not covered by any source we read (reviewer; verify).
3. The reducer and compiler stay in TypeScript because they also run in the browser [ARCH §2.5 "used identically by compiler and runtime"]. Lean checks them by differential testing (§11.2) and does not replace them.

---

## 8. Performance ("Perceus")

- Lean uses **reference counting, not a tracing GC**. Cycles cannot form, because "the verifiable fragment of Lean cannot create cyclic data" [REF Reference-Counting §12.2].
- Benefits: memory reuse (e.g. `List.map` allocates nothing when the list is uniquely referenced), opportunistic in-place updates for `Array`/`String`, predictable deallocation, and a simpler FFI. Borrow analysis removes many RC updates. Objects shared across threads use slower atomic counts [REF §12.2].
- **Where the name comes from.** The manual cites **Ullrich & de Moura (2019), "Counting Immutable Beans"**, and "Perceus" does not appear in its chapter [REF §12.2]. Perceus is a later paper, co-authored by Lean's lead developer: "an algorithm for precise reference counting with reuse and specialization" whose programs are "garbage free", evaluated "as implemented in Koka" [PERCEUS]. It generalizes the reset/reuse idea of Counting Immutable Beans. So the article's naming is loose, not baseless: say "Perceus-style reference counting with reuse" or use the manual's terms, not "Lean implements Perceus" (§1 row 11). Whether Lean's borrow inference keeps Perceus's garbage-free guarantee is not covered by our sources (reviewer; verify).
- In-place updates happen only when the value is unshared. `Array.set`/`swap` copy once when shared, and after that the copy is unique [FPIL Insertion-Sort §8.6, §8.8.2].
- **Observe it, don't assume it**: `dbgTraceIfShared "msg" x` prints `shared RC msg` to stderr, and `set_option trace.compiler.ir.result true` shows inc/dec/reuse in the IR [REF §12.2.1–12.2.2; FPIL §8.6.4].
- `#eval` reports much more sharing than compiled code, so measure with a `lake build` binary, `buildType = "release"`, and input from stdin [FPIL §8.6.4; REF Lake §24.1.3.1].
- "Lean's proof logic works at the level of pure functional programs, not the underlying implementation" [FPIL §8.6.4]. Proofs say nothing about performance.
- The article's "competitive with imperative implementations in many cases" [ART L31] is its own claim. No benchmark in our sources confirms it for workloads like FlowAId's. Cedar reports DRT times of 5 µs Lean vs 7 µs Rust [CEDAR-B], or medians of 6 µs vs 10 µs [CEDAR-P]. The two sources disagree, so cite them separately. SampCert's extracted sampler is ">2x faster" than a reference implementation [SAMP].
- None of this carries over to TypeScript/V8. It matters only for the extracted checker.

---

## 9. Lake, elan and toolchain pinning

- Install elan with `curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh` [ART L82; SRC L11]. Editor: VS Code with the lean4 extension [ART L83].
- `lean-toolchain` is "a text file … that contains a single line with a valid toolchain identifier", e.g. `leanprover/lean4:v4.34.0`. "A project's toolchain file should typically contain a specific version of Lean, rather than a general channel" [REF Managing-Toolchains-with-Elan §24.2.1.1].
- Elan chooses the toolchain from the nearest parent directory that has an override or a `lean-toolchain` file. `lake +4.x.y` forces a version. Other commands: `elan run [--install] <tc> <cmd>`, `elan which`, `elan show` [REF §24.2.1.2].
- `lake update` may rewrite `lean-toolchain` when a dependency needs a newer toolchain. Prevent that with `--keep-toolchain`, or with `fixedToolchain = true` in the package config [REF Lake §24.1.2.4].
- Commit `lake-manifest.json` ("should normally be checked into source control") [REF Lake §24.1.1].
- `lake new greeting` creates `Main.lean`, a library, `lakefile.toml`, `lean-toolchain` and a git repo. `lake new x exe` creates one without a library [FPIL §2.3.1]. `lake new my_project math` [ART L84] adds Mathlib.
- Tactic names and behaviour change between versions: FPIL uses `grind`, `fun_induction` and `String.Slice` [FPIL study note], and TPIL targets 4.33 [TPIL]. Pin one version and treat a toolchain bump as a PR with its own CI run.

**Recommendation:** pin the core-only package to **`leanprover/lean4:v4.34.0`**, the latest stable release. Move to v4.35.0 once it is stable, to get `lake check` (§10). That move needs a review for the `Decidable` change (§2.4) and the removed `ofReduceBool` family (§4.2).

---

## 10. Validation ladder and CI gates

The manual gives a ladder of increasingly strong checks [REF ValidatingProofs]:

| Level | Check | What it establishes | Gaps |
|---|---|---|---|
| L1 | `lake build --wfail` (warnings fail the build) | Elaborated and accepted by the kernel, with no `sorry` and no linter warnings | Plain `lake build` passes with `sorry`, which is only a warning [HANDS G5]; axioms are not shown |
| L2 | `#print axioms thm`, pinned with `#guard_msgs` | Only propext / Classical.choice / Quot.sound are used (or no axioms at all). `sorryAx` means the proof is incomplete, `_native` names mean native evaluation, and anything else is a custom axiom | Meta-code can bypass the kernel's state |
| L3 | `lake env leanchecker --fresh <Module>` (lean-action `leanchecker: true`) | .olean files replayed through the kernel | Trusts that the .olean files are well formed. Accepts declared axioms, so it does not catch `native_decide` [HANDS G9]. Pair it with L2 |
| L4 | `lake comparator` with external kernels (`enable_nanoda`, `--paranoid`) | Sandboxed build; statements matched against a trusted challenge file | Linux only (bubblewrap); 4.35+ |

**The checker binary is `leanchecker`, and it already ships in v4.34.0.** Measured: `~/.elan/toolchains/leanprover--lean4---v4.34.0/bin/leanchecker` exists, and `lake env leanchecker [--fresh] LeanScratch.Checker` ran in 0.45 s (26 s with `--fresh`) [HANDS §2, §3.4]. lean-action's own docs agree: its `leanchecker` input "Uses the bundled `leanchecker` binary on Lean `nightly-2026-01-09` / `v4.28.0-rc1` and newer" and falls back to building the external `lean4checker` repository on older toolchains; the `lean4checker` input is a "Deprecated alias" [LEAN-ACTION]. The second examiner review said `leanchecker` is bundled only from 4.35 (#15130). That is not what the notes say: #15130 bundles **con-leche**. What 4.35 adds is more independent checkers in the toolchain, namely `bin/leanchecker-paranoid` (#14884), lean4lean (#15048), nanoda (#15099) and con-leche (#15130), all of which `lake check --paranoid` and `lake comparator --paranoid` run (#15145) [REL v4.35.0].

- Pinning axioms (*upstream pattern* [REF Axioms §8.5]; copy the expected text from real output, never write it by hand):

```lean
/--
info: 'checkGate_sound' does not depend on any axioms
-/
#guard_msgs (whitespace := lax) in
#print axioms checkGate_sound
```

- `lake check` (**new in 4.35**) builds the default targets, replays them through the kernel, and "fails if any of them is not one of the standard axioms". Exit codes are 0/1/2 [REF Lake §24.1.2.8; REL v4.35.0].
- `lake comparator` takes `comparator.json` with the required keys `challenge_module`, `solution_module`, `theorem_names` and `permitted_axioms`, plus optional `definition_names`, `external_kernels` and `enable_nanoda`. `lake challenge` was renamed to `lake comparator` in 4.35. The sandbox runs on Linux only, and `--inadvisably-no-sandbox` is "not trustworthy" [REF Lake §24.1.2.8.1–2; REL v4.35.0]. The v4.33 notes list kernel soundness fixes, some of which affected comparator unless nanoda was also used [REL v4.33.0]. At the highest assurance level, use several independent kernels.
- The manual counts "un-reviewed AI-generated proofs and programs" as potentially malicious [REF ValidatingProofs]. This applies directly to FlowAId's AI critic and builder [PLAN P6-02].

**FlowAId CI job `lean` (Linux)**, proposed as an extension of [PLAN P0-05]:
1. Install elan and use the pinned toolchain.
2. `lake build --wfail` for the library *and* the exe (list both, [HANDS G6]). `--wfail` is Lake's own "fail build if warnings are logged" (`--fail-level=warning`), so a `sorry` or a linter warning fails the job; do not grep logs for "declaration uses `sorry`" [lake 4.34.0 `--help`; HANDS G5, G7]. `--iofail` (fail on info messages too) is stricter, but *verified 4.34.0* [REV]: a bare `#print axioms` or `#eval` in the library then fails the build, while the same command wrapped in `#guard_msgs` passes. Use `--iofail` only once every such command is pinned with `#guard_msgs`, which is the discipline this guide wants anyway.
3. `lake test`: the library test driver with `#guard`/`#guard_msgs`, including a pinned `#print axioms` for every exported theorem.
4. `leanchecker` on changed modules, and `leanchecker --fresh` nightly (26 s for one small module [HANDS §3.4]), via lean-action `leanchecker: true`. lean-action also offers `axiom-audit` with the allowlist `propext,Classical.choice,Quot.sound` [LEAN-ACTION]; it can replace the hand-written gate once it has been tried on the pinned toolchain.
5. From 4.35 stable: `lake check`.
6. A lint that forbids `sorry`, `native_decide`, `axiom`, `implemented_by`, `extern`, `unsafe` and `partial` in `FlowaidCert`. Native evaluation is allowed only in a separately named `Examples`/regression-vector library. Match axiom names by *pattern* (`_native`, `trustCompiler`, `sorryAx`), because the names change between versions (§4.2).
7. Machine- or LLM-generated proofs: `lake comparator` against a human-written challenge module.

---

## 11. Production strategies

### 11.1 Spec-first, with an executable model (Cedar's verification-guided development)

- Cedar's three parts: (1) an executable Lean model with machine-checked properties; (2) production Rust, checked against the model by differential random testing (DRT); (3) property-based testing (PBT) for parts that are not modelled, such as the parser and formatter [CEDAR-P].
- Theorems are statements about *all inputs* of the executable spec, e.g. `forbid_trumps_permit`, `default_deny`, `order_and_dup_independent`, and soundness of validation and slicing [CEDAR-GH cedar-lean/Cedar/Thm/Authorization.lean].
- Scale: 1,673 LOC Lean model plus 5,714 LOC of proofs, against 24,915 LOC of Rust, "approximately 10 times smaller" [CEDAR-B]. The validator proof took 18 person-days [CEDAR-B].
- Results: 4 bugs found by proofs, and 21 by DRT and PBT (16 DRT, 5 PBT) [CEDAR-P].
- Release policy: "A new version of Cedar isn't released unless its model, proofs, and differential tests are up to date" [CEDAR-B].
- LNSym (Armv8 in Lean): "Since Lean programs are executable, the specifications achieve a high degree of trust through thorough conformance testing" [LNSYM]. The spec is itself tested against ground truth.
- A second use of the executable spec: keep the simple function as "an executable specification for the optimized version", proved equal for all inputs with `funext` plus (functional) induction, generalizing the accumulator [FPIL Proving-Equivalence §8.2].

### 11.2 Differential testing between the proven model and production

- Cedar's DRT runs nightly: about 100M tests per night, 6 h per fuzz target [CEDAR-S]. A minimized cargo-fuzz corpus is kept for each version and run in CI [CEDAR-P].
- The harness runs production and spec on the same input and panics on disagreement, with an explicit `ErrorComparisonMode {Ignore, PolicyIds, Full}` and an allow-listed, ticketed known gap (TODO #175) [CEDAR-GH cedar-drt/src/tests.rs]. Fuzz targets are split into `*-drt`, `*-pbt` and `*-roundtrip` [CEDAR-GH cedar-drt/fuzz/fuzz_targets].
- Generators decide how much DRT finds. Cedar's type-directed generator produces a schema, then conforming entities, then policies and requests, and a second generator adds ill-typed inputs. The team found that 35.5% of generated conditions were boolean literals and cut that to 9.7%. "Complete line coverage alone does not guarantee effective testing" [CEDAR-P].
- DRT is evidence, not proof: it misses inputs that are unlikely to be generated [CEDAR-P].

### 11.3 Certificate checking: untrusted solver, verified checker

- `bv_decide` sends the goal to an external SAT solver and checks its LRAT certificate with a Lean checker that has `check_sound` (§2.4) [LEANSRC LRAT/Checker.lean; src/Init/Tactics.lean].
- Certifying algorithms: "a checker for such a witness is usually much simpler than the original algorithm – yet it is all the user has to trust" [CERTALG].
- **For FlowAId:** do not prove the whole TS compiler. Have it *emit certificates*, and check each one with a small checker that has a soundness theorem in Lean and a TS mirror. Examples: the contradictory literal pair behind each pair of exclusive edges [ARCH §4.3], the Kahn order [ARCH §4.1], and the derivation behind an `isSubschema` result [ARCH §4.5]. This gives "verified for this plan" at publish time and at the worker's plan-hash re-check. It is our derived recommendation; no source proposes it for FlowAId.

### 11.4 Translation validation and proven-equal fast implementations

- `@[csimp]` takes a theorem `@f = @g` and makes the compiled code call `g` in place of `f`. *Upstream*: `@[csimp] theorem append_eq_appendTR : @List.append = @appendTR` [LEANSRC src/Init/Data/List/Basic.lean ~L596]. It adds nothing to the trusted base, unlike `implemented_by`.
- lean-mlir verifies peephole rewrites [LEANMLIR]. AMO-Lean derives every e-graph rule from a Lean theorem but leaves codegen unverified, and checks the generated C against the spec with 2850+ differential tests. It notes that its "proof anchors" are "not executable assertions" [AMO]. Axon layers testing, translation validation and full verification [AXON].

### 11.5 Proof-carrying results

- SampCert: a Lean + Mathlib development of more than 12k lines of proof, deployed in AWS Clean Rooms Differential Privacy. It uses **rational arithmetic, not floats**, "to avoid round-off error", and its runtime glue is 57 lines of C++ [SAMP]. We found no report of statistical testing of the binary; its correctness rests on the proofs.
- **For FlowAId:** a result (an evaluation summary or a decision receipt) carries enough data for a Lean checker to recompute it and give a verdict. The fast TS path stays untrusted, and the checker plays the "black box of truth" role [ART L25].

### 11.6 AI-assisted proving

- LeanDojo/ReProver (about 98.7k theorems, retrieval-augmented) [LEANDOJO]; Lean Copilot [COPILOT].
- The Rust-to-Lean pipeline with AI provers: "The Lean kernel re-checks every proof, constituting the trust boundary … AI output cannot compromise soundness". AI closed structural lemmas but not domain algebra or loop invariants. "Specification design, invariant discovery, and the selection of mathematical abstractions remained the work of human proof engineers" [AIPIPE].
- Aeneas: 237 KLOC of Lean verifying 16.7 KLOC of SymCrypt Rust [AENEAS]. It shows the true proof-to-code ratio of full verification.
- Policy: AI may *propose* proofs. Only comparator-judged proofs against a human-written challenge count as certified [REF ValidatingProofs].

---

## 12. Mathlib: cost, trade-off, recommendation

### 12.1 What Mathlib offers FlowAId
- ℝ, `Finset.sum` lemmas (`sum_nonneg`, `sum_le_sum`, `single_le_sum`, `sum_congr`, `sum_div`, …), casts from ℚ to ℝ, and the inequality tactics in §4.3 [MLSRC Algebra/Order/BigOperators/Group/Finset.lean; MIL C05 §5.2, C06 §6.1].
- The probability simplex `stdSimplex 𝕜 ι := {f | (∀ x, 0 ≤ f x) ∧ ∑ x, f x = 1}` with `convex_stdSimplex`. **All of these were deprecated on 2026-08-29** in favour of `Convexity.StdSimplex` (`weights : X →₀ R; nonneg; total`), which lives in a `noncomputable section` [MLDOC Analysis/Convex/StdSimplex; MLSRC Geometry/Convex/ConvexSpace/Defs.lean].
- `PMF α = {f : α → ℝ≥0∞ // HasSum f 1}` is measure-theoretic and noncomputable. It is more than FlowAId's finite distributions need [MLDOC Probability/ProbabilityMassFunction/Basic].

### 12.2 What it costs
- **ℝ is noncomputable.** `Real.decidableLE`/`LT`/`Eq`, `linearOrder` and `instField` are `noncomputable` [MLSRC Mathlib/Basic/Real/Basic.lean L471–505]. A gate that branches on `conf ≥ thr : ℝ` will not compile, and `decide` fails on it. `Mathlib.Data.Real.Basic` has been a deprecated re-export since 2026-08-27 [MLSRC].
- Size and build time: 8,556 `.lean` files and about 99 MB of source on master (GitHub tree count). The only disk figure found is "Mathlib + deps consumes 3.9 GB" from 2023 [Zulip archive, "Centrally Storing and Referencing Mathlib"]; the real figure today is larger and should be *measured*, not quoted. Without `lake exe cache get`, the next step is "very slow" [MLSRC README].
- Churn: three deprecations in one month (`Data.Real.Basic` on 08-27, `stdSimplex` on 08-29, `single_le_prod'` on 09-01), and master sits on an rc toolchain [MLSRC]. Setup: `[[require]] name = "mathlib" scope = "leanprover-community" rev = "<tag>"`, and copy Mathlib's `lean-toolchain` exactly [mathlib4 wiki "Using mathlib4 as a dependency"].

### 12.3 What core Lean already provides
- **`Rat` is in core**: exact, `DecidableEq`, decidable `<`/`≤`, `Min`/`Max`, `OfScientific` (`0.85 : Rat` is exactly 85/100), about 258 lemmas, and `grind` instances [LEANSRC src/Init/Data/Rat/Basic.lean, Lemmas.lean; src/Init/Grind*/Rat.lean].
- `List.sum` with `@[simp, grind =]` lemmas [LEANSRC src/Init/Data/List/Basic.lean L2061–2065]; `Fin n`, `BitVec`, `UIntN` with grind ring instances [LEANSRC src/Init/GrindInstances/Ring/*]; `omega`, `decide*` and `grind` [REF].
- **`Float` is IEEE double with an opaque, extern-backed model and no field or order laws** [LEANSRC src/Init/Data/Float/Float.lean]. Nothing about thresholds can be proved over `Float`.

### 12.4 Recommendation
1. **The certified package `FlowaidCert` is core-only.** Specs and checkers use `Nat` fixed-point (ppm or basis points), `Int` micro-units and `Rat`. Proofs use `omega`, `decide*`, `simp` and `grind`. It builds fast in CI, links no Mathlib into the binary, and pins one stable toolchain.
2. **Defer Mathlib.** If ℝ-level statements are ever needed (for example, a calibration theorem stated over reals, or convexity of consensus mixing), add a *separate* package `FlowaidSpec` that requires Mathlib at a pinned tag, uses its own `lean-toolchain`, and has a cached CI job running `lake exe cache get`. It proves transport lemmas such as `gateQ c t = gateR (c:ℝ) (t:ℝ)` with `push_cast`/`exact_mod_cast`. The production binary never links it.
3. Choose between `Rat` and ppm per property. `Rat` is exact, but gcd normalization has a cost. ppm keeps everything in `omega`'s reach, but renormalization becomes rounding, so the spec must state an error bound (e.g. |Σ − 10^6| ≤ n) instead of Σ = 1 [MLSRC study note, fixed-point technique].

---

## 13. How this maps onto FlowAId

### 13.1 The self-critical assurance ledger (the central idea)

Every claim that FlowAId's evaluation makes, in `EvaluationSummary`, `RegressionReport` [ARCH §10.4] or a Jev decision receipt [ARCH §2.8], gets a tier. The article's range-constraint caveat [ART L40] and the manual's split between proof and meaning [REF ValidatingProofs] both show why:

| Tier | Meaning | Example |
|---|---|---|
| **PROVEN** | A Lean theorem for all inputs of the modelled type. Records the theorem name, validation level L1–L4 (§10), axiom set and toolchain | "verdict = fail ↔ passRate < minPassRate" |
| **CHECKED** | This specific result was recomputed or validated by a checker with a soundness theorem, or agreed with the Lean oracle | the summary for run X was recomputed by `flowaid-check` |
| **TESTED** | Holds on the evaluation dataset / DRT corpus only | "accuracy 0.94 on 200 cases" |
| **ASSUMED** | Trusted, not checked | `judge` matchers, provider calibration, `W_TYPE_UNVERIFIED` edges [ARCH §4.5], JSON/float boundary |

Each report also lists **what it does not cover**, following the article's own caveat. The publish gate reads the ledger, not only `passRate`. `verified: false` from the compiler is treated like a `sorry`: it is recorded and surfaced, and never passes silently.

### 13.2 Candidate theorems (priority order)

1. **Evaluation maths and verdict** [ARCH §10.4; PLAN P2-07]: 0 ≤ passRate ≤ 1; ECE bins partition [0,1] and their counts sum to N; 0 ≤ ECE ≤ 1; ECE does not depend on case order; the verdict is monotone in `minPassRate`; every case flip appears in `flips`, and flips are symmetric when baseline and candidate swap. All of these are finite and mostly linear, a good fit for `omega`/`grind` over `Nat`/`Rat`.
2. **Decision-result invariants** [ARCH §2.8, §6.3]: probabilities are non-negative and sum to 1; Choice keys ⊆ options; Boolean `confidence = max(pYes, 1−pYes) ≥ 1/2`; Score `value ∈ [0, n−1]`, `normalized = value/(n−1) ∈ [0,1]`, `level = round(value)`; one gate threshold means the same thing for a Boolean and a two-option Choice. Also soundness of the adapter's renormalization window (sum ∈ [0.9, 1.1] ⇒ `p_i/S` is on the simplex) [ARCH §6.3].
3. **Confidence gate** [ARCH §6.3]: exactly one outcome; monotone in confidence; never `fail` without `reviewBand`.
4. **Activation and reducer semantics** [ARCH §2.5, §5.1, §5.3]:
   - at most one edge fires per exclusive group, and a node with several fired edges in a group runs once;
   - pruning is monotone, and a node is never both ready and pruned;
   - a producer settles before its consumer runs;
   - replaying a log gives the same `SchedulerState` (§5.1 invariant 3);
   - run completion follows §2.7.
   These are proved by induction over the event log (§4.1).
5. **Guard exclusivity soundness** [ARCH §4.3]: `exclusive g1 g2 = true → ∀σ, ¬(sat σ g1 ∧ sat σ g2)`, and widening past 64 clauses to `[[]]` never makes pruning unsound.
6. **`isSubschema` soundness** for the handled fragment [ARCH §4.5; PLAN P0-10]: ok ∧ verified ⇒ ∀v, valid S v → valid T v; reflexivity and transitivity *for all schemas*. Today these properties are only fast-checked. The three-valued result keeps `unverified` as an honest third outcome.
7. **Accounting** [ARCH §5.13]: run cost = Σ node costs in integer micro-units; roll-ups are conservative. This is linear arithmetic, the same shape as the article's limb example.
8. **Compile-time vs execution errors** [ART L3; ARCH §4.1]: a plan with zero `E_*` diagnostics cannot trigger certain runtime failures, such as unresolved refs or `E_CONDITIONAL_DATA_DEP` situations. Record which layer caught each regression (Lean build, compiler diagnostic, runtime `RUN_FAILED`).

### 13.3 Staging (lowest risk first)

1. **Spec + proofs** in a `spec/lean` (or `formal/`) Lake package: core-only, pinned v4.34.0, CI job per §10. Write the model *before* growing the TS worker, following the article's "spec before low-level code" [ART L3]. Run Plausible and fast-check on the statements before proving them [CEDAR-P; PLAUSIBLE]. Spec statements need human sign-off [AIPIPE].
2. **A `lake exe` oracle** (`flowaid-check`, JSON in and out, exit codes 0/1/2) used by vitest differential tests against the TS reducer, compiler checks and evaluator. Use type-directed fast-check arbitraries (definition → plan → valid event sequences, plus an ill-typed generator), explicit comparison modes (exact for state and events; code-level for diagnostics; stated tolerance for float metrics), a minimized corpus per release, and a nightly long run [CEDAR-P, CEDAR-GH]. Also run conformance replay of golden or recorded run logs [PLAN P5-03] through the Lean reducer, which validates the spec itself [LNSYM].
3. **Proof-carrying evaluation**: an `EvalCertificate` next to each report, checked by `checkReport` with a `check_sound` theorem (§11.3, §11.5). Store the checker verdict and the toolchain hash.
4. **Optional armored library**: a static library plus N-API for publish-time plan and receipt validation, only if stages 1–3 have proved their value (§7.3).

Until stage 4 exists and is justified, all external claims stay at "checked against a proven model". Never claim "the TS implementation is verified".

---

## 14. Pitfalls (consolidated)

1. **The spec can be wrong while the proof is right.** Lean does not check that the statement means what you intended [REF ValidatingProofs]. Review the domain, hypothesis necessity and vacuity (§1.1).
2. **Unused, vacuous or contradictory hypotheses** give false confidence, and contradictory ones make anything provable [ART L55–56 analysis].
3. **Caveats pushed outside the theorem** (range constraints handled "by lookup arguments" [ART L40]) have to be listed in the report as ASSUMED.
4. **A theorem hypothesis that production does not enforce is worthless.** Reducer determinism "for well-formed events" requires the append path to enforce well-formedness [survey note, Cedar/limb analogy].
5. **`sorry` is a warning, not an error.** It can prove false bounds, and those can crash at run time [TPIL §8.5; FPIL §8.8.5]. `#eval!` bypasses the refusal to evaluate sorry-dependent code [TPIL §6.1].
6. **`native_decide`/`bv_decide` trust the whole compiler.** This is not hypothetical: in 2023 `reduceBool` proved `False` with an empty axiom list [ZULIP-NATIVE], and until 4.23.0 `collectAxioms` could omit `trustCompiler` [REL v4.23.0 #8842]. Their axiom names changed in 4.29 and the old ones were removed in 4.35 [REF §14.5.18; REL v4.29.0, v4.35.0]. External checkers cannot check them, and `leanchecker` passes them [HANDS G9].
7. **`partial`/`unsafe`/`implemented_by`/`extern`** are outside the kernel [REF §7.6.6]. Lean's JSON parser is `partial` [LEANSRC].
8. **"Certified extraction" is not a verified compiler.** The compiler works from the pre-definition, and the C compiler and runtime are trusted [REF §2.3–2.4].
9. **A theorem never gives a runnable witness.** Theorems are erased, so even a constructive proof of `∀ x, ∃ y, P x y` produces no program. Write the witness calculator as a `def` returning `Subtype`/Sigma. `Classical.choose` is noncomputable, but for a *decidable* predicate over ℕ (or an encodable or finite type) a witness *can* be computed from an `∃` proof by a search that takes its termination from the proof (`Nat.find`; §2.3) [TPIL §4.4, §12.5].
10. **`open Classical` in checker code** makes it noncomputable [REF §10.5.4; TPIL §12.6].
11. **propext/funext/Quot.sound block kernel reduction**, so `decide`/`rfl` can fail even when `#eval` works [TPIL §12.3–12.4].
12. **Well-founded definitions don't unfold definitionally.** Use equation lemmas, `decide_cbv`, or structural recursion/fuel [TPIL §8.5; REF §14.5.19].
13. **Float is not ℝ.** It has no laws, and NaN serializes as a string [LEANSRC Float.lean; Json]. Specify over `Rat`/ppm, and convert at the boundary with documented rounding.
14. **ℝ is noncomputable** and cannot be the type of an extracted gate [MLSRC Real/Basic.lean].
15. **`OfNat` for `Fin` wraps silently**: `(45 : Fin 10) = 5` [FPIL Bounded-Numbers §8.5].
16. **`xs[i]!` panics, and `xs[i]?` returns an Option.** Only `xs[i]` with a proof is check-free [FPIL Interlude; §8.3.2].
17. **`simp`/`decide` don't unfold `def`s**; use `abbrev` or `simp [f]` [FPIL Interlude]. A global `@[simp]` cannot be removed downstream [TPIL §5.7].
18. **Only self tail calls become loops** [FPIL §8.1.1].
19. **In-place updates need uniqueness.** `#eval` gives misleading sharing information, and constant folding can empty a benchmark [FPIL §8.6.4].
20. **Transformer order changes rollback semantics** [FPIL §6.3].
21. **The FFI is officially unstable**, constructor layout is unspecified, and `@[export]` arguments are owned [REF §12.4].
22. **`lakefile.toml` ignores unknown fields**, and `lake update` can bump the toolchain [REF Lake §24.1.3.1, §24.1.2.4].
23. **`lake check` and `comparator` need 4.35+**, and the sandbox is Linux-only. The dev machine is macOS, so run them in Linux CI [REF Lake §24.1.2.8].
24. **Treat AI-generated proofs as malicious until comparator accepts them** [REF ValidatingProofs].
25. **Mathlib churns fast and is heavy**; MIL's names lag behind current Mathlib [MLSRC; MIL].
26. **DRT is evidence, not proof.** Its value depends on the generators; line coverage is not enough [CEDAR-P].
27. **Error-comparison mode**: too strict and DRT is noise, too loose and it hides bugs. Track every allow-listed gap as a ticket [CEDAR-GH tests.rs].
28. **The article's attributions and numbers need care**: "Perceus" is loose naming (§1 row 11, §8) [PERCEUS; REF §12.2], the Coq/Isabelle comparison is wrong as stated (§1 row 6) [ROCQ-EXTR; ISA-CODEGEN], and the Cedar speed figures differ between sources [CEDAR-B vs CEDAR-P].
29. **Proof maintenance cost is real**: Cedar's validator proof took 18 person-days [CEDAR-B], and Aeneas needed 237 KLOC of Lean for 16.7 KLOC of Rust [AENEAS]. Keep the verified core narrow.
30. **An uncaught IO error exits 1**, whatever `main`'s type. If 1 means "rejected", a crash reads as a verdict. Catch everything and map it to 2. Use only small exit codes (in practice 0/1/2), because the OS keeps 8 bits: `pure 300` exits 44 [EMITC; HANDS G13; §6.2].
31. **`omega` is incomplete** (no dark or grey shadows). A failure means "not found", not "false"; it failed on the true field-level limb theorem [LEANSRC Init/Tactics.lean; HANDS §3.2].
32. **"Zero-cost" has conditions.** Under the module system a public one-field wrapper may stay boxed unless its public scope shows it is a trivial wrapper [REF §4.4.4.3]. Type-class instances other than `Decidable` are run-time dictionaries (§2.2). Check the generated C.
33. **`import Lean` in the certified core** makes every embedder run the full `lean_initialize` and ships ~99 MB [EMITC; HANDS G14]. Keep `Lean.Json` in the exe shell.
34. **The compiler behind `#eval` and the binary changes under you.** It was replaced in 4.22.0 (#8577) and keeps moving, so re-run differential tests on every toolchain bump [REL v4.22.0].
35. **`--iofail` fails on bare `#print axioms`/`#eval`.** Pin them with `#guard_msgs` first (§10) [REV].

---

## 15. Open items

**Settled in this revision or by [HANDS]:**

- [x] The article's theorem builds with no Mathlib import, and also with `h_c0_bit`/`h_c1_bit` removed [HANDS §3.1–3.2]. The bit bounds are still needed for the field-level theorem (§1.1 point 2).
- [x] The article's `native_decide` examples check with `decide` (no axioms), `rfl` (none) and `omega` (`[propext, Quot.sound]`) [HANDS §3.1].
- [x] `import Lean.Data.Json` alone is enough for `Json` and `deriving ToJson, FromJson`. Binary size: 99 MB, against 2.4 MB for `Init` only [HANDS §3.4; REV].
- [x] An uncaught IO exception in `main` exits **1**, whatever the return type, and exit codes above 255 are truncated (§6.2) [EMITC; REV].
- [x] The checker binary is `leanchecker`, bundled with v4.34.0; `lean4checker` is the old external repository and a deprecated lean-action alias (§10) [HANDS §2; LEAN-ACTION].
- [x] `grind` closes `max`/`min` goals over `Rat` without unfolding. *Verified 4.34.0* [REV]: `a ≤ max a b`, `min a b ≤ a`, `a ≤ c → b ≤ c → max a b ≤ c`, and `max c (1 - c) ≥ 1/2` (the Boolean-confidence bound of §13.2 item 2) all prove by `grind` alone.
- [x] `termination_by n` followed by `decreasing_by omega` compiles on 4.34.0 [REV]. `@[export]` on a declaration with an `@&` parameter is an error on 4.34.0: "Declaration bad is marked as `export` but some of its parameters have borrow annotations" [REV; REL v4.30.0 #13017].
- [x] The §6.3 `lakefile.toml` builds and its test driver behaves as described [REV].
- [x] Perceus vs Counting Immutable Beans: loose naming, not baseless (§1 row 11, §8) [PERCEUS]. Coq/Isabelle: both extract code, so the article's claim is wrong as stated (§1 row 6) [ROCQ-EXTR; ISA-CODEGEN].

**Still open:**

- [ ] The §2.3 `solve` signature is the only remaining *sketch*; it is a type shape, not code to run.
- [ ] Try lean-action's `axiom-audit` on the pinned toolchain and decide whether it replaces the hand-written gate (§10). Its description still names `Lean.ofReduceBool`, which 4.29+ no longer uses, so confirm that the allowlist mode catches `_native` axioms [LEAN-ACTION].
- [ ] Whether Lean's borrow inference keeps Perceus's garbage-free property (§8).
- [ ] On the move to 4.35: re-run §2.4 under the `Decidable` structure change, adopt `lake check`, and re-run all differential tests (§7.2).
- [ ] If Mathlib is ever adopted: measure `.lake` size after `lake exe cache get`, and check the `Convexity.StdSimplex` lemma API.
- [ ] Measure whether FlowAId's own one-field wrappers stay unboxed once the package uses `module` files (§2.2).

---

## 16. Self-test: 25 questions

Engineers working on the formal layer should be able to answer these without looking. The short answers point to the section that explains them.

1. **What does `native_decide` trust?** The whole Lean compiler, every `@[implemented_by]`/`@[extern]` in reach, and the C toolchain. The result enters as an axiom, which `leanchecker` accepts and external checkers cannot re-check (§4.2).
2. **What gets erased at compile time?** Types, proofs and all theorems. Irrelevant arguments are dropped or passed as `lean_box(0)`. `Decidable` becomes a `uint8_t`. Other instance arguments are *not* erased; they are dictionaries (§2.2).
3. **How does C code call a Lean function safely?** Through a monomorphic, scalar `@[export sym]` function, after calling `initialize_<pkg>_<Module>(builtin=1)`, checking the result and calling `lean_io_mark_end_initialization()`. Arguments are owned. If the module imports `Lean`, its initializer runs the full `lean_initialize` (§7.1).
4. **How does a Lean CLI read JSON from stdin?** `let raw ← (← IO.getStdin).readToEnd`, then an empty-input check, then `Json.parse raw >>= fromJson?`, with every failure mapped to exit 2 (§6.2).
5. **Why does `unfold` plus `omega` prove the limb theorem?** After `unfold`, `carry0 * 65536` is multiplication by a literal, so it is linear. `omega` replaces each `% 2^32` with a bounded remainder variable and solves the linear system. Without `unfold`, the product is an opaque nonlinear atom (§1.2).
6. **What is the range-check caveat, concretely?** Without limbs < 2^16, a prover can wrap a limb past p (`res0 = p`) or claim a fake carry (`carry0 = 1`, `res0 = p − 2^16`). Both satisfy the field equations with a wrong sum. Both counterexamples are kernel-checked (§1.1 point 5).
7. **What does certified extraction not certify?** The Lean compiler, the C compiler, the runtime, FFI glue, `implemented_by`/`extern`, `partial`/`unsafe` code, the JSON boundary and the meaning of the spec (§7.2).
8. **`∃` vs a witness: what runs?** Only a `def`. A theorem is erased, so write `(x : α) → {y // P x y}` or a `def` plus a completeness theorem. For a decidable predicate over ℕ, a search can still compute a witness from an `∃` proof (§2.3).
9. **Is Lean's memory management Perceus?** Perceus-style: reference counting with reset/reuse from Counting Immutable Beans. Perceus is the later, Koka-based generalization (§8).
10. **What exit code does an uncaught IO error give?** 1, for any `main` type. So a certifying CLI must catch everything and use 0/1/2 for accept/reject/could-not-run (§6.2).
11. **How do you stop `sorry` from reaching main?** `lake build --wfail`, plus the axiom allowlist gate that fails on `sorryAx` (§10).
12. **How do you stop a custom `axiom`?** An allowlist of `propext`, `Quot.sound` and `Classical.choice` checked on every exported theorem, plus a lint banning `axiom` in `FlowaidCert` (§10).
13. **`decide` vs `decide +kernel` vs `decide +native`?** Elaborator reduction checked by the kernel; kernel-only reduction ignoring transparency; compiled evaluation admitted by axiom. Only the first two belong in the certified tier (§4.2).
14. **Why does `decide` fail on a well-founded definition?** Well-founded definitions do not unfold definitionally. Use `decide_cbv`, equation lemmas, or structural recursion with fuel (§5).
15. **What can you prove about a `partial def`?** Nothing: the kernel keeps only an opaque constant. Lean's JSON parser is `partial` (§5, §6.1).
16. **What does `@&` mean, and where is it forbidden?** A borrowed argument, with no reference-count transfer. It is a compile error on an `@[export]` declaration since 4.30 (§7.1).
17. **What changed about `Decidable` in 4.35?** It became a structure with `decide : Bool` and a reflection proof. Use `decide` with `of_decide_eq_true`, not matches on `isTrue`/`isFalse` (§2.4).
18. **`Float`, `Rat` or ℝ for thresholds?** `Nat` ppm or core `Rat` in the checker. `Float` has no laws; ℝ is noncomputable and needs Mathlib (§12).
19. **What does Mathlib cost?** A toolchain that must match Mathlib's exactly, a large cache (3.9 GB already in 2023; measure it today), fast churn, and a noncomputable ℝ. The certified core stays core-only (§12.2, §12.4).
20. **Who checks that the spec is right?** No tool. Spec review does: domain, hypothesis necessity, counterexamples, vacuity and the axiom set (§1.1).
21. **`leanchecker` vs `comparator`?** `leanchecker` replays `.olean` files through the kernel and accepts declared axioms. `comparator` checks a solution against a trusted challenge in a Linux sandbox, optionally with independent kernels (§10).
22. **Is Lean's extraction unique among proof assistants?** No. Rocq and Isabelle extract to OCaml, Haskell and others. Lean's difference is that the Lean definition itself is compiled, via C, with no separate host language (§1 row 6).
23. **How do you pin the toolchain?** A specific `leanprover/lean4:v4.34.0` in `lean-toolchain`, a committed `lake-manifest.json`, and `--keep-toolchain` or `fixedToolchain = true` (§9).
24. **Are the article's `native_decide` examples needed?** No. They prove by `decide` with no axioms, and they are test cases, not the theorem (§1.1 point 4).
25. **What is the checker plus soundness pattern, and what is in its TCB?** A `Bool` checker with `check_sound : check x = true → Spec x`. The proof is kernel-checked; the compiled checker, the parser and the process contract are trusted (§2.4, §7.2).
