/**
 * FlowExpr built-in function names and signatures (ARCHITECTURE.md §2.3). The
 * set is closed: the parser only accepts calls to these names, and every name
 * is reserved as a node id (`RESERVED_IDS`). Implementations live in the
 * evaluator, their static types in the typer.
 */

/** Names of the FlowExpr built-in functions, in specification order. */
export const EXPRESSION_FUNCTION_NAMES = [
  "len",
  "lower",
  "upper",
  "trim",
  "contains",
  "starts_with",
  "ends_with",
  "split",
  "join",
  "json",
  "parse_json",
  "keys",
  "values",
  "has",
  "get",
  "coalesce",
  "min",
  "max",
  "abs",
  "round",
  "floor",
  "ceil",
  "sum",
  "avg",
  "first",
  "last",
  "concat",
  "filter",
  "map",
  "any",
  "all",
  "sort",
  "to_number",
  "to_string",
  "regex_test",
  "regex_match",
  "now",
  "format_date",
] as const;
/** A FlowExpr built-in function name. */
export type ExpressionFunctionName = (typeof EXPRESSION_FUNCTION_NAMES)[number];

/** FlowExpr keywords (literals and word operators). */
export const EXPRESSION_KEYWORDS = ["true", "false", "null", "in", "matches"] as const;
/** A FlowExpr keyword. */
export type ExpressionKeyword = (typeof EXPRESSION_KEYWORDS)[number];

/** Functions whose last argument is a lambda (`x => …`). */
export const LAMBDA_FUNCTIONS: ReadonlySet<ExpressionFunctionName> =
  new Set<ExpressionFunctionName>(["filter", "map", "any", "all", "sort"]);

/**
 * Functions whose second argument is a regular-expression pattern (the third,
 * when present, its flags). Like the right operand of `matches`, the pattern
 * and the flags must be string literals so the compiler can vet them
 * (`E_EXPR_REGEX_DYNAMIC` otherwise; `INVALID_ARGUMENT` at runtime).
 */
export const REGEX_FUNCTIONS: ReadonlySet<ExpressionFunctionName> = new Set<ExpressionFunctionName>(
  ["regex_test", "regex_match"],
);

const FUNCTION_NAME_SET: ReadonlySet<string> = new Set<string>(EXPRESSION_FUNCTION_NAMES);
const KEYWORD_SET: ReadonlySet<string> = new Set<string>(EXPRESSION_KEYWORDS);

/** True when `name` is a FlowExpr built-in function. */
export function isExpressionFunction(name: string): name is ExpressionFunctionName {
  return FUNCTION_NAME_SET.has(name);
}

/** True when `name` is a FlowExpr keyword. */
export function isExpressionKeyword(name: string): name is ExpressionKeyword {
  return KEYWORD_SET.has(name);
}

/** Static arity of a built-in function. */
export interface FunctionSignature {
  /** Minimum number of arguments. */
  readonly minArgs: number;
  /** Maximum number of arguments (`Number.POSITIVE_INFINITY` for variadic functions). */
  readonly maxArgs: number;
  /**
   * Index of the argument that must be a lambda (`x => …`) when present.
   * Lambdas are accepted nowhere else. Only `sort` may omit its lambda.
   */
  readonly lambdaArg?: number;
}

/** Arity and lambda position of every built-in, keyed by name. */
export const FUNCTION_SIGNATURES: Readonly<Record<ExpressionFunctionName, FunctionSignature>> = {
  len: { minArgs: 1, maxArgs: 1 },
  lower: { minArgs: 1, maxArgs: 1 },
  upper: { minArgs: 1, maxArgs: 1 },
  trim: { minArgs: 1, maxArgs: 1 },
  contains: { minArgs: 2, maxArgs: 2 },
  starts_with: { minArgs: 2, maxArgs: 2 },
  ends_with: { minArgs: 2, maxArgs: 2 },
  split: { minArgs: 2, maxArgs: 2 },
  join: { minArgs: 1, maxArgs: 2 },
  json: { minArgs: 1, maxArgs: 1 },
  parse_json: { minArgs: 1, maxArgs: 1 },
  keys: { minArgs: 1, maxArgs: 1 },
  values: { minArgs: 1, maxArgs: 1 },
  has: { minArgs: 2, maxArgs: 2 },
  get: { minArgs: 2, maxArgs: 3 },
  coalesce: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY },
  min: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY },
  max: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY },
  abs: { minArgs: 1, maxArgs: 1 },
  round: { minArgs: 1, maxArgs: 2 },
  floor: { minArgs: 1, maxArgs: 1 },
  ceil: { minArgs: 1, maxArgs: 1 },
  sum: { minArgs: 1, maxArgs: 1 },
  avg: { minArgs: 1, maxArgs: 1 },
  first: { minArgs: 1, maxArgs: 1 },
  concat: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY },
  last: { minArgs: 1, maxArgs: 1 },
  filter: { minArgs: 2, maxArgs: 2, lambdaArg: 1 },
  map: { minArgs: 2, maxArgs: 2, lambdaArg: 1 },
  any: { minArgs: 2, maxArgs: 2, lambdaArg: 1 },
  all: { minArgs: 2, maxArgs: 2, lambdaArg: 1 },
  sort: { minArgs: 1, maxArgs: 2, lambdaArg: 1 },
  to_number: { minArgs: 1, maxArgs: 1 },
  to_string: { minArgs: 1, maxArgs: 1 },
  regex_test: { minArgs: 2, maxArgs: 3 },
  regex_match: { minArgs: 2, maxArgs: 3 },
  now: { minArgs: 0, maxArgs: 0 },
  format_date: { minArgs: 1, maxArgs: 2 },
};

/**
 * Maximum height of an expression AST: the number of nodes on its longest
 * root-to-leaf path (a left-associative chain `1 + 1 + …` of 100 terms is
 * exactly at the limit). The parser rejects source whose AST would be taller
 * (and source that nests deeper before a node exists: parentheses, unary
 * chains); the typer and the evaluator reject taller ASTs (which can only
 * come from hand-built plans) so the three agree on what is too deep.
 */
export const MAX_EXPR_DEPTH = 100;

/** The one message every FlowExpr depth rejection carries (parser, typer and evaluator). */
export const EXPRESSION_TOO_DEEP_MESSAGE =
  "expression too deep; split it into a variable or transform node";
