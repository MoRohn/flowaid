/**
 * Reference collection: every {@link Ref} an expression (or template) reads,
 * which the compiler resolves (`E_REF_*`) and turns into data dependencies.
 */
import { formatRef, type CompiledTemplate, type ExprAst, type Ref } from "../bindings.js";

function walk(ast: ExprAst, seen: Map<string, Ref>): void {
  switch (ast.kind) {
    case "literal":
    case "ident":
      return;
    case "ref": {
      const key = formatRef(ast.ref);
      if (!seen.has(key)) seen.set(key, ast.ref);
      return;
    }
    case "unary":
      walk(ast.operand, seen);
      return;
    case "binary":
      walk(ast.left, seen);
      walk(ast.right, seen);
      return;
    case "ternary":
      walk(ast.test, seen);
      walk(ast.then, seen);
      walk(ast.else, seen);
      return;
    case "member":
      walk(ast.object, seen);
      return;
    case "index":
      walk(ast.object, seen);
      walk(ast.index, seen);
      return;
    case "call":
      for (const arg of ast.args) walk(arg, seen);
      return;
    case "lambda":
      walk(ast.body, seen);
      return;
    case "array":
      for (const item of ast.items) walk(item, seen);
      return;
    case "object":
      for (const entry of ast.entries) walk(entry.value, seen);
      return;
  }
}

/** Every distinct reference used by `ast`, in order of first appearance (identity = compact form). */
export function collectRefs(ast: ExprAst): Ref[] {
  const seen = new Map<string, Ref>();
  walk(ast, seen);
  return [...seen.values()];
}

/** Every distinct reference used by the holes of `template`, in order of first appearance. */
export function collectTemplateRefs(template: CompiledTemplate): Ref[] {
  const seen = new Map<string, Ref>();
  for (const part of template.parts) if (part.kind === "hole") walk(part.expr, seen);
  return [...seen.values()];
}
