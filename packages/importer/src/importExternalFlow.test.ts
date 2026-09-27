import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowDefinitionSchema, type WorkflowNode } from "@flowaid/workflow-core";
import {
  ExternalFlowError,
  importExternalFlow,
  isExternalFlowExport,
  sanitizeInputs,
  unwrapRichText,
  type ImportResult,
} from "./index.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const ID = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";
const load = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const run = (name: string): ImportResult => importExternalFlow(load(name), { id: ID });
const node = (r: ImportResult, id: string): WorkflowNode => {
  const n = r.definition.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};

describe("golden fixtures: counts per status", () => {
  it.each([
    [
      "agentflow-support-router.json",
      "agentflow",
      { imported: 7, converted: 1, needsConfig: 0, unsupported: 0 },
    ],
    [
      "agentflow-operations.json",
      "agentflow",
      { imported: 2, converted: 6, needsConfig: 2, unsupported: 1 },
    ],
    [
      "chatflow-rag.json",
      "chatflow",
      { imported: 2, converted: 3, needsConfig: 2, unsupported: 0 },
    ],
    [
      "chatflow-llm-chain.json",
      "chatflow",
      { imported: 1, converted: 2, needsConfig: 0, unsupported: 1 },
    ],
  ] as const)("%s", (file, format, counts) => {
    const r = run(file);
    expect(r.report.format).toBe(format);
    expect(r.report.counts).toEqual(counts);
    // a valid definition, and every source node is accounted for
    expect(() => WorkflowDefinitionSchema.parse(r.definition)).not.toThrow();
    const unsupported = r.definition.nodes.filter(
      (n) => n.kind === "task" && n.type === "flowaid.dev.todo",
    );
    expect(unsupported).toHaveLength(counts.unsupported);
  });

  it("is deterministic for a given id", () => {
    expect(JSON.stringify(run("agentflow-operations.json"))).toBe(
      JSON.stringify(run("agentflow-operations.json")),
    );
  });
});

describe("sanitising", () => {
  it("never carries credentials, API keys or auth headers into the definition", () => {
    for (const f of [
      "agentflow-support-router.json",
      "agentflow-operations.json",
      "chatflow-rag.json",
      "chatflow-llm-chain.json",
    ]) {
      const text = JSON.stringify(run(f).definition);
      expect(text, f).not.toMatch(
        /sk-(live|should)|7c1f7d2e-cred|a91f-cred|cred-(emb|pc|anthropic)|Bearer /,
      );
    }
  });

  it("reports removed secrets and declares the secrets to bind", () => {
    const r = run("agentflow-operations.json");
    expect(
      r.report.issues.some(
        (i) => i.code === "W_IMPORT_CREDENTIAL_REMOVED" && i.nodeId === "http_0",
      ),
    ).toBe(true);
    expect(r.report.secrets).toContain("HTTP_0_AUTH");
    expect(node(r, "http_0")).toMatchObject({
      credentials: { auth: "HTTP_0_AUTH" },
      config: { headers: { Accept: "application/json" } },
    });
    const s = sanitizeInputs({
      id: "x",
      data: {
        name: "x",
        inputs: {
          apiKey: "k",
          nested: { password: "p", ok: 1 },
          headers: [{ key: "Cookie", value: "c" }],
        },
      },
    });
    expect(s.value).toEqual({ nested: { ok: 1 }, headers: [] });
    expect(s.removed).toEqual(["apiKey", "nested.password", "headers[0]"]);
  });
});

describe("agent flows", () => {
  const r = run("agentflow-support-router.json");

  it("maps the start node, state and chat input", () => {
    expect(node(r, "start").kind).toBe("input");
    expect(r.definition.inputs).toMatchObject({
      properties: { question: { type: "string" } },
      required: ["question"],
    });
    expect(r.definition.variables).toContainEqual(
      expect.objectContaining({ name: "tier", default: "standard" }),
    );
  });

  it("turns the LLM classifier into a TypeSafe router whose routes are the scenarios", () => {
    expect(node(r, "condition_agent_0")).toMatchObject({
      type: "flowaid.decision.router",
      config: {
        routes: { billing_question: "Billing question", technical_issue: "Technical issue" },
      },
      inputs: { state: { kind: "expr", source: "start.question" } },
      credentials: { typesafe: "TYPESAFE_API_KEY" },
    });
    expect(r.report.issues.some((i) => i.code === "W_IMPORT_PROVIDER_CHANGED")).toBe(true);
    const ports = r.definition.edges
      .filter((e) => e.from.node === "condition_agent_0")
      .map((e) => e.from.port);
    expect(ports.sort()).toEqual(["billing_question", "technical_issue"]);
  });

  it("translates templates, state and rich text", () => {
    expect(node(r, "llm_0")).toMatchObject({
      config: {
        model: { provider: "openai", model: "gpt-4o-mini" },
        system: "You answer billing questions for a {{ $vars.tier }} customer.",
      },
      inputs: { prompt: { kind: "expr", source: "start.question" } },
    });
    expect(node(r, "human_input_0")).toMatchObject({
      kind: "human",
      title: { kind: "template", source: "Send this reply? {{ llm_0.text }}" },
    });
    expect(node(r, "direct_reply_0")).toMatchObject({
      kind: "output",
      value: { fields: { answer: { kind: "expr", source: "llm_0.text" } } },
    });
    const human = r.definition.edges
      .filter((e) => e.from.node === "human_input_0")
      .map((e) => `${e.from.port}>${e.to.node}`);
    expect(human.sort()).toEqual(["approved>direct_reply_0", "rejected>direct_reply_1"]);
  });

  it("adds an output for a flow branch that ends without a reply", () => {
    expect(node(r, "out_llm_1")).toMatchObject({
      kind: "output",
      value: { fields: { answer: { ref: { node: "llm_1", port: "text" } } } },
    });
  });
});

