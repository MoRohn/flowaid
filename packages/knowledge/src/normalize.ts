/**
 * Normalisation (ARCHITECTURE.md §10.8): every loaded document becomes markdown-ish plain text
 * before chunking. HTML is reduced to its readable content (scripts, styles, navigation and
 * comments dropped; headings, lists, paragraphs and links kept as markdown); JSON is
 * pretty-printed; everything else is taken as text. Binary formats (PDF, DOCX) are not parsed
 * here: they arrive as text from the caller (an upload converted client side, or a loader node).
 */
import { sha256Hex } from "@flowaid/shared";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#x") || e.startsWith("#X"))
      return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The page title of an HTML document, if any. */
export function htmlTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = m?.[1] ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  return t || undefined;
}

/** Readable markdown from HTML: the main content when marked up, else the body. */
export function htmlToMarkdown(html: string): string {
  let s = html;
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(s);
  if (main?.[2]) s = main[2];
  else {
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(s);
    if (body?.[1]) s = body[1];
  }
  s = s
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<title\b[\s\S]*?<\/title>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|noscript|svg|nav|header|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t}\n\n`,
    )
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => {
      const text = t.replace(/<[^>]+>/g, "").trim();
      return href && !href.startsWith("#") && !href.startsWith("javascript:") && text
        ? `[${text}](${href})`
        : text;
    })
    .replace(/<(pre|code)\b[^>]*>/gi, "`")
    .replace(/<\/(pre|code)>/gi, "`")
    .replace(/<\/(p|div|section|table|tr|ul|ol|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(s));
}

/** Collapses runs of spaces and blank lines; trims every line. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalised text for a document of the given media type (HTML, JSON, anything else as text). */
export function normalize(content: string, mimeType = "text/plain"): string {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "text/plain";
  if (type === "text/html" || type === "application/xhtml+xml") return htmlToMarkdown(content);
  if (type === "application/json" || type.endsWith("+json")) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return tidy(content);
    }
  }
  return tidy(content);
}

/** The document's content hash: re-ingesting unchanged content is a no-op. */
export function contentHash(text: string): string {
  return sha256Hex(text);
}
