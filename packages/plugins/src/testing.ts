/**
 * A fake npm registry for tests (no network): serves packuments, `/-/v1/search` and tarballs of
 * packages published into it with `publish()`, computing real sha512 integrities.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Packument } from "./registry.js";
import { integrityOf, packTarball } from "./tarball.js";

export interface FakePackage {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  flowaid?: { package?: string; sdk?: string; manifest?: string };
  /** files inside the tarball besides package.json */
  files?: Record<string, string>;
  /** serve these bytes instead of the packed tarball (tamper tests) */
  tamper?: Uint8Array;
}

export interface FakeRegistry {
  url: string;
  publish(pkg: FakePackage): Promise<{ integrity: string }>;
  /** replaces the search response (a recorded registry body) */
  setSearchResponse(body: unknown): void;
  requests: string[];
  close(): Promise<void>;
}

export async function startFakeRegistry(): Promise<FakeRegistry> {
  const packuments = new Map<string, Packument>();
  const tarballs = new Map<string, Uint8Array>();
  const requests: string[] = [];
  let searchOverride: unknown;
  let base = "";
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requests.push(`${req.method ?? "GET"} ${url.pathname}${url.search}`);
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body));
    };
    if (url.pathname === "/-/v1/search") {
      if (searchOverride !== undefined) return send(200, searchOverride);
      const text = (url.searchParams.get("text") ?? "").toLowerCase();
      const words = text.split(/\s+/).filter((w) => w && !w.startsWith("keywords:"));
      const objects = [...packuments.values()]
        .map((p) => p.versions[p["dist-tags"].latest ?? ""])
        .filter((v) => v !== undefined)
        .filter((v) =>
          words.every((w) => `${v.name} ${v.description ?? ""}`.toLowerCase().includes(w)),
        )
        .map((v) => ({
          package: {
            name: v.name,
            version: v.version,
            description: v.description,
            keywords: v.keywords,
            date: "2026-09-01T00:00:00.000Z",
            publisher: { username: "tester" },
            links: { npm: `https://www.npmjs.com/package/${v.name}` },
          },
          score: { final: 0.9 },
        }));
      return send(200, { objects, total: objects.length });
    }
    if (url.pathname.startsWith("/-/tarballs/")) {
      const data = tarballs.get(url.pathname);
      return data ? send(200, data, "application/octet-stream") : send(404, { error: "not found" });
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    const p = packuments.get(name);
    return p ? send(200, p) : send(404, { error: "Not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: base,
    requests,
    setSearchResponse(body) {
      searchOverride = body;
    },
    async publish(pkg) {
      const packageJson = {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? "",
        keywords: pkg.keywords ?? ["flowaid-node"],
        type: "module",
        main: "index.js",
        ...(pkg.flowaid === undefined ? {} : { flowaid: pkg.flowaid }),
      };
      const data = await packTarball({
        "package.json": JSON.stringify(packageJson, null, 2),
        ...(pkg.files ?? {}),
      });
      const integrity = integrityOf(data);
      const path = `/-/tarballs/${pkg.name.replace("/", "__")}-${pkg.version}.tgz`;
      tarballs.set(path, pkg.tamper ?? data);
      const existing = packuments.get(pkg.name) ?? {
        name: pkg.name,
        "dist-tags": {},
        versions: {},
      };
      existing.versions[pkg.version] = {
        ...packageJson,
        dist: { tarball: `${base}${path}`, integrity },
      };
      existing["dist-tags"].latest = pkg.version;
      packuments.set(pkg.name, existing);
      return { integrity };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
