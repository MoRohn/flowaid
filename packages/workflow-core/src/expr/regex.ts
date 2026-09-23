/**
 * FlowExpr regular expressions (ARCHITECTURE.md §2.3).
 *
 * The pattern operand of `matches`, `regex_test` and `regex_match` (and the
 * flags argument, when present) must be a string literal, so every pattern a
 * workflow can run is known at compile time. Each literal is vetted with
 * `recheck`, which decides in linear time whether the pattern can backtrack in
 * super-linear time; a vulnerable, unsupported or undecided pattern is
 * rejected (`E_EXPR_REGEX_UNSAFE` at compile time, `INVALID_REGEX` at
 * runtime), an unparseable one likewise (`E_EXPR_TYPE` / `INVALID_REGEX`).
 * Patterns are capped at {@link MAX_REGEX_PATTERN_LENGTH} characters and
 * subjects at {@link MAX_REGEX_SUBJECT_LENGTH} (`INVALID_ARGUMENT`), verdicts
 * are memoised in a {@link REGEX_CACHE_SIZE}-entry LRU, and compiled regexes
 * come from a replaceable {@link RegexEngine} so a worker can substitute `re2`.
 *
 * `recheck`'s pure-JS (Scala.js) build is imported directly rather than the
 * package's Node entry: the Node entry runs the check in a `synckit` worker
 * thread that prefers a platform-specific native binary, while the pure build
 * is one synchronous function with the same verdicts on every platform and in
 * the browser bundle (`scripts/check-browser-bundle.test.ts`).
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- recheck ships no types for its pure build; the reference travels with this module into every program that imports it.
/// <reference path="./recheck-browser.d.ts" />
import recheck from "recheck/lib/browser.js";
import type { ExprAst } from "../bindings.js";

/** Longest regex pattern (in UTF-16 code units) an expression may use. */
export const MAX_REGEX_PATTERN_LENGTH = 1024;
/** Longest string (in UTF-16 code units) a regex may be matched against. */
export const MAX_REGEX_SUBJECT_LENGTH = 65_536;
/** Number of vetted patterns and compiled regexes remembered per cache. */
export const REGEX_CACHE_SIZE = 256;
/** The regex flags FlowExpr accepts. */
export const REGEX_FLAGS = "imsu";
/** Milliseconds `recheck` may spend on one pattern before the verdict is "not proven safe". */
export const REGEX_CHECK_TIMEOUT_MS = 5000;

const REGEX_FLAGS_RE = /^[imsu]*$/;

/** A small least-recently-used cache: `get` refreshes, `set` evicts the oldest entry past `capacity`. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}

/** Why a pattern was rejected: bad `flags`, over-`length`, invalid `syntax`, or `unsafe` (super-linear or unprovable). */
export type RegexProblem = "flags" | "length" | "syntax" | "unsafe";

/** Verdict of {@link checkRegexLiteral}. */
export type RegexCheck = { ok: true } | { ok: false; problem: RegexProblem; message: string };

/** The compiled form a {@link RegexEngine} produces: `RegExp`'s `test`/`exec` subset. */
export interface CompiledRegex {
  test(subject: string): boolean;
  exec(subject: string): ReadonlyArray<string | undefined> | null;
}

/** Compiles vetted patterns. The default engine is the platform `RegExp`; a worker may install `re2`. */
export interface RegexEngine {
  compile(source: string, flags: string): CompiledRegex;
}

/** The platform `RegExp` engine. */
export const NATIVE_REGEX_ENGINE: RegexEngine = {
  compile(source: string, flags: string): CompiledRegex {
    return new RegExp(source, flags);
  },
};

let defaultEngine: RegexEngine = NATIVE_REGEX_ENGINE;

/**
 * Installs the engine every later evaluation compiles regexes with (`undefined`
 * restores the platform `RegExp`). The worker calls this once at start-up with
 * `re2` when that package is installed; patterns are still vetted first, so a
 * pattern the engine cannot compile is reported as `INVALID_REGEX`.
 */
export function setDefaultRegexEngine(engine: RegexEngine | undefined): void {
  defaultEngine = engine ?? NATIVE_REGEX_ENGINE;
}

/** The engine {@link setDefaultRegexEngine} installed, or the platform `RegExp`. */
export function getDefaultRegexEngine(): RegexEngine {
  return defaultEngine;
}

/** The value of `ast` when it is a string literal, else `undefined`. */
export function literalString(ast: ExprAst): string | undefined {
  return ast.kind === "literal" && typeof ast.value === "string" ? ast.value : undefined;
}

/** Validates a flags string: a subset of {@link REGEX_FLAGS} with no repeats. */
export function checkRegexFlags(flags: string): RegexCheck {
  if (!REGEX_FLAGS_RE.test(flags) || new Set(flags).size !== flags.length) {
    return {
      ok: false,
      problem: "flags",
      message: `invalid regex flags ${JSON.stringify(flags)} (allowed: ${REGEX_FLAGS.split("").join(", ")})`,
    };
  }
  return { ok: true };
}

const verdicts = new LruCache<string, RegexCheck>(REGEX_CACHE_SIZE);

function cacheKey(source: string, flags: string): string {
  return `${flags}\0${source}`;
}

/**
 * Vets one pattern: flags, length, syntax (the platform `RegExp` must accept
 * it) and, through `recheck`'s automaton checker, worst-case matching time.
 * Only a `safe` verdict passes; `vulnerable`, `unsupported`, `timeout` and
 * every other outcome is reported as `unsafe` so a pattern is never run on
 * trust. Verdicts are memoised, so vetting the same literal again is a map
 * lookup.
 */
export function checkRegexLiteral(source: string, flags: string): RegexCheck {
  const flagsCheck = checkRegexFlags(flags);
  if (!flagsCheck.ok) return flagsCheck;
  if (source.length > MAX_REGEX_PATTERN_LENGTH) {
    return {
      ok: false,
      problem: "length",
      message: `regex pattern is ${source.length} characters long (limit ${MAX_REGEX_PATTERN_LENGTH})`,
    };
  }
  const key = cacheKey(source, flags);
  const known = verdicts.get(key);
  if (known !== undefined) return known;
  const verdict = vet(source, flags);
  verdicts.set(key, verdict);
  return verdict;
}

function vet(source: string, flags: string): RegexCheck {
  try {
    new RegExp(source, flags);
  } catch (error) {
    return {
      ok: false,
      problem: "syntax",
      message: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const diagnostics = recheck.checkSync(source, flags, {
    checker: "automaton",
    timeout: REGEX_CHECK_TIMEOUT_MS,
  });
  switch (diagnostics.status) {
    case "safe":
      return { ok: true };
    case "vulnerable": {
      const attack = diagnostics.attack.pumps
        .map((pump) => `${JSON.stringify(pump.prefix)} then ${JSON.stringify(pump.pump)} repeated`)
        .join(", ");
      return {
        ok: false,
        problem: "unsafe",
        message: `regex pattern ${JSON.stringify(source)} can take ${diagnostics.complexity.summary} time to match (an input like ${attack} backtracks); anchor the pattern (^…$) or make adjacent repetitions unambiguous`,
      };
    }
    case "unknown": {
      const why =
        diagnostics.error.kind === "timeout" || diagnostics.error.kind === "cancel"
          ? diagnostics.error.kind
          : `${diagnostics.error.kind}: ${diagnostics.error.message}`;
      return {
        ok: false,
        problem: "unsafe",
        message: `regex pattern ${JSON.stringify(source)} could not be proven to match in linear time (${why})`,
      };
    }
  }
}
