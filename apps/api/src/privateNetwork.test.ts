import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "@flowaid/env";
import { apiSafeFetch, configFromEnv } from "./context.js";

const MINIMAL = { DATABASE_URL: "postgres://flowaid:flowaid@localhost:5432/flowaid" };

describe("FLOWAID_ALLOW_PRIVATE_NETWORK in the api", () => {
  let server: Server;
  let url = "";
  beforeAll(async () => {
    server = createServer((_req, res) => res.end("local"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("is off by default: the config refuses private addresses and so does the fetch", async () => {
    const config = configFromEnv(loadEnv(MINIMAL));
    expect(config.allowPrivateNetwork).toBe(false);
    await expect(apiSafeFetch(config)(url)).rejects.toThrow(/private or reserved/);
  });

  it("turns on OpenAPI/MCP import checks and the api fetch together", async () => {
    const config = configFromEnv(loadEnv({ ...MINIMAL, FLOWAID_ALLOW_PRIVATE_NETWORK: "true" }));
    expect(config.allowPrivateNetwork).toBe(true);
    expect(await (await apiSafeFetch(config)(url)).text()).toBe("local");
  });
});
