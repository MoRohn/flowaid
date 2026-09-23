/**
 * Template expression helpers shared by ExpressionInput, ExpressionTextarea and
 * the SchemaForm expression widget. A template is plain text with `{{ … }}`
 * regions; inside a region, references point into the ExpressionScope:
 *
 *   {{ input.message }}
 *   {{ nodes.intent.output.confidence >= 0.9 }}
 *   {{ variables.locale }}
 *
 * Everything here is pure so the editor, the validator and tests share one
 * model of what a reference is.
 */
import type { ExpressionScope, PortView } from "@/types";

export type ExpressionRoot = "input" | "variables" | "nodes";

export const EXPRESSION_ROOTS: ExpressionRoot[] = ["input", "variables", "nodes"];

/** One `{{ … }}` region in a template. Offsets are absolute within the text. */
export interface ExpressionRegion {
  /** Offset of the opening `{{`. */
  from: number;
  /** Offset just past the closing `}}` (or the end of the text when unclosed). */
  to: number;
  /** Offsets of the inner expression, excluding the braces. */
  innerFrom: number;
  innerTo: number;
  /** The inner expression source. */
  source: string;
  closed: boolean;
}

/** A dotted reference such as `nodes.intent.output.confidence`. */
export interface ExpressionReference {
  /** Full dotted path as written. */
  path: string;
  root: ExpressionRoot;
  /** Path segments after the root. */
  segments: string[];
  /** Absolute offsets of the reference text. */
  from: number;
  to: number;
  /** Index of the enclosing region in `findExpressionRegions`. */
  region: number;
}

