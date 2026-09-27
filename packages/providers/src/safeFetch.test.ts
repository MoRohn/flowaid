import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSafeFetch, isBlockedAddress, type LookupFn } from "./safeFetch.js";

let server: Server;
let port = 0;
const seen: { method: string; url: string; auth?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
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
    ["8.8.8.8", false],
    ["2606:4700:4700::1111", false],
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

  it("applies deny lists", async () => {
    const f = createSafeFetch({ denyHosts: ["*.evil.test"] });
    await expect(f("https://x.evil.test/")).rejects.toThrow(/denied/);
  });
});
