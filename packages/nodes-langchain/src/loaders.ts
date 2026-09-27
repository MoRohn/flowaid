/**
 * Document loading for `langchain.document_loader`: text, Markdown, JSON, JSON Lines, CSV and HTML
 * from an input string, and web pages, sitemaps and GitHub repositories over the node's SafeFetch
 * (SSRF-guarded, byte-capped). Produces LangChain `Document`s with provenance metadata.
 */
import { Document } from "@langchain/core/documents";
import { NetworkError, type JsonValue, type SafeFetch } from "@flowaid/workflow-core";

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
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Readable text of an HTML page: scripts/styles/nav dropped, block elements become line breaks. */
export function htmlToText(html: string): { title: string | undefined; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|script|style|noscript|svg|nav|footer|header|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|pre|blockquote)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
  return { title: title ? decodeEntities(title).trim() : undefined, text };
}

/** RFC 4180 CSV (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ""));
}

function pointer(value: unknown, path: string): unknown {
  if (!path || path === "/") return value;
  let cur: unknown = value;
  for (const raw of path.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    cur =
      typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>)[key] : undefined;
  }
  return cur;
}

const textOfValue = (v: unknown, field: string | undefined): string => {
  const picked = field ? pointer(v, field.startsWith("/") ? field : `/${field}`) : v;
  return typeof picked === "string" ? picked : JSON.stringify(picked);
};

export interface InlineOptions {
  source: string;
  jsonPointer?: string;
  textField?: string;
  csvDelimiter?: string;
  metadata: Record<string, JsonValue>;
}

/** Documents from inline content. */
export function loadInline(
  kind: "text" | "markdown" | "json" | "jsonl" | "csv" | "html",
  content: string,
  o: InlineOptions,
): Document[] {
  const meta = (extra: Record<string, JsonValue>) => ({
    source: o.source,
    loader: kind,
    ...o.metadata,
    ...extra,
  });
  if (content.trim() === "") return [];
  switch (kind) {
    case "text":
    case "markdown":
      return [new Document({ pageContent: content, metadata: meta({}) })];
    case "html": {
      const { title, text } = htmlToText(content);
      return [new Document({ pageContent: text, metadata: meta(title ? { title } : {}) })];
    }
    case "json": {
      const parsed = pointer(JSON.parse(content) as unknown, o.jsonPointer ?? "");
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.map(
        (item, i) =>
          new Document({
            pageContent: textOfValue(item, o.textField),
            metadata: meta({ index: i }),
          }),
      );
    }
    case "jsonl":
      return content
        .split(/\r?\n/)
        .map((line, i) => ({ line, number: i + 1 }))
        .filter(({ line }) => line.trim() !== "")
        .map(
          ({ line, number }) =>
            new Document({
              pageContent: textOfValue(JSON.parse(line) as unknown, o.textField),
              metadata: meta({ line: number }),
            }),
        );
    case "csv": {
      const [header, ...rows] = parseCsv(content, o.csvDelimiter ?? ",");
      if (!header) return [];
      return rows.map((cells, i) => {
        const record = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""]));
        const pageContent = o.textField
          ? (record[o.textField] ?? "")
          : header.map((h) => `${h}: ${record[h] ?? ""}`).join("\n");
        return new Document({ pageContent, metadata: meta({ row: i + 1 }) });
      });
    }
  }
}

async function fetchText(
  http: SafeFetch,
  url: string,
  maxBytes: number,
  headers: Record<string, string> = {},
): Promise<{ text: string; contentType: string }> {
  const res = await http(url, {
    headers: { accept: "text/html,text/plain,application/xml,*/*;q=0.5", ...headers },
    maxBytes,
  });
  if (!res.ok) throw new NetworkError(`GET ${url} answered ${res.status}`);
  return { text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
}

export async function loadUrls(
  http: SafeFetch,
  urls: readonly string[],
  o: { maxBytes: number; metadata: Record<string, JsonValue> },
): Promise<Document[]> {
  const docs: Document[] = [];
  for (const url of urls) {
    const { text, contentType } = await fetchText(http, url, o.maxBytes);
    if (/html/i.test(contentType) || /^\s*</.test(text)) {
      const page = htmlToText(text);
      docs.push(
        new Document({
          pageContent: page.text,
          metadata: {
            source: url,
            loader: "url",
            ...(page.title ? { title: page.title } : {}),
            ...o.metadata,
          },
        }),
      );
    } else
      docs.push(
        new Document({
          pageContent: text,
          metadata: { source: url, loader: "url", ...o.metadata },
        }),
      );
  }
  return docs;
}

/** Pages listed in a sitemap (nested sitemap indexes followed once), filtered by a URL prefix. */
export async function loadSitemap(
  http: SafeFetch,
  sitemapUrl: string,
  o: { maxPages: number; maxBytes: number; include?: string; metadata: Record<string, JsonValue> },
): Promise<Document[]> {
  const locs = async (url: string) =>
    [
      ...(await fetchText(http, url, o.maxBytes)).text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi),
    ].map((m) => decodeEntities(m[1] ?? ""));
  let pages = await locs(sitemapUrl);
  const nested = pages.filter((u) => /\.xml(\?|$)/i.test(u));
  if (nested.length) {
    pages = pages.filter((u) => !nested.includes(u));
    for (const n of nested.slice(0, 10)) pages.push(...(await locs(n)));
  }
  const selected = pages.filter((u) => !o.include || u.startsWith(o.include)).slice(0, o.maxPages);
  return loadUrls(http, selected, {
    maxBytes: o.maxBytes,
    metadata: { sitemap: sitemapUrl, ...o.metadata },
  });
}

/** Text files of a GitHub repository (git trees API), filtered by path prefix and extension. */
export async function loadGitHub(
  http: SafeFetch,
  o: {
    repo: string;
    ref: string;
    path: string;
    extensions: readonly string[];
    maxFiles: number;
    maxBytes: number;
    token?: string;
    apiBase?: string;
    metadata: Record<string, JsonValue>;
  },
): Promise<Document[]> {
  const api = o.apiBase ?? "https://api.github.com";
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
  };
  const res = await http(
    `${api}/repos/${o.repo}/git/trees/${encodeURIComponent(o.ref)}?recursive=1`,
    {
      headers,
      maxBytes: 20 * 1024 * 1024,
    },
  );
  if (!res.ok) throw new NetworkError(`GitHub tree of ${o.repo}@${o.ref} answered ${res.status}`);
  const tree = (await res.json()) as { tree?: { path: string; type: string; size?: number }[] };
  const prefix = o.path.replace(/^\/+/, "");
  const files = (tree.tree ?? [])
    .filter(
      (f) =>
        f.type === "blob" &&
        f.path.startsWith(prefix) &&
        (o.extensions.length === 0 || o.extensions.some((ext) => f.path.endsWith(ext))) &&
        (f.size ?? 0) <= o.maxBytes,
    )
    .slice(0, o.maxFiles);
  const docs: Document[] = [];
  for (const f of files) {
    const url = `${api}/repos/${o.repo}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(o.ref)}`;
    const { text } = await fetchText(http, url, o.maxBytes, {
      ...headers,
      accept: "application/vnd.github.raw+json",
    });
    docs.push(
      new Document({
        pageContent: text,
        metadata: {
          source: `github:${o.repo}/${f.path}@${o.ref}`,
          loader: "github",
          path: f.path,
          ...o.metadata,
        },
      }),
    );
  }
  return docs;
}
