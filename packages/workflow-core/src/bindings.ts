/**
 * §3 References, bindings, templates and expressions (schemas), plus the
 * compact reference grammar (`parseRef` / `formatRef`).
 *
 * Implementations of the FlowExpr parser/evaluator live in `./expr/`, the
 * template scanner/renderer in `./template.ts`.
 */
import { z } from "zod";
import {
  JsonPointerSchema,
  JsonPrimitiveSchema,
  JsonValueSchema,
  type JsonPrimitive,
  type JsonValue,
} from "./json.js";
import { NodeIdSchema, PortNameSchema, VarNameSchema } from "./ids.js";
import { escapePointerToken, unescapePointerToken } from "./schema/pointer.js";

/**
 * A value reference. Canonical JSON form. The compact string form
 * (`intent.decision.value`, `$vars.threshold`, `$scope.item.title`, `$run.id`)
 * is accepted by parseRef() in templates/expressions/SDK and normalised to this.
 */
/** The `$scope.<field>` names: innermost enclosing container (foreach → item/index; loop → iteration/carry). */
export const ScopeFieldSchema = z.enum(["item", "index", "iteration", "carry"]);
/** A `$scope` field name. */
export type ScopeField = z.infer<typeof ScopeFieldSchema>;
/** The `$run.<field>` names. */
export const RunFieldSchema = z.enum([
  "id",
  "workflowId",
  "workflowVersionId",
  "environment",
  "startedAt",
  "sessionId",
]);
/** A `$run` field name. */
export type RunField = z.infer<typeof RunFieldSchema>;
/** Every `$scope` field, in `RefSchema` order (the parser, `parseRef` and `createEvalScope` share this list). */
export const SCOPE_FIELDS: readonly ScopeField[] = ScopeFieldSchema.options;
/** Every `$run` field, in `RefSchema` order. */
export const RUN_FIELDS: readonly RunField[] = RunFieldSchema.options;
/** True when `text` names a `$scope` field. */
export function isScopeField(text: string): text is ScopeField {
  return ScopeFieldSchema.safeParse(text).success;
}
/** True when `text` names a `$run` field. */
export function isRunField(text: string): text is RunField {
  return RunFieldSchema.safeParse(text).success;
}

export const RefSchema = z.discriminatedUnion("kind", [
  /** Output port of a node in the same or an enclosing scope (the input node's ports included). */
  z.object({
    kind: z.literal("port"),
    node: NodeIdSchema,
    port: PortNameSchema,
    path: JsonPointerSchema.optional(),
  }),
  z.object({ kind: z.literal("var"), name: VarNameSchema }),
  /** Innermost enclosing container: foreach → item/index; loop → iteration/carry. */
  z.object({
    kind: z.literal("scope"),
    field: ScopeFieldSchema,
    path: JsonPointerSchema.optional(),
  }),
  z.object({ kind: z.literal("run"), field: RunFieldSchema }),
]);
export type Ref = z.infer<typeof RefSchema>;

/** Renders a non-string template hole. `string` (default) requires a scalar leaf at compile time. */
export const TemplateFilterSchema = z.enum([
  "string",
  "json",
  "json_pretty",
  "join_lines",
  "join_comma",
  "upper",
  "lower",
  "trim",
]);
export type TemplateFilter = z.infer<typeof TemplateFilterSchema>;

/** Source text of a FlowExpr expression (grammar in ARCHITECTURE.md §2.3). Parsed by the compiler. */
export const ExpressionSourceSchema = z.string().min(1).max(4000);
/** Source text of a template: text with `{{ expr | filter }}` holes; `\{{` escapes. */
export const TemplateSourceSchema = z.string().max(64_000);

/**
 * Input binding — the ONLY way data flows between nodes. Data edges on the canvas are derived from bindings.
 * `ref.default` marks the ref optional: when the producer was pruned the default is used (else the consumer is pruned).
 */
export type Binding =
  | { kind: "literal"; value: JsonValue }
  | { kind: "ref"; ref: Ref; default?: JsonValue }
  | { kind: "template"; source: string }
  | { kind: "expr"; source: string }
  | { kind: "object"; fields: Record<string, Binding> }
  | { kind: "array"; items: Binding[] };

