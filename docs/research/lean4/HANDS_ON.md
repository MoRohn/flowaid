# Lean 4 hands-on log (FlowAId)

Status: done 2026-09-23 on the product owner's Mac. Every Lean snippet in this file was compiled and checked with the toolchain below. The complete, verified sources are in the appendix, because the scratch project lives in a temp directory that will be deleted.

This file covers what [LEAN4_EXPERT_GUIDE.md](LEAN4_EXPERT_GUIDE.md) could not: that guide was written with no toolchain installed. Where the two disagree, the measurements here win for Lean 4.34.0. §6 lists the corrections.

## 1. Environment and versions

| Item | Value |
|---|---|
| Machine | Apple M4 Pro, 48 GB RAM, macOS 26.2 (25C56), arm64 |
| C toolchain on the machine | Apple clang 17.0.0 (not used by Lean: Lean ships its own `clang` and `ld64.lld`) |
| elan | 4.2.4 (227caca13, 2026-08-25), the latest elan release |
| Lean | **4.34.0**, commit 293d5d0c0c3f3dded4688b3ccd6a33939ac5102b, `arm64-apple-darwin24.6.0`, Release |
| Lake | 5.0.0-src+293d5d0 |
| `lean-toolchain` | `leanprover/lean4:v4.34.0` |
| Mathlib | not used; there are no dependencies (`"packages": []` in `lake-manifest.json`) |

**How the version was chosen.** The GitHub releases API (`/repos/leanprover/lean4/releases`) lists v4.34.0 (2026-09-14) as the newest non-prerelease. v4.35.0-rc1 and v4.35.0-rc2 (2026-09-15 and 2026-09-16) are release candidates. `https://release.lean-lang.org/` also lists `stable: v4.34.0`.

## 2. Commands, in order

```sh
# 1. elan, no sudo, no default toolchain. Takes 1 s.
curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf \
  | sh -s -- -y --default-toolchain none
source ~/.elan/env                  # only adds ~/.elan/bin to PATH

# 2. The pinned toolchain. Takes 36 s (downloads lean-4.34.0-darwin_aarch64.tar.zst). Uses 2.7 GB on disk.
elan toolchain install leanprover/lean4:v4.34.0

# 3. The project. The toolchain must be named explicitly because no default is configured (gotcha G2).
cd "$SCRATCH"
lake +leanprover/lean4:v4.34.0 new lean-scratch        # default template: lib + exe; no Mathlib
cd lean-scratch                                        # lean-toolchain = leanprover/lean4:v4.34.0

# 4. Build and check.
lake build LeanScratch                 # the library: proofs plus #print axioms output
lake build                             # the default target, the lean-scratch exe (gotcha G6)
lake build bench                       # the Init-only throughput exe
lake env lean gate/AxiomGate.lean      # the axiom allowlist gate; exits 1 on failure
lake env leanchecker LeanScratch.Checker            # kernel replay of the module's own declarations
lake env leanchecker --fresh LeanScratch.Checker    # replays everything, including Init: 26 s
lake build --wfail LeanScratch         # turns warnings (sorry, lints) into failures
```

`$SCRATCH` = `/private/tmp/claude-501/-Users-rohnspringfield-flowaid/5e5b740f-28d2-4b4f-9b2f-e6c5698bc146/scratchpad`.

Project layout: `LeanScratch/AddConstraint.lean` (the article, ported), `LeanScratch/FieldModel.lean` (the critique), `LeanScratch/Checker.lean` (the certified checker, `Init` only), `Main.lean` (JSON stdin to verdict), `Bench.lean` (throughput), `gate/AxiomGate.lean` (CI gate). That is 347 lines of Lean.

## 3. Results

### 3.1 The article's theorem, in core Lean

The article's `add_constraint_mod32` [ART L51–61] **compiles unchanged in core Lean** once the two Mathlib imports are removed. `unfold` and `omega` are both in core. It takes 0.3 s.

`#print axioms` output (verbatim from `lake build`):

| Declaration | Axioms |
|---|---|
| `add_constraint_mod32` (article, `omega`) | `[propext, Quot.sound]` |
| `ex1_native` / `ex2_native` / `ex3_native` (article, `native_decide`) | `[ex1_native._native.native_decide.ax_1_1]` (one fresh axiom per proof) |
| `ex1..3_decide` (same statements, `decide`) | **none** |
| `ex3_rfl` (`rfl`) | **none** |
| `ex3_omega` (`omega`) | `[propext, Quot.sound]` |
| `ex3_from_theorem` (an instance of the general theorem) | `[propext, Quot.sound]` |

The three `example`s are anonymous, so `#print axioms` cannot name them. We restated them as named theorems. The kernel checks `decide` on these 2^32-sized `Nat` literals instantly, because it has built-in GMP arithmetic for `Nat`. **`native_decide` is never needed for the article's examples**, and using it adds a trusted-compiler axiom for nothing.

### 3.2 Self-critique: the theorem is weaker than it looks

