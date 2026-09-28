import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NodeManifest } from "@flowaid/workflow-core";
import {
  PLATFORM_SDK_VERSION,
  PluginProblem,
  RegistryClient,
  integrityOf,
  isAllowed,
  maxSatisfying,
  packTarball,
  parsePluginSpec,
  readTarball,
  resolvePlugin,
  satisfies,
  verifyIntegrity,
} from "./index.js";
import { startFakeRegistry, type FakeRegistry } from "./testing.js";

const ROOT = join(import.meta.dirname, "../../..");
/** The range a package built for this platform declares (follows the release version). */
const SDK = `^${PLATFORM_SDK_VERSION}`;
const CORE = JSON.parse(readFileSync(join(ROOT, "packages/nodes-core/manifest.json"), "utf8")) as {
  nodes: NodeManifest[];
};
const template = CORE.nodes.find((m) => m.id === "flowaid.data.template") as NodeManifest;
const manifestFor = (pkg: string, tail = "echo"): string =>
  JSON.stringify({ nodes: [{ ...template, id: `${pkg}.${tail}` }] });

describe("semver", () => {
  it.each([
    ["1.2.3", "^1.0.0", true],
    ["2.0.0", "^1.0.0", false],
    ["0.1.5", "^0.1.0", true],
    ["0.2.0", "^0.1.0", false],
    ["1.2.9", "~1.2.0", true],
    ["1.3.0", "~1.2.0", false],
    ["1.4.0", ">=1.2.0 <2", true],
    ["3.0.0", "1.x || >=3", true],
    ["2.5.0", "1.x || >=3", false],
    ["1.0.0-beta.2", "^1.0.0", false],
    ["1.0.0-beta.2", ">=1.0.0-beta.1", true],
    ["5.0.0", "*", true],
  ])("%s satisfies %s → %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
  it("picks the highest matching version", () => {
    expect(maxSatisfying(["1.0.0", "1.4.2", "2.0.0", "1.10.0"], "^1")).toBe("1.10.0");
    expect(maxSatisfying(["1.0.0"], "^2")).toBeNull();
  });
  it("the platform SDK version is @flowaid/node-sdk's", () => {
    const sdk = JSON.parse(readFileSync(join(ROOT, "packages/node-sdk/package.json"), "utf8")) as {
      version: string;
    };
    expect(PLATFORM_SDK_VERSION).toBe(sdk.version);
  });
});

describe("specs and the allow-list", () => {
  it("parses name and range", () => {
    expect(parsePluginSpec("@acme/nodes-crm@^1.2.0")).toEqual({
      name: "@acme/nodes-crm",
      range: "^1.2.0",
    });
    expect(parsePluginSpec("flowaid-node-weather")).toEqual({
      name: "flowaid-node-weather",
      range: "latest",
    });
    expect(() => parsePluginSpec("Bad Name")).toThrow(/npm package name/);
    expect(() => parsePluginSpec("x@not a range!")).toThrow(/semver range/);
  });
  it("allows scopes, exact names and *", () => {
    expect(isAllowed("@acme/nodes-crm", ["@acme"])).toBe(true);
    expect(isAllowed("@evil/nodes", ["@acme"])).toBe(false);
    expect(isAllowed("flowaid-node-weather", ["flowaid-node-weather"])).toBe(true);
    expect(isAllowed("flowaid-node-other", ["@acme", "flowaid-node-weather"])).toBe(false);
    expect(isAllowed("anything", ["*"])).toBe(true);
  });
});

describe("tarballs", () => {
  it("round-trips files and verifies SRI", async () => {
    const data = await packTarball({ "package.json": "{}", "dist/index.js": "export {};" });
    expect(readTarball(data).map((e) => e.path)).toEqual(["package.json", "dist/index.js"]);
    const sri = integrityOf(data);
    expect(sri).toMatch(/^sha512-/);
    expect(verifyIntegrity(data, sri)).toBe(true);
    expect(verifyIntegrity(new Uint8Array([1, 2, 3]), sri)).toBe(false);
    expect(verifyIntegrity(data, "md5-abc")).toBe(false);
  });
  it("rejects entries that escape the package directory", async () => {
    const data = await packTarball({ "../../etc/passwd": "x" });
    expect(() => readTarball(data)).toThrow(/escapes/);
  });
});

describe("resolvePlugin against a fake registry", () => {
  let reg: FakeRegistry;
  let client: RegistryClient;
  beforeAll(async () => {
    reg = await startFakeRegistry();
    client = new RegistryClient({ registry: reg.url });
    await reg.publish({
      name: "@acme/nodes-crm",
      version: "1.0.0",
      description: "CRM nodes",
      flowaid: { package: "nodePackage", sdk: SDK },
      files: { "manifest.json": manifestFor("@acme/nodes-crm") },
    });
    await reg.publish({
      name: "@acme/nodes-crm",
      version: "1.2.0",
      description: "CRM nodes",
      flowaid: { package: "nodePackage", sdk: SDK },
      files: { "manifest.json": manifestFor("@acme/nodes-crm", "lookup") },
    });
    await reg.publish({ name: "@acme/not-a-plugin", version: "1.0.0", keywords: ["other"] });
    await reg.publish({
      name: "@acme/future",
      version: "1.0.0",
      flowaid: { sdk: "^2.0.0" },
      files: { "manifest.json": manifestFor("@acme/future") },
    });
    await reg.publish({
      name: "@acme/squatter",
      version: "1.0.0",
      flowaid: { sdk: SDK },
      files: { "manifest.json": manifestFor("@acme/nodes-crm") },
    });
    await reg.publish({
      name: "@acme/tampered",
      version: "1.0.0",
      flowaid: { sdk: SDK },
      files: { "manifest.json": manifestFor("@acme/tampered") },
      tamper: await packTarball({ "package.json": "{}", "manifest.json": "[]" }),
    });
  });
  afterAll(() => reg.close());

  const problem = async (spec: string, allow = ["@acme"], expectedIntegrity?: string) => {
    try {
      await resolvePlugin(spec, {
        registry: client,
        allowList: allow,
        ...(expectedIntegrity ? { expectedIntegrity } : {}),
      });
    } catch (e) {
      return e instanceof PluginProblem ? e.code : String(e);
    }
    return "resolved";
  };

  it("resolves the latest or a range, with integrity and manifests", async () => {
    const latest = await resolvePlugin("@acme/nodes-crm", {
      registry: client,
      allowList: ["@acme"],
    });
    expect(latest).toMatchObject({ name: "@acme/nodes-crm", version: "1.2.0", sdk: SDK });
    expect(latest.integrity).toMatch(/^sha512-/);
    expect(latest.manifests.map((m) => m.id)).toEqual(["@acme/nodes-crm.lookup"]);
    const pinned = await resolvePlugin("@acme/nodes-crm@~1.0.0", {
      registry: client,
      allowList: ["@acme"],
    });
    expect(pinned.version).toBe("1.0.0");
  });

  it("refuses what it must", async () => {
    expect(await problem("@acme/nodes-crm", ["@other"])).toBe("E_PLUGIN_NOT_ALLOWED");
    expect(await problem("@acme/missing")).toBe("E_PLUGIN_NOT_FOUND");
    expect(await problem("@acme/nodes-crm@^9")).toBe("E_PLUGIN_NOT_FOUND");
    expect(await problem("@acme/not-a-plugin")).toBe("E_PLUGIN_NOT_A_PLUGIN");
    expect(await problem("@acme/future")).toBe("E_PLUGIN_SDK_RANGE");
    expect(await problem("@acme/squatter")).toBe("E_PLUGIN_ID_PREFIX");
    expect(await problem("@acme/tampered")).toBe("E_PLUGIN_INTEGRITY");
    expect(await problem("@acme/nodes-crm", ["@acme"], "sha512-pinnedsomethingelse")).toBe(
      "E_PLUGIN_INTEGRITY",
    );
  });

  it("searches only packages with the discovery keyword", async () => {
    const results = await client.search("crm");
    expect(results.map((r) => r.name)).toEqual(["@acme/nodes-crm"]);
    expect(reg.requests.some((r) => r.includes("keywords%3Aflowaid-node"))).toBe(true);
  });
});