/** Zod schema for a {@link Binding} (recursive). */
export const BindingSchema: z.ZodType<Binding> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), value: JsonValueSchema }),
    z.object({ kind: z.literal("ref"), ref: RefSchema, default: JsonValueSchema.optional() }),
    z.object({ kind: z.literal("template"), source: TemplateSourceSchema }),
    z.object({ kind: z.literal("expr"), source: ExpressionSourceSchema }),
    z.object({ kind: z.literal("object"), fields: z.record(z.string(), BindingSchema) }),
    z.object({ kind: z.literal("array"), items: z.array(BindingSchema) }),
  ]),
);

/** FlowExpr AST (compiled form stored in the plan). */
export type ExprAst =
  | { kind: "literal"; value: JsonPrimitive }
  | { kind: "ref"; ref: Ref }
  | { kind: "ident"; name: string } // lambda parameter
  | { kind: "unary"; op: "!" | "-"; operand: ExprAst }
  | {
      kind: "binary";
      op:
        | "||"
        | "&&"
        | "=="
        | "!="
        | "<"
        | "<="
        | ">"
        | ">="
        | "in"
        | "matches"
        | "+"
        | "-"
        | "*"
        | "/"
        | "%";
      left: ExprAst;
      right: ExprAst;
    }
  | { kind: "ternary"; test: ExprAst; then: ExprAst; else: ExprAst }
  | { kind: "member"; object: ExprAst; key: string }
  | { kind: "index"; object: ExprAst; index: ExprAst }
  | { kind: "call"; fn: string; args: ExprAst[] }
  | { kind: "lambda"; param: string; body: ExprAst }
  | { kind: "array"; items: ExprAst[] }
  | { kind: "object"; entries: { key: string; value: ExprAst }[] };

/** Zod schema for an {@link ExprAst} (recursive). */
export const ExprAstSchema: z.ZodType<ExprAst> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), value: JsonPrimitiveSchema }),
    z.object({ kind: z.literal("ref"), ref: RefSchema }),
    z.object({ kind: z.literal("ident"), name: z.string() }),
    z.object({ kind: z.literal("unary"), op: z.enum(["!", "-"]), operand: ExprAstSchema }),
    z.object({
      kind: z.literal("binary"),
      op: z.enum([
        "||",
        "&&",
        "==",
        "!=",
        "<",
        "<=",
        ">",
        ">=",
        "in",
        "matches",
        "+",
        "-",
        "*",
        "/",
        "%",
      ]),
      left: ExprAstSchema,
      right: ExprAstSchema,
    }),
    z.object({
      kind: z.literal("ternary"),
      test: ExprAstSchema,
      then: ExprAstSchema,
      else: ExprAstSchema,
    }),
    z.object({ kind: z.literal("member"), object: ExprAstSchema, key: z.string() }),
    z.object({ kind: z.literal("index"), object: ExprAstSchema, index: ExprAstSchema }),
    z.object({ kind: z.literal("call"), fn: z.string(), args: z.array(ExprAstSchema) }),
    z.object({ kind: z.literal("lambda"), param: z.string(), body: ExprAstSchema }),
    z.object({ kind: z.literal("array"), items: z.array(ExprAstSchema) }),
    z.object({
      kind: z.literal("object"),
      entries: z.array(z.object({ key: z.string(), value: ExprAstSchema })),
    }),
  ]),
);

/** One part of a compiled template: literal text or a `{{ expr | filter }}` hole with its source range. */
export type TemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; expr: ExprAst; filter: TemplateFilter; range: { start: number; end: number } };
/** Zod schema for a {@link TemplatePart}. */
export const TemplatePartSchema: z.ZodType<TemplatePart> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("hole"),
    expr: ExprAstSchema,
    filter: TemplateFilterSchema,
    range: z.object({ start: z.int(), end: z.int() }),
  }),
]);
/** A parsed template: the ordered list of its parts. */
export const CompiledTemplateSchema = z.object({ parts: z.array(TemplatePartSchema) });
export type CompiledTemplate = z.infer<typeof CompiledTemplateSchema>;

