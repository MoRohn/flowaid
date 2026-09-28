import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSafeFetch, isBlockedAddress, type LookupFn } from "./safeFetch.js";

let server: Server;
let port = 0;
const seen: {
  method: string;
  url: string;
  auth?: string;
  headers: Record<string, string | string[] | undefined>;
}[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
    });
    if (req.url === "/big") return void res.end("x".repeat(2048));
    if (req.url === "/chunked") {
      res.write("x".repeat(800));
      return void res.end("y".repeat(800));
    }
    if (req.url === "/redirect-303") return void res.writeHead(303, { location: "/final" }).end();
    if (req.url === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
    if (req.url === "/to-metadata")
      return void res.writeHead(302, { location: "http://169.254.169.254/latest" }).end();
    if (req.url === "/to-other-port")
      return void res.writeHead(302, { location: "http://127.0.0.1:9/final" }).end();
    if (req.url === "/to-other-host")
      return void res.writeHead(302, { location: `http://other.test:${port}/final` }).end();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, method: req.method }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** DNS that maps every *.test host to the loopback server (so "public" names can rebind to it). */
const loopbackDns: LookupFn = (_host, _opts, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]);

describe("isBlockedAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.2.3.4", true],
    ["169.254.169.254", true],
    ["100.100.1.1", true],
    ["192.168.0.1", true],
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["::1", true],
    ["fd12::1", true],
    ["fe80::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:7f00:1", true],
    // IPv4-compatible (deprecated): ::a.b.c.d reaches a.b.c.d on some stacks
    ["::127.0.0.1", true],
    ["::7f00:1", true],
    ["::a9fe:a9fe", true],
    // 6to4 2002::/16 carries an IPv4 address in bits 16-47
    ["2002:7f00:1::1", true],
    ["2002:a9fe:a9fe::", true],
    ["2002:0808:0808::1", false],
    // Teredo 2001::/32 tunnels to an embedded IPv4 server and client
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", true],
    ["2001::1", true],
    ["0064:ff9b::7f00:1", true],
    ["fec0::1", true],
    ["2001:db8::1", true],
    ["8.8.8.8", false],
    ["2606:4700:4700::1111", false],
    ["2001:4860:4860::8888", false],
  ])("%s → %s", (ip, blocked) => expect(isBlockedAddress(ip)).toBe(blocked));
});

