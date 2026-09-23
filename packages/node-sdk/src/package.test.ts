import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  definePackage,
  defineNode,
  idPrefixFor,
  normalizePackage,
  ok,
  toManifest,
  type AnyNodeDefinition,
} from "./index.js";

const node = (id: string) =>
  defineNode({
    id,
    version: "1.0.0",
    metadata: { name: id, description: "d", category: "data", icon: "box", tags: [] },
    configSchema: z.strictObject({}),
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    capabilities: [],
    idempotency: "safe",
    execute: () => Promise.resolve(ok({})),
  }) as AnyNodeDefinition;

const PKG = { name: "@community/slack", version: "2.1.0" };

describe("normalizePackage", () => {
  it("accepts nodePackage, node and nodes exports", () => {
    const pkg = definePackage({
      name: "@community/slack",
      version: "2.1.0",
      nodes: [node("@community/slack.post")],
      sdk: "^1.0.0",
    });
    expect(normalizePackage({ nodePackage: pkg }, PKG)).toEqual({ ok: true, package: pkg });
    const single = normalizePackage({ node: node("@community/slack.post") }, PKG);
    expect(single.ok && single.package).toMatchObject({
      name: "@community/slack",
      version: "2.1.0",
      sdk: "^1.0.0",
    });
    const many = normalizePackage(
      { nodes: [node("@community/slack.post"), node("@community/slack.react")] },
      PKG,
    );
    expect(many.ok && many.package.nodes).toHaveLength(2);
  });

  it("rejects node ids outside the package's prefix and duplicates", () => {
    const result = normalizePackage(
      { nodes: [node("@other/pkg.post"), node("@community/slack.a"), node("@community/slack.a")] },
      PKG,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.diagnostics.map((d) => d.code)).toEqual([
      "E_PLUGIN_ID_PREFIX",
      "E_DUPLICATE_NODE_ID",
    ]);
  });

  it("rejects modules that export no nodes", () => {
    expect(normalizePackage({ something: 1 }, PKG).ok).toBe(false);
  });

  it("reserves flowaid.* for @flowaid packages", () => {
    expect(idPrefixFor("@flowaid/nodes-core")).toBe("flowaid.");
    expect(idPrefixFor("@community/slack")).toBe("@community/slack.");
  });
});

describe("toManifest shapes", () => {
  const def = defineNode({
    id: "@community/crm.lookup",
    version: "1.2.0",
    metadata: {
      name: "Lookup",
      description: "Finds a customer",
      category: "tool",
      icon: "search",
      tags: ["crm"],
    },
    configSchema: z.strictObject({ region: z.enum(["eu", "us"]).default("eu") }),
    inputSchema: z.object({
      email: z.string().meta({ "x-dataClass": "pii", "x-port": { description: "Customer email" } }),
      hint: z.string().optional(),
    }),
    outputSchema: z.object({ customer: z.object({ id: z.string(), tier: z.int() }) }),
    dynamicInputs: z.string(),
    capabilities: ["network"],
    idempotency: "safe",
    pool: "high_memory",
    optionProviders: { regions: () => Promise.resolve([]) },
    migrations: { "1.0.0": (c) => c, "1.1.0": (c) => c },
    execute: () => Promise.resolve(ok({ customer: { id: "c", tier: 1 } })),
  }) as AnyNodeDefinition;
  const manifest = toManifest(def);

  it("derives ports, requiredness, descriptions and data classes from the Zod shapes", () => {
    expect(manifest.inputs).toEqual([
      {
        name: "email",
        schema: { type: "string", "x-dataClass": "pii" },
        required: true,
        description: "Customer email",
        dataClass: "pii",
      },
      { name: "hint", schema: { type: "string" }, required: false },
    ]);
    expect(manifest.outputs[0]?.schema).toEqual({
      type: "object",
      properties: { id: { type: "string" }, tier: { type: "integer" } },
      required: ["id", "tier"],
      additionalProperties: false,
    });
  });

  it("keeps defaulted config fields optional and records providers, migrations and pool", () => {
    expect(manifest.configSchema).toEqual({
      type: "object",
      properties: { region: { type: "string", enum: ["eu", "us"], default: "eu" } },
      additionalProperties: false,
    });
    expect(manifest.dynamicInputs).toEqual({ schema: { type: "string" } });
    expect(manifest.optionProviders).toEqual(["regions"]);
    expect(manifest.migrations).toEqual(["1.0.0", "1.1.0"]);
    expect(manifest.pool).toBe("high_memory");
  });
});
