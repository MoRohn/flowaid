import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  normalizePackage,
  toManifest,
  type AnyNodeDefinition,
  type NodePackage,
} from "@flowaid/node-sdk";
import { runNode } from "@flowaid/node-sdk/testing";
import { RegistryClient, packTarball, resolvePlugin } from "@flowaid/plugins";
import { startFakeRegistry } from "@flowaid/plugins/testing";
import { create } from "./main.js";
import { scaffold, validateName } from "./scaffold.js";

// Generated packages are written inside this package so their imports resolve here.
const TMP = join(import.meta.dirname, "../.scaffold-test");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function write(dir: string, files: Record<string, string>) {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
}

describe("create-flowaid-node", () => {
  it("validates the package name", () => {
    expect(validateName("@acme/nodes-crm")).toBeNull();
    expect(validateName("Bad Name")).toMatch(/npm package name/);
    expect(validateName("@flowaid/x")).toMatch(/reserved/);
  });

  it("scaffolds a package whose node runs, whose manifest is current, and whose own tests pass", async () => {
    const dir = join(TMP, "acme-crm");
    const files = scaffold({ name: "@acme/nodes-crm", description: "CRM nodes" });
    write(dir, files);
    const pkg = JSON.parse(files["package.json"] as string) as {
      keywords: string[];
      flowaid: { package: string; sdk: string; manifest: string };
    };
    expect(pkg.keywords).toContain("flowaid-node");
    expect(pkg.flowaid).toEqual({
      package: "nodePackage",
      sdk: "^0.1.0",
      manifest: "manifest.json",
    });

    const mod = (await import(join(dir, "src/index.ts"))) as {
      greetNode: AnyNodeDefinition;
      nodePackage: NodePackage;
    };
    // the generated harness test, run here
    const { result } = await runNode(mod.greetNode, {
      config: { greeting: "Hi" },
      input: { name: "Ada" },
    });
    expect(result).toEqual({ kind: "ok", output: { text: "Hi, Ada!" } });
    // the shipped manifest equals what toManifest derives from the generated source
    const shipped = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as unknown;
    expect(shipped).toEqual({ nodes: mod.nodePackage.nodes.map((n) => toManifest(n)) });
    // the platform loader accepts it
    const normalized = normalizePackage(mod, {
      name: "@acme/nodes-crm",
      version: "0.1.0",
    });
    expect(normalized.ok).toBe(true);
    expect(shipped).toMatchSnapshot();
  });

  it("publishes to a registry and installs as a plugin (integrity, keyword, SDK range, id prefix)", async () => {
    const reg = await startFakeRegistry();
    try {
      const files = scaffold({ name: "flowaid-node-weather" });
      const pkg = JSON.parse(files["package.json"] as string) as { flowaid: { sdk: string } };
      await reg.publish({
        name: "flowaid-node-weather",
        version: "0.1.0",
        keywords: ["flowaid-node"],
        flowaid: { package: "nodePackage", sdk: pkg.flowaid.sdk, manifest: "manifest.json" },
        files: {
          "manifest.json": files["manifest.json"] as string,
          "src/index.ts": files["src/index.ts"] as string,
        },
      });
      const resolved = await resolvePlugin("flowaid-node-weather", {
        registry: new RegistryClient({ registry: reg.url }),
        allowList: ["flowaid-node-weather"],
      });
      expect(resolved.manifests.map((m) => m.id)).toEqual(["flowaid-node-weather.greet"]);
      expect(resolved.integrity).toMatch(/^sha512-/);
      expect(await packTarball({ "package.json": files["package.json"] as string })).toBeInstanceOf(
        Uint8Array,
      );
    } finally {
      await reg.close();
    }
  });

  it("the CLI writes into a new directory and refuses a non-empty one", () => {
    const lines: string[] = [];
    expect(create(["@acme/nodes-x", "--dir", "nodes-x"], TMP, (l) => lines.push(l))).toBe(0);
    expect(readFileSync(join(TMP, "nodes-x/package.json"), "utf8")).toContain('"@acme/nodes-x"');
    expect(create(["@acme/nodes-x", "--dir", "nodes-x"], TMP, (l) => lines.push(l))).toBe(1);
    expect(lines.at(-1)).toMatch(/not empty/);
    expect(create([], TMP, (l) => lines.push(l))).toBe(2);
  });
});
