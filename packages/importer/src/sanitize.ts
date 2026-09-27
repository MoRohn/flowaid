/**
 * Sanitising (ARCHITECTURE.md §10.9): credential ids, password-like inputs and auth headers
 * never cross into a FlowAId definition. Values are removed, not masked, and every removal is
 * counted so the report can ask for a secret binding instead.
 */
import type { SourceNode } from "./types.js";

const SENSITIVE_KEY =
  /(credential|password|passwd|secret|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|bearer|private[-_]?key|client[-_]?secret)/i;
const AUTH_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key|cookie)$/i;

export interface Sanitized<T> {
  value: T;
  /** dotted paths of removed values */
  removed: string[];
}

function sanitizeValue(value: unknown, path: string, removed: string[]): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    value.forEach((item, i) => {
      // header rows: { key: "Authorization", value: "Bearer …" }
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).key === "string" &&
        AUTH_HEADER.test((item as Record<string, unknown>).key as string)
      ) {
        removed.push(`${path}[${i}]`);
        return;
      }
      out.push(sanitizeValue(item, `${path}[${i}]`, removed));
    });
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (
        (SENSITIVE_KEY.test(k) || AUTH_HEADER.test(k)) &&
        v !== "" &&
        v !== null &&
        v !== undefined
      ) {
        removed.push(p);
        continue;
      }
      out[k] = sanitizeValue(v, p, removed);
    }
    return out;
  }
  return value;
}

/** A copy of the node's inputs without secrets, and the paths that were removed. */
export function sanitizeInputs(node: SourceNode): Sanitized<Record<string, unknown>> {
  const removed: string[] = [];
  const value = sanitizeValue(node.data.inputs ?? {}, "", removed) as Record<string, unknown>;
  return { value, removed };
}