describe("containers and flagged nodes", () => {
  const r = run("agentflow-operations.json");

  it("maps form inputs, HTTP templates and number conditions", () => {
    expect(r.definition.inputs).toMatchObject({
      properties: { ticket_id: { type: "string" }, priority: { type: "number" } },
    });
    expect(node(r, "http_0")).toMatchObject({
      config: { url: "https://api.example.com/tickets/{{ start.ticket_id }}" },
    });
    expect(node(r, "condition_0")).toMatchObject({
      kind: "branch",
      cases: [{ port: "case_1", when: "to_number(start.priority) > to_number(3)" }],
    });
  });

  it("wraps iteration children in a foreach reading $scope.item", () => {
    expect(node(r, "iteration_0")).toMatchObject({
      kind: "foreach",
      items: { kind: "expr", source: "custom_function_0.result" },
    });
    expect(node(r, "llm_1")).toMatchObject({
      parent: "iteration_0",
      inputs: { prompt: { kind: "template", source: "Summarise: {{ $scope.item }}" } },
    });
  });

  it("turns a back-edge loop into a loop container and routes later reads through its result", () => {
    expect(node(r, "loop_0")).toMatchObject({
      kind: "loop",
      bounds: { maxIterations: 3 },
      onExhausted: "route",
    });
    expect(node(r, "llm_2").parent).toBe("loop_0");
    expect(node(r, "agent_0")).toMatchObject({
      inputs: { task: { source: "Find context for {{ loop_0.result.llm_2 }}" } },
    });
    expect(r.definition.edges).toContainEqual(
      expect.objectContaining({
        from: { node: "loop_0", port: "exhausted" },
        to: { node: "agent_0" },
      }),
    );
    expect(r.definition.edges).toContainEqual(
      expect.objectContaining({
        from: { node: "condition_0", port: "else" },
        to: { node: "loop_0" },
      }),
    );
  });

  it("keeps an untranslatable node as a placeholder that fails compilation", () => {
    expect(node(r, "tool_0")).toMatchObject({
      type: "flowaid.dev.todo",
      config: { sourceType: "toolAgentflow" },
    });
    expect(r.report.issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual([
      "E_IMPORT_UNSUPPORTED",
    ]);
  });
});

describe("LangChain chat flows", () => {
  it("rebuilds a retrieval chain as load → split → index → retrieve → answer", () => {
    const r = run("chatflow-rag.json");
    expect(r.definition.name).toBe("Docs Q&A");
    const types = r.definition.nodes.map((n) =>
      n.kind === "task" ? n.type.replace("@flowaid/nodes-langchain.", "lc.") : n.kind,
    );
    expect(types).toEqual([
      "input",
      "lc.document_loader",
      "lc.text_splitter",
      "lc.vector_store",
      "lc.retriever",
      "lc.chat",
      "output",
    ]);
    const retrieve = r.definition.nodes.find((n) => n.id === "retrieve");
    expect(retrieve).toMatchObject({
      config: { store: "pinecone", collection: "handbook", k: 6 },
      credentials: { store: "PINECONE_API_KEY" },
    });
    const answer = r.definition.nodes.find((n) => n.id === "answer");
    expect(answer).toMatchObject({
      inputs: {
        variables: { fields: { context: { ref: { node: "retrieve", port: "context" } } } },
      },
    });
    expect(r.report.issues.some((i) => /memory is not imported/.test(i.message))).toBe(true);
  });

  it("maps prompt templates onto chat messages and their values", () => {
    const r = run("chatflow-llm-chain.json");
    expect(r.definition.nodes.find((n) => n.id === "answer")).toMatchObject({
      config: {
        model: { provider: "anthropic", model: "claude-sonnet-4-5" },
        messages: [{ role: "human" }],
      },
      inputs: {
        variables: {
          fields: {
            language: { kind: "literal", value: "French" },
            text: { ref: { node: "start", port: "question" } },
          },
        },
      },
    });
  });
});

describe("detection and parsing", () => {
  it("tells exports from FlowAId definitions", () => {
    expect(isExternalFlowExport(load("chatflow-llm-chain.json"))).toBe(true);
    expect(isExternalFlowExport(run("chatflow-llm-chain.json").definition)).toBe(false);
    expect(isExternalFlowExport({ nodes: [] })).toBe(false);
  });

  it("rejects documents that are not flows", () => {
    expect(() => importExternalFlow({ hello: 1 })).toThrow(ExternalFlowError);
  });

  it("unwraps rich text and mention chips", () => {
    expect(
      unwrapRichText(
        '<p>Hi <span data-type="mention" data-id="question">x</span> &amp; bye</p><p>2</p>',
      ),
    ).toBe("Hi {{ question }} & bye\n2");
  });
});
