/**
 * The retrieval variant of the GitHub triage template (P6-09): compiled against the core
 * manifests, then driven through the scheduler's golden-trace harness. The retrieval nodes are
 * the real ones over an in-memory knowledge base with the hashed fake embedding; decisions and
 * tool calls are fakes. The first issue is new and gets indexed; a near-identical second issue is
 * found by hybrid search and closed as its duplicate.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KnowledgeService,
  MemoryIndex,
  MemoryKnowledgeStore,
  fakeEmbeddingProvider,
} from "@flowaid/knowledge";
import type { AnyNodeDefinition } from "@flowaid/node-sdk";
import { runNode } from "@flowaid/node-sdk/testing";
import { CORE_NODES } from "@flowaid/nodes-core";
import { coreManifests } from "@flowaid/nodes-core/manifest";
import { compile } from "@flowaid/workflow-compiler";
import {
  ToolDefinitionSchema,
  type JsonObject,
  type ToolDefinition,
  type ToolSource,
} from "@flowaid/workflow-core";
import { okResult, simulate, type FakeCall } from "@flowaid/workflow-runtime/testing";

const TEMPLATES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/nodes-core/templates",
);
const NAME = "github-issue-triage.retrieval";
const idFor = (key: string) =>
  `00000000-0000-4000-8000-${Buffer.from(key).toString("hex").padEnd(12, "0").slice(0, 12)}`;
const SOURCE = idFor("github_issues");

const resources = JSON.parse(readFileSync(join(TEMPLATES, `${NAME}.resources.json`), "utf8")) as {
  requiredResources: { kind: string; key: string; tools: { name: string }[] }[];
};
const definition = JSON.parse(
  readFileSync(join(TEMPLATES, `${NAME}.json`), "utf8").replace(
    /"\$template\.(?:mcp|knowledge)\.([a-z0-9_]+)"/g,
    (_m, key: string) => `"${idFor(key)}"`,
  ),
) as unknown;
const resolveTool = (source: ToolSource): ToolDefinition | undefined => {
  if (source.kind !== "mcp") return undefined;
  const r = resources.requiredResources.find((x) => idFor(x.key) === source.serverId);
  const tool = r?.tools.find((t) => t.name === source.tool);
  return tool ? ToolDefinitionSchema.parse({ ...tool, source }) : undefined;
};
const catalog = {
  get: (id: string) => coreManifests.find((m) => m.id === id),
  list: () => [...coreManifests],
};

const boolean = (value: boolean, confidence: number) => ({
  decision: {
    kind: "boolean",
    value,
    confidence,
    pYes: value ? confidence : 1 - confidence,
    provider: "fake",
    model: "judge",
    latencyMs: 1,
    costUsd: 0,
    attempts: [],
  },
});

function knowledgeBase() {
  const store = new MemoryKnowledgeStore();
  store.addSource({
    id: SOURCE,
    name: "Past issues",
    kind: "github",
    pipeline: { embedding: { provider: "fake", model: "hashed-bow" } },
  });
  const index = new MemoryIndex();
  let seq = 0;
  return new KnowledgeService({
    store,
    index: () => index,
    embedder: () => Promise.resolve(fakeEmbeddingProvider()),
    newId: () => `chunk-${++seq}`,
  });
}

/** A real node as the harness's executor, with `ctx.knowledge` bound. */
const real = (id: string, knowledge: KnowledgeService) => async (call: FakeCall) => {
  const def = CORE_NODES.find((n) => n.id === id) as AnyNodeDefinition;
  const { result } = await runNode(def, { config: call.config, input: call.input, knowledge });
  if (result.kind !== "ok") throw new Error(`${id}: ${JSON.stringify(result)}`);
  return okResult(result.output as JsonObject, {
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
  });
};

describe("template github-issue-triage.retrieval (golden trace, fake embeddings)", () => {
  const compiled = compile(definition, { catalog, resolveTool });

  it("compiles against the core manifests", () => {
    expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(compiled.ok).toBe(true);
  });

  it("indexes a new issue, then finds the next one as its duplicate", async () => {
    if (!compiled.ok) throw new Error("does not compile");
    const knowledge = knowledgeBase();
    const tools: string[] = [];
    const executors = {
      actionable: () => okResult(boolean(true, 0.95)),
      classify: () =>
        okResult({
          answers: {
            kind: { kind: "choice", value: "bug", confidence: 0.9 },
            severity: { kind: "score", value: 2, confidence: 0.8, levelLabel: "Moderate" },
          },
        }),
      // a duplicate when the search found a candidate
      dup_judge: (c: FakeCall) =>
        okResult(boolean((c.input.state as JsonObject).candidate != null, 0.92)),
      labels: () => okResult({ result: ["bug", "severity:moderate"] }),
      "flowaid.tools.mcp": (c: FakeCall) => {
        tools.push(`${c.config.tool as string}#${c.input.issue_number as number}`);
        return okResult({ result: { id: 1, html_url: "https://github.com/acme/app/issues/1" } });
      },
      "flowaid.retrieval.hybrid_search": real("flowaid.retrieval.hybrid_search", knowledge),
      "flowaid.retrieval.upsert": real("flowaid.retrieval.upsert", knowledge),
    };
    const issue = (number: number, title: string, body: string) => ({
      action: "opened",
      repository: { full_name: "acme/app" },
      issue: { number, title, body, html_url: `https://github.com/acme/app/issues/${number}` },
    });

    const first = await simulate({
      plan: compiled.plan,
      input: issue(41, "App crashes when saving a file", "Saving any file crashes the editor."),
      executors,
    });
    expect(first.status).toBe("completed");
    expect(first.of("RUN_COMPLETED")[0]?.output).toMatchObject({
      handled: true,
      route: "backlog",
      labels: ["bug", "severity:moderate"],
    });
    expect(first.statuses()).toMatchObject({ remember: "completed", gh_dup_comment: "skipped" });
    expect(await knowledge.sources()).toMatchObject([{ id: SOURCE, documents: 1 }]);

    const second = await simulate({
      plan: compiled.plan,
      input: issue(42, "Crash when saving a file", "The editor crashes every time I save a file."),
      executors,
    });
    expect(second.status).toBe("completed");
    expect(second.of("RUN_COMPLETED")[0]?.output).toMatchObject({
      handled: true,
      route: "duplicate",
      duplicate_of: 41,
    });
    expect(second.statuses()).toMatchObject({ similar: "completed", remember: "skipped" });
    expect(tools).toEqual(["add_issue_labels#41", "add_issue_comment#42"]);
  });
});