describe("createSafeFetch", () => {
  it("refuses loopback literals, local names and non-http schemes", async () => {
    const f = createSafeFetch();
    await expect(f(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f(`http://localhost:${port}/`)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f("file:///etc/passwd")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f(`http://user:pw@example.com/`)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses public names that resolve to private addresses at connect time (rebinding)", async () => {
    const f = createSafeFetch({ lookup: loopbackDns });
    await expect(f(`http://api.test:${port}/`)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("private"),
    });
  });

  it("works for allowed destinations and caps bodies", async () => {
    const f = createSafeFetch({ allowPrivate: true, lookup: loopbackDns, maxBytes: 1024 });
    const ok = await f(`http://api.test:${port}/`);
    expect(await ok.json()).toEqual({ ok: true, method: "GET" });
    // A declared Content-Length over the cap fails before the body is read.
    await expect(f(`http://api.test:${port}/big`)).rejects.toThrow(/larger than 1024 bytes/);
    // A chunked body is counted as it streams.
    const chunked = await f(`http://api.test:${port}/chunked`);
    await expect(chunked.text()).rejects.toThrow(/larger than 1024 bytes/);
  });

  it("follows redirects manually: 303 downgrades to GET, loops stop, private hops are re-checked", async () => {
    const f = createSafeFetch({ allowPrivate: true, lookup: loopbackDns });
    const r = await f(`http://api.test:${port}/redirect-303`, {
      method: "POST",
      body: "x",
      headers: { "content-type": "text/plain" },
    });
    expect(await r.json()).toEqual({ ok: true, method: "GET" });
    await expect(f(`http://api.test:${port}/loop`, { maxRedirects: 2 })).rejects.toThrow(
      /too many redirects/,
    );
    const strict = createSafeFetch({
      allowHosts: ["api.test"],
      allowPrivate: true,
      lookup: loopbackDns,
    });
    await expect(strict(`http://api.test:${port}/to-other-host`)).rejects.toThrow(/allow list/);
    const guarded = createSafeFetch({
      lookup: (h, o, cb) =>
        h === "api.test"
          ? loopbackDns(h, o, cb)
          : cb(null, [{ address: "93.184.216.34", family: 4 }]),
    });
    await expect(guarded(`http://api.test:${port}/to-metadata`)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("drops Authorization when a redirect leaves the origin", async () => {
    seen.length = 0;
    const f = createSafeFetch({ allowPrivate: true, lookup: loopbackDns });
    await f(`http://api.test:${port}/to-other-host`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(seen[0]?.auth).toBe("Bearer secret");
    expect(seen[1]?.auth).toBeUndefined();
  });

  it("forwards only safe headers when a redirect leaves the origin", async () => {
    seen.length = 0;
    const f = createSafeFetch({ allowPrivate: true, lookup: loopbackDns, userAgent: "flowaid" });
    await f(`http://api.test:${port}/to-other-host`, {
      headers: {
        "x-api-key": "k-secret",
        "private-token": "t-secret",
        accept: "application/json",
        "accept-language": "en",
      },
    });
    expect(seen[0]?.headers["x-api-key"]).toBe("k-secret");
    expect(seen[1]?.headers["x-api-key"]).toBeUndefined();
    expect(seen[1]?.headers["private-token"]).toBeUndefined();
    expect(seen[1]?.headers.accept).toBe("application/json");
    expect(seen[1]?.headers["accept-language"]).toBe("en");
    expect(seen[1]?.headers["user-agent"]).toBe("flowaid");
  });

  it("keeps custom headers on same-origin redirects", async () => {
    seen.length = 0;
    const f = createSafeFetch({ allowPrivate: true, lookup: loopbackDns });
    await f(`http://api.test:${port}/redirect-303`, { headers: { "x-api-key": "k-secret" } });
    expect(seen[1]?.headers["x-api-key"]).toBe("k-secret");
  });

  it("applies deny lists", async () => {
    const f = createSafeFetch({ denyHosts: ["*.evil.test"] });
    await expect(f("https://x.evil.test/")).rejects.toThrow(/denied/);
  });
});

describe("trusted origins", () => {
  it("reaches an operator-configured private origin, and only that origin", async () => {
    const trusted = createSafeFetch({ trustedOrigins: [`http://127.0.0.1:${port}/`] });
    const res = await trusted(`http://127.0.0.1:${port}/ok`);
    expect(res.status).toBe(200);
    // another port on the same private address is not trusted
    await expect(trusted("http://127.0.0.1:9/")).rejects.toThrow(/private or reserved/);
    // nor is localhost by name on this port (the origin must match exactly)
    await expect(trusted(`http://localhost:${port}/ok`)).rejects.toThrow(/refused to connect/);
  });

  it("does not follow a trusted origin's redirect to an untrusted private address", async () => {
    const trusted = createSafeFetch({ trustedOrigins: [`http://127.0.0.1:${port}`] });
    await expect(trusted(`http://127.0.0.1:${port}/to-other-port`)).rejects.toThrow(
      /private or reserved/,
    );
    await expect(trusted(`http://127.0.0.1:${port}/to-metadata`)).rejects.toThrow(
      /private or reserved/,
    );
  });

  it("ignores malformed entries", async () => {
    const f = createSafeFetch({ trustedOrigins: ["not a url"] });
    await expect(f(`http://127.0.0.1:${port}/ok`)).rejects.toThrow(/private or reserved/);
  });
});