1. **The carry-bit hypotheses are not used.** Lean's unused-variables linter flags `h_c0_bit` and `h_c1_bit` on the verbatim article proof. `add_constraint_mod32_no_bits`, the same theorem with both hypotheses deleted, also proves by `omega`. Over `Nat`, `carry0` cancels and `carry1·2^32 ≡ 0`, so the conclusion holds for any carries. The hypotheses the article presents as essential carry no weight in its own model.
2. **The model is not the circuit.** A STARK constraint holds in F_p (BabyBear, p = 2^31 − 2^27 + 1), which means modulo p, not over `Nat`. `add_constraint_mod32_field` states the constraints mod p. It needs **every** range hypothesis (limbs < 2^16) **and** the carry-bit hypotheses: those bound both sides below p, which lifts the mod-p equations to `Nat` equations. From there the proof reuses `_no_bits`.
3. **Counterexample, checked by the kernel.** `field_needs_range` proves that the field version is *false* without range constraints. Take `res0 = p ≡ 0`: it satisfies the low-limb constraint for 0 + 0, but `res ≠ 0 mod 2^32`. The theorem is proved with `decide` and uses no axioms. The article's caveat [ART L45] is therefore load-bearing: the range constraints are the soundness argument, not an implementation detail.
4. **`omega` is incomplete.** On the field version, `omega` alone fails and prints a "possible counterexample". Lean's `omega` does not implement dark or grey shadows. A two-line manual step (`Nat.mod_eq_of_lt`) was needed first. A failing tactic means "not found", not "false".

For FlowAId: a spec can be proved and still be the wrong spec. The review has to ask "is the model faithful to the thing deployed?" and "are all the hypotheses used?" The linter answered the second question for free.

### 3.3 The certified checker ("armored library" plus "witness calculator")

`LeanScratch/Checker.lean` imports only `Init` and the two proof modules.

- `AddSpec w : Prop`: the specification, `res ≡ lhs + rhs (mod 2^32)`.
- `checkAdd w : Bool`: the field-faithful runtime check (six range checks, two bit checks, two constraints mod p).
- `checkAdd_sound : checkAdd w = true → AddSpec w`: **soundness for every input**. Axioms: `[propext, Quot.sound]`.
- `mkWitness a b`: the witness calculator. `mkWitness_complete`: for **every** `a` and `b`, the computed witness is accepted **and** decomposes `a mod 2^32` and `b mod 2^32` faithfully. This is the constructive form of ∀ a b, ∃ w. Axioms: `[propext, Quot.sound]`.
- `certify w : Option {v // AddSpec v}`: the proof travels in the type.

**Data vs Prop erasure, observed.** In the generated C (`.lake/build/ir/LeanScratch/Checker.c`), `certify` compiles to: call `checkAdd`; if false, `lean_box(0)` (`none`); else `lean_alloc_ctor(1, 1, 0)` holding **only `w`**. The subtype's proof field is gone, and no theorem name (`checkAdd_sound`, `mkWitness_complete`, `add_constraint*`) appears in any `.c` file.

**The exe** (`lean-scratch`) reads one JSON object from stdin using `Lean.Json`, which is arbitrary precision, so there is no float rounding. It prints one JSON verdict line. Exit codes: 0 accept, 1 reject, 2 malformed input.

```sh
$ echo '{"property":"add32","witness":{"lhs0":65535,"lhs1":65535,"rhs0":1,"rhs1":0,"res0":0,"res1":0,"carry0":1,"carry1":1}}' | lean-scratch
{"certifiedBy":"LeanScratch.checkAdd_sound","lean":"4.34.0","lhsPlusRhs":0,"mode":"check","property":"add32: res ≡ lhs + rhs (mod 2^32)","res":0,"verdict":"accept"}   # exit 0
$ echo '{"property":"add32","lhs":4294967295,"rhs":1}' | lean-scratch
{... "mode":"calculate","res":0,"verdict":"accept","witness":{"carry0":1,"carry1":1,"lhs0":65535,"lhs1":65535,"res0":0,"res1":0,"rhs0":1,"rhs1":0}}   # exit 0
$ echo '{"property":"add32","witness":{"lhs0":0,"lhs1":0,"rhs0":0,"rhs1":0,"res0":2013265921,"res1":0,"carry0":0,"carry1":0}}' | lean-scratch
{... "reasons":["res0 out of range [0, 2^16)"],"verdict":"reject"}   # exit 1: the field-wrap attack from §3.2
```

Full input battery (20 cases):

| Case | Result |
|---|---|
| honest witness (article example 3), calculator on u32, calculator on 2^100 (reduced mod 2^32, flagged in `note`) | accept, 0 |
| field-wrap attack (`res0 = p`), carry = 2, wrong sum | reject, 1, with reasons |
| negative, `1.5`, **`2.0`**, unknown witness field, missing field, trailing garbage, two concatenated documents, empty stdin, unsupported property, `witness` not an object | error, 2 |
| **`1e3`** | **accepted as 1000** (see G11) |
| **duplicate key** `{"lhs":1,"lhs":7}` | **last one wins silently** (see G12) |
| invalid UTF-8 | uncaught exception, **exit 1**, before the fix (G13). After the fix: error, 2 |

### 3.4 Build times, sizes, performance (M4 Pro)

