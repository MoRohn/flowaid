# @flowaid/nodes-langchain

LangChain-powered FlowAId nodes (docs/design/LANGCHAIN.md §3), built with `definePackage` exactly
like a third-party plugin: node ids carry the `@flowaid/nodes-langchain.` prefix, the package ships
its own `langchain:<vendor>` providers, and the worker loads it as a **bundled plugin**
(`FLOWAID_BUNDLED_PLUGINS`, default `@flowaid/nodes-langchain`; off when `langchain` is in
`FLOWAID_FEATURES_DISABLED`). Ports are ordinary JSON Schemas, so these nodes wire to decision,
tool and human nodes without special cases.

| node              | what it does                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`            | A `ChatPromptTemplate` (`{variable}` placeholders from `variables`, optional `history`) run through `ctx.providers` (native or `langchain:*` models); streams text, structured output with `outputSchema`, returns requested `tool_calls` for offered workflow tools. |
| `runnable`        | A registered LCEL runnable (`registerRunnable`) with typed input/output (`inputSchemaFromConfig` / `outputSchemaFromConfig`, checked at run time), the node's model/embeddings/tools, callback tracing and token/cost bounds.                                         |
| `agent`           | A LangGraph ReAct agent (`createReactAgent`) over workflow tools, bounded by `maxSteps`, `maxToolCalls`, `maxTokens`, `maxCostUsd` and the timeout. Calls to tools that need approval suspend the run for a person; the conversation is the durable suspend state.    |
| `document_loader` | Text, Markdown, JSON (pointer + text field), JSON Lines, CSV (RFC 4180) and HTML content; web pages, sitemaps and GitHub repositories over the SSRF-guarded `ctx.http`. Empty inline content loads nothing.                                                           |
| `text_splitter`   | `@langchain/textsplitters`: recursive character, character, Markdown and code (per language), with `chunk` / `chunkOf` provenance.                                                                                                                                    |
| `embed`           | Texts or documents through LangChain `Embeddings` over the node's embedding provider; empty input is a no-op.                                                                                                                                                         |
| `vector_store`    | Upsert (deterministic ids: re-ingesting replaces), query and delete against the durable **workspace** store (`ctx.state`, ≤ 5 000 chunks), **Qdrant** or **Pinecone** — LangChain `VectorStore` subclasses speaking the vendor REST APIs through `ctx.http`.          |
| `retriever`       | `similarity`, `mmr` (diverse), `multi_query` (a chat model writes variants, reciprocal-rank fusion) or `hybrid` (vector recall re-ranked with BM25, RRF); returns documents and a numbered, citable `context` block.                                                  |
| `output_parser`   | JSON (validated against `schema`), comma/line lists, numbers, booleans, with an optional repair loop through a chat model.                                                                                                                                            |

**Providers** (`NodePackage.providers`): `langchain:openai`, `langchain:anthropic` and
`langchain:ollama` for generation, `langchain:openai` and `langchain:ollama` for embeddings. The
vendor clients get the workspace's SafeFetch as their `fetch`; credentials reuse the catalog types
(`openai.api_key`, `anthropic.api_key`, `ollama.host`).

**Template**: `templates/knowledge-assistant-langchain-rag.json` — "Knowledge assistant (LangChain
RAG)": load → split → embed → upsert (a no-op without new knowledge) → hybrid retrieval → TypeSafe
relevance judgments → cited `chat` answer → TypeSafe safety/groundedness → confidence gate → human
review fallback.

`./manifest` exports the node manifests, provider descriptors and the template as data (no
LangChain import) for the API and docs; `pnpm --filter @flowaid/nodes-langchain manifest`
regenerates `manifest.json`.

Tests: harness tests per node with scripted providers and fake HTTP (Qdrant, Pinecone, GitHub,
sitemaps), recorded OpenAI and Anthropic stream fixtures replayed through SafeFetch into the real
vendor clients, the manifest snapshot; the template compiles with zero errors in
`@flowaid/workflow-compiler` and runs end to end (golden traces) in `apps/worker`.
