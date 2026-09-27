import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NodeManifestSchema, WorkflowDefinitionSchema } from "@flowaid/workflow-core";
import { LANGCHAIN_NODES } from "./index.js";
import { buildManifest, langchainManifests } from "./manifest.js";
import { langchainProviderDescriptors, langchainTemplates } from "./manifestFile.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("manifest.json", () => {
  it("is up to date (pnpm --filter @flowaid/nodes-langchain manifest)", () => {
    expect(readFileSync(join(ROOT, "manifest.json"), "utf8")).toBe(buildManifest());
  });

  it("every manifest parses, is plugin-prefixed and declares its capabilities", () => {
    for (const m of langchainManifests()) {
      expect(NodeManifestSchema.safeParse(m).success, m.id).toBe(true);
      expect(m.id).toMatch(/^@flowaid\/nodes-langchain\.[a-z_]+$/);
    }
    expect(langchainManifests()).toHaveLength(LANGCHAIN_NODES.length);
  });

  it("is reproducible and lists the langchain:* provider descriptors", () => {
    expect(buildManifest()).toBe(buildManifest());
    expect(
      langchainProviderDescriptors.map((p) => `${p.kind}:${p.id}:${p.credentialType ?? "-"}`),
    ).toEqual([
      "embedding:langchain:ollama:-",
      "embedding:langchain:openai:openai.api_key",
      "generation:langchain:anthropic:anthropic.api_key",
      "generation:langchain:ollama:-",
      "generation:langchain:openai:openai.api_key",
    ]);
  });
});

describe("templates", () => {
  it("ships the Knowledge assistant (LangChain RAG) template, valid and marked as needing LangChain", () => {
    expect(langchainTemplates.map((t) => t.id)).toEqual(["knowledge-assistant-langchain-rag"]);
    const t = langchainTemplates[0];
    expect(t).toMatchObject({
      name: "Knowledge assistant (LangChain RAG)",
      requires: ["langchain"],
      requiredResources: [],
    });
    expect(WorkflowDefinitionSchema.safeParse(t?.definition).success).toBe(true);
    const types = new Set(
      (t?.definition as { nodes: { type?: string }[] }).nodes.flatMap((n) =>
        n.type ? [n.type] : [],
      ),
    );
    // loader → splitter → embed → vector store → retriever → TypeSafe decisions → chat → safety → gate
    expect([...types].sort()).toEqual([
      "@flowaid/nodes-langchain.chat",
      "@flowaid/nodes-langchain.document_loader",
      "@flowaid/nodes-langchain.embed",
      "@flowaid/nodes-langchain.retriever",
      "@flowaid/nodes-langchain.text_splitter",
      "@flowaid/nodes-langchain.vector_store",
      "flowaid.decision.batch",
      "flowaid.decision.confidence_gate",
    ]);
  });
});