| Measurement | Value |
|---|---|
| elan install | 1 s |
| toolchain download and install | 36 s; **2.7 GB** in `~/.elan` |
| clean build of everything (`rm -rf .lake; lake build LeanScratch lean-scratch bench`, 15 jobs) | **1.86 s** wall (1.88 s user) |
| per module | AddConstraint 0.31 s, FieldModel 0.25 s, Checker 0.30 s, Main 0.22 s, link 0.40 s |
| incremental rebuild after editing `Main.lean` | 0.9 s |
| `.lake` directory | 103 MB (almost all of it is the exe) |
| **`lean-scratch` exe** (`import Lean.Data.Json`) | **103,951,600 B (99 MB)**; stripped 75.6 MB; dynamic deps are only `libc++` and `libSystem` |
| `bench` exe (`Init` only, same checker) | **2,446,128 B (2.4 MB)** |
| size probe: an `Init`-only exe / `import Std.Data.HashMap` / `import Lean.Data.Json` | 2.4 MB / 3.0 MB / 99 MB |
| exe latency per invocation (spawn + parse + check + print, average of 200) | **17.0 ms** with `Lean.Json`, compared with **2.5 ms** for an `Init`-only exe |
| peak RSS, one invocation | 37.7 MB |
| in-process throughput, `checkAdd (mkWitness a b)` | **~52 ns per check** (1M and 10M iterations, all accepted) |
| `leanchecker LeanScratch.Checker` (module only) | 0.45 s |
| `leanchecker --fresh LeanScratch.Checker` (replays Init too) | **25.9 s** |
| axiom gate (`lake env lean gate/AxiomGate.lean`, 55 declarations) | 3.6 s |

**Perceus, observed** (size-probe project, `Array.set!` in a loop):

| n | unique owner (in-place reuse) | a snapshot kept every 64 steps (shared, so it copies) |
|---|---|---|
| 100,000 | 0 ms | 132 ms |
| 200,000 | 0 ms | 522 ms |
| 400,000 | 1 ms | 2,094 ms |

The unique version is linear and effectively free. With one extra live reference, every `set!` copies the array, and the cost grows quadratically. Nothing in the source warns you about it. This matters for FlowAId: a reducer over an append-only event log that also keeps snapshots will fall off the fast path.

## 4. Gotchas (all hit in this session)

| # | Gotcha | What to do |
|---|---|---|
| G1 | The elan installer **edits `~/.profile`, `~/.bash_profile` and `~/.zprofile`** (it appends `export PATH="$HOME/.elan/bin:$PATH"`), even with `-y`. Non-login shells (agents, CI) still need `source ~/.elan/env`. | Pass `--no-modify-path` for a hermetic install. Source `~/.elan/env` in every script. |
| G2 | With `--default-toolchain none`, a bare `lean --version` or `lake new` fails with "no default toolchain configured". | Use `lake +leanprover/lean4:v4.34.0 new …`. Inside the project, `lean-toolchain` then selects the version. |
| G3 | In zsh, an unquoted URL containing `?` fails with "no matches found" (it is treated as a glob). | Quote URLs. |
| G4 | `lake env lean File.lean` does **not** build imports. A fresh project gives "unknown module prefix". | Run `lake build <Lib>` first. |
| G5 | **`lake build` succeeds with `sorry`** (it only warns: "declaration uses `sorry`"). `#print axioms` shows `sorryAx`. A failed tactic also becomes `sorryAx` in the axioms output. | Use `--wfail`, or the axiom gate. Never trust a green `lake build` by itself. |
| G6 | `defaultTargets = ["<exe>"]` builds only the modules the exe imports. The library root `LeanScratch.olean` was never built, so the gate failed with "object file … does not exist". | Build `lake build LeanScratch` explicitly in CI, or add the lib to `defaultTargets`. |
| G7 | `--wfail` fails on **linter** warnings too. The article's verbatim theorem fails `--wfail` because of the unused `h_c*_bit` hypotheses. | Fix the hypotheses (§3.2) or rename them `_h…`. The linter was right. |
| G8 | `native_decide` in 4.34 creates the axiom `<decl>._native.native_decide.ax_1_1`. `#print axioms` shows it relative to the current namespace; `collectAxioms` gives the full name (`LeanScratch.ex1_native._native…`). | Gate by allowlist (`propext`, `Quot.sound`, `Classical.choice`), never by a blocklist of names. |
| G9 | **`leanchecker` passes modules that contain `native_decide` axioms** (exit 0, including `--fresh`). It re-checks proofs, but it accepts axioms as declared. | `leanchecker` and the axiom gate are separate, complementary checks. |
| G10 | `lake check` does not exist in 4.34 ("unknown command 'check'"). | Use the gate script (appendix) until 4.35. |
| G11 | `Json.getNat?` accepts `1e3` (= 1000) but rejects `2.0`. JSON has no integer type, so accepting some number spellings and not others is a parser-differential risk. | Pin one canonical number form at the FlowAId boundary (e.g. integers only, no exponent) and check it before handing off. |
| G12 | Duplicate keys: `Lean.Json.parse` silently keeps the **last** value. | Reject duplicate keys upstream, or with a custom parser, for anything security-relevant. |
| G13 | An uncaught `IO` exception (e.g. non-UTF-8 stdin in `readToEnd`) exits with code **1**, which collided with our "reject" code. | `try … catch` in `main`. Treat 1 as ambiguous unless `main` is total. |
| G14 | **`import Lean` (even just `Lean.Data.Json`) makes a 99 MB binary** and adds ~15 ms of startup. `Init` or `Std` alone gives 2.4 to 3 MB and 2.5 ms. | Keep the certified core `Init`-only. Do JSON in a thin shell, or in the host (TS) over FFI or a long-lived process. |
| G15 | In `Json.mkObj [...]` the list literal's element type comes from the first entry, so mixing `String` and `Nat`/`Json` values fails with "failed to synthesize HAppend … (String × String)". | Ascribe `: List (String × Json)`. |
| G16 | `let mut checked := 0` later used inside `m!"…"` was inferred as `MessageData` ("OfNat MessageData 0"). | Annotate numeric `let mut`s. |
| G17 | A pure `let r := f ()` between two `IO.monoNanosNow` calls was **moved out of the timed region** by the compiler (0 ms measured). | Use `let r ← IO.lazyPure f`. Loops that thread `mut` state through `IO` are safe. |
| G18 | After `simp only [Bool.and_eq_true]`, range conjuncts stay as `decide (x < 65536) = true`. `decide_eq_true_eq` in the same `simp only` was reported unused, and `omega` cannot see through `decide`. | `and_intros <;> first \| omega \| exact decide_eq_true (by omega)`. |
| G19 | The spec said `lhs + rhs` while the article's statement is `lhs0 + lhs1·B + rhs0 + rhs1·B`. They differ only by association, and `exact` rejects them. | `rwa [← Nat.add_assoc]`. Keep specs in the same shape as the theorem they will be matched against. |
| G20 | Generated C symbols are package-prefixed: `lp_lean_x2dscratch_LeanScratch_checkAdd` (the `-` becomes `x2d`). | Use `@[export flowaid_…]` for any function the FFI will call; don't depend on the mangled names. |
| G21 | `lake new` also creates `.github/workflows/lean_action_ci.yml` (leanprover/lean-action@v1) and a git repo. | Delete or adapt it when vendoring into the monorepo. |

