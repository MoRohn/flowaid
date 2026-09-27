/**
 * The FlowAId importer's golden fixtures compiled against the real catalog (core nodes plus the
 * bundled LangChain package): imported flows compile, and the only errors are the placeholders
 * the importer flagged.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importExternalFlow } from "@flowaid/importer";
import { coreManifests } from "@flowaid/nodes-core/manifest";
import { compile } from "@flowaid/workflow-compiler";
import type { NodeManifest } from "@flowaid/workflow-core";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FIXTURES = join(ROOT, "packages", "importer", "fixtures");
const langchain = (
  JSON.parse(readFileSync(join(ROOT, "packages", "nodes-langchain", "manifest.json"), "utf8")) as {
    nodes: NodeManifest[];
  }
).nodes;
const all = [...coreManifests, ...langchain];
const catalog = {
  get: (id: string, version?: string) =>
    all.find((m) => m.id === id && (!version || m.version === version)),
  list: () => all,
};

describe("imported fixtures compile against the FlowAId catalog", () => {
  it.each(readdirSync(FIXTURES).filter((f) => f.endsWith(".json")))("%s", (file) => {
    const { definition, report } = importExternalFlow(
      JSON.parse(readFileSync(join(FIXTURES, file), "utf8")),
    );
    const result = compile(definition, { catalog, level: "draft" });
    const errors = result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
    if (report.counts.unsupported === 0) {
      expect(errors).toEqual([]);
      expect(result.ok).toBe(true);
    } else {
      // compilation stops at the placeholders, and nothing else is wrong before them
      expect(new Set(errors)).toEqual(new Set(["E_IMPORT_UNSUPPORTED"]));
      expect(errors).toHaveLength(report.counts.unsupported);
    }
  });

  it("compiles the rest of a flow once its placeholders are removed", () => {
    const { definition } = importExternalFlow(
      JSON.parse(readFileSync(join(FIXTURES, "agentflow-operations.json"), "utf8")),
    );
    const drop = new Set(
      definition.nodes
        .filter((n) => n.kind === "task" && n.type === "flowaid.dev.todo")
        .map((n) => n.id),
    );
    const outputsOfDropped = new Set(
      definition.edges.filter((e) => drop.has(e.from.node)).map((e) => e.to.node),
    );
    const gone = new Set([...drop, ...outputsOfDropped]);
    const result = compile(
      {
        ...definition,
        nodes: definition.nodes.filter((n) => !gone.has(n.id)),
        edges: definition.edges.filter((e) => !gone.has(e.from.node) && !gone.has(e.to.node)),
      },
      { catalog, level: "draft" },
    );
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});
