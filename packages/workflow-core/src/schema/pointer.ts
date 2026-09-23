/**
 * RFC 6901 JSON Pointer utilities shared by the compact reference grammar
 * (`parseRef` / `formatRef`), the schema projector and the runtime projector.
 *
 * A pointer is either the empty string (the whole document) or a sequence of
 * `/`-prefixed reference tokens in which `~` is written `~0` and `/` is
 * written `~1`.
 */

/** Result of {@link parsePointer}. */
export type ParsePointerResult = { ok: true; tokens: string[] } | { ok: false; message: string };

/** Escapes one reference token (`~` → `~0`, `/` → `~1`), in that order as RFC 6901 requires. */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Unescapes one reference token (`~1` → `/`, then `~0` → `~`), in that order as RFC 6901 requires. */
export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Is `pointer` syntactically a JSON Pointer (empty or `/`-led with only `~0`/`~1` escapes)? */
export function isJsonPointer(pointer: string): boolean {
  return /^(\/([^/~]|~0|~1)*)*$/.test(pointer);
}

/**
 * Splits a JSON Pointer into its unescaped reference tokens.
 *
 * `""` yields no tokens; `"/a/b~1c/0"` yields `["a", "b/c", "0"]`. A pointer
 * that does not start with `/` or contains a bare `~` is rejected.
 */
export function parsePointer(pointer: string): ParsePointerResult {
  if (pointer === "") return { ok: true, tokens: [] };
  if (!pointer.startsWith("/"))
    return { ok: false, message: `JSON pointer must start with '/' (got '${pointer}')` };
  if (!isJsonPointer(pointer))
    return { ok: false, message: `invalid escape sequence in JSON pointer '${pointer}'` };
  return { ok: true, tokens: pointer.slice(1).split("/").map(unescapePointerToken) };
}

/** Joins unescaped reference tokens into a JSON Pointer (the inverse of {@link parsePointer}). */
export function formatPointer(tokens: readonly string[]): string {
  return tokens.map((token) => "/" + escapePointerToken(token)).join("");
}

/** Appends one unescaped reference token to a JSON Pointer. */
export function appendPointerToken(pointer: string, token: string): string {
  return pointer + "/" + escapePointerToken(token);
}

/**
 * Is `token` a canonical array index (`0`, `1`, … without leading zeros)?
 * RFC 6901 only allows canonical decimal indexes into arrays.
 */
export function isArrayIndexToken(token: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(token);
}