## 5. What this means for FlowAId's self-critical evaluation layer

1. **The pattern works.** It is `Prop` spec → `Bool` checker → soundness theorem → erased certificate → C binary → JSON verdict. It is cheap: a 2 s build, ~52 ns per check, a 2.4 MB core. The same shape fits FlowAId decision receipts (e.g. `checkGate r = true → r.chosenProb ≥ r.threshold ∧ probabilities sum to 1e6 ppm`).
2. **Trust gate for CI, in order:** `lake build --wfail`, then the axiom allowlist gate (rejects `sorryAx` and `native_decide`), then `leanchecker` on changed modules (`--fresh` nightly: 26 s here, more with more code). None of the three is enough alone (G5, G9).
3. **Every proof review should include the self-critique checks from §3.2:** unused hypotheses (the linter), model fidelity (the Nat vs F_p gap), and a kernel-checked counterexample showing that each hypothesis is necessary. That is the "self-critical" part in practice.
4. **The trust boundary is the JSON edge, not the proof.** Most defects found in this session were in parsing and the process contract (G11–G13), not in the logic. The FlowAId verdict schema should pin canonical numbers, forbid duplicate keys, and define exit codes. The proof covers `checkAdd`, not `parseWitness`.
5. **Packaging:** `Init`-only certified core; JSON in a separate thin shell, or FFI from Node via `@[export]`. Budget 2.7 GB per pinned toolchain on CI runners.

## 6. Corrections to LEAN4_EXPERT_GUIDE.md (measured on 4.34.0)

- §0 banner: some snippets have now been compiled. The article's theorem and examples pass in core Lean 4.34.0 without Mathlib.
- §4.2: the `native_decide` axiom name on 4.34 is `…_native.native_decide.ax_1_1`, not `…ax_1`. The guide's advice to allowlist rather than hard-code names stands.
- §10 L3: the checker binary is **`leanchecker`**. It ships in the toolchain's `bin/` and elan installs a proxy for it. It does **not** flag `native_decide` axioms (G9).
- §9: confirmed that `lake check` is absent in 4.34.
- Claim table row about the article's theorem: add that the carry-bit hypotheses are unused over `Nat`, and that the field-faithful version needs range constraints (§3.2).

## Appendix: verified sources

The build was clean with `lake build LeanScratch lean-scratch bench` on Lean 4.34.0. Only the expected lint warnings appear, on the article's verbatim theorem.

### `lakefile.toml`

```toml
name = "lean-scratch"
version = "0.1.0"
defaultTargets = ["lean-scratch"]

[[lean_lib]]
name = "LeanScratch"

[[lean_exe]]
name = "lean-scratch"
root = "Main"

[[lean_exe]]
name = "bench"
root = "Bench"
```

### `LeanScratch.lean`

```lean
import LeanScratch.AddConstraint
import LeanScratch.FieldModel
import LeanScratch.Checker
```

### `LeanScratch/AddConstraint.lean`

