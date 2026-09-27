# @flowaid/langchain

LangChain ⇄ FlowAId adapters (docs/design/LANGCHAIN.md §2). This package and
`@flowaid/nodes-langchain` are the only packages that import `@langchain/*`; the core never does
(`boundaries.json` `thirdParty`, enforced by ESLint and `scripts/check-boundaries.test.ts`).
`@langchain/core` is a peer dependency.

**LangChain → FlowAId**

- **`LangChainGenerationProvider(model | builder, opts)`**: any LangChain chat model as a
  `GenerationProvider`. `.stream()` becomes `GenerationChunk`s (text, reasoning, tool-call argument
  deltas, usage, done); `GenerationRequest.tools` go through `bindTools` (with the tool choice);
  JSON Schema responses through `withStructuredOutput` with `includeRaw` (usage is kept, the raw
  `response` tool call is recovered when LangChain's parser rejects a message shape, strict mode
  falls back when a model refuses it); `usage_metadata` becomes `TokenUsage` including cache
  reads/writes; the node's `AbortSignal` rides in the `RunnableConfig`; vendor errors map onto the
  flowaid taxonomy (`CredentialError`, `ProviderRateLimitedError` with Retry-After,
  `ProviderOverloadedError`, `BoundsExceededError('maxTokens')`, `CancelledError`, …); pricing
  through the model catalog; rolling health. Given a builder instead of a model, per-call sampling
  settings (temperature, top-p, max tokens, seed) build a model per distinct setting set.
- **`LangChainEmbeddingProvider(embeddings)`**: LangChain `Embeddings` as an `EmbeddingProvider`
  (dimensions learned on first call, usage estimated, raced against the signal).
- **`LangChainDecisionProvider(model)`**: typed decisions from any LangChain model — the native
  `LLMDecisionProvider` rules (strict JSON Schema, renormalisation, one re-ask, fuzzy-choice
  penalty) over `LangChainGenerationProvider`; `provider = 'llm'`.
- **`langChainGenerationFactory` / `langChainEmbeddingFactory`**: registry factories for
  `langchain:<vendor>` provider ids (node packages ship them through `NodePackage.providers`).
- **`fromLangChainTool(tool)`**: a LangChain tool as a `ToolDefinition` plus an executor returning
  `ToolResult` (idempotency and capability from `tool.metadata`).

**FlowAId → LangChain**

- **`FlowaidChatModel`**: a `BaseChatModel` over a flowaid `GenerationProvider` (normally the node's
  `ctx.providers.generation`), with `bindTools`, streaming and an `onResult` hook for spend. LCEL
  chains and LangGraph agents inside a node therefore use the platform's credentials, tracing
  (GENERATION_COMPLETED), pricing and failover.
- **`FlowaidEmbeddings`**: LangChain `Embeddings` over an `EmbeddingProvider`, batched.
- **`toLangChainTool(definition, execute)`**: a flowaid tool as a `StructuredTool` (Zod schema from
  the tool's JSON Schema, content plus the structured artifact; failures go back to the model as
  an error message unless `throwOnError`).
- **`workflowAsLangChainTool(client, workflowId, opts)`**: a FlowAId workflow as a LangChain tool
  over a small structural client (the SDK client or a `runLocally` wrapper).

**Tracing, registry, bridges**

- **`FlowaidCallbackHandler(sink, opts)`**: LangChain callbacks → the node's events: tokens as
  GENERATION_DELTA, model/tool/retriever activity as LOG entries (prompts through `redact`,
  truncated), usage as METRIC events, and the node's `maxTokens`/`maxCostUsd` enforced by aborting
  `handler.signal` with a `BoundsExceededError`. `callbackSinkFromContext(ctx)` builds the sink.
- **`registerRunnable(name, factory)` / `runnableFromRegistry(name)`**: the LCEL runnable registry
  the `langchain.runnable` node reads.
- **`toLangChainMessages` / `fromLangChainMessages`**, `textOf`, `reasoningOf`, `toolCallsOf`,
  `usageOf`: message bridges (images as data URLs, tool calls and results).
- **`jsonSchemaToZod` / `zodToJsonSchema`**: a conservative JSON Schema → Zod converter that reports
  every construct it does not enforce, and Zod 4 → draft 2020-12.

Tests use scripted `BaseChatModel`s, deterministic embeddings and LangChain's own tools and runnables
(no network); the recorded OpenAI/Anthropic stream fixtures live in `@flowaid/nodes-langchain`,
which ships the vendor integrations.