/** Finds every `{{ … }}` region, including an unclosed trailing one. */
export function findExpressionRegions(text: string): ExpressionRegion[] {
  const regions: ExpressionRegion[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{{", i);
    if (open === -1) break;
    const close = text.indexOf("}}", open + 2);
    if (close === -1) {
      regions.push({
        from: open,
        to: text.length,
        innerFrom: open + 2,
        innerTo: text.length,
        source: text.slice(open + 2),
        closed: false,
      });
      break;
    }
    regions.push({
      from: open,
      to: close + 2,
      innerFrom: open + 2,
      innerTo: close,
      source: text.slice(open + 2, close),
      closed: true,
    });
    i = close + 2;
  }
  return regions;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

/**
 * Scans an expression body for references, skipping string literals so
 * `"nodes"` inside quotes is not a reference. Bracket access with a string or
 * number literal (`input["ticket id"]`, `output.items[0]`) is folded into the
 * segment list.
 */
function scanReferences(source: string, base: number, region: number): ExpressionReference[] {
  const refs: ExpressionReference[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source.charAt(i);
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (IDENT_START.test(ch) && (i === 0 || !IDENT_PART.test(source.charAt(i - 1)))) {
      const start = i;
      while (i < n && IDENT_PART.test(source.charAt(i))) i += 1;
      const ident = source.slice(start, i);
      const prev = source.slice(0, start).trimEnd();
      // A property access like `foo.input` is not a root reference.
      if (prev.endsWith(".")) continue;
      if (!isRoot(ident)) continue;
      const segments: string[] = [];
      let end = i;
      while (end < n) {
        if (source.charAt(end) === ".") {
          let j = end + 1;
          const segStart = j;
          while (j < n && IDENT_PART.test(source.charAt(j))) j += 1;
          if (j === segStart) {
            // Trailing dot (the person is mid-typing): keep an empty segment.
            segments.push("");
            end = j;
            break;
          }
          segments.push(source.slice(segStart, j));
          end = j;
          continue;
        }
        if (source.charAt(end) === "[") {
          const closeIdx = source.indexOf("]", end);
          if (closeIdx === -1) break;
          const inner = source.slice(end + 1, closeIdx).trim();
          const literal = /^(?:"([^"]*)"|'([^']*)'|(\d+))$/.exec(inner);
          if (!literal) break;
          segments.push(literal[1] ?? literal[2] ?? literal[3] ?? "");
          end = closeIdx + 1;
          continue;
        }
        break;
      }
      refs.push({
        path: source.slice(start, end),
        root: ident,
        segments,
        from: base + start,
        to: base + end,
        region,
      });
      i = end;
      continue;
    }
    i += 1;
  }
  return refs;
}

function skipString(source: string, start: number): number {
  const quote = source.charAt(start);
  let i = start + 1;
  while (i < source.length) {
    const c = source.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function isRoot(ident: string): ident is ExpressionRoot {
  return (EXPRESSION_ROOTS as string[]).includes(ident);
}

/** Every scope reference used by the template, in document order. */
export function parseExpressionReferences(text: string): ExpressionReference[] {
  const regions = findExpressionRegions(text);
  const out: ExpressionReference[] = [];
  regions.forEach((region, index) => {
    out.push(...scanReferences(region.source, region.innerFrom, index));
  });
  return out;
}

export type ExpressionIssueCode =
  | "unbalanced"
  | "empty"
  | "unknown-root"
  | "unknown-input"
  | "unknown-variable"
  | "unknown-node"
  | "unknown-node-member"
  | "unknown-output"
  | "incomplete";

export interface ExpressionIssue {
  code: ExpressionIssueCode;
  message: string;
  from: number;
  to: number;
  severity: "error" | "warning";
}

export interface ExpressionValidation {
  valid: boolean;
  issues: ExpressionIssue[];
  references: ExpressionReference[];
}

const NODE_MEMBERS = ["output", "status", "durationMs", "attempt"] as const;

/**
 * Validates a template against a scope: braces must balance, every region must
 * hold an expression, and each reference must resolve to an input port, a
 * variable, a node, a node member or a node output port. Segments beyond a
 * known port are accepted because port payloads are opaque here.
 */
export function validateExpression(text: string, scope: ExpressionScope): ExpressionValidation {
  const regions = findExpressionRegions(text);
  const references = parseExpressionReferences(text);
  const issues: ExpressionIssue[] = [];

  for (const region of regions) {
    if (!region.closed) {
      issues.push({
        code: "unbalanced",
        message: "Missing closing }}",
        from: region.from,
        to: region.to,
        severity: "error",
      });
    } else if (region.source.trim() === "") {
      issues.push({
        code: "empty",
        message: "Empty expression",
        from: region.from,
        to: region.to,
        severity: "error",
      });
    }
  }
  // A stray `}}` without an opener.
  let cursor = 0;
  for (const region of regions) {
    const stray = text.slice(cursor, region.from).indexOf("}}");
    if (stray !== -1) {
      issues.push({
        code: "unbalanced",
        message: "Unexpected }} without an opening {{",
        from: cursor + stray,
        to: cursor + stray + 2,
        severity: "error",
      });
    }
    cursor = region.to;
  }
  const tail = text.slice(cursor).indexOf("}}");
  if (tail !== -1) {
    issues.push({
      code: "unbalanced",
      message: "Unexpected }} without an opening {{",
      from: cursor + tail,
      to: cursor + tail + 2,
      severity: "error",
    });
  }

  for (const ref of references) {
    const issue = checkReference(ref, scope);
    if (issue) issues.push(issue);
  }

  issues.sort((a, b) => a.from - b.from);
  return { valid: issues.every((i) => i.severity !== "error"), issues, references };
}

function checkReference(ref: ExpressionReference, scope: ExpressionScope): ExpressionIssue | null {
  const [first, second, third] = ref.segments;
  const at = (message: string, code: ExpressionIssueCode): ExpressionIssue => ({
    code,
    message,
    from: ref.from,
    to: ref.to,
    severity: "error",
  });
  const incomplete = (what: string): ExpressionIssue => ({
    code: "incomplete",
    message: `Choose ${what}`,
    from: ref.from,
    to: ref.to,
    severity: "warning",
  });
  switch (ref.root) {
    case "input": {
      if (first === undefined) return null; // whole input object
      if (first === "") return incomplete("an input");
      if (!scope.inputs.some((p) => p.id === first)) {
        return at(
          `Unknown input "${first}"${suggest(
            first,
            scope.inputs.map((p) => p.id),
          )}`,
          "unknown-input",
        );
      }
      return null;
    }
    case "variables": {
      if (first === undefined) return null;
      if (first === "") return incomplete("a variable");
      if (!scope.variables.some((v) => v.name === first)) {
        return at(
          `Unknown variable "${first}"${suggest(
            first,
            scope.variables.map((v) => v.name),
          )}`,
          "unknown-variable",
        );
      }
      return null;
    }
    case "nodes": {
      if (first === undefined) return null;
      if (first === "") return incomplete("a node");
      const node = scope.nodes.find((n) => n.id === first);
      if (!node) {
        return at(
          `Unknown node "${first}"${suggest(
            first,
            scope.nodes.map((n) => n.id),
          )}`,
          "unknown-node",
        );
      }
      if (second === undefined) return null;
      if (second === "") return incomplete("a member (output)");
      if (!(NODE_MEMBERS as readonly string[]).includes(second)) {
        return at(
          `Node "${node.name}" has no "${second}"; use output, status, durationMs or attempt`,
          "unknown-node-member",
        );
      }
      if (second !== "output" || third === undefined) return null;
      if (third === "") return incomplete("an output");
      if (!node.outputs.some((p) => p.id === third)) {
        return at(
          `Node "${node.name}" has no output "${third}"${suggest(
            third,
            node.outputs.map((p) => p.id),
          )}`,
          "unknown-output",
        );
      }
      return null;
    }
    default:
      return null;
  }
}

function suggest(needle: string, haystack: string[]): string {
  const lower = needle.toLowerCase();
  const hit = haystack.find(
    (h) => h.toLowerCase().startsWith(lower) || lower.startsWith(h.toLowerCase()),
  );
  return hit ? `; did you mean "${hit}"?` : "";
}

/** A completion candidate at some point in a reference path. */
export interface ScopeCompletion {
  label: string;
  /** Mono type label, e.g. "string", "decision". */
  type?: string;
  detail?: string;
  /** The reference kind, for icons. */
  kind: "root" | "input" | "variable" | "node" | "member" | "output";
}

/**
 * Completions for the segments typed so far inside a reference. An empty
 * array of segments means "at the root"; `["nodes", "intent", "output"]`
 * lists that node's outputs.
 */
export function scopeCompletions(segments: string[], scope: ExpressionScope): ScopeCompletion[] {
  const [root, first, second] = segments;
  if (root === undefined) {
    return [
      { label: "input", kind: "root", type: "object", detail: `${scope.inputs.length} ports` },
      { label: "nodes", kind: "root", type: "object", detail: `${scope.nodes.length} upstream` },
      {
        label: "variables",
        kind: "root",
        type: "object",
        detail: `${scope.variables.length} defined`,
      },
    ];
  }
  if (root === "input" && first === undefined) return scope.inputs.map(portCompletion("input"));
  if (root === "variables" && first === undefined)
    return scope.variables.map((v) => ({ label: v.name, type: v.type, kind: "variable" as const }));
  if (root === "nodes") {
    if (first === undefined)
      return scope.nodes.map((n) => ({
        label: n.id,
        detail: n.name,
        type: `${n.outputs.length} ${n.outputs.length === 1 ? "output" : "outputs"}`,
        kind: "node" as const,
      }));
    const node = scope.nodes.find((n) => n.id === first);
    if (!node) return [];
    if (second === undefined)
      return [
        { label: "output", kind: "member", type: "object", detail: "Node outputs" },
        { label: "status", kind: "member", type: "string", detail: "completed, failed, skipped" },
        { label: "durationMs", kind: "member", type: "number", detail: "Wall time" },
        { label: "attempt", kind: "member", type: "integer", detail: "Retry attempt" },
      ];
    if (second === "output") return node.outputs.map(portCompletion("output"));
  }
  return [];
}

function portCompletion(kind: "input" | "output") {
  return (p: PortView): ScopeCompletion => ({
    label: p.id,
    type: p.type,
    detail: p.description ?? (p.label !== p.id ? p.label : undefined),
    kind,
  });
}

/** Wraps a dotted path as a template reference: `input.message` → `{{ input.message }}`. */
export function referenceTemplate(path: string): string {
  return `{{ ${path} }}`;
}

/** Flat list of every referenceable path in a scope, for pickers and tests. */
export function scopePaths(
  scope: ExpressionScope,
): Array<{ path: string; type: string; label: string }> {
  const out: Array<{ path: string; type: string; label: string }> = [];
  for (const p of scope.inputs) out.push({ path: `input.${p.id}`, type: p.type, label: p.label });
  for (const v of scope.variables)
    out.push({ path: `variables.${v.name}`, type: v.type, label: v.name });
  for (const n of scope.nodes)
    for (const p of n.outputs)
      out.push({
        path: `nodes.${n.id}.output.${p.id}`,
        type: p.type,
        label: `${n.name} · ${p.label}`,
      });
  return out;
}
