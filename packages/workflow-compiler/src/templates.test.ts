/**
 * The shipped templates (`packages/nodes-core/templates`) compile with zero errors against the real
 * core node manifests (`packages/nodes-core/manifest.json`, read as data — the compiler never imports
 * nodes-core), with tools resolved from each template's `requiredResources`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NodeManifestSchema,
  ToolDefinitionSchema,
  type ToolDefinition,
  type ToolSource,
} from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { catalogOf } from "./test/support.js";

const NODES_CORE = join(dirname(fileURLToPath(import.meta.url)), "../../nodes-core");
const read = (...p: string[]): unknown => JSON.parse(readFileSync(join(NODES_CORE, ...p), "utf8"));

const manifests = (read("manifest.json") as { nodes: unknown[] }).nodes.map((m) =>
  NodeManifestSchema.parse(m),
);
const catalog = catalogOf(manifests);

const templates = readdirSync(join(NODES_CORE, "templates"))
  .filter((f) => f.endsWith(".json") && !f.endsWith(".resources.json"))
  .map((f) => f.slice(0, -5));

interface Resources {
  requiredResources: { kind: string; key: string; tools: { name: string }[] }[];
}

describe.each(templates)("template %s", (name) => {
  const resources = read("templates", `${name}.resources.json`) as Resources;
  const idFor = (key: string) =>
    `00000000-0000-4000-8000-${Buffer.from(key).toString("hex").padEnd(12, "0").slice(0, 12)}`;
  const definition = JSON.parse(
    readFileSync(join(NODES_CORE, "templates", `${name}.json`), "utf8").replace(
      /"\$template\.(?:mcp|knowledge)\.([a-z0-9_]+)"/g,
      (_m, key: string) => `"${idFor(key)}"`,
    ),
  ) as unknown;
  const resolveTool = (source: ToolSource): ToolDefinition | undefined => {
    if (source.kind !== "mcp") return undefined;
    const resource = resources.requiredResources.find((r) => idFor(r.key) === source.serverId);
    const tool = resource?.tools.find((t) => t.name === source.tool);
    return tool ? ToolDefinitionSchema.parse({ ...tool, source }) : undefined;
  };

  it("compiles with zero errors against the core manifests", () => {
    const result = compile(definition, { catalog, resolveTool });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

/**
 * The LangChain template (`packages/nodes-langchain/templates`) compiles against the core and the
 * `@flowaid/nodes-langchain` manifests (both read as data), like a workspace with the bundled plugin.
 */
describe("template knowledge-assistant-langchain-rag", () => {
  const NODES_LANGCHAIN = join(NODES_CORE, "../nodes-langchain");
  const readLc = (...p: string[]): unknown =>
    JSON.parse(readFileSync(join(NODES_LANGCHAIN, ...p), "utf8"));
  const lcManifests = (readLc("manifest.json") as { nodes: unknown[] }).nodes.map((m) =>
    NodeManifestSchema.parse(m),
  );
  const definition = readLc("templates", "knowledge-assistant-langchain-rag.json");

  it("compiles with zero errors against the core and LangChain manifests", () => {
    const result = compile(definition, { catalog: catalogOf([...manifests, ...lcManifests]) });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("does not compile without the LangChain manifests", () => {
    const result = compile(definition, { catalog });
    expect(result.diagnostics.map((d) => d.code)).toContain("E_UNKNOWN_NODE_TYPE");
  });
});

/** A template made without choosing its resources names what to choose, never a schema regex. */
describe("templates with unresolved placeholders", () => {
  it.each(templates)("%s reports each placeholder once, in words", (name) => {
    const raw = readFileSync(join(NODES_CORE, "templates", `${name}.json`), "utf8");
    const count = raw.match(/"\$template\.[a-z]+\.[A-Za-z0-9_-]+"/g)?.length ?? 0;
    const result = compile(JSON.parse(raw) as unknown, { catalog });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    const placeholders = errors.filter((d) =>
      /still holds the placeholder \$template\./.test(d.message),
    );
    expect(placeholders.length).toBeGreaterThanOrEqual(count > 0 ? 1 : 0);
    for (const d of errors) {
      expect(d.message).not.toMatch(/must match pattern|\[0-9a-fA-F\]/);
      expect(d.message).not.toMatch(/^config\//);
    }
  });

  it("pageindex-agent asks for the knowledge source by name", () => {
    const definition = read("templates", "pageindex-agent.json");
    const result = compile(definition, { catalog });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([
      expect.objectContaining({
        code: "E_TOOL_UNRESOLVED",
        message:
          "Choose the knowledge source for Documents › Source IDs › item 1: this node came from a template and still holds the placeholder $template.knowledge.documents",
        location: expect.objectContaining({
          path: expect.stringMatching(/\/config\/documents\/sourceIds\/0$/),
        }),
      }),
    ]);
  });
});
