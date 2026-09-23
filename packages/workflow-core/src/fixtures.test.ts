import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WorkflowDefinitionSchema } from "./definition.js";
import { NodeManifestSchema } from "./manifest.js";
import { ExecutionPlanSchema } from "./plan.js";
import { RunEventSchema } from "./events.js";
import { JsonSchemaSchema } from "./json.js";
import { RefSchema } from "./bindings.js";
import exampleSupportReply from "../fixtures/example-support-reply.json" with { type: "json" };
import supportTriage from "../fixtures/support-triage.json" with { type: "json" };
import githubIssueTriage from "../fixtures/github-issue-triage.json" with { type: "json" };
import researchAgent from "../fixtures/research-agent.json" with { type: "json" };

const FIXTURES: Record<string, unknown> = {
  "example-support-reply": exampleSupportReply,
  "support-triage": supportTriage,
  "github-issue-triage": githubIssueTriage,
  "research-agent": researchAgent,
};
const NAMES = Object.keys(FIXTURES);
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readJson = (...path: string[]): unknown =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, ...path), "utf8"));
/** Knowledge-slice variants (fixtures/variants/): parsed here, excluded from first-slice compile tests. */
const VARIANTS: Record<string, unknown> = {
  "github-issue-triage.retrieval": readJson("variants", "github-issue-triage.retrieval.json"),
};
/** Returns a fresh deep copy of a fixture document. */
function loadRaw(name: string): unknown {
  return JSON.parse(JSON.stringify(FIXTURES[name]));
}

/** Collects every `{ kind: 'ref', ref }` binding in a document. */
function collectRefs(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) value.forEach((v) => collectRefs(v, out));
  else if (typeof value === "object" && value !== null) {
    if ("kind" in value && value.kind === "ref" && "ref" in value) out.push(value.ref);
    for (const v of Object.values(value)) collectRefs(v, out);
  }
  return out;
}

describe("golden fixtures", () => {
  for (const name of NAMES) {
    describe(name, () => {
      const raw = loadRaw(name);

      it("parses with WorkflowDefinitionSchema", () => {
        const result = WorkflowDefinitionSchema.safeParse(raw);
        expect(
          result.success,
          JSON.stringify(result.success ? null : result.error.issues, null, 2),
        ).toBe(true);
      });

      it("round-trips through JSON after parsing (defaults are stable)", () => {
        const parsed = WorkflowDefinitionSchema.parse(raw);
        const again = WorkflowDefinitionSchema.parse(JSON.parse(JSON.stringify(parsed)));
        expect(again).toEqual(parsed);
      });

      it("carries $schema, a uuid id, a layout entry per node and no compact refs", () => {
        const def = WorkflowDefinitionSchema.parse(raw);
        expect(def.$schema).toBe("https://flowaid.dev/schemas/workflow/v1");
        expect(z.uuid().safeParse(def.id).success).toBe(true);
        expect(def.layout).toBeDefined();
        for (const node of def.nodes) expect(def.layout?.nodes[node.id], node.id).toBeDefined();
        const refs = collectRefs(raw);
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
          expect(typeof ref).toBe("object");
          expect(RefSchema.safeParse(ref).success).toBe(true);
        }
      });

      it("has exactly one input node, at least one output node and unique node/edge ids", () => {
        const def = WorkflowDefinitionSchema.parse(raw);
        expect(def.nodes.filter((n) => n.kind === "input")).toHaveLength(1);
        expect(def.nodes.filter((n) => n.kind === "output").length).toBeGreaterThan(0);
        expect(new Set(def.nodes.map((n) => n.id)).size).toBe(def.nodes.length);
        expect(new Set(def.edges.map((e) => e.id)).size).toBe(def.edges.length);
        const ids = new Set(def.nodes.map((n) => n.id));
        for (const e of def.edges) {
          expect(ids.has(e.from.node), e.id).toBe(true);
          expect(ids.has(e.to.node), e.id).toBe(true);
        }
        for (const n of def.nodes)
          if (n.parent !== undefined) expect(ids.has(n.parent), n.id).toBe(true);
      });
    });
  }

  for (const [name, raw] of Object.entries(VARIANTS)) {
    it(`${name} (knowledge-slice variant) parses and round-trips`, () => {
      const result = WorkflowDefinitionSchema.safeParse(raw);
      expect(
        result.success,
        JSON.stringify(result.success ? null : result.error.issues, null, 2),
      ).toBe(true);
      const parsed = WorkflowDefinitionSchema.parse(raw);
      expect(WorkflowDefinitionSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
      expect(new Set(parsed.nodes.map((n) => n.id)).size).toBe(parsed.nodes.length);
      for (const n of parsed.nodes) expect(parsed.layout?.nodes[n.id], n.id).toBeDefined();
    });
  }

  it("rejects a fixture with a missing $schema", () => {
    const raw = loadRaw("support-triage");
    if (typeof raw !== "object" || raw === null) throw new Error("bad fixture");
    const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "$schema"));
    expect(Object.keys(rest).length).toBe(Object.keys(raw).length - 1);
    expect(WorkflowDefinitionSchema.safeParse(rest).success).toBe(false);
  });
});

