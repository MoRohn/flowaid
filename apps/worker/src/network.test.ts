import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { dbQueryConnector } from "@flowaid/nodes-core";
import { workerNetworkFromEnv } from "./network.js";

describe("worker network policy (FLOWAID_ALLOW_PRIVATE_NETWORK)", () => {
  let server: Server;
  let url = "";
  beforeAll(async () => {
    server = createServer((_req, res) => res.end("local"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const reset = () =>
    onTestFinished(() => {
      dbQueryConnector.network = {};
    });

  it("refuses loopback addresses by default, in the safe fetch and the database query node", async () => {
    reset();
    const net = workerNetworkFromEnv({
      FLOWAID_ALLOW_PRIVATE_NETWORK: false,
      OLLAMA_HOST: undefined,
    });
    expect(net.allowPrivateNetwork).toBe(false);
    await expect(net.http(url)).rejects.toThrow(/private or reserved/);
    expect(dbQueryConnector.network.allowPrivate).toBe(false);
  });

  it("reaches services on this computer when the operator allows it", async () => {
    reset();
    const net = workerNetworkFromEnv({
      FLOWAID_ALLOW_PRIVATE_NETWORK: true,
      OLLAMA_HOST: undefined,
    });
    expect(net.allowPrivateNetwork).toBe(true);
    const res = await net.http(url);
    expect(await res.text()).toBe("local");
    expect(dbQueryConnector.network.allowPrivate).toBe(true);
  });

  it("always reaches the operator's OLLAMA_HOST, and nothing else private", async () => {
    reset();
    const origin = new URL(url).origin;
    const net = workerNetworkFromEnv({ FLOWAID_ALLOW_PRIVATE_NETWORK: false, OLLAMA_HOST: origin });
    expect(await (await net.http(url)).text()).toBe("local");
    await expect(net.http("http://127.0.0.1:9/")).rejects.toThrow(/private or reserved/);
    expect(dbQueryConnector.network.allowPrivate).toBe(false);
  });
});
