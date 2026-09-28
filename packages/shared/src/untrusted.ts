/**
 * Untrusted content (tool results, retrieved passages, caller-supplied context) on its way into
 * a model prompt. Two jobs: keep it bounded (a byte cap and an approximate token cap, with a note
 * saying what was cut) and keep it recognisable as data — wrapped in labelled delimiters that
 * the content itself cannot forge, because any delimiter lookalike inside it is broken up first.
 *
 * Token counts are approximate: about four characters per token, the same estimate the rest of
 * the platform budgets with. Browser-safe (TextEncoder/TextDecoder only).
 */

const OPEN_PREFIX = "<<<UNTRUSTED";
export const UNTRUSTED_CLOSE = "<<<END UNTRUSTED>>>";

/** Approximate tokens in `text`: about four characters per token. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/** Breaks up runs of three or more angle brackets so content cannot open or close a block. */
export function escapeDelimiters(text: string): string {
  return text.replace(/<{3,}|>{3,}/g, (run) => run.split("").join(" "));
}

/** The opening delimiter for `label` (quotes, angle brackets and line breaks removed). */
export function untrustedOpen(label: string): string {
  const clean = label.replace(/["<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${OPEN_PREFIX} label="${clean}">>>`;
}

export interface CapLimits {
  /** UTF-8 bytes the result may take. */
  maxBytes?: number;
  /** Approximate tokens (four characters each) the result may take. */
  maxTokens?: number;
}

/**
 * `text` cut to fit `limits`, the cut marked by a trailing `[truncated: showing X of Y bytes]`
 * note that itself fits inside the limits. Cuts land on character boundaries.
 */
export function capText(text: string, limits: CapLimits): { text: string; truncated: boolean } {
  const maxChars = limits.maxTokens === undefined ? Infinity : limits.maxTokens * 4;
  const maxBytes = limits.maxBytes ?? Infinity;
  if (text.length <= maxChars && (maxBytes === Infinity || utf8Length(text) <= maxBytes))
    return { text, truncated: false };
  const total = utf8Length(text);
  // the note is ASCII, so its length in characters and bytes is the same; size it for the widest X
  const noteFor = (shown: number) => `\n[truncated: showing ${shown} of ${total} bytes]`;
  const reserve = noteFor(total).length;
  let head = text.slice(0, Math.max(0, Math.min(text.length, maxChars - reserve)));
  // never leave half a surrogate pair behind
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  if (maxBytes !== Infinity) {
    const bytes = encoder.encode(head);
    const byteBudget = Math.max(0, maxBytes - reserve);
    if (bytes.length > byteBudget) head = decoder.decode(bytes.subarray(0, byteBudget));
    head = head.replace(/�$/, "");
  }
  return { text: `${head}${noteFor(utf8Length(head))}`, truncated: true };
}

export interface UntrustedOptions extends CapLimits {
  /** What the content is, e.g. `tool result: search_docs` or `retrieved passages`. */
  label: string;
}

/**
 * `content` escaped, capped and wrapped in labelled delimiters. The caps cover the whole block,
 * delimiters included, so the result never exceeds them.
 */
export function wrapUntrusted(content: string, opts: UntrustedOptions): string {
  const open = untrustedOpen(opts.label);
  const overhead = open.length + UNTRUSTED_CLOSE.length + 2;
  const limits: CapLimits = {};
  if (opts.maxBytes !== undefined) limits.maxBytes = Math.max(0, opts.maxBytes - overhead);
  if (opts.maxTokens !== undefined)
    // tokens are whole four-character units: floor keeps ceil(length / 4) within the cap
    limits.maxTokens = Math.max(0, Math.floor((opts.maxTokens * 4 - overhead) / 4));
  const body = capText(escapeDelimiters(content), limits).text;
  return `${open}\n${body}\n${UNTRUSTED_CLOSE}`;
}
