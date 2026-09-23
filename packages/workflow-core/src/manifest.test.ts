/**
 * `NodeManifestSchema` and the port-rule model (ARCHITECTURE.md §4.2) against the
 * hand-written manifests in `fixtures/manifests/`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  IdempotencySpecSchema,
  NodeManifestSchema,
  PortRuleSchema,
  type Idempotency,
  type NodeCatalog,
  type NodeManifest,
  type PortRule,
} from "./manifest.js";
import type { NodeTypeId } from "./ids.js";
import { DecisionResultJsonSchema } from "./decision.js";
import { JsonSchemaSchema } from "./json.js";
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "./definition.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const MANIFESTS_DIR = join(FIXTURES, "manifests");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const rawManifests = new Map<string, unknown>(
  readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [f.slice(0, -".json".length), readJson(join(MANIFESTS_DIR, f))]),
);
const manifests = new Map<string, NodeManifest>(
  [...rawManifests].map(([id, raw]) => [id, NodeManifestSchema.parse(raw)]),
);
const example: WorkflowDefinition = WorkflowDefinitionSchema.parse(
  readJson(join(FIXTURES, "example-support-reply.json")),
);

/** Resolves an idempotency spec against a config the way the compiler will (`byConfig` pointer lookup). */
function resolveIdempotency(
  spec: NodeManifest["idempotency"],
  config: Record<string, unknown>,
): Idempotency {
  if (typeof spec === "string") return spec;
  const key = spec.byConfig.slice(1);
  const value = config[key];
  return (typeof value === "string" ? spec.cases[value] : undefined) ?? spec.default;
}

/** Minimal in-memory catalog over the fixtures, as the compiler consumes it. */
class FixtureCatalog implements NodeCatalog {
  get(id: NodeTypeId, version?: string): NodeManifest | undefined {
    const m = manifests.get(id);
    return m !== undefined && (version === undefined || m.version === version) ? m : undefined;
  }
  list(): NodeManifest[] {
    return [...manifests.values()];
  }
}

describe("fixtures/manifests", () => {
  it("ships a manifest for every node type the example plan and the three demos use", () => {
    expect([...manifests.keys()]).toEqual([
      "flowaid.ai.generate",
      "flowaid.ai.structured_generate",
      "flowaid.data.transform",
      "flowaid.decision.batch",
      "flowaid.decision.boolean",
      "flowaid.decision.choice",
      "flowaid.decision.confidence_gate",
      "flowaid.tools.http",
      "flowaid.tools.mcp",
    ]);
  });

  for (const [id, raw] of rawManifests) {
    it(`${id} parses unchanged and is named after its file`, () => {
      const result = NodeManifestSchema.safeParse(raw);
      expect(
        result.success,
        JSON.stringify(result.success ? null : result.error.issues, null, 2),
      ).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual(raw);
      expect(result.data.id).toBe(id);
      expect(JsonSchemaSchema.safeParse(result.data.configSchema).success).toBe(true);
      for (const port of [...result.data.inputs, ...result.data.outputs])
        expect(JsonSchemaSchema.safeParse(port.schema).success, port.name).toBe(true);
      // Port names are unique within each namespace (an input and an output may share a name, e.g. `decision`).
      for (const ports of [result.data.inputs, result.data.outputs, result.data.controlPorts]) {
        const names = ports.map((p) => p.name);
        expect(new Set(names).size).toBe(names.length);
      }
    });
  }

  it("every task node of the example workflow resolves in the catalog with its typeVersion", () => {
    const catalog = new FixtureCatalog();
    for (const node of example.nodes) {
      if (node.kind !== "task") continue;
      const manifest = catalog.get(node.type, node.typeVersion);
      expect(manifest, `${node.id}: ${node.type}@${node.typeVersion}`).toBeDefined();
      if (manifest === undefined) continue;
      for (const slot of Object.keys(node.credentials))
        expect(
          manifest.credentials.map((c) => c.name),
          `${node.id} slot ${slot}`,
        ).toContain(slot);
      for (const port of Object.keys(node.inputs))
        expect(
          manifest.inputs.map((p) => p.name),
          `${node.id} port ${port}`,
        ).toContain(port);
      for (const secretSlot of manifest.credentials.filter((c) => c.required))
        expect(
          node.credentials[secretSlot.name],
          `${node.id} needs ${secretSlot.name}`,
        ).toBeDefined();
    }
    expect(catalog.get("flowaid.decision.choice", "9.9.9")).toBeUndefined();
    expect(catalog.list()).toHaveLength(manifests.size);
  });
});