```lean
/-!
# The article's `add_constraint_mod32`, ported to core Lean (no Mathlib)

Source: docs/research/lean4/lambdaclass-lean4-article.md, lines 46-69.
The only change from the article: the two Mathlib imports are dropped.
`omega` and `native_decide` are both in core Lean 4.
-/

namespace LeanScratch

def LIMB_BASE : Nat := 65536      -- 2^16
def MOD_32 : Nat := 4294967296    -- 2^32

/-- If the limb constraint equations hold and carries are bits,
    then res ≡ lhs + rhs (mod 2^32). (Verbatim from the article.) -/
theorem add_constraint_mod32
  (lhs0 lhs1 rhs0 rhs1 res0 res1 carry0 carry1 : Nat)
  (h_low : lhs0 + rhs0 = res0 + carry0 * LIMB_BASE)
  (h_high : lhs1 + rhs1 + carry0 = res1 + carry1 * LIMB_BASE)
  (h_c0_bit : carry0 ≤ 1)
  (h_c1_bit : carry1 ≤ 1)
  : (res0 + res1 * LIMB_BASE) % MOD_32 =
    (lhs0 + lhs1 * LIMB_BASE + rhs0 + rhs1 * LIMB_BASE) % MOD_32 := by
  unfold LIMB_BASE MOD_32
  unfold LIMB_BASE at h_low h_high
  omega

-- The article's three concrete checks, verbatim.
example : (300 + 0 * 65536) % 4294967296 =
          (100 + 0 * 65536 + 200 + 0 * 65536) % 4294967296 := by native_decide
example : (0 + 1 * 65536) % 4294967296 =
          (65535 + 0 * 65536 + 1 + 0 * 65536) % 4294967296 := by native_decide
example : (0 + 0 * 65536) % 4294967296 =
          (65535 + 65535 * 65536 + 1 + 0 * 65536) % 4294967296 := by native_decide

-- `example`s are anonymous, so `#print axioms` needs names. Same statements, named:
theorem ex1_native : (300 + 0 * 65536) % 4294967296 =
          (100 + 0 * 65536 + 200 + 0 * 65536) % 4294967296 := by native_decide
theorem ex2_native : (0 + 1 * 65536) % 4294967296 =
          (65535 + 0 * 65536 + 1 + 0 * 65536) % 4294967296 := by native_decide
theorem ex3_native : (0 + 0 * 65536) % 4294967296 =
          (65535 + 65535 * 65536 + 1 + 0 * 65536) % 4294967296 := by native_decide

-- Kernel-checked alternatives: no compiler in the trusted base.
theorem ex1_decide : (300 + 0 * 65536) % 4294967296 =
          (100 + 0 * 65536 + 200 + 0 * 65536) % 4294967296 := by decide
theorem ex2_decide : (0 + 1 * 65536) % 4294967296 =
          (65535 + 0 * 65536 + 1 + 0 * 65536) % 4294967296 := by decide
theorem ex3_decide : (0 + 0 * 65536) % 4294967296 =
          (65535 + 65535 * 65536 + 1 + 0 * 65536) % 4294967296 := by decide
theorem ex3_rfl : (0 + 0 * 65536) % 4294967296 =
          (65535 + 65535 * 65536 + 1 + 0 * 65536) % 4294967296 := rfl
theorem ex3_omega : (0 + 0 * 65536) % 4294967296 =
          (65535 + 65535 * 65536 + 1 + 0 * 65536) % 4294967296 := by omega

-- The instances are corollaries of the general theorem (carry0 = 1, carry1 = 1):
theorem ex3_from_theorem : (0 + 0 * LIMB_BASE) % MOD_32 =
          (65535 + 65535 * LIMB_BASE + 1 + 0 * LIMB_BASE) % MOD_32 :=
  add_constraint_mod32 65535 65535 1 0 0 0 1 1 (by decide) (by decide) (by decide) (by decide)

#print axioms add_constraint_mod32
#print axioms ex1_native
#print axioms ex2_native
#print axioms ex3_native
#print axioms ex1_decide
#print axioms ex2_decide
#print axioms ex3_decide
#print axioms ex3_rfl
#print axioms ex3_omega
#print axioms ex3_from_theorem

end LeanScratch
```

### `LeanScratch/FieldModel.lean`

```lean
import LeanScratch.AddConstraint
/-!
# Self-critique of the article's theorem

1. Over `Nat`, the carry-bit hypotheses are unused (the linter says so). The conclusion
   holds for ANY carries: `carry0` cancels and `carry1 * 2^32 ≡ 0 (mod 2^32)`.
2. A real STARK constraint holds in the field F_p (BabyBear, p = 2^31 - 2^27 + 1), i.e. modulo p,
   not over `Nat`. There, the bit and range constraints are what make the theorem true.
-/

namespace LeanScratch

/-- Strictly stronger than the article: no carry-bit hypotheses at all. -/
theorem add_constraint_mod32_no_bits
  (lhs0 lhs1 rhs0 rhs1 res0 res1 carry0 carry1 : Nat)
  (h_low : lhs0 + rhs0 = res0 + carry0 * LIMB_BASE)
  (h_high : lhs1 + rhs1 + carry0 = res1 + carry1 * LIMB_BASE)
  : (res0 + res1 * LIMB_BASE) % MOD_32 =
    (lhs0 + lhs1 * LIMB_BASE + rhs0 + rhs1 * LIMB_BASE) % MOD_32 := by
  unfold LIMB_BASE MOD_32 at *
  omega

def BABYBEAR : Nat := 2013265921   -- 2^31 - 2^27 + 1