/** What an evaluator needs from its environment: reference resolution and the current time. */
export interface EvalScope {
  resolve(ref: Ref): JsonValue | undefined;
  now(): string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Compact reference grammar (ARCHITECTURE.md §2.2 / §2.3)
 *
 *   ref := IDENT ('.' IDENT)+ ('[' (INT|STRING) ']' | '.' IDENT)*      -- node.port.path…
 *        | '$vars' '.' IDENT
 *        | '$scope' '.' ('item'|'index'|'iteration'|'carry') ('.' IDENT | '[' (INT|STRING) ']')*
 *        | '$run' '.' IDENT
 *
 * Dotted/bracketed path segments after the port (or scope field) map to an
 * RFC 6901 JSON Pointer: `a.b[0]['x-y']` ⇒ "/a/b/0/x-y".
 * ──────────────────────────────────────────────────────────────────────────── */

/** Result of {@link parseRef}. */
export type ParseRefResult = { ok: true; ref: Ref } | { ok: false; message: string };

type RefSegment =
  | { kind: "root"; text: string }
  | { kind: "ident"; text: string }
  | { kind: "index"; text: string }
  | { kind: "key"; text: string };

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INT_RE = /^(0|[1-9][0-9]*)$/;

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Scans a quoted string starting at `start` (the quote). Returns the decoded text and the position after the closing quote. */
function scanString(
  source: string,
  start: number,
): { ok: true; text: string; end: number } | { ok: false; message: string } {
  const quote = source[start];
  let i = start + 1;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) break;
    if (ch === quote) return { ok: true, text: out, end: i + 1 };
    if (ch === "\\") {
      const esc = source[i + 1];
      if (esc === undefined) return { ok: false, message: `unterminated escape at offset ${i}` };
      switch (esc) {
        case '"':
          out += '"';
          break;
        case "'":
          out += "'";
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = source.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex))
            return { ok: false, message: `invalid \\u escape at offset ${i}` };
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        default:
          return { ok: false, message: `invalid escape '\\${esc}' at offset ${i}` };
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { ok: false, message: `unterminated string starting at offset ${start}` };
}

/** Splits a compact reference into its lexical segments. */
function scanRefSegments(
  source: string,
): { ok: true; segments: RefSegment[] } | { ok: false; message: string } {
  if (source.length === 0) return { ok: false, message: "empty reference" };
  const segments: RefSegment[] = [];
  let i = 0;
  // root: IDENT or '$' IDENT
  const first = source[0];
  if (first === "$") i = 1;
  const rootStart = i;
  if (i >= source.length || !isIdentStart(source.charAt(i))) {
    return { ok: false, message: `expected identifier at offset ${i}` };
  }
  while (i < source.length && isIdentPart(source.charAt(i))) i += 1;
  segments.push({ kind: "root", text: source.slice(first === "$" ? 0 : rootStart, i) });

  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === ".") {
      const start = i + 1;
      if (start >= source.length || !isIdentStart(source.charAt(start))) {
        return { ok: false, message: `expected identifier after '.' at offset ${start}` };
      }
      let j = start;
      while (j < source.length && isIdentPart(source.charAt(j))) j += 1;
      segments.push({ kind: "ident", text: source.slice(start, j) });
      i = j;
      continue;
    }
    if (ch === "[") {
      const start = i + 1;
      const inner = source.charAt(start);
      if (inner === '"' || inner === "'") {
        const str = scanString(source, start);
        if (!str.ok) return str;
        if (source.charAt(str.end) !== "]")
          return { ok: false, message: `expected ']' at offset ${str.end}` };
        segments.push({ kind: "key", text: str.text });
        i = str.end + 1;
        continue;
      }
      if (isDigit(inner)) {
        let j = start;
        while (j < source.length && isDigit(source.charAt(j))) j += 1;
        const digits = source.slice(start, j);
        if (!INT_RE.test(digits))
          return { ok: false, message: `invalid array index '${digits}' at offset ${start}` };
        if (source.charAt(j) !== "]") return { ok: false, message: `expected ']' at offset ${j}` };
        segments.push({ kind: "index", text: digits });
        i = j + 1;
        continue;
      }
      return { ok: false, message: `expected integer or string index at offset ${start}` };
    }
    return { ok: false, message: `unexpected character '${ch}' at offset ${i}` };
  }
  return { ok: true, segments };
}

/** Converts trailing path segments to a JSON Pointer; `undefined` when there are none. */
function segmentsToPointer(segments: readonly RefSegment[]): string | undefined {
  if (segments.length === 0) return undefined;
  return segments.map((s) => "/" + escapePointerToken(s.text)).join("");
}