describe("flowaid.decision.choice", () => {
  const manifest = manifests.get("flowaid.decision.choice");
  if (manifest === undefined) throw new Error("missing fixture");

  it("derives one control-out per option through controlPortsFromConfig{/options} (§4.2)", () => {
    expect(manifest.portRules).toEqual([{ kind: "controlPortsFromConfig", path: "/options" }]);
    expect(manifest.controlPorts).toEqual([]);
    expect(manifest.decision).toEqual({ kind: "choice" });
    const intent = example.nodes.find((n) => n.id === "intent");
    if (intent?.kind !== "task") throw new Error("example intent node");
    const options = intent.config.options;
    if (typeof options !== "object" || options === null || Array.isArray(options))
      throw new Error("options object");
    const derived = Object.keys(options);
    expect(derived).toEqual(["billing", "technical", "security", "general"]);
    for (const port of derived) expect(port).toMatch(/^[a-z0-9_]{1,64}$/);
  });

  it("exposes the whole DecisionResult on output port `decision` typed by DecisionResultJsonSchema.choice (§2.8)", () => {
    expect(manifest.inputs.map((p) => p.name)).toEqual(["state"]);
    expect(manifest.inputs[0]?.required).toBe(true);
    expect(manifest.outputs.map((p) => p.name)).toEqual(["decision"]);
    expect(manifest.outputs[0]?.schema).toEqual(DecisionResultJsonSchema.choice);
  });

  it("declares the typesafe credential slot, decision capability and a safe idempotency", () => {
    expect(manifest.credentials).toEqual([
      {
        name: "typesafe",
        types: ["typesafe.api_key"],
        required: true,
        description: "TypeSafe API key used by the primary hop.",
      },
    ]);
    expect(manifest.capabilities).toEqual(["decision", "credentials"]);
    expect(manifest.idempotency).toBe("safe");
    expect(manifest.pool).toBe("general");
    expect(manifest.generation).toBe(false);
    expect(manifest.streams).toBe(false);
  });

  it("describes a config that the example node satisfies", () => {
    expect(manifest.configSchema.required).toEqual(["instructions", "options"]);
    expect(manifest.configSchema.additionalProperties).toBe(false);
    expect(manifest.configSchema.properties?.options?.["x-ui"]?.widget).toBe("keyvalue");
    expect(manifest.configSchema.properties?.options?.minProperties).toBe(2);
    expect(manifest.configSchema.properties?.options?.maxProperties).toBe(255);
    expect(manifest.metadata.category).toBe("decision");
  });
});

describe("flowaid.tools.http", () => {
  const manifest = manifests.get("flowaid.tools.http");
  if (manifest === undefined) throw new Error("missing fixture");

  it("has static ports only (no port rule applies to a plain HTTP call in §4.2)", () => {
    expect(manifest.portRules).toEqual([]);
    expect(manifest.inputs).toEqual([]);
    expect(manifest.outputs.map((p) => p.name)).toEqual(["status", "headers", "body"]);
    expect(manifest.outputs.find((p) => p.name === "body")?.schema).toEqual({});
    expect(manifest.outputs.find((p) => p.name === "body")?.required).toBe(false);
    expect(manifest.controlPorts).toEqual([]);
    expect(manifest.decision).toBeUndefined();
  });

  it("selects idempotency by HTTP method (byConfig) and the example GET resolves to safe", () => {
    expect(IdempotencySpecSchema.safeParse(manifest.idempotency).success).toBe(true);
    expect(manifest.idempotency).toEqual({
      byConfig: "/method",
      cases: {
        GET: "safe",
        HEAD: "safe",
        OPTIONS: "safe",
        PUT: "keyed",
        DELETE: "keyed",
        POST: "none",
        PATCH: "none",
      },
      default: "none",
    });
    const fetchAccount = example.nodes.find((n) => n.id === "fetch_account");
    if (fetchAccount?.kind !== "task") throw new Error("example fetch_account node");
    expect(resolveIdempotency(manifest.idempotency, fetchAccount.config)).toBe("safe");
    expect(resolveIdempotency(manifest.idempotency, { method: "POST" })).toBe("none");
    expect(resolveIdempotency(manifest.idempotency, { method: "PUT" })).toBe("keyed");
    expect(resolveIdempotency(manifest.idempotency, {})).toBe("none");
  });

  it("marks url as a template field and body as bindable (config fields can carry data, §2.2)", () => {
    expect(manifest.configSchema.properties?.url?.["x-ui"]?.widget).toBe("template");
    expect(manifest.configSchema.properties?.body?.["x-ui"]?.bindable).toBe(true);
    expect(manifest.configSchema.required).toEqual(["method", "url"]);
  });

  it("has an optional auth slot compatible with the example CRM_TOKEN secret", () => {
    const auth = manifest.credentials.find((c) => c.name === "auth");
    expect(auth?.required).toBe(false);
    const crm = example.secrets.find((s) => s.name === "CRM_TOKEN");
    expect(crm).toBeDefined();
    if (crm !== undefined) expect(auth?.types).toContain(crm.credentialType);
    expect(manifest.capabilities).toContain("network");
    expect(manifest.metadata.summary).toBe("{{ config.method }} {{ config.url }}");
  });
});