/-- Field-faithful version: constraints hold only modulo p. Needs range + bit constraints. -/
theorem add_constraint_mod32_field
  (lhs0 lhs1 rhs0 rhs1 res0 res1 carry0 carry1 : Nat)
  (r_l0 : lhs0 < LIMB_BASE) (r_l1 : lhs1 < LIMB_BASE)
  (r_r0 : rhs0 < LIMB_BASE) (r_r1 : rhs1 < LIMB_BASE)
  (r_s0 : res0 < LIMB_BASE) (r_s1 : res1 < LIMB_BASE)
  (h_low : (lhs0 + rhs0) % BABYBEAR = (res0 + carry0 * LIMB_BASE) % BABYBEAR)
  (h_high : (lhs1 + rhs1 + carry0) % BABYBEAR = (res1 + carry1 * LIMB_BASE) % BABYBEAR)
  (h_c0_bit : carry0 ≤ 1)
  (h_c1_bit : carry1 ≤ 1)
  : (res0 + res1 * LIMB_BASE) % MOD_32 =
    (lhs0 + lhs1 * LIMB_BASE + rhs0 + rhs1 * LIMB_BASE) % MOD_32 := by
  -- `omega` alone fails here (Lean's omega omits dark/grey shadows, so it is incomplete).
  -- Lift each mod-p equation to a Nat equation: both sides are < 2^17 + 2^16 < p.
  unfold LIMB_BASE BABYBEAR at *
  rw [Nat.mod_eq_of_lt (by omega), Nat.mod_eq_of_lt (by omega)] at h_low h_high
  exact add_constraint_mod32_no_bits _ _ _ _ _ _ _ _ h_low h_high

/-- Counterexample: without range constraints, the field version is FALSE.
    res0 = p (≡ 0 in F_p) satisfies the low constraint for 0 + 0, but res ≠ 0 mod 2^32. -/
theorem field_needs_range :
    ¬ ∀ (lhs0 lhs1 rhs0 rhs1 res0 res1 carry0 carry1 : Nat),
      (lhs0 + rhs0) % BABYBEAR = (res0 + carry0 * LIMB_BASE) % BABYBEAR →
      (lhs1 + rhs1 + carry0) % BABYBEAR = (res1 + carry1 * LIMB_BASE) % BABYBEAR →
      carry0 ≤ 1 → carry1 ≤ 1 →
      (res0 + res1 * LIMB_BASE) % MOD_32 =
        (lhs0 + lhs1 * LIMB_BASE + rhs0 + rhs1 * LIMB_BASE) % MOD_32 := by
  intro h
  have := h 0 0 0 0 BABYBEAR 0 0 0 (by decide) (by decide) (by decide) (by decide)
  revert this; decide

#print axioms add_constraint_mod32_no_bits
#print axioms add_constraint_mod32_field
#print axioms field_needs_range

end LeanScratch
```

### `LeanScratch/Checker.lean`

```lean
import LeanScratch.FieldModel
/-!
# A certified checker: the "armored library" core

Pure code, `Init` only. The runtime check (`checkAdd`, returns `Bool`) is linked to the spec
(`AddSpec`, a `Prop`) by a soundness theorem, so a `true` verdict implies the spec for ALL inputs.
`certify` packs the proof into a subtype; the proof is erased by the compiler (Data vs Prop).
-/

namespace LeanScratch

structure AddWitness where
  lhs0 : Nat
  lhs1 : Nat
  rhs0 : Nat
  rhs1 : Nat
  res0 : Nat
  res1 : Nat
  carry0 : Nat
  carry1 : Nat
  deriving Repr, DecidableEq

def AddWitness.lhs (w : AddWitness) : Nat := w.lhs0 + w.lhs1 * LIMB_BASE
def AddWitness.rhs (w : AddWitness) : Nat := w.rhs0 + w.rhs1 * LIMB_BASE
def AddWitness.res (w : AddWitness) : Nat := w.res0 + w.res1 * LIMB_BASE

/-- The specification (a proposition, erased at runtime). -/
def AddSpec (w : AddWitness) : Prop := w.res % MOD_32 = (w.lhs + w.rhs) % MOD_32

/-- The field-faithful constraint system, as a runtime `Bool` check. -/
def checkAdd (w : AddWitness) : Bool :=
  w.lhs0 < LIMB_BASE && w.lhs1 < LIMB_BASE && w.rhs0 < LIMB_BASE && w.rhs1 < LIMB_BASE &&
  w.res0 < LIMB_BASE && w.res1 < LIMB_BASE && w.carry0 ≤ 1 && w.carry1 ≤ 1 &&
  (w.lhs0 + w.rhs0) % BABYBEAR == (w.res0 + w.carry0 * LIMB_BASE) % BABYBEAR &&
  (w.lhs1 + w.rhs1 + w.carry0) % BABYBEAR == (w.res1 + w.carry1 * LIMB_BASE) % BABYBEAR

/-- Soundness, for every input: an accepted witness satisfies the spec. -/
theorem checkAdd_sound (w : AddWitness) (h : checkAdd w = true) : AddSpec w := by
  simp only [checkAdd, Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq] at h
  obtain ⟨⟨⟨⟨⟨⟨⟨⟨⟨hl0, hl1⟩, hr0⟩, hr1⟩, hs0⟩, hs1⟩, hc0⟩, hc1⟩, hlow⟩, hhigh⟩ := h
  have spec := add_constraint_mod32_field _ _ _ _ _ _ _ _ hl0 hl1 hr0 hr1 hs0 hs1 hlow hhigh hc0 hc1
  -- The article states the sum as `lhs0 + lhs1*B + rhs0 + rhs1*B`; the spec says `lhs + rhs`.
  unfold AddSpec AddWitness.res AddWitness.lhs AddWitness.rhs
  rwa [← Nat.add_assoc]

/-- Witness calculator: the honest limb decomposition of `a + b`. -/
def mkWitness (a b : Nat) : AddWitness :=
  let l0 := a % LIMB_BASE; let l1 := a / LIMB_BASE % LIMB_BASE
  let r0 := b % LIMB_BASE; let r1 := b / LIMB_BASE % LIMB_BASE
  let s0 := l0 + r0
  let s1 := l1 + r1 + s0 / LIMB_BASE
  { lhs0 := l0, lhs1 := l1, rhs0 := r0, rhs1 := r1,
    res0 := s0 % LIMB_BASE, res1 := s1 % LIMB_BASE,
    carry0 := s0 / LIMB_BASE, carry1 := s1 / LIMB_BASE }

/-- Completeness of the calculator, for every input: honest witnesses are always accepted,
    and they decompose the inputs faithfully. (∀ a b, ∃ w, checkAdd w ∧ ... made concrete.) -/
theorem mkWitness_complete (a b : Nat) :
    checkAdd (mkWitness a b) = true ∧
    (mkWitness a b).lhs = a % MOD_32 ∧ (mkWitness a b).rhs = b % MOD_32 := by
  simp only [checkAdd, mkWitness, AddWitness.lhs, AddWitness.rhs,
    Bool.and_eq_true, beq_iff_eq]
  unfold LIMB_BASE MOD_32 BABYBEAR
  -- Range goals arrive as `decide (x < 65536) = true`; `simp only [decide_eq_true_eq]` does not fire
  -- on them after `Bool.and_eq_true`, so discharge via `decide_eq_true`.
  and_intros <;> first | omega | exact decide_eq_true (by omega)

/-- Certified API: the proof rides along in the type and is erased from the binary. -/
def certify (w : AddWitness) : Option { v : AddWitness // AddSpec v } :=
  if h : checkAdd w = true then some ⟨w, checkAdd_sound w h⟩ else none

/-- Which constraint failed, for a human-readable verdict (not part of the trusted claim). -/
def explain (w : AddWitness) : List String :=
  (if w.lhs0 < LIMB_BASE then [] else ["lhs0 out of range [0, 2^16)"]) ++
  (if w.lhs1 < LIMB_BASE then [] else ["lhs1 out of range [0, 2^16)"]) ++
  (if w.rhs0 < LIMB_BASE then [] else ["rhs0 out of range [0, 2^16)"]) ++
  (if w.rhs1 < LIMB_BASE then [] else ["rhs1 out of range [0, 2^16)"]) ++
  (if w.res0 < LIMB_BASE then [] else ["res0 out of range [0, 2^16)"]) ++
  (if w.res1 < LIMB_BASE then [] else ["res1 out of range [0, 2^16)"]) ++
  (if w.carry0 ≤ 1 then [] else ["carry0 is not a bit"]) ++
  (if w.carry1 ≤ 1 then [] else ["carry1 is not a bit"]) ++
  (if (w.lhs0 + w.rhs0) % BABYBEAR == (w.res0 + w.carry0 * LIMB_BASE) % BABYBEAR then []
   else ["low-limb constraint fails mod p"]) ++
  (if (w.lhs1 + w.rhs1 + w.carry0) % BABYBEAR == (w.res1 + w.carry1 * LIMB_BASE) % BABYBEAR then []
   else ["high-limb constraint fails mod p"])

#print axioms checkAdd_sound
#print axioms mkWitness_complete
#print axioms certify

end LeanScratch
```

### `Main.lean`

```lean
import Lean.Data.Json
import LeanScratch.Checker
/-!
# `lean-scratch`: stdin JSON → certified verdict JSON

Input (one JSON object on stdin), either
  {"property":"add32","witness":{"lhs0":..,"lhs1":..,"rhs0":..,"rhs1":..,"res0":..,"res1":..,"carry0":..,"carry1":..}}
    → check a prover-supplied witness (checker mode, backed by `checkAdd_sound`)
  {"property":"add32","lhs":a,"rhs":b}
    → compute the witness and result (witness-calculator mode, backed by `mkWitness_complete`)
Exit code: 0 accept, 1 reject, 2 malformed input.
-/
open Lean LeanScratch

def witnessFields : List String :=
  ["lhs0", "lhs1", "rhs0", "rhs1", "res0", "res1", "carry0", "carry1"]

def parseWitness (j : Json) : Except String AddWitness := do
  let obj ← j.getObj?
  for (k, _) in obj.toArray do
    unless witnessFields.contains k do throw s!"unknown witness field: {k}"
  let f (k : String) : Except String Nat := do
    let v ← j.getObjVal? k
    v.getNat? |>.mapError (fun e => s!"{k}: {e}")
  return { lhs0 := ← f "lhs0", lhs1 := ← f "lhs1", rhs0 := ← f "rhs0", rhs1 := ← f "rhs1",
           res0 := ← f "res0", res1 := ← f "res1", carry0 := ← f "carry0", carry1 := ← f "carry1" }

def witnessJson (w : AddWitness) : Json :=
  Json.mkObj [("lhs0", w.lhs0), ("lhs1", w.lhs1), ("rhs0", w.rhs0), ("rhs1", w.rhs1),
              ("res0", w.res0), ("res1", w.res1), ("carry0", w.carry0), ("carry1", w.carry1)]

def base (verdict : String) : List (String × Json) :=
  [("verdict", verdict), ("property", "add32: res ≡ lhs + rhs (mod 2^32)"),
   ("lean", Lean.versionString)]

/-- Returns (exit code, verdict JSON). -/
def run (input : String) : UInt32 × Json :=
  match go with
  | .ok r => r
  | .error e => (2, Json.mkObj (base "error" ++ ([("error", e)] : List (String × Json))))
where
  go : Except String (UInt32 × Json) := do
    let j ← Json.parse input
    let prop ← (j.getObjVal? "property" >>= Json.getStr?)
    unless prop == "add32" do throw s!"unsupported property: {prop}"
    match j.getObjVal? "witness" with
    | .ok wj =>
      let w ← parseWitness wj
      match certify w with
      | some ⟨v, _proof⟩ =>   -- `_proof : AddSpec v` exists at compile time only
        return (0, Json.mkObj (base "accept" ++
          ([("mode", "check"), ("certifiedBy", "LeanScratch.checkAdd_sound"),
           ("res", v.res % MOD_32), ("lhsPlusRhs", (v.lhs + v.rhs) % MOD_32)] : List (String × Json))))
      | none =>
        return (1, Json.mkObj (base "reject" ++
          ([("mode", "check"), ("reasons", toJson (explain w))] : List (String × Json))))
    | .error _ =>
      let a ← (j.getObjVal? "lhs" >>= Json.getNat?)
      let b ← (j.getObjVal? "rhs" >>= Json.getNat?)
      let w := mkWitness a b
      -- By `mkWitness_complete`, `checkAdd w = true` for every a, b; we still run it (defense in depth).
      match certify w with
      | some ⟨v, _⟩ =>
        return (0, Json.mkObj (base "accept" ++
          ([("mode", "calculate"), ("certifiedBy", "LeanScratch.mkWitness_complete + checkAdd_sound"),
           ("witness", witnessJson v), ("res", v.res),
           ("note", if a < MOD_32 && b < MOD_32 then "inputs are u32" else "inputs reduced mod 2^32")] : List (String × Json))))
      | none => throw "internal: calculator witness rejected (contradicts mkWitness_complete)"

def main : IO UInt32 := do
  -- An uncaught IO exception exits with code 1, which would collide with "reject".
  -- Catch it (e.g. non-UTF-8 stdin) and report it as malformed input (exit 2).
  let input ← try (← IO.getStdin).readToEnd catch e =>
    IO.println (Json.mkObj (base "error" ++ ([("error", toString e)] : List (String × Json)))).compress
    return 2
  let (code, out) := run input
  IO.println out.compress
  return code
```

### `Bench.lean`

```lean
import LeanScratch.Checker
open LeanScratch
/-- Init-only exe: no `Lean` import, so the binary stays small. Arg: iteration count. -/
def main (args : List String) : IO UInt32 := do
  let n := (args.head? >>= String.toNat?).getD 1000000
  let t0 ← IO.monoNanosNow
  let mut ok := 0
  for i in [0:n] do
    let a := (i * 2654435761) % 4294967296
    let b := (i * 40503 + 12345) % 4294967296
    if checkAdd (mkWitness a b) then ok := ok + 1
  let t1 ← IO.monoNanosNow
  IO.println s!"\{\"iterations\":{n},\"accepted\":{ok},\"ns_per_check\":{(t1 - t0) / n}}"
  return 0
```

### `gate/AxiomGate.lean`

```lean
import Lean
import LeanScratch
/-!
Axiom gate: every declaration from a `LeanScratch.*` module may depend only on the
standard axioms. `native_decide` axioms (`*._native.native_decide.*`) and `sorryAx` fail it.
Run: `lake env lean gate/AxiomGate.lean` (exit code 1 on failure).
-/
open Lean Elab Command

def allowedAxioms : List Name := [``propext, ``Quot.sound, ``Classical.choice]

elab "#axiom_gate " allow:ident* : command => do
  let env ← getEnv
  let extra := allow.toList.map (·.getId)
  let mut bad : Array String := #[]
  let mut checked : Nat := 0
  for (n, _) in env.constants.toList do
    let some idx := env.getModuleIdxFor? n | continue
    let mod := env.header.moduleNames[idx.toNat]!
    unless (`LeanScratch).isPrefixOf mod do continue
    if n.isInternal then continue
    checked := checked + 1
    let axs ← liftCoreM <| collectAxioms n
    let offending := axs.filter (fun a => !(allowedAxioms.contains a))
    if !offending.isEmpty && !(extra.contains n) then
      bad := bad.push s!"{n}: {offending.toList}"
  logInfo m!"axiom gate checked {checked} declarations"
  unless bad.isEmpty do
    logError m!"axiom gate FAILED:\n{"\n".intercalate bad.toList}"

-- Strict run: fails on the three `ex*_native` theorems.
#axiom_gate
```
