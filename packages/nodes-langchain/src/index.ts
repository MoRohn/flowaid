/**
 * `@flowaid/nodes-langchain` — LangChain-powered nodes (docs/design/LANGCHAIN.md §3), built with
 * `definePackage` exactly like a third-party plugin: ids carry the `@flowaid/nodes-langchain.`
 * prefix, the package ships its `langchain:<vendor>` providers, and the worker loads it as a
 * bundled plugin behind `features.langchain`.
 */
import { definePackage, type AnyNodeDefinition, type NodePackage } from "@flowaid/node-sdk";
import { chatNode } from "./nodes/chat.js";
import { runnableNode } from "./nodes/runnable.js";
import { agentNode } from "./nodes/agent.js";
import { documentLoaderNode } from "./nodes/document_loader.js";
import { textSplitterNode } from "./nodes/text_splitter.js";
import { embedNode } from "./nodes/embed.js";
import { vectorStoreNode } from "./nodes/vector_store.js";
import { retrieverNode } from "./nodes/retriever.js";
import { outputParserNode } from "./nodes/output_parser.js";
import { LANGCHAIN_PROVIDERS } from "./providers.js";

export {
  chatNode,
  runnableNode,
  agentNode,
  documentLoaderNode,
  textSplitterNode,
  embedNode,
  vectorStoreNode,
  retrieverNode,
  outputParserNode,
};
export {
  LANGCHAIN_PROVIDERS,
  fetchVia,
  langchainAnthropic,
  langchainOllama,
  langchainOllamaEmbeddings,
  langchainOpenAI,
  langchainOpenAIEmbeddings,
} from "./providers.js";
export {
  WorkspaceVectorStore,
  QdrantVectorStore,
  PineconeVectorStore,
  FlowaidVectorStore,
  chunkId,
  type MetadataFilter,
} from "./stores.js";
export { FlowaidRetriever, bm25, type Strategy } from "./retrieval.js";
export { htmlToText, parseCsv } from "./loaders.js";
export { PREFIX } from "./common.js";

/** Every node of the package, in palette order. */
export const LANGCHAIN_NODES: readonly AnyNodeDefinition[] = [
  chatNode,
  runnableNode,
  agentNode,
  documentLoaderNode,
  textSplitterNode,
  embedNode,
  vectorStoreNode,
  retrieverNode,
  outputParserNode,
] as readonly AnyNodeDefinition[];

/** The package's release and the node SDK range it targets (kept current by `pnpm version-packages`). */
export const PACKAGE_VERSION = "0.9.0";
export const SDK_RANGE = "^0.9.0";

export const nodePackage: NodePackage = definePackage({
  name: "@flowaid/nodes-langchain",
  version: PACKAGE_VERSION,
  nodes: LANGCHAIN_NODES,
  providers: LANGCHAIN_PROVIDERS,
  sdk: SDK_RANGE,
});

export default nodePackage;
