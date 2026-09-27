/**
 * Template grammar translation (ARCHITECTURE.md §10.9): the source editor's `{{ … }}` holes —
 * `{{ question }}`, `{{ nodeId }}`, `{{ nodeId.output.path }}`, `$flow.state.x`, `$vars.x`,
 * `$form.x`, `$webhook.body.x`, `$iteration.x` — become FlowAId template holes and FlowExpr
 * references; rich-text (TipTap) HTML is unwrapped to plain text first.
 */
import type { Binding } from "@flowaid/workflow-core";
import { snake, type Builder } from "./builder.js";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

/** TipTap/HTML rich text → plain text; mention chips become `{{ id }}` holes. */
export function unwrapRichText(text: string): string {
  if (!/<[a-z][^>]*>/i.test(text)) return text;
  return text
    .replace(
      /<span[^>]*data-type="mention"[^>]*data-id="([^"]+)"[^>]*>.*?<\/span>/gi,
      (_m, id: string) => `{{ ${id} }}`,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PATH_OK = /^(\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/;

function suffix(rest: string | undefined): string | null {
  if (!rest) return "";
  const path = rest.startsWith(".") || rest.startsWith("[") ? rest : `.${rest}`;
  return PATH_OK.test(path) ? path : null;
}

function varName(key: string): string {
  return /^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) ? key : snake(key);
}

/**
 * The FlowExpr for one hole's source text, or null when it names nothing the importer knows.
 * `sourceId` is the node the template belongs to (for issue locations).
 */
export function translateReference(inner: string, b: Builder, sourceId?: string): string | null {
  const t = inner.trim();
  let m: RegExpMatchArray | null;
  if (/^(\$?question|\$flow\.input|input)$/.test(t)) {
    b.input("question", { type: "string" }, true);
    return "start.question";
  }
  if (t === "chat_history" || t === "$flow.chatHistory") {
    b.variable("chat_history", [], "definition");
    b.issue(
      "W_IMPORT_APPROXIMATE",
      "chat history is not kept between runs; the imported workflow reads $vars.chat_history (empty by default)",
      sourceId ? { sourceId } : {},
    );
    return "$vars.chat_history";
  }
  if ((m = /^\$flow\.state\.([A-Za-z_][\w]*)(.*)$/.exec(t))) {
    const name = varName(m[1] as string);
    b.variable(name, null, "definition");
    const s = suffix(m[2]);
    return s === null ? null : `$vars.${name}${s}`;
  }
  if ((m = /^\$vars\.([A-Za-z_][\w]*)(.*)$/.exec(t))) {
    const name = varName(m[1] as string);
    b.variable(name, undefined, "environment");
    const s = suffix(m[2]);
    return s === null ? null : `$vars.${name}${s}`;
  }
  if ((m = /^\$(?:form|webhook(?:\.body)?)\.([A-Za-z_][\w]*)(.*)$/.exec(t))) {
    const name = snake(m[1] as string);
    b.input(name, {});
    const s = suffix(m[2]);
    return s === null ? null : `start.${name}${s}`;
  }
  if ((m = /^\$iteration(?:\.(.+))?$/.exec(t))) {
    const s = suffix(m[1]);
    return s === null ? null : `$scope.item${s}`;
  }
  if (t === "$flow.sessionId") return "$run.sessionId";
  if (t === "$flow.chatflowId") return "$run.workflowId";
  if (t === "$flow.chatId" || t === "$flow.runId") return "$run.id";
  if ((m = /^([A-Za-z][A-Za-z0-9]*_\d+)(?:\.(.*))?$/.exec(t))) {
    const target = b.mapped.get(m[1] as string);
    if (!target?.port) return null;
    // `nodeId.output.content` and `nodeId.output` address the node's result
    const rest = (m[2] ?? "").replace(/^output(\.|$)/, "").replace(/^content$/, "");
    const s = suffix(rest);
    return s === null ? null : `${target.id}.${target.port}${s}`;
  }
  return null;
}

interface Piece {
  text?: string;
  expr?: string;
}

function pieces(source: string, b: Builder, sourceId?: string): { parts: Piece[]; holes: number } {
  const text = unwrapRichText(source);
  const parts: Piece[] = [];
  let holes = 0;
  let last = 0;
  for (const m of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const at = m.index;
    if (at > last) parts.push({ text: text.slice(last, at) });
    const expr = translateReference(m[1] as string, b, sourceId);
    if (expr === null) {
      b.issue(
        "W_IMPORT_APPROXIMATE",
        `'{{${m[1] as string}}}' has no FlowAId equivalent and was kept as text`,
        sourceId ? { sourceId } : {},
      );
      parts.push({ text: `\\{{${m[1] as string}}}` });
    } else {
      holes += 1;
      parts.push({ expr });
    }
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return { parts, holes };
}

/** A template string (holes translated), or the plain text when it has none. */
export function translateTemplate(source: string, b: Builder, sourceId?: string): string {
  const { parts } = pieces(source, b, sourceId);
  return parts.map((p) => (p.expr !== undefined ? `{{ ${p.expr} }}` : p.text)).join("");
}

/** A binding for a text field: a literal without holes, else a template. */
export function textBinding(source: string, b: Builder, sourceId?: string): Binding {
  const { parts, holes } = pieces(source, b, sourceId);
  if (holes === 0) return { kind: "literal", value: parts.map((p) => p.text ?? "").join("") };
  // a single hole alone keeps its value's type
  const only = parts.filter((p) => p.expr !== undefined || (p.text ?? "").trim() !== "");
  if (only.length === 1 && only[0]?.expr !== undefined)
    return { kind: "expr", source: only[0].expr };
  return {
    kind: "template",
    source: parts.map((p) => (p.expr !== undefined ? `{{ ${p.expr} }}` : p.text)).join(""),
  };
}

/** A FlowExpr for a value: the translated reference, or a JSON literal of the text. */
export function valueExpression(source: unknown, b: Builder, sourceId?: string): string {
  if (typeof source !== "string") return JSON.stringify(source ?? null);
  const { parts, holes } = pieces(source, b, sourceId);
  if (holes === 0) {
    const text = parts.map((p) => p.text ?? "").join("");
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) && /^-?\d/.test(text.trim())
      ? String(n)
      : JSON.stringify(text);
  }
  const terms = parts
    .filter((p) => p.expr !== undefined || (p.text ?? "") !== "")
    .map((p) => (p.expr !== undefined ? p.expr : JSON.stringify(p.text)));
  if (terms.length === 1) return terms[0] as string;
  return terms.map((t) => (t.startsWith('"') ? t : `to_string(${t})`)).join(" + ");
}
