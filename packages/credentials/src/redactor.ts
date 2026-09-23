/**
 * The Redactor (ARCHITECTURE.md §10.6) runs before anything is persisted: run events, node run
 * input and output, human task requests, error messages and logs.
 *
 * - Learned secrets: every decrypted credential value and secret-valued environment variable is
 *   learned, with its base64, base64url and URL-encoded forms; any occurrence in text or JSON is
 *   replaced by `[REDACTED]`. Values shorter than 4 characters are not learned (they would
 *   redact ordinary text).
 * - Pointer rules (`PlanNode.redact`): `pii` masked, `sensitive` hashed (`sha256:<16 hex>`),
 *   `drop` replaced by `{ "$redacted": true }`. Pointers are rooted at `/in` or `/out`; a `*`
 *   token matches every array item or object member.
 */
import { createHash } from "node:crypto";
import type { JsonValue, RedactionRule } from "@flowaid/workflow-core";

export const REDACTED = "[REDACTED]";
export const DROPPED: JsonValue = { $redacted: true };
const MIN_SECRET_LENGTH = 4;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The forms a secret can appear in: raw, base64 (padded and not), base64url and URL-encoded. */
export function secretVariants(secret: string): string[] {
  const base64 = Buffer.from(secret, "utf8").toString("base64");
  const variants = new Set([
    secret,
    base64,
    base64.replace(/=+$/, ""),
    Buffer.from(secret, "utf8").toString("base64url"),
    encodeURIComponent(secret),
  ]);
  return [...variants].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

export function hashValue(value: JsonValue): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

export class Redactor {
  private readonly secrets = new Set<string>();
  private pattern: RegExp | null = null;

  /** Learns secret values (credential fields, secret env values). */
  learn(values: Iterable<string>): this {
    let changed = false;
    for (const value of values) {
      if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) continue;
      for (const variant of secretVariants(value)) {
        if (!this.secrets.has(variant)) {
          this.secrets.add(variant);
          changed = true;
        }
      }
    }
    if (changed) {
      // Longest first, so a secret that contains another is replaced whole.
      const alternatives = [...this.secrets].sort((a, b) => b.length - a.length).map(escapeRegExp);
      this.pattern = new RegExp(alternatives.join("|"), "g");
    }
    return this;
  }

  get size(): number {
    return this.secrets.size;
  }

  redactText(text: string): string {
    return this.pattern ? text.replace(this.pattern, REDACTED) : text;
  }

  /** Redacts learned secrets in every string of a JSON value (keys included). */
  redactJson(value: JsonValue): JsonValue {
    if (!this.pattern) return value;
    if (typeof value === "string") return this.redactText(value);
    if (Array.isArray(value)) return value.map((v) => this.redactJson(v));
    if (value !== null && typeof value === "object") {
      const out: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(value))
        out[this.redactText(key)] = this.redactJson(item);
      return out;
    }
    return value;
  }

  /**
   * Applies pointer rules to a node run's `{ in, out }` record (either side may be absent), then
   * scrubs learned secrets from what remains.
   */
  apply(
    record: { in?: JsonValue; out?: JsonValue },
    rules: readonly RedactionRule[],
  ): { in?: JsonValue; out?: JsonValue } {
    let root: JsonValue = JSON.parse(JSON.stringify(record)) as JsonValue;
    for (const rule of rules) root = applyRule(root, rule);
    return this.redactJson(root) as { in?: JsonValue; out?: JsonValue };
  }
}

function replacement(rule: RedactionRule, value: JsonValue): JsonValue {
  switch (rule.mode) {
    case "mask":
      return REDACTED;
    case "hash":
      return hashValue(value);
    case "drop":
      return DROPPED;
  }
}

/** Applies one rule; `*` fans out over arrays and objects. Missing paths are left alone. */
export function applyRule(root: JsonValue, rule: RedactionRule): JsonValue {
  const tokens = rule.pointer.split("/").slice(1).map(unescapeToken);
  const visit = (node: JsonValue, depth: number): JsonValue => {
    if (depth === tokens.length) return replacement(rule, node);
    const token = tokens[depth] ?? "";
    if (Array.isArray(node)) {
      if (token === "*") return node.map((item) => visit(item, depth + 1));
      const index = Number(token);
      if (!/^(0|[1-9][0-9]*)$/.test(token) || index >= node.length) return node;
      return node.map((item, i) => (i === index ? visit(item, depth + 1) : item));
    }
    if (node !== null && typeof node === "object") {
      if (token === "*")
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v, depth + 1)]));
      if (!Object.hasOwn(node, token)) return node;
      return { ...node, [token]: visit(node[token] as JsonValue, depth + 1) };
    }
    return node;
  };
  return visit(root, 0);
}
