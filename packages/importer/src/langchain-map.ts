/**
 * LangChain chat-flow exports → `@flowaid/nodes-langchain` (ARCHITECTURE.md §10.9, LANGCHAIN.md).
 * A chat flow wires LangChain components (models, embeddings, loaders, splitters, vector stores,
 * prompts, memory) into one chain or agent. The importer recognises the component roles and
 * rebuilds the same pipeline as explicit FlowAId steps: optional ingestion (loader → splitter →
 * vector store), retrieval, then the chat or agent node, then the output. Models become node
 * configuration; everything the importer changes is reported (`W_IMPORT_APPROXIMATE`,
 * `W_IMPORT_PROVIDER_CHANGED`), and components without an equivalent become placeholders.
 */
import type { Binding, JsonObject, JsonValue } from "@flowaid/workflow-core";
import { portRef, type Builder, type ProviderChoice } from "./builder.js";
import { chatProvider, embeddingProvider } from "./providers.js";
import { sanitizeInputs } from "./sanitize.js";
import { unwrapRichText } from "./templates.js";
import type { SourceFlow, SourceNode } from "./types.js";

const LC = "@flowaid/nodes-langchain";

const CHAT_MODELS = new Set([
  "chatOpenAI",
  "azureChatOpenAI",
  "chatOpenAICustom",
  "chatAnthropic",
  "chatOllama",
  "chatGoogleGenerativeAI",
  "chatGoogleVertexAI",
  "groqChat",
  "chatMistralAI",
  "chatCohere",
  "awsChatBedrock",
  "chatTogetherAI",
]);
const EMBEDDINGS = new Set([
  "openAIEmbeddings",
  "azureOpenAIEmbeddings",
  "ollamaEmbedding",
  "googleGenerativeAiEmbeddings",
  "cohereEmbeddings",
  "huggingFaceInferenceEmbeddings",
  "voyageAIEmbeddings",
]);
const LOADERS: Record<string, { source: string; input?: { name: string; schema: JsonObject } }> = {
  plainText: { source: "text" },
  textFile: { source: "text", input: { name: "document_text", schema: { type: "string" } } },
  pdfFile: { source: "text", input: { name: "document_text", schema: { type: "string" } } },
  docxFile: { source: "text", input: { name: "document_text", schema: { type: "string" } } },
  csvFile: { source: "csv", input: { name: "document_csv", schema: { type: "string" } } },
  jsonFile: { source: "json", input: { name: "document_json", schema: {} } },
  cheerioWebScraper: { source: "url" },
  playwrightWebScraper: { source: "url" },
  puppeteerWebScraper: { source: "url" },
  sitemap: { source: "sitemap" },
  github: { source: "github" },
};
const SPLITTERS: Record<string, string> = {
  recursiveCharacterTextSplitter: "recursive",
  characterTextSplitter: "character",
  markdownTextSplitter: "markdown",
  codeTextSplitter: "code",
  tokenTextSplitter: "recursive",
  htmlToMarkdownTextSplitter: "markdown",
};
const VECTOR_STORES = new Set([
  "memoryVectorStore",
  "faiss",
  "pinecone",
  "qdrant",
  "chroma",
  "supabase",
  "postgres",
  "pgvector",
  "weaviate",
  "milvus",
  "redis",
  "elasticsearch",
  "mongoDBAtlas",
]);
const RETRIEVAL_CHAINS = new Set([
  "conversationalRetrievalQAChain",
  "retrievalQAChain",
  "multiRetrievalQAChain",
  "vectorDBQAChain",
]);
const CHAT_CHAINS = new Set(["conversationChain", "llmChain", "multiPromptChain"]);
const AGENTS = new Set([
  "conversationalAgent",
  "toolAgent",
  "openAIToolAgent",
  "openAIFunctionAgent",
  "reactAgentChat",
  "reactAgentLLM",
  "mrklAgentChat",
  "conversationalRetrievalToolAgent",
]);
const PROMPTS = new Set(["chatPromptTemplate", "promptTemplate", "fewShotPromptTemplate"]);
const MEMORY = /memory$/i;
const TOOLS_CATEGORY = /^tools?$/i;

type Inputs = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** `{name}` placeholders a prompt uses (`{{` escapes excluded). */
function placeholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.replace(/\{\{|\}\}/g, "").matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g))
    out.add(m[1] as string);
  return [...out];
}

