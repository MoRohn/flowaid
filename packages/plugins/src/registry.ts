/**
 * The npm registry, as far as plugins need it: packuments (`GET /<name>`), search
 * (`GET /-/v1/search?text=keywords:flowaid-node <q>`) and tarball downloads verified against the
 * published integrity. Works with any npm-compatible registry (`FLOWAID_PLUGIN_REGISTRY`).
 */
export const DISCOVERY_KEYWORD = "flowaid-node";

export type FetchLike = (
  url: string,
  init?: RequestInit & { maxBytes?: number },
) => Promise<Response>;

export interface PackumentVersion {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  flowaid?: { package?: string; sdk?: string; manifest?: string };
  deprecated?: string;
  dist: { tarball: string; integrity?: string; shasum?: string };
}

export interface Packument {
  name: string;
  description?: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, PackumentVersion>;
  time?: Record<string, string>;
}

export interface SearchResult {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  publisher: string | null;
  date: string | null;
  links: { npm?: string; repository?: string; homepage?: string };
  score: number;
}

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export interface RegistryClientOptions {
  registry: string;
  fetch?: FetchLike;
  /** tarball download cap */
  maxTarballBytes?: number;
}

export class RegistryClient {
  readonly registry: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxTarballBytes: number;

  constructor(o: RegistryClientOptions) {
    this.registry = o.registry.replace(/\/+$/, "");
    this.fetchImpl = o.fetch ?? ((url, init) => fetch(url, init));
    this.maxTarballBytes = o.maxTarballBytes ?? 32 * 1024 * 1024;
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.registry}${path}`, {
      headers: { accept: "application/json" },
      maxBytes: 16 * 1024 * 1024,
    });
    if (res.status === 404) throw new RegistryError(`not found in ${this.registry}: ${path}`, 404);
    if (!res.ok) throw new RegistryError(`registry answered ${res.status} for ${path}`, res.status);
    return (await res.json()) as T;
  }

  /** The package document; 404 → RegistryError(status 404). */
  packument(name: string): Promise<Packument> {
    // scoped names keep their @ and encode the slash (`@acme%2fnodes-crm`), as npm does
    return this.json<Packument>(`/${name.replace("/", "%2f")}`);
  }

  /** Packages that declare the `flowaid-node` keyword, best matches first. */
  async search(text: string, size = 20): Promise<SearchResult[]> {
    const q = encodeURIComponent(`keywords:${DISCOVERY_KEYWORD} ${text}`.trim());
    const body = await this.json<{
      objects: {
        package: {
          name: string;
          version: string;
          description?: string;
          keywords?: string[];
          date?: string;
          publisher?: { username?: string };
          links?: SearchResult["links"];
        };
        score?: { final?: number };
      }[];
    }>(`/-/v1/search?text=${q}&size=${Math.max(1, Math.min(250, size))}`);
    return body.objects
      .filter((o) => (o.package.keywords ?? []).includes(DISCOVERY_KEYWORD))
      .map((o) => ({
        name: o.package.name,
        version: o.package.version,
        description: o.package.description ?? "",
        keywords: o.package.keywords ?? [],
        publisher: o.package.publisher?.username ?? null,
        date: o.package.date ?? null,
        links: o.package.links ?? {},
        score: o.score?.final ?? 0,
      }));
  }

  /** Downloads a tarball; no integrity check here (see `verifyIntegrity`). */
  async tarball(url: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(url, { maxBytes: this.maxTarballBytes });
    if (!res.ok) throw new RegistryError(`tarball download answered ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
}
