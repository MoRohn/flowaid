/**
 * `@flowaid/langchain` — LangChain ⇄ FlowAId adapters (docs/design/LANGCHAIN.md §2). This package
 * and `@flowaid/nodes-langchain` are the only places that import `@langchain/*`; the core never
 * does (boundaries.json `thirdParty`).
 */
export {
  LangChainGenerationProvider,
  type ChatModelBuilder,
  type ChatModelSettings,
  type LangChainGenerationOptions,
} from "./generation.js";
export {
  LangChainEmbeddingProvider,
  estimateTokens,
  type LangChainEmbeddingOptions,
} from "./embeddings.js";
export { LangChainDecisionProvider } from "./decision.js";
export {
  FlowaidChatModel,
  FlowaidEmbeddings,
  toolDefinitionOf,
  type FlowaidChatModelFields,
  type FlowaidEmbeddingsFields,
} from "./reverse.js";
export {
  toLangChainTool,
  fromLangChainTool,
  workflowAsLangChainTool,
  toolResultText,
  type ToolExecutor,
  type ToLangChainToolOptions,
  type FromLangChainTool,
  type WorkflowRunClient,
  type WorkflowToolOptions,
} from "./tools.js";
export {
  FlowaidCallbackHandler,
  callbackSinkFromContext,
  type CallbackSink,
  type FlowaidCallbackOptions,
} from "./callbacks.js";
export {
  registerRunnable,
  runnableFromRegistry,
  listRunnables,
  unregisterRunnable,
  type RunnableEntry,
  type RunnableServices,
} from "./registry.js";
export {
  toLangChainMessages,
  fromLangChainMessages,
  textOf,
  reasoningOf,
  toolCallsOf,
  usageOf,
  addUsage,
  finishReasonOf,
} from "./messages.js";
export { jsonSchemaToZod, zodToJsonSchema, type SchemaWarning } from "./schema.js";
export { toProviderError } from "./errors.js";
export {
  langChainGenerationFactory,
  langChainEmbeddingFactory,
  type LangChainBuildArgs,
} from "./factories.js";