function first<T>(list: T[], b: Builder, what: string): T | undefined {
  if (list.length > 1)
    b.issue(
      "W_IMPORT_APPROXIMATE",
      `the flow has ${list.length} ${what}; only the first was imported`,
    );
  return list[0];
}

export function importChatFlow(flow: SourceFlow, b: Builder): void {
  const by = (pred: (n: SourceNode) => boolean) => flow.nodes.filter(pred);
  const chats = by((n) => CHAT_MODELS.has(n.data.name));
  const embeds = by((n) => EMBEDDINGS.has(n.data.name));
  const loaders = by((n) => n.data.name in LOADERS);
  const splitters = by((n) => n.data.name in SPLITTERS);
  const stores = by((n) => VECTOR_STORES.has(n.data.name));
  const prompts = by((n) => PROMPTS.has(n.data.name));
  const memories = by((n) => MEMORY.test(n.data.name));
  const agents = by((n) => AGENTS.has(n.data.name));
  const retrievalChains = by((n) => RETRIEVAL_CHAINS.has(n.data.name));
  const chatChains = by((n) => CHAT_CHAINS.has(n.data.name));
  const tools = by((n) => TOOLS_CATEGORY.test(n.data.category ?? ""));
  const handled = new Set<SourceNode>([
    ...chats,
    ...embeds,
    ...loaders,
    ...splitters,
    ...stores,
    ...prompts,
    ...memories,
    ...agents,
    ...retrievalChains,
    ...chatChains,
    ...tools,
  ]);

  b.reserve("start");
  b.input("question", { type: "string" }, true);
  b.add({ id: "start", kind: "input", name: "Question", disabled: false }, { x: 0, y: 0 });
  let x = 320;
  const place = () => {
    const at = { x, y: 0 };
    x += 320;
    return at;
  };

  const chatNode = first(chats, b, "chat models");
  const chatInputs = chatNode ? sanitizeInputs(chatNode).value : {};
  const answerModel: ProviderChoice | undefined = chatNode
    ? chatProvider(chatNode.data.name, chatInputs, b, { sourceId: chatNode.id })
    : undefined;
  const embedNode = first(embeds, b, "embedding models");
  const embedding = embedNode
    ? embeddingProvider(embedNode.data.name, sanitizeInputs(embedNode).value, b, {
        sourceId: embedNode.id,
      })
    : undefined;
  const storeNode = first(stores, b, "vector stores");
  let previous = "start";
  const chain = (id: string) => {
    b.edge(previous, "done", id);
    previous = id;
  };

  // --- vector store placement ---------------------------------------------------------
  let storeConfig: JsonObject | undefined;
  const storeCredentials: Record<string, string> = {};
  if (storeNode) {
    const s = sanitizeInputs(storeNode).value;
    const name = storeNode.data.name;
    const store = name === "pinecone" ? "pinecone" : name === "qdrant" ? "qdrant" : "workspace";
    const collection =
      str(s.pineconeNamespace) || str(s.qdrantCollection) || str(s.collectionName) || "knowledge";
    storeConfig = {
      store,
      collection: /^[A-Za-z0-9_.-]{1,128}$/.test(collection) ? collection : "knowledge",
      ...(store === "qdrant" && str(s.qdrantServerUrl) ? { url: str(s.qdrantServerUrl) } : {}),
    };
    if (store !== "workspace") {
      const secret = store === "pinecone" ? "PINECONE_API_KEY" : "QDRANT_API_KEY";
      b.secret(secret, "http.api_key");
      storeCredentials.store = secret;
    }
    if (store === "workspace" && name !== "memoryVectorStore")
      b.issue(
        "W_IMPORT_PROVIDER_CHANGED",
        `${storeNode.data.label ?? name}: ${name} is not available; documents go to the durable workspace store`,
        { sourceId: storeNode.id },
      );
    if (name === "memoryVectorStore")
      b.issue(
        "W_IMPORT_APPROXIMATE",
        `${storeNode.data.label ?? name}: the in-memory store is now the durable workspace store (documents persist across runs)`,
        { sourceId: storeNode.id },
      );
  }
  const embeddingModel =
    embedding ?? (storeNode ? embeddingProvider(undefined, {}, b, {}) : undefined);
  if (embeddingModel) b.secret(embeddingModel.secret.name, embeddingModel.secret.credentialType);

  // --- ingestion: loaders → splitter → vector store (upsert) --------------------------
  if (loaders.length > 0) {
    const splitter = first(splitters, b, "text splitters");
    const loaderIds: string[] = [];
    for (const l of loaders) {
      const spec = LOADERS[l.data.name] as (typeof LOADERS)[string];
      const s = sanitizeInputs(l).value;
      const id = b.id(`load_${l.data.name}`);
      const inputs: Record<string, Binding> = {};
      const config: JsonObject = { source: spec.source };
      const credentials: Record<string, string> = {};
      let status: "converted" | "needs_config" = "converted";
      let message: string | undefined;
      if (spec.input) {
        b.input(spec.input.name, spec.input.schema);
        inputs.content = portRef("start", spec.input.name);
        status = "needs_config";
        message = `pass the document's text as the '${spec.input.name}' input`;
      } else if (l.data.name === "plainText") {
        inputs.content = { kind: "literal", value: str(s.text) };
      } else if (spec.source === "url" || spec.source === "sitemap") {
        const url = str(s.url);
        inputs.urls = { kind: "literal", value: url ? [url] : [] };
        if (!url) status = "needs_config";
      } else if (spec.source === "github") {
        const m = /github\.com\/([^/]+\/[^/#?]+)/.exec(str(s.repoLink));
        if (m) config.repo = (m[1] as string).replace(/\.git$/, "");
        if (str(s.branch)) config.ref = str(s.branch);
        b.secret("GITHUB_TOKEN", "github.token");
        credentials.github = "GITHUB_TOKEN";
        if (!m) status = "needs_config";
      }
      b.add(
        {
          id,
          kind: "task",
          name: l.data.label ?? "Load documents",
          type: `${LC}.document_loader`,
          typeVersion: "1.0.0",
          config,
          inputs,
          credentials,
          disabled: false,
        },
        { x: 320, y: 220 + loaderIds.length * 160 },
      );
      b.edge("start", "done", id);
      loaderIds.push(id);
      b.report(l, status, {
        nodeId: id,
        targetType: `${LC}.document_loader`,
        ...(message ? { message } : {}),
      });
    }
    let docs: { id: string; port: string }[] = loaderIds.map((id) => ({ id, port: "documents" }));
    if (splitter) {
      const s = sanitizeInputs(splitter).value;
      const id = b.id("split");
      const kind = SPLITTERS[splitter.data.name] as string;
      b.add(
        {
          id,
          kind: "task",
          name: splitter.data.label ?? "Split",
          type: `${LC}.text_splitter`,
          typeVersion: "1.0.0",
          config: {
            splitter: kind,
            ...(num(s.chunkSize) ? { chunkSize: num(s.chunkSize) as number } : {}),
            ...(num(s.chunkOverlap) !== undefined
              ? { chunkOverlap: num(s.chunkOverlap) as number }
              : {}),
            ...(kind === "character" && str(s.separator) ? { separator: str(s.separator) } : {}),
          },
          inputs: {
            documents:
              loaderIds.length === 1
                ? portRef(loaderIds[0] as string, "documents")
                : {
                    kind: "expr",
                    source: `concat(${loaderIds.map((i) => `${i}.documents`).join(", ")})`,
                  },
          },
          credentials: {},
          disabled: false,
        },
        { x: 640, y: 220 },
      );
      for (const l of loaderIds) b.edge(l, "done", id);
      docs = [{ id, port: "chunks" }];
      b.report(splitter, splitter.data.name === "tokenTextSplitter" ? "converted" : "imported", {
        nodeId: id,
        targetType: `${LC}.text_splitter`,
      });
    }
    if (storeConfig && embeddingModel) {
      const id = b.id("index_documents");
      const documents: Binding =
        docs.length === 1
          ? portRef((docs[0] as { id: string }).id, (docs[0] as { port: string }).port)
          : { kind: "expr", source: `concat(${docs.map((d) => `${d.id}.${d.port}`).join(", ")})` };
      b.add(
        {
          id,
          kind: "task",
          name: "Index documents",
          type: `${LC}.vector_store`,
          typeVersion: "1.0.0",
          config: {
            ...storeConfig,
            operation: "upsert",
            embeddingModel: { provider: embeddingModel.provider, model: embeddingModel.model },
          },
          inputs: { documents },
          credentials: { llm: embeddingModel.secret.name, ...storeCredentials },
          disabled: false,
        },
        { x: 960, y: 220 },
      );
      for (const d of docs) b.edge(d.id, "done", id);
      // retrieval waits for this run's documents
      previous = id;
      b.issue(
        "W_IMPORT_APPROXIMATE",
        "the source indexed documents once; this workflow indexes them on every run. Move the ingestion steps into their own workflow when the corpus is stable.",
        { nodeId: id },
      );
    }
  }

  // --- answer: agent, retrieval chain or chat chain ----------------------------------
  const agent = first(agents, b, "agents");
  const retrievalChain = agent ? undefined : first(retrievalChains, b, "retrieval chains");
  const chatChain = agent || retrievalChain ? undefined : first(chatChains, b, "chains");
  const promptNode = first(prompts, b, "prompt templates");
  const model = answerModel ?? chatProvider(undefined, {}, b, {});
  b.secret(model.secret.name, model.secret.credentialType);
  let answer: { id: string; port: string } | undefined;

  if (agent) {
    const s = sanitizeInputs(agent).value;
    const id = b.id("agent");
    const system = unwrapRichText(str(s.systemMessage) || str(s.systemMessagePrompt));
    b.add(
      {
        id,
        kind: "task",
        name: agent.data.label ?? "Agent",
        type: `${LC}.agent`,
        typeVersion: "1.0.0",
        config: {
          model: { provider: model.provider, model: model.model },
          ...(system ? { system } : {}),
          tools: [],
          maxSteps: 10,
        },
        inputs: { task: portRef("start", "question") },
        credentials: { llm: model.secret.name },
        // agents need a spend bound (E_AGENT_UNBOUNDED)
        policy: { onError: "fail", maxCostUsd: 0.5 },
        disabled: false,
      },
      place(),
    );
    chain(id);
    answer = { id, port: "answer" };
    b.report(agent, tools.length ? "needs_config" : "converted", {
      nodeId: id,
      targetType: `${LC}.agent`,
      ...(tools.length ? { message: "add the agent's tools" } : {}),
    });
    for (const t of tools) {
      b.report(t, "needs_config", {
        message:
          "LangChain tools are not imported; give the agent workflow tools (HTTP, MCP, OpenAPI, subflows)",
      });
    }
  } else {
    let context: Binding | undefined;
    if (retrievalChain && storeConfig && embeddingModel) {
      const s = sanitizeInputs(storeNode as SourceNode).value;
      const id = b.id("retrieve");
      b.add(
        {
          id,
          kind: "task",
          name: "Retrieve",
          type: `${LC}.retriever`,
          typeVersion: "1.0.0",
          config: {
            ...storeConfig,
            strategy: "similarity",
            ...(num(s.topK) ? { k: num(s.topK) as number } : {}),
            embeddingModel: { provider: embeddingModel.provider, model: embeddingModel.model },
          },
          inputs: { query: portRef("start", "question") },
          credentials: { llm: embeddingModel.secret.name, ...storeCredentials },
          disabled: false,
        },
        place(),
      );
      chain(id);
      context = portRef(id, "context");
    } else if (retrievalChain) {
      b.issue(
        "W_IMPORT_NEEDS_CONFIG",
        `${retrievalChain.data.label ?? retrievalChain.data.name}: no vector store was connected; the answer runs without retrieved context`,
        { sourceId: retrievalChain.id },
      );
    }

    // messages and their {placeholders}
    const chainInputs = retrievalChain
      ? sanitizeInputs(retrievalChain).value
      : chatChain
        ? sanitizeInputs(chatChain).value
        : {};
    const promptInputs = promptNode ? sanitizeInputs(promptNode).value : {};
    const system =
      unwrapRichText(
        str(promptInputs.systemMessagePrompt) ||
          str(chainInputs.systemMessagePrompt) ||
          str(chainInputs.responsePrompt),
      ) ||
      (context
        ? "Answer the question using only the context below. If the context does not contain the answer, say so.\n\nContext:\n{context}"
        : "");
    const human =
      unwrapRichText(str(promptInputs.humanMessagePrompt) || str(promptInputs.template)) ||
      (retrievalChain ? "{question}" : "{input}");
    const messages: JsonValue[] = [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "human", content: human },
    ];
    const fields: Record<string, Binding> = {};
    let promptValues: Inputs = {};
    try {
      promptValues =
        typeof promptInputs.promptValues === "string"
          ? (JSON.parse(promptInputs.promptValues) as Inputs)
          : ((promptInputs.promptValues as Inputs | undefined) ?? {});
    } catch {
      promptValues = {};
    }
    for (const p of placeholders(`${system}\n${human}`)) {
      if (p === "context" && context) fields.context = context;
      else if (p === "context") fields.context = { kind: "literal", value: "" };
      else if (p === "chat_history" || p === "history") fields[p] = { kind: "literal", value: "" };
      else if (["question", "input", "query"].includes(p)) fields[p] = portRef("start", "question");
      else {
        const mapped = str(promptValues[p]);
        if (/\{\{\s*question\s*\}\}/.test(mapped)) fields[p] = portRef("start", "question");
        else if (mapped && !mapped.includes("{{")) fields[p] = { kind: "literal", value: mapped };
        else {
          b.input(p, { type: "string" });
          fields[p] = portRef("start", p);
        }
      }
    }
    const id = b.id("answer");
    const temperature = num(chatInputs.temperature);
    b.add(
      {
        id,
        kind: "task",
        name: (retrievalChain ?? chatChain)?.data.label ?? "Answer",
        type: `${LC}.chat`,
        typeVersion: "1.0.0",
        config: {
          model: { provider: model.provider, model: model.model },
          messages,
          ...(temperature !== undefined ? { temperature } : {}),
        },
        inputs: { variables: { kind: "object", fields } },
        credentials: { llm: model.secret.name },
        disabled: false,
      },
      place(),
    );
    chain(id);
    answer = { id, port: "text" };
    const primary = retrievalChain ?? chatChain;
    if (primary) b.report(primary, "converted", { nodeId: id, targetType: `${LC}.chat` });
    if (retrievalChain && storeNode) {
      const needsHost =
        storeConfig?.store === "pinecone" || (storeConfig?.store === "qdrant" && !storeConfig.url);
      b.report(storeNode, needsHost ? "needs_config" : "converted", {
        targetType: `${LC}.retriever`,
        message: needsHost
          ? `set the ${storeConfig?.store === "pinecone" ? "pinecone" : "qdrant"} URL (index host) on the retrieval and indexing steps`
          : "retrieval and indexing use the store's collection",
      });
    }
    for (const t of tools)
      b.report(t, "unsupported", { message: "LangChain tools are only imported for agents" });
  }

  // components folded into configuration
  if (chatNode)
    b.report(
      chatNode,
      answerModel?.provider === providerOf(chatNode.data.name) ? "imported" : "converted",
      {
        ...(answer ? { nodeId: answer.id } : {}),
        targetType: "model configuration",
      },
    );
  for (const c of chats.slice(1))
    b.report(c, "unsupported", { message: "only the first chat model was imported" });
  if (embedNode) b.report(embedNode, "converted", { targetType: "embedding configuration" });
  if (storeNode && !(retrievalChain && storeNode))
    b.report(storeNode, "converted", { targetType: `${LC}.vector_store` });
  if (promptNode)
    b.report(promptNode, "converted", {
      ...(answer ? { nodeId: answer.id } : {}),
      targetType: "chat messages",
    });
  for (const mem of memories) {
    b.report(mem, "converted", { message: "conversation memory is not carried between runs" });
    b.issue(
      "W_IMPORT_APPROXIMATE",
      `${mem.data.label ?? mem.data.name}: memory is not imported; each run answers without earlier turns`,
      { sourceId: mem.id },
    );
  }

  // secrets typed into components are never imported
  for (const n of flow.nodes) {
    const { removed } = sanitizeInputs(n);
    if (removed.length > 0)
      b.issue(
        "W_IMPORT_CREDENTIAL_REMOVED",
        `${n.data.label ?? n.data.name}: removed ${removed.join(", ")}; bind the workflow's secrets instead`,
        { sourceId: n.id },
      );
  }

  // components the importer does not know
  for (const n of flow.nodes) {
    if (handled.has(n) || n.data.name === "stickyNote") continue;
    b.todo(n, `the LangChain component '${n.data.name}' has no FlowAId equivalent`);
  }

  // the output
  const out = b.id("result");
  b.outputProps.set("answer", {});
  b.add(
    {
      id: out,
      kind: "output",
      name: "Answer",
      value: {
        kind: "object",
        fields: {
          answer: answer ? portRef(answer.id, answer.port) : { kind: "literal", value: null },
        },
      },
      earlyExit: false,
      disabled: false,
    },
    place(),
  );
  chain(out);
}

function providerOf(component: string): string {
  if (component === "chatAnthropic") return "anthropic";
  if (component === "chatOllama") return "ollama";
  if (["chatOpenAI", "azureChatOpenAI", "chatOpenAICustom"].includes(component)) return "openai";
  return "other";
}
