/**
 * Loaders (ARCHITECTURE.md §10.8): turn a source's configuration into normalised documents. Every
 * request goes through the caller's SSRF-guarded fetch; nothing here opens a socket itself.
 *
 * - `url`: one page (HTML → markdown, text and markdown as-is);
 * - `sitemap`: the pages a sitemap lists (nested sitemap indexes followed once), filtered by
 *   path prefix, capped by `maxPages`;
 * - `github`: the files of a repository (or a sub-path) with the listed extensions, read through
 *   the GitHub REST API (a token raises the rate limit and reaches private repositories);
 * - `text`: inline documents (uploads and API calls).
 */
import {
  BadRequestError,
  NetworkError,
  type JsonObject,
  type SafeFetch,
} from "@flowaid/workflow-core";
import { decodeEntities, htmlTitle, normalize } from "./normalize.js";

export interface LoadedDocument {
  externalId: string;
  title?: string;
  uri?: string;
  mimeType: string;
  /** normalised text */
  text: string;
  metadata: JsonObject;
}

export interface LoadOptions {
  signal?: AbortSignal;
  /** per-document byte cap (default 5 MiB) */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

async function fetchText(
  fetch: SafeFetch,
  url: string,
  o: LoadOptions & { headers?: Record<string, string> },
): Promise<{ text: string; type: string }> {
  const res = await fetch(url, {
    ...(o.signal ? { signal: o.signal } : {}),
    maxBytes: o.maxBytes ?? DEFAULT_MAX_BYTES,
    headers: {
      accept: "text/html,text/markdown,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5",
      ...o.headers,
    },
  });
  if (!res.ok)
    throw new NetworkError(
      `GET ${url} answered ${res.status}`,
      res.status >= 500 || res.status === 429,
    );
  return { text: await res.text(), type: res.headers.get("content-type") ?? "text/plain" };
}

function mimeOf(type: string, url: string): string {
  const t = type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (t && t !== "application/octet-stream" && t !== "text/plain") return t;
  if (/\.(md|markdown|mdx)$/i.test(url)) return "text/markdown";
  if (/\.html?$/i.test(url)) return "text/html";
  if (/\.json$/i.test(url)) return "application/json";
  return t || "text/plain";
}

/** One page. */
export async function loadUrl(
  fetch: SafeFetch,
  url: string,
  o: LoadOptions = {},
): Promise<LoadedDocument> {
  const { text, type } = await fetchText(fetch, url, o);
  const mimeType = mimeOf(type, url);
  const title = mimeType === "text/html" ? htmlTitle(text) : undefined;
  return {
    externalId: url,
    uri: url,
    mimeType,
    text: normalize(text, mimeType),
    metadata: { source: url },
    ...(title ? { title } : {}),
  };
}

/** `<loc>` entries of a sitemap or sitemap index. */
export function sitemapLocations(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = (tag: string) =>
    [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].flatMap((m) => {
      const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(m[1] ?? "")?.[1];
      return loc ? [decodeEntities(loc.trim())] : [];
    });
  return { pages: locs("url"), sitemaps: locs("sitemap") };
}

export interface SitemapOptions extends LoadOptions {
  /** only pages whose path starts with one of these */
  include?: string[];
  maxPages?: number;
}

/** The pages a sitemap lists. Failed pages are skipped and reported in `errors`. */
export async function loadSitemap(
  fetch: SafeFetch,
  url: string,
  o: SitemapOptions = {},
): Promise<{ documents: LoadedDocument[]; errors: { url: string; message: string }[] }> {
  const max = o.maxPages ?? 200;
  const root = sitemapLocations((await fetchText(fetch, url, o)).text);
  const pages = [...root.pages];
  for (const nested of root.sitemaps.slice(0, 20)) {
    if (pages.length >= max * 2) break;
    pages.push(...sitemapLocations((await fetchText(fetch, nested, o)).text).pages);
  }
  const wanted = [...new Set(pages)]
    .filter(
      (p) =>
        !o.include?.length || o.include.some((prefix) => new URL(p).pathname.startsWith(prefix)),
    )
    .slice(0, max);
  const documents: LoadedDocument[] = [];
  const errors: { url: string; message: string }[] = [];
  for (const page of wanted) {
    if (o.signal?.aborted) break;
    try {
      documents.push(await loadUrl(fetch, page, o));
    } catch (error) {
      errors.push({ url: page, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { documents, errors };
}

export interface GithubOptions extends LoadOptions {
  /** `owner/name` */
  repo: string;
  ref?: string;
  /** only files under this directory */
  path?: string;
  extensions?: string[];
  token?: string;
  maxFiles?: number;
  /** API base (GitHub Enterprise) */
  apiUrl?: string;
}

const DEFAULT_EXTENSIONS = [".md", ".mdx", ".markdown", ".txt", ".rst"];

/** The files of a repository through the GitHub REST API (one tree call, then the blobs). */
export async function loadGithub(fetch: SafeFetch, o: GithubOptions): Promise<LoadedDocument[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo))
    throw new BadRequestError(`repo must be owner/name, got ${o.repo}`);
  const api = (o.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
  };
  const get = async (url: string) => {
    const r = await fetch(url, {
      headers,
      ...(o.signal ? { signal: o.signal } : {}),
      maxBytes: o.maxBytes ?? DEFAULT_MAX_BYTES,
    });
    if (!r.ok)
      throw new NetworkError(
        `GitHub ${url} answered ${r.status}`,
        r.status >= 500 || r.status === 429,
      );
    return r;
  };
  let ref = o.ref;
  if (!ref)
    ref = ((await (await get(`${api}/repos/${o.repo}`)).json()) as { default_branch: string })
      .default_branch;
  const tree = (await (
    await get(`${api}/repos/${o.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
  ).json()) as {
    tree: { path: string; type: string; size?: number }[];
  };
  const exts = (o.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase());
  const prefix = o.path ? `${o.path.replace(/^\/|\/$/g, "")}/` : "";
  const files = tree.tree
    .filter(
      (t) =>
        t.type === "blob" &&
        t.path.startsWith(prefix) &&
        exts.some((e) => t.path.toLowerCase().endsWith(e)),
    )
    .slice(0, o.maxFiles ?? 500);
  const out: LoadedDocument[] = [];
  for (const f of files) {
    if (o.signal?.aborted) break;
    const r = await get(
      `${api}/repos/${o.repo}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    const body = (await r.json()) as { content?: string; encoding?: string; html_url?: string };
    const raw =
      body.encoding === "base64" && body.content ? fromBase64(body.content) : (body.content ?? "");
    const mimeType = mimeOf("", f.path);
    out.push({
      externalId: `${o.repo}:${f.path}`,
      title: f.path,
      uri: body.html_url ?? `https://github.com/${o.repo}/blob/${ref}/${f.path}`,
      mimeType,
      text: normalize(raw, mimeType),
      metadata: { source: `github:${o.repo}`, path: f.path, ref },
    });
  }
  return out;
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Inline documents (uploads, the API). */
export function loadText(doc: {
  externalId: string;
  text: string;
  title?: string;
  uri?: string;
  mimeType?: string;
  metadata?: JsonObject;
}): LoadedDocument {
  const mimeType = doc.mimeType ?? "text/plain";
  const title = doc.title ?? (mimeType === "text/html" ? htmlTitle(doc.text) : undefined);
  return {
    externalId: doc.externalId,
    mimeType,
    text: normalize(doc.text, mimeType),
    metadata: doc.metadata ?? {},
    ...(title ? { title } : {}),
    ...(doc.uri ? { uri: doc.uri } : {}),
  };
}
