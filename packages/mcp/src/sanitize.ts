/**
 * Sanitising what an MCP server tells us about itself: names become valid tool names, descriptions
 * are capped at 1 KiB with control characters stripped, and prompt-injection phrasing is flagged
 * (`W_MCP_TOOL_SUSPICIOUS`) so a person reviews the tool before it reaches a model.
 */

export const MAX_DESCRIPTION_BYTES = 1024;

/** A valid flowaid tool name (`^[A-Za-z0-9_-]{1,64}$`) derived from an MCP tool name. */
export function sanitizeToolName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "tool").slice(0, 64);
}

/** Truncates to `max` UTF-8 bytes without splitting a code point. */
export function truncateUtf8(text: string, max: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= max) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const n = encoder.encode(ch).byteLength;
    if (bytes + n > max - 3) break;
    out += ch;
    bytes += n;
  }
  return `${out}…`;
}

/** Strips control characters (keeping newlines and tabs), collapses blank runs and caps at 1 KiB. */
export function sanitizeToolDescription(description: string | undefined): string {
  if (!description) return "";
  const cleaned = description
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncateUtf8(cleaned, MAX_DESCRIPTION_BYTES);
}

const SUSPICIOUS: readonly { re: RegExp; reason: string }[] = [
  {
    re: /\b(?:ignore|disregard|forget)\b.{0,40}\b(?:previous|prior|above|earlier|all)\b.{0,20}\b(?:instructions?|prompts?|rules)\b/i,
    reason: "asks the model to ignore its instructions",
  },
  {
    re: /<\/?(?:system|assistant|important|instructions?)>|\[\/?INST\]|<\|im_(?:start|end)\|>/i,
    reason: "contains chat-role markup",
  },
  {
    re: /\b(?:do not|don't|never)\s+(?:tell|mention|reveal|inform)\b.{0,30}\b(?:user|human)\b/i,
    reason: "asks the model to hide something from the user",
  },
  {
    re: /\b(?:before|after|instead of)\s+(?:using|calling)\s+(?:this|any)\s+tool\b.{0,60}\b(?:call|send|read|upload|email)\b/i,
    reason: "chains another action onto the tool call",
  },
  {
    re: /(?:~\/\.ssh|id_rsa|\.env\b|\bapi[_ -]?keys?|\bpasswords?|\bcredentials?)\b.{0,40}\b(?:send|include|pass|read|upload|exfiltrat)/i,
    reason: "asks for secrets",
  },
  {
    re: /\b(?:send|include|pass|read|upload)\b.{0,40}(?:~\/\.ssh|id_rsa|\.env\b|\bapi[_ -]?keys?|\bpasswords?|\bcredentials?)/i,
    reason: "asks for secrets",
  },
];

/** Reasons a tool's name or description looks like a prompt-injection attempt (empty when clean). */
export function suspiciousReasons(...texts: (string | undefined)[]): string[] {
  const reasons = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const { re, reason } of SUSPICIOUS) if (re.test(text)) reasons.add(reason);
    if (/[​-‏‪-‮⁦-⁩]/.test(text))
      reasons.add("contains invisible or bidirectional control characters");
  }
  return [...reasons];
}