describe("PortRuleSchema", () => {
  it("accepts exactly the five rule kinds of §4.2", () => {
    const rules: PortRule[] = [
      { kind: "controlPortsFromConfig", path: "/routes" },
      { kind: "outputSchemaFromConfig", port: "result", path: "/outputSchema" },
      { kind: "inputSchemaFromConfig", port: "input", path: "/inputSchema" },
      { kind: "decisionAnswersFromConfig", port: "answers", path: "/questions" },
      { kind: "toolSignature", source: "mcp" },
    ];
    for (const rule of rules) expect(PortRuleSchema.parse(rule)).toEqual(rule);
    const kinds = PortRuleSchema.options.map((o) => o.shape.kind.value).sort();
    expect(kinds).toEqual([
      "controlPortsFromConfig",
      "decisionAnswersFromConfig",
      "inputSchemaFromConfig",
      "outputSchemaFromConfig",
      "toolSignature",
    ]);
  });

  it("rejects unknown kinds, non-pointer paths, bad port names and unknown tool sources", () => {
    expect(PortRuleSchema.safeParse({ kind: "portsFromCode", path: "/x" }).success).toBe(false);
    expect(
      PortRuleSchema.safeParse({ kind: "controlPortsFromConfig", path: "routes" }).success,
    ).toBe(false);
    expect(
      PortRuleSchema.safeParse({ kind: "outputSchemaFromConfig", port: "Result", path: "/s" })
        .success,
    ).toBe(false);
    expect(PortRuleSchema.safeParse({ kind: "toolSignature", source: "http" }).success).toBe(false);
    expect(PortRuleSchema.safeParse({ kind: "toolSignature", source: "builtin" }).success).toBe(
      false,
    );
  });
});

describe("NodeManifestSchema", () => {
  const base = manifests.get("flowaid.tools.http");
  if (base === undefined) throw new Error("missing fixture");

  it("rejects code-shaped or malformed manifests", () => {
    expect(NodeManifestSchema.safeParse({ ...base, id: "Flowaid.tools.http" }).success).toBe(false);
    expect(NodeManifestSchema.safeParse({ ...base, version: "1.0" }).success).toBe(false);
    expect(NodeManifestSchema.safeParse({ ...base, pool: "quantum" }).success).toBe(false);
    expect(NodeManifestSchema.safeParse({ ...base, capabilities: ["filesystem"] }).success).toBe(
      false,
    );
    expect(NodeManifestSchema.safeParse({ ...base, idempotency: "sometimes" }).success).toBe(false);
    expect(
      NodeManifestSchema.safeParse({
        ...base,
        credentials: [{ name: "Auth", types: ["http.bearer"], required: false }],
      }).success,
    ).toBe(false);
    expect(
      NodeManifestSchema.safeParse({
        ...base,
        credentials: [{ name: "auth", types: [], required: false }],
      }).success,
    ).toBe(false);
    expect(
      NodeManifestSchema.safeParse({ ...base, metadata: { ...base.metadata, category: "misc" } })
        .success,
    ).toBe(false);
    expect(NodeManifestSchema.safeParse({ ...base, decision: { kind: "oracle" } }).success).toBe(
      false,
    );
    expect(NodeManifestSchema.safeParse({ ...base, execute: "function () {}" }).success).toBe(true);
    const parsed = NodeManifestSchema.parse({ ...base, execute: "function () {}" });
    expect(parsed).not.toHaveProperty("execute");
  });

  it("converts to a JSON Schema document that describes the fixtures", () => {
    const json = z.toJSONSchema(NodeManifestSchema, { target: "draft-2020-12" });
    expect(json.required).toEqual(
      expect.arrayContaining([
        "id",
        "version",
        "metadata",
        "configSchema",
        "inputs",
        "outputs",
        "portRules",
        "idempotency",
        "pool",
      ]),
    );
    expect(JSON.stringify(json)).toContain('"controlPortsFromConfig"');
  });
});
