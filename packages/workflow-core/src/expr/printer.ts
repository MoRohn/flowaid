/**
 * FlowExpr printer: renders an {@link ExprAst} as source text that parses back
 * to the same AST (`parseExpression(printAst(ast))` ≡ `ast` for every AST the
 * parser can produce). Used by the canvas to show normalised expressions and
 * by tests as the inverse of the parser.
 */
import { formatRef, type ExprAst } from "../bindings.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Binding strength of an AST node when printed (higher binds tighter). */
const Prec = {
  Ternary: 1,
  Or: 2,
  And: 3,
  Cmp: 4,
  Add: 5,
  Mul: 6,
  Unary: 7,
  Postfix: 8,
  Primary: 9,
} as const;
type Prec = (typeof Prec)[keyof typeof Prec];

function binaryPrec(op: string): Prec {
  switch (op) {
    case "||":
      return Prec.Or;
    case "&&":
      return Prec.And;
    case "+":
    case "-":
      return Prec.Add;
    case "*":
    case "/":
    case "%":
      return Prec.Mul;
    default:
      return Prec.Cmp;
  }
}

function precOf(ast: ExprAst): Prec {
  switch (ast.kind) {
    case "literal":
      return typeof ast.value === "number" && (ast.value < 0 || Object.is(ast.value, -0))
        ? Prec.Unary
        : Prec.Primary;
    case "ref":
    case "ident":
    case "call":
    case "array":
    case "object":
      return Prec.Primary;
    case "member":
    case "index":
      return Prec.Postfix;
    case "unary":
      return Prec.Unary;
    case "binary":
      return binaryPrec(ast.op);
    case "ternary":
    case "lambda":
      return Prec.Ternary;
  }
}

/** Prints `ast`, parenthesising it when it binds less tightly than `min`. */
function printAt(ast: ExprAst, min: number): string {
  const text = print(ast);
  return precOf(ast) < min ? `(${text})` : text;
}

/** A port/scope reference directly followed by a static segment would be re-parsed as a longer reference path. */
function needsRefGuard(object: ExprAst): boolean {
  return object.kind === "ref" && (object.ref.kind === "port" || object.ref.kind === "scope");
}

function printKey(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function print(ast: ExprAst): string {
  switch (ast.kind) {
    case "literal":
      return typeof ast.value === "string" ? JSON.stringify(ast.value) : String(ast.value);
    case "ref":
      return formatRef(ast.ref);
    case "ident":
      return ast.name;
    case "unary":
      return ast.op + printAt(ast.operand, Prec.Unary);
    case "binary": {
      const prec = binaryPrec(ast.op);
      const left = printAt(ast.left, prec === Prec.Cmp ? Prec.Add : prec);
      const right = printAt(ast.right, prec + 1);
      return `${left} ${ast.op} ${right}`;
    }
    case "ternary":
      return `${printAt(ast.test, Prec.Or)} ? ${print(ast.then)} : ${print(ast.else)}`;
    case "member": {
      const object = needsRefGuard(ast.object)
        ? `(${print(ast.object)})`
        : printAt(ast.object, Prec.Postfix);
      return IDENT_RE.test(ast.key)
        ? `${object}.${ast.key}`
        : `${object}[${JSON.stringify(ast.key)}]`;
    }
    case "index": {
      const guard = needsRefGuard(ast.object) && ast.index.kind === "literal";
      const object = guard ? `(${print(ast.object)})` : printAt(ast.object, Prec.Postfix);
      return `${object}[${print(ast.index)}]`;
    }
    case "call":
      return `${ast.fn}(${ast.args.map(print).join(", ")})`;
    case "lambda":
      return `${ast.param} => ${print(ast.body)}`;
    case "array":
      return `[${ast.items.map(print).join(", ")}]`;
    case "object":
      return `{${ast.entries.map((e) => `${printKey(e.key)}: ${print(e.value)}`).join(", ")}}`;
  }
}

/**
 * Renders an AST as FlowExpr source. Parentheses are inserted only where the
 * grammar needs them; strings use double quotes with JSON escapes; references
 * use their compact form ({@link formatRef}).
 */
export function printAst(ast: ExprAst): string {
  return print(ast);
}