/**
 * Parses the compact string form of a {@link Ref}.
 *
 * Accepted forms: `node.port`, `node.port.a.b[0]['x-y']`, `$vars.name`,
 * `$scope.item.title`, `$scope.carry`, `$run.id`. Path segments after the port
 * (or scope field) become an RFC 6901 pointer (`intent.decision.value` ⇒
 * `{ kind: 'port', node: 'intent', port: 'decision', path: '/value' }`).
 * No whitespace is allowed. Node ids, port names and variable names are
 * validated against their id schemas.
 */
export function parseRef(source: string): ParseRefResult {
  const scanned = scanRefSegments(source);
  if (!scanned.ok) return scanned;
  const [root, ...rest] = scanned.segments;
  if (root === undefined) return { ok: false, message: "empty reference" };

  if (root.text.startsWith("$")) {
    const field = rest[0];
    if (field === undefined || field.kind !== "ident") {
      return { ok: false, message: `expected '.<field>' after '${root.text}'` };
    }
    const tail = rest.slice(1);
    switch (root.text) {
      case "$vars": {
        if (tail.length > 0) return { ok: false, message: "$vars references take no path" };
        if (!VarNameSchema.safeParse(field.text).success)
          return { ok: false, message: `invalid variable name '${field.text}'` };
        return { ok: true, ref: { kind: "var", name: field.text } };
      }
      case "$run": {
        if (tail.length > 0) return { ok: false, message: "$run references take no path" };
        if (!isRunField(field.text))
          return { ok: false, message: `unknown $run field '${field.text}'` };
        return { ok: true, ref: { kind: "run", field: field.text } };
      }
      case "$scope": {
        if (!isScopeField(field.text))
          return { ok: false, message: `unknown $scope field '${field.text}'` };
        const path = segmentsToPointer(tail);
        const ref: Ref =
          path === undefined
            ? { kind: "scope", field: field.text }
            : { kind: "scope", field: field.text, path };
        const parsed = RefSchema.safeParse(ref);
        if (!parsed.success) return { ok: false, message: `invalid $scope reference '${source}'` };
        return { ok: true, ref: parsed.data };
      }
      default:
        return {
          ok: false,
          message: `unknown root '${root.text}' (expected $vars, $scope or $run)`,
        };
    }
  }

  const port = rest[0];
  if (port === undefined || port.kind !== "ident") {
    return { ok: false, message: `expected '.<port>' after node id '${root.text}'` };
  }
  if (!NodeIdSchema.safeParse(root.text).success)
    return { ok: false, message: `invalid node id '${root.text}'` };
  if (!PortNameSchema.safeParse(port.text).success)
    return { ok: false, message: `invalid port name '${port.text}'` };
  const path = segmentsToPointer(rest.slice(1));
  const ref: Ref =
    path === undefined
      ? { kind: "port", node: root.text, port: port.text }
      : { kind: "port", node: root.text, port: port.text, path };
  return { ok: true, ref };
}

/** Renders a single pointer token as a compact path segment (`.ident`, `[0]` or `['quoted']`). */
function formatPathToken(token: string): string {
  if (IDENT_RE.test(token)) return "." + token;
  if (INT_RE.test(token)) return "[" + token + "]";
  let quoted = "";
  for (const ch of token) {
    const code = ch.charCodeAt(0);
    if (ch === "\\") quoted += "\\\\";
    else if (ch === "'") quoted += "\\'";
    else if (ch === "\n") quoted += "\\n";
    else if (ch === "\r") quoted += "\\r";
    else if (ch === "\t") quoted += "\\t";
    else if (code < 0x20) quoted += "\\u" + code.toString(16).padStart(4, "0");
    else quoted += ch;
  }
  return "['" + quoted + "']";
}

/** Renders an optional JSON Pointer as compact path segments. */
function formatPointer(pointer: string | undefined): string {
  if (pointer === undefined || pointer === "") return "";
  return pointer
    .slice(1)
    .split("/")
    .map((token) => formatPathToken(unescapePointerToken(token)))
    .join("");
}

/**
 * Renders a {@link Ref} in its compact string form — the inverse of {@link parseRef}:
 * `parseRef(formatRef(ref))` yields a ref equal to `ref` (a `path` of `""` is
 * treated as absent).
 */
export function formatRef(ref: Ref): string {
  switch (ref.kind) {
    case "var":
      return `$vars.${ref.name}`;
    case "run":
      return `$run.${ref.field}`;
    case "scope":
      return `$scope.${ref.field}${formatPointer(ref.path)}`;
    case "port":
      return `${ref.node}.${ref.port}${formatPointer(ref.path)}`;
  }
}
