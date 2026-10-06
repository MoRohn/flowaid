/** API-only value schemas (API.md §7). */
import { z } from "zod";
import { and, eq, gt, lt, or, type AnyColumn, type SQL } from "drizzle-orm";
import { FEATURE_KEYS } from "@flowaid/env";

export const SlugSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/,
    "lower-case letters, digits and dashes, 3–40 characters",
  );
export const FeatureKeySchema = z.enum(FEATURE_KEYS);
export type FeatureKey = z.infer<typeof FeatureKeySchema>;

export const RoleSchema = z.enum(["owner", "admin", "editor", "operator", "viewer"]);
export const IdParams = z.object({ id: z.uuid() });

/**
 * A boolean query flag. "true"/"1" and "false"/"0" are read as written; `z.coerce.boolean` would
 * read `?purge=false` as true because every non-empty string is truthy. Documented as a boolean.
 */
export const queryBool = (fallback = false) =>
  z.preprocess(
    (v) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : v),
    z.boolean().default(fallback),
  );

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    details: z.unknown().optional(),
    request_id: z.string(),
    run_id: z.string().optional(),
    node_id: z.string().optional(),
    node_run_id: z.string().optional(),
  }),
});

/** Keyset pagination (API.md §2). */
export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() });

export function encodeCursor(sortValue: string | number, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString("base64url");
}
export function decodeCursor(cursor: string | undefined): [string | number, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      (typeof v[0] === "string" || typeof v[0] === "number") &&
      typeof v[1] === "string"
    )
      return [v[0], v[1]];
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Keyset pagination for a collection in one fixed `(sort, id)` order (a name, or a creation time),
 * which is why it takes no `order`.
 */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});

/**
 * The rows after `cursor` in `(sort, id)` order, or undefined on the first page (or for a cursor
 * that does not decode). `parse` turns the cursor's sort value back into the column's type.
 */
export function afterCursor(
  sort: AnyColumn,
  id: AnyColumn,
  cursor: string | undefined,
  dir: "asc" | "desc" = "asc",
  parse: (v: string | number) => unknown = (v) => v,
): SQL | undefined {
  const c = decodeCursor(cursor);
  if (!c) return undefined;
  const value = parse(c[0]);
  const past = dir === "asc" ? gt : lt;
  return or(past(sort, value), and(eq(sort, value), past(id, c[1])));
}

/** `{ items, next_cursor }` from rows fetched with `.limit(limit + 1)`. */
export function toPage<R, T>(
  rows: readonly R[],
  limit: number,
  key: (row: R) => [string | number, string],
  map: (row: R) => T,
): { items: T[]; next_cursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    next_cursor: rows.length > limit && last ? encodeCursor(...key(last)) : null,
  };
}

export const NoContent = z.null().describe("No content");
