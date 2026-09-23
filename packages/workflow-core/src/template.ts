/**
 * Template scanner and renderer (ARCHITECTURE.md §2.3):
 *
 * ```
 * template := text ('{{' ws expr ws ('|' filter)? ws '}}')*
 * filter   := 'json' | 'json_pretty' | 'join_lines' | 'join_comma' | 'upper' | 'lower' | 'trim'
 * ```
 *
 * `\{{` is a literal `{{`; any other backslash is ordinary text; a `}}`
 * outside a hole is ordinary text. The expression inside a hole is lexed on
 * demand, so it may itself contain `}}` (an object literal, say) and the text
 * after the hole is never lexed. Each hole keeps the source range of the
 * whole `{{ … }}` for diagnostics.
 *
 * Rendering: scalars become text (`null` → empty string), objects and arrays
 * go through the hole's filter, or compact JSON when the hole has none
 * (`string`) — the runtime fallback for holes the compiler could not type.
 * `json`, `json_pretty`, `join_lines` and `join_comma` accept containers;
 * `upper`, `lower` and `trim` coerce to text first and, like a bare hole,
 * are `E_TEMPLATE_OBJECT_COERCION` on a container-typed hole at compile time.
 */
import { isJsonObject } from "@flowaid/shared";
import {
  TemplateFilterSchema,
  type CompiledTemplate,
  type EvalScope,
  type TemplateFilter,
  type TemplatePart,
} from "./bindings.js";
import { ExpressionError } from "./errors.js";
import type { JsonValue } from "./json.js";
import {
  MAX_EVAL_RESULT_BYTES,
  evaluateExpression,
  expressionError,
  jsonToText,
  jsonTypeOf,
} from "./expr/evaluator.js";
import { ExpressionSyntaxError, Lexer } from "./expr/lexer.js";
import { parseEmbeddedExpression } from "./expr/parser.js";
export { collectTemplateRefs } from "./expr/refs.js";

/** Result of {@link parseTemplate}. */
export type ParseTemplateResult =
  { ok: true; template: CompiledTemplate } | { ok: false; message: string; offset: number };

/** A filter accepted in template source: every {@link TemplateFilter} except the implicit `string`. */
export type TemplateHoleFilter = Exclude<TemplateFilter, "string">;

function isHoleFilter(name: string): name is TemplateHoleFilter {
  return name !== "string" && TemplateFilterSchema.safeParse(name).success;
}

/**
 * The filters a template hole may name (`| filter`), derived from the contract's
 * `TemplateFilterSchema` (RFC-0009) so the scanner accepts every member. Holes
 * without a filter are `string`.
 */
export const TEMPLATE_HOLE_FILTERS: readonly TemplateHoleFilter[] =
  TemplateFilterSchema.options.filter(isHoleFilter);

/** The filters that render an object or array on purpose; every other filter coerces to text. */
export const TEMPLATE_CONTAINER_FILTERS: readonly TemplateFilter[] = [
  "json",
  "json_pretty",
  "join_lines",
  "join_comma",
];

/**
 * True when a hole with `filter` may hold an object or array without the
 * compiler reporting `E_TEMPLATE_OBJECT_COERCION`. `string` (no filter),
 * `upper`, `lower` and `trim` coerce containers to compact JSON at runtime,
 * which is never what the author meant.
 */
export function filterAcceptsContainers(filter: TemplateFilter): boolean {
  return TEMPLATE_CONTAINER_FILTERS.includes(filter);
}

