# Lean 4 for verified systems (LambdaClass article excerpt, provided by the product owner)

So adopting Lean introduces a layered development architecture distinguishing compilation and execution errors starkly and provides an improved workflow. Lean's role is to guarantee that the specification is correct and consistent before writing a single line of low-level code.

## Certified Code Extraction

Lean 4 is not just a verifier; it is an efficient programming language capable of compiling to C. This enables something called Certified Code Extraction: the process by which Lean takes your mathematical definitions (functions, structures) and compiles them into efficient C code, eliminating all the "logical overhead" (the proofs) that is not necessary for execution.

Since writing the specification in Lean and then rewriting it by hand in C introduces the risk of human error, you can write critical functions (like Merkle Path verification or polynomial evaluation) in Lean, formally prove their correctness, and then ask Lean to automatically generate the corresponding code. As a result, you obtain a binary that runs with the speed of C, but with the mathematical guarantee that it is a faithful representation of the logic verified in Lean. This feature is arguably what turns Lean 4 into a "game changer" for the industry, separating it from academic predecessors like Coq or Isabelle.

In order to understand how this works, we look at a fundamental distinction Lean makes when compiling: Data (Type): numbers, lists, vectors, matrices, etc. are necessary to run the program, while Proofs (Prop): theorems, lemmas, type guarantees (e.g., i < n), etc. are only necessary to convince the compiler, but they are useless at runtime.

But what sense do we make out of a "compiled mathematical proof"? Below is a brief list of the practical utility of the binary resulting from code extraction, separated by two viewpoints.

From the perspective of a software developer, the resulting binary (say, `libfri_verifier.so` or `fri_verifier.exe`) is a production artifact. This is useful for:

1. Deployment: this binary is what you upload to the server, the blockchain node, or the IoT device. You may replace your old `verifier.rs` library (hand-written and potentially buggy) with this binary. The advantage is that now you possess an executable that runs at native speed (C/C++) but will never suffer from a buffer overflow or accept a false proof.
2. Integration: the extracted Lean code usually exposes a C API; you use FFI (Foreign Function Interface) to call functions within the Lean binary. As an example: "My web server (Rust) handles JSON and networking, but when the critical moment arrives to verify the cryptographic proof, it passes the bytes to the Lean binary." You delegate critical security to the verified component. If you wrote it in a higher-level language you would pay a price in speed; if you wrote it in C, you would pay a price in security risk. You use the Lean binary when you need the raw speed of the metal (C) but cannot afford a single memory or logical error.

The binary is then interpreted as an Armored Static/Dynamic Library. It serves to execute critical business logic in production without fear of it crashing or being exploited.

From the perspective of a mathematician, the binary produced is a "Witness Calculator": the computational realization of an existence theorem. The uses of this binary are typically:

1. To "materialize" existence: you proved the theorem ∀ x, ∃ y, P(x, y) ("for every input x, there exists a solution y"). While the theorem is abstract, the binary is concrete. Feed the binary x = 2^64 + 13; it executes the algorithm implicit in your proof and outputs y. You have converted an abstract truth into concrete data.
2. For certified computation: sometimes you want to calculate something difficult (e.g., the n-th prime, or a ZK execution trace). The binary works as a "Black Box of Truth": if you used a Python script and got a result, you might doubt whether you implemented the algorithm correctly. With the Lean binary, you have the mathematical guarantee that the number on the screen is correct according to the axiomatic definition.

From a mathematical perspective, the binary is an Executable Instance of your proof. It is the same file, but one views it as a confirmation of theory and the other as a production tool.

## Performance

Lean 4 uses a reference counting strategy called Perceus with aggressive reuse and uniqueness optimizations. When the compiler detects that a data structure is uniquely owned (reference count of 1) and you are about to create a similar structure, Lean can reuse the memory in place rather than allocating new memory and copying. This makes purely functional code competitive with imperative implementations in many cases.

## Practical example: verifying addition constraints

In STARKs and other proof systems, we often need to verify that arithmetic operations on 32-bit integers are correct. Working over field elements (e.g. BabyBear, p = 2^31 − 2^27 + 1), 32-bit integers are decomposed into 16-bit limbs with carry bits:

- lhs = lhs0 + lhs1·2^16, rhs = rhs0 + rhs1·2^16, res = res0 + res1·2^16
- Constraints: lhs0 + rhs0 = res0 + carry0·2^16; lhs1 + rhs1 + carry0 = res1 + carry1·2^16; carry0, carry1 ∈ {0,1}.
- Theorem: if the constraints hold and the carries are bits, then res ≡ lhs + rhs (mod 2^32).
- Caveat: this proves the algebraic identity given the constraint equations; real circuits also need range constraints (limbs in [0, 2^16)), typically enforced by lookup arguments.

```lean
import Mathlib.Data.ZMod.Basic
import Mathlib.Tactic

def LIMB_BASE : Nat := 65536      -- 2^16
def MOD_32 : Nat := 4294967296    -- 2^32

/-- If the limb constraint equations hold and carries are bits,
    then res ≡ lhs + rhs (mod 2^32). -/
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

example : (300 + 0 * 65536) % 4294967296 =
          (100 + 0 * 65536 + 200 + 0 * 65536) % 4294967296 := by native_decide
example : (0 + 1 * 65536) % 4294967296 =
          (65535 + 0 * 65536 + 1 + 0 * 65536) % 4294967296 := by native_decide
example : (0 + 0 * 65536) % 4294967296 =
          (65535 + 65535 * 65536 + 1 + 0 * 65536) % 4294967296 := by native_decide
```

Proof sketch: unfold the constants; combine the high-limb equation (×2^16) with the low-limb one to get res + carry1·2^32 = lhs + rhs; since carry1·2^32 ≡ 0 (mod 2^32), res ≡ lhs + rhs. `omega` discharges the linear arithmetic.

## Conclusion

- Curry-Howard: proofs and programs are the same thing; types are propositions, terms are proofs.
- Type safety as logic safety: if the code compiles, the proof is valid.
- Certified code extraction: Lean 4 compiles to efficient C, so formally verified software can be deployed in production.
- Practical ZK verification: machine-checked assurance for all inputs, not just test cases.

## Getting started

1. Install elan: `curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh`
2. VS Code with the lean4 extension.
3. `lake new my_project math`, then `lake update && lake build`.
4. Write proofs in `.lean` files; `lake build` verifies everything compiles.

Resources: Lean 4 Manual, Mathematics in Lean, Mathlib documentation, Functional Programming in Lean, Theorem Proving in Lean 4 (URLs in `SOURCES.md`).
