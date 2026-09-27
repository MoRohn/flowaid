/** API-only value schemas (API.md §7). */
import { z } from "zod";
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

export const NoContent = z.null().describe("No content");
