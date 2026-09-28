import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_API_PORT, DEFAULT_WEB_PORT, choosePort, portIsFree } from "./ports.ts";

/** A fake port table: every port listed is taken. */
const taken =
  (...ports: number[]) =>
  (port: number) =>
    Promise.resolve(!ports.includes(port));

describe("default ports", () => {
  it("puts the web app on 3000 and the API on 3001", () => {
    expect(DEFAULT_WEB_PORT).toBe(3000);
    expect(DEFAULT_API_PORT).toBe(3001);
  });
});

describe("choosePort", () => {
  it("uses the requested port when it is free", async () => {
    expect(await choosePort({ port: 3000, explicit: false }, taken())).toEqual({
      ok: true,
      port: 3000,
      requested: 3000,
      fallback: false,
    });
  });

  it("moves a busy default to the next free port, skipping the API port", async () => {
    expect(
      await choosePort({ port: 3000, explicit: false, avoid: [3001] }, taken(3000, 3002)),
    ).toEqual({ ok: true, port: 3003, requested: 3000, fallback: true });
  });

  it("moves a busy default API port past the web app's port", async () => {
    expect(
      await choosePort({ port: 3001, explicit: false, avoid: [3002] }, taken(3000, 3001)),
    ).toMatchObject({ ok: true, port: 3003, fallback: true });
  });

  it("never swaps an explicit port for another", async () => {
    expect(await choosePort({ port: 3000, explicit: true }, taken(3000))).toEqual({
      ok: false,
      requested: 3000,
      reason: "in-use",
    });
  });

  it("gives up after a bounded search", async () => {
    const tried: number[] = [];
    const none = (port: number) => {
      tried.push(port);
      return Promise.resolve(false);
    };
    expect(await choosePort({ port: 3000, explicit: false }, none)).toMatchObject({
      ok: false,
      reason: "exhausted",
    });
    expect(tried.length).toBeLessThanOrEqual(51);
  });

  it("stops at the last port number", async () => {
    expect(await choosePort({ port: 65_535, explicit: false }, taken(65_535))).toMatchObject({
      ok: false,
      reason: "exhausted",
    });
  });
});

describe("portIsFree", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("sees a listening socket", async () => {
    server = createServer();
    const port = await new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    expect(await portIsFree("127.0.0.1", port)).toBe(false);
    const found = await choosePort({ port, explicit: false }, (p) => portIsFree("127.0.0.1", p));
    expect(found).toMatchObject({ ok: true, fallback: true });
  });

  it("sees an app on the IPv6 wildcard that leaves 127.0.0.1 bindable", async () => {
    server = createServer();
    const port = await new Promise<number>((resolve) => {
      server?.once("error", () => resolve(0));
      server?.listen(0, "::", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    if (port === 0) return; // no IPv6 on this machine
    expect(await portIsFree("127.0.0.1", port)).toBe(false);
  });
});