describe("z.toJSONSchema", () => {
  const targets = {
    WorkflowDefinitionSchema,
    NodeManifestSchema,
    ExecutionPlanSchema,
    RunEventSchema,
  };
  for (const [name, schema] of Object.entries(targets)) {
    it(`succeeds for ${name} and yields a valid JsonSchema document`, () => {
      const json = z.toJSONSchema(schema, { target: "draft-2020-12" });
      expect(json.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      const validated = JsonSchemaSchema.safeParse(json);
      expect(
        validated.success,
        JSON.stringify(validated.success ? null : validated.error.issues.slice(0, 3)),
      ).toBe(true);
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    });
  }

  it("emits the discriminator literals of RunEventSchema", () => {
    const json = z.toJSONSchema(RunEventSchema, { target: "draft-2020-12" });
    const text = JSON.stringify(json);
    for (const type of [
      "RUN_CREATED",
      "NODE_COMPLETED",
      "DECISION_COMPLETED",
      "HUMAN_APPROVAL_REQUESTED",
      "GENERATION_DELTA",
      "HEARTBEAT",
    ]) {
      expect(text).toContain(`"${type}"`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Template resources (ARCHITECTURE §11, API §templates, DATABASE `templates.required_resources`)
// ---------------------------------------------------------------------------------------------

const SENTINEL = /^\$template\.(mcp|knowledge)\.[a-z0-9_]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Config fields that name a workspace-scoped resource, with the sentinel kind each must use. */
const RESOURCE_FIELDS: Readonly<Record<string, "mcp" | "knowledge">> = {
  serverId: "mcp",
  sourceId: "knowledge",
};

const ResourceKeySchema = z.string().regex(/^[a-z0-9_]+$/);
/** `templates.required_resources` as DATABASE.md declares it. */
const RequiredResourcesSchema = z.strictObject({
  mcpServers: z.array(
    z.strictObject({
      key: ResourceKeySchema,
      description: z.string().min(1),
      requiredTools: z.array(z.string().min(1)).min(1),
    }),
  ),
  knowledgeSources: z.array(
    z.strictObject({ key: ResourceKeySchema, description: z.string().min(1) }),
  ),
});

/** The shipped templates: the three demos and the knowledge-slice variant of demo 2. */
const TEMPLATES: Record<string, unknown> = {
  "support-triage": supportTriage,
  "github-issue-triage": githubIssueTriage,
  "research-agent": researchAgent,
  ...VARIANTS,
};
/** Every definition document the fixtures ship (first-slice definitions plus variants). */
const ALL_DEFINITIONS: Record<string, unknown> = { ...FIXTURES, ...VARIANTS };

interface ResourceUse {
  field: string;
  value: unknown;
  /** `config.tool` of the node holding the field, when it names one. */
  tool: string | undefined;
}

/** Every `serverId`/`sourceId` field anywhere in a document, with the sibling `tool` of its config. */
function collectResourceFields(value: unknown, out: ResourceUse[] = []): ResourceUse[] {
  if (Array.isArray(value)) value.forEach((v) => collectResourceFields(v, out));
  else if (typeof value === "object" && value !== null) {
    const tool = "tool" in value && typeof value.tool === "string" ? value.tool : undefined;
    for (const [key, v] of Object.entries(value)) {
      if (key in RESOURCE_FIELDS) out.push({ field: key, value: v, tool });
      collectResourceFields(v, out);
    }
  }
  return out;
}

/** Every string in a document that starts with `$template.` (a sentinel, well-formed or not). */
function collectSentinels(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.startsWith("$template.")) out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => collectSentinels(v, out));
  else if (typeof value === "object" && value !== null)
    for (const v of Object.values(value)) collectSentinels(v, out);
  return out;
}

function taskTypes(raw: unknown): string[] {
  return WorkflowDefinitionSchema.parse(raw).nodes.flatMap((n) =>
    n.kind === "task" ? [n.type] : [],
  );
}

describe("template resources and sentinels", () => {
  it("ships one requiredResources block per template in fixtures/templates/", () => {
    const files = readdirSync(join(FIXTURES_DIR, "templates")).sort();
    expect(files).toEqual(
      Object.keys(TEMPLATES)
        .map((name) => `${name}.resources.json`)
        .sort(),
    );
  });

  for (const [name, raw] of Object.entries(ALL_DEFINITIONS)) {
    it(`${name}: no serverId/sourceId holds a uuid; each is a sentinel of the matching kind`, () => {
      for (const use of collectResourceFields(raw)) {
        expect(typeof use.value, `${name} ${use.field}`).toBe("string");
        const text = typeof use.value === "string" ? use.value : "";
        expect(UUID.test(text), `${name} ${use.field} = ${text}`).toBe(false);
        expect(z.uuid().safeParse(text).success, `${name} ${use.field} = ${text}`).toBe(false);
        expect(text, `${name} ${use.field}`).toMatch(SENTINEL);
        expect(text.split(".")[1], `${name} ${use.field}`).toBe(RESOURCE_FIELDS[use.field]);
      }
    });

    it(`${name}: every sentinel matches ^\\$template\\.(mcp|knowledge)\\.[a-z0-9_]+$`, () => {
      for (const s of collectSentinels(raw)) expect(s).toMatch(SENTINEL);
    });
  }

  it("example-support-reply is not a template: no sentinels and no workspace resources", () => {
    expect(collectSentinels(FIXTURES["example-support-reply"])).toEqual([]);
    expect(collectResourceFields(FIXTURES["example-support-reply"])).toEqual([]);
  });

  for (const [name, raw] of Object.entries(TEMPLATES)) {
    it(`${name}: every sentinel key is declared in ${name}.resources.json, and every declaration is used`, () => {
      const resources = RequiredResourcesSchema.parse(
        readJson("templates", `${name}.resources.json`),
      );
      const declared = {
        mcp: resources.mcpServers.map((s) => s.key),
        knowledge: resources.knowledgeSources.map((s) => s.key),
      };
      expect(new Set(declared.mcp).size).toBe(declared.mcp.length);
      expect(new Set(declared.knowledge).size).toBe(declared.knowledge.length);

      const used = { mcp: new Set<string>(), knowledge: new Set<string>() };
      for (const s of collectSentinels(raw)) {
        const match = SENTINEL.exec(s);
        expect(match, s).not.toBeNull();
        const kind = match?.[1];
        const key = s.split(".")[2] ?? "";
        if (kind === "mcp") used.mcp.add(key);
        else if (kind === "knowledge") used.knowledge.add(key);
      }
      expect([...used.mcp].sort()).toEqual([...declared.mcp].sort());
      expect([...used.knowledge].sort()).toEqual([...declared.knowledge].sort());

      // requiredTools lists exactly the tools the template calls on each server.
      for (const server of resources.mcpServers) {
        const tools = collectResourceFields(raw)
          .filter((u) => u.field === "serverId" && u.value === `$template.mcp.${server.key}`)
          .map((u) => u.tool);
        expect(
          tools.every((t) => t !== undefined),
          `${name} ${server.key}: every MCP node names its tool`,
        ).toBe(true);
        expect([...new Set(tools)].sort()).toEqual([...server.requiredTools].sort());
      }
    });
  }

  it("a malformed sentinel or an undeclared resource shape is rejected", () => {
    for (const bad of [
      "$template.mcp.GitHub",
      "$template.mcp.",
      "$template.kb.github",
      "$template.mcp.git-hub",
      "template.mcp.github",
      "$template.mcp.github.extra",
    ]) {
      expect(SENTINEL.test(bad), bad).toBe(false);
    }
    expect(
      RequiredResourcesSchema.safeParse({
        mcpServers: [{ key: "github", description: "x", requiredTools: [] }],
        knowledgeSources: [],
      }).success,
    ).toBe(false);
    expect(RequiredResourcesSchema.safeParse({ mcpServers: [] }).success).toBe(false);
  });
});

describe("first-slice demos use first-slice nodes only (ARCHITECTURE §11)", () => {
  for (const name of NAMES) {
    it(`${name} has no retrieval node`, () => {
      for (const type of taskTypes(FIXTURES[name]))
        expect(type.startsWith("flowaid.retrieval."), type).toBe(false);
    });
  }

  it("github-issue-triage finds similar issues with the GitHub MCP search_issues tool (§11.2)", () => {
    const def = WorkflowDefinitionSchema.parse(githubIssueTriage);
    const similar = def.nodes.find((n) => n.id === "similar");
    if (similar?.kind !== "task") throw new Error("similar is a task node");
    expect(similar.type).toBe("flowaid.tools.mcp");
    expect(similar.config).toEqual({ serverId: "$template.mcp.github", tool: "search_issues" });
    expect(Object.keys(similar.inputs).sort()).toEqual(["per_page", "q"]);
    expect(similar.inputs.q).toEqual({
      kind: "template",
      source: "repo:{{ start.repository.full_name }} is:issue {{ start.issue.title }}",
    });
    expect(similar.inputs.per_page).toEqual({ kind: "literal", value: 5 });
    expect(similar.credentials).toEqual({ mcp: "GITHUB_MCP" });
    // Consumers read the tool result, not the retriever's `hits` port.
    const text = JSON.stringify(githubIssueTriage);
    expect(text).not.toContain("similar.hits");
    expect(text).toContain("similar.result.items");
  });

  it("the retrieval variant keeps the knowledge-slice retriever behind a knowledge sentinel", () => {
    const variant = VARIANTS["github-issue-triage.retrieval"];
    const def = WorkflowDefinitionSchema.parse(variant);
    const similar = def.nodes.find((n) => n.id === "similar");
    if (similar?.kind !== "task") throw new Error("similar is a task node");
    expect(similar.type).toBe("flowaid.retrieval.retriever");
    expect(similar.config.sourceId).toBe("$template.knowledge.github_issues");
    expect(def.id).not.toBe(WorkflowDefinitionSchema.parse(githubIssueTriage).id);
  });
});

// ---------------------------------------------------------------------------------------------
// Confidence gate (ARCHITECTURE §6.3) and the example plan that embeds its manifest
// ---------------------------------------------------------------------------------------------

const ARCHITECTURE = readFileSync(
  join(FIXTURES_DIR, "..", "..", "..", "docs", "design", "ARCHITECTURE.md"),
  "utf8",
);
/** The gate semantics paragraph of §6.3, which the manifest's `configSchema.description` copies verbatim. */
function architectureGateSemantics(): string {
  const start =
    "**Gate semantics, defined once here and copied into the node's `configSchema` description**: ";
  const from = ARCHITECTURE.indexOf(start);
  expect(from, "ARCHITECTURE §6.3 gate semantics").toBeGreaterThan(-1);
  const rest = ARCHITECTURE.slice(from + start.length);
  const end = rest.indexOf(" `router` (");
  expect(end).toBeGreaterThan(0);
  return rest.slice(0, end);
}

describe("flowaid.decision.confidence_gate manifest", () => {
  const raw = readJson("manifests", "flowaid.decision.confidence_gate.json");

  it("still parses unchanged with NodeManifestSchema", () => {
    const result = NodeManifestSchema.safeParse(raw);
    expect(
      result.success,
      JSON.stringify(result.success ? null : result.error.issues, null, 2),
    ).toBe(true);
    expect(NodeManifestSchema.parse(raw)).toEqual(raw);
  });

  it("declares pass | review | fail control ports and the outcome output", () => {
    const m = NodeManifestSchema.parse(raw);
    expect(m.controlPorts.map((p) => p.name)).toEqual(["pass", "review", "fail"]);
    expect(m.outputs.map((p) => p.name)).toEqual(["decision", "passed", "outcome"]);
    const outcome = m.outputs.find((p) => p.name === "outcome");
    expect(outcome?.required).toBe(true);
    expect(outcome?.schema).toEqual({ type: "string", enum: ["pass", "review", "fail"] });
  });

  it("has threshold (bindable), requireValue and an optional reviewBand slider in [0, 1]", () => {
    const m = NodeManifestSchema.parse(raw);
    const props = m.configSchema.properties ?? {};
    expect(Object.keys(props)).toEqual(["threshold", "requireValue", "reviewBand"]);
    expect(m.configSchema.required).toEqual(["threshold"]);
    expect(props.threshold?.["x-ui"]?.bindable).toBe(true);
    const band = props.reviewBand;
    expect(band).toMatchObject({ type: "number", minimum: 0, maximum: 1 });
    expect(band?.["x-ui"]).toMatchObject({ widget: "slider", min: 0, max: 1 });
    expect(band?.default).toBeUndefined();
  });

  it("copies the §6.3 gate semantics into configSchema.description verbatim", () => {
    const m = NodeManifestSchema.parse(raw);
    expect(m.configSchema.description).toBe(architectureGateSemantics());
  });
});

describe("fixtures/plans/example-support-reply.plan.json embeds the current manifests", () => {
  const plan = ExecutionPlanSchema.parse(readJson("plans", "example-support-reply.plan.json"));

  it("every embedded task manifest deep-equals its fixtures/manifests file", () => {
    let checked = 0;
    for (const n of Object.values(plan.nodes)) {
      if (n.op.kind !== "task") continue;
      expect(n.op.manifest, n.id).toEqual(
        NodeManifestSchema.parse(readJson("manifests", `${n.op.type}.json`)),
      );
      checked += 1;
    }
    expect(checked).toBe(5);
  });

  it("the gate node exposes the manifest control ports and outputs", () => {
    const gate = plan.nodes.gate;
    if (gate?.op.kind !== "task") throw new Error("gate is a task node");
    expect(gate.controlOut).toEqual(["done", "pass", "review", "fail"]);
    expect(Object.keys(gate.outputs)).toEqual(["decision", "passed", "outcome"]);
    expect(gate.outputs.outcome).toEqual({ type: "string", enum: ["pass", "review", "fail"] });
  });
});