/** Parses template source into a {@link CompiledTemplate}. Never throws; errors carry an absolute offset. */
export function parseTemplate(source: string): ParseTemplateResult {
  const parts: TemplatePart[] = [];
  let text = "";
  const flush = (): void => {
    if (text.length > 0) parts.push({ kind: "text", text });
    text = "";
  };
  let i = 0;
  try {
    while (i < source.length) {
      if (source.startsWith("\\{{", i)) {
        text += "{{";
        i += 3;
        continue;
      }
      if (!source.startsWith("{{", i)) {
        text += source.charAt(i);
        i += 1;
        continue;
      }
      const start = i;
      const lexer = new Lexer(source, i + 2);
      const first = lexer.peek();
      if (first.kind === "eof")
        throw new ExpressionSyntaxError("unterminated template hole", start);
      const expr = parseEmbeddedExpression(lexer);
      let filter: TemplateFilter = "string";
      let token = lexer.next();
      if (token.kind === "punct" && token.text === "|") {
        const name = lexer.next();
        if (name.kind !== "ident" || !isHoleFilter(name.text)) {
          throw new ExpressionSyntaxError(
            `unknown template filter (expected ${TEMPLATE_HOLE_FILTERS.join(", ")})`,
            name.start,
          );
        }
        filter = name.text;
        token = lexer.next();
      }
      if (token.kind === "eof")
        throw new ExpressionSyntaxError("unterminated template hole", start);
      const closer = lexer.peek();
      if (!(
        token.kind === "punct" &&
        token.text === "}" &&
        closer.kind === "punct" &&
        closer.text === "}" &&
        closer.start === token.end
      )) {
        throw new ExpressionSyntaxError("expected '}}' to close template hole", token.start);
      }
      flush();
      parts.push({ kind: "hole", expr, filter, range: { start, end: closer.end } });
      i = closer.end;
    }
    flush();
    return { ok: true, template: { parts } };
  } catch (error) {
    if (error instanceof ExpressionSyntaxError)
      return { ok: false, message: error.message, offset: error.offset };
    throw error;
  }
}

function joinItems(value: JsonValue, separator: string, filter: string): string {
  if (!Array.isArray(value))
    throw expressionError(
      "TYPE",
      `template filter ${filter}: expected array, got ${jsonTypeOf(value)}`,
      { filter },
    );
  return value.map(jsonToText).join(separator);
}

/** Applies a template filter to an evaluated hole value. */
export function applyTemplateFilter(value: JsonValue, filter: TemplateFilter): string {
  switch (filter) {
    case "string":
      return jsonToText(value);
    case "json":
      return JSON.stringify(value);
    case "json_pretty":
      return JSON.stringify(value, null, 2);
    case "join_lines":
      return joinItems(value, "\n", filter);
    case "join_comma":
      return joinItems(value, ", ", filter);
    case "upper":
      return jsonToText(value).toUpperCase();
    case "lower":
      return jsonToText(value).toLowerCase();
    case "trim":
      return jsonToText(value).trim();
  }
}

/**
 * Renders a compiled template against a scope. Each hole is evaluated with the
 * bounded evaluator; the whole rendering is capped at
 * {@link MAX_EVAL_RESULT_BYTES}. Throws `ExpressionError` on evaluation
 * failures (the failing hole's range is in `details.range`).
 */
export function renderTemplate(template: CompiledTemplate, scope: EvalScope): string {
  let out = "";
  for (const part of template.parts) {
    if (part.kind === "text") {
      out += part.text;
    } else {
      try {
        out += applyTemplateFilter(evaluateExpression(part.expr, scope), part.filter);
      } catch (error) {
        if (error instanceof ExpressionError) throw withRange(error, part.range);
        throw error;
      }
    }
    if (out.length > MAX_EVAL_RESULT_BYTES) {
      throw expressionError(
        "RESULT_TOO_LARGE",
        `rendered template exceeds ${MAX_EVAL_RESULT_BYTES} bytes`,
        { limit: MAX_EVAL_RESULT_BYTES },
      );
    }
  }
  return out;
}

/** Re-raises an evaluation error with the failing hole's source range added to its details. */
function withRange(error: ExpressionError, range: { start: number; end: number }): ExpressionError {
  const details = isJsonObject(error.details) ? error.details : {};
  return new ExpressionError(
    error.message,
    { ...details, range: { start: range.start, end: range.end } },
    { cause: error },
  );
}
