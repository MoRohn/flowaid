import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./program.js";
import { fakeIo, json } from "./test/fakeIo.js";

const SEARCH = JSON.parse(
  readFileSync(join(import.meta.dirname, "test/fixtures/npm-search.json"), "utf8"),
) as unknown;
const PLUGIN = {
  id: "0190b5a4-0000-7000-8000-0000000000aa",
  packageName: "@acme/nodes-crm",
  version: "1.2.0",
  status: "enabled",
  scope: "workspace",
  integrity: "sha512-abc",
  nodes: [{ id: "@acme/nodes-crm.lookup" }],
};

describe("flowaid plugin", () => {
  it("search lists only flowaid-node packages from the registry (recorded response)", async () => {
    const t = fakeIo([(c) => (c.url.pathname === "/-/v1/search" ? json(200, SEARCH) : undefined)], {
      env: { FLOWAID_PLUGIN_REGISTRY: "https://npm.example.com" },
    });
    expect(await runCli(["plugin", "search", "crm"], t.io)).toBe(0);
    expect(t.calls[0]?.url.origin).toBe("https://npm.example.com");
    expect(t.calls[0]?.url.searchParams.get("text")).toBe("keywords:flowaid-node crm");
    expect(t.stdout.join("\n")).toMatchSnapshot();
  });

  it("add parses the spec, pins --frozen and reports the restart", async () => {
    const t = fakeIo([
      (c) =>
        c.method === "POST" && c.url.pathname === "/v1/plugins"
          ? json(201, { plugin: PLUGIN, workerRestartRequired: true })
          : undefined,
    ]);
    const code = await runCli(
      [
        "plugin",
        "add",
        "@acme/nodes-crm@^1.2.0",
        "--frozen",
        "sha512-abc",
        "--api-key",
        "fa_test_k",
      ],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.calls[0]?.body).toEqual({
      packageName: "@acme/nodes-crm",
      version: "^1.2.0",
      integrity: "sha512-abc",
    });
    expect(t.stdout).toEqual([
      "installed @acme/nodes-crm@1.2.0 (1 node) sha512-abc",
      "restart the workers to load it",
    ]);
    expect(await runCli(["plugin", "add", "Not A Name", "--api-key", "k"], t.io)).toBe(1);
  });

  it("enable/disable resolve a package name to its plugin", async () => {
    const t = fakeIo([
      (c) =>
        c.method === "GET" && c.url.pathname === "/v1/plugins" ? json(200, [PLUGIN]) : undefined,
      (c) =>
        c.method === "PATCH" && c.url.pathname === `/v1/plugins/${PLUGIN.id}`
          ? json(200, {
              plugin: { ...PLUGIN, status: (c.body as { status: string }).status },
              workerRestartRequired: true,
            })
          : undefined,
    ]);
    expect(await runCli(["plugin", "disable", "@acme/nodes-crm", "--api-key", "k"], t.io)).toBe(0);
    expect(t.calls[1]?.body).toEqual({ status: "disabled" });
    expect(t.stdout.at(-1)).toBe("@acme/nodes-crm is disabled; restart the workers to apply it");
    expect(await runCli(["plugin", "enable", "@acme/missing", "--api-key", "k"], t.io)).toBe(1);
  });
});
