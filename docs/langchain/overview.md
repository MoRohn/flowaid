# LangChain in FlowAId

FlowAId uses LangChain the way a runtime uses a driver library: inside a boundary. The core —
the workflow contracts, compiler, runtime, providers and the API — never imports `langchain` or
`@langchain/*`, and the boundary check fails the build if it does. Everything LangChain lives in
two packages:

| package                    | what it is                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@flowaid/langchain`       | adapters both ways: LangChain models, embeddings and tools as FlowAId providers and tools, FlowAId providers and workflows as LangChain models and tools, a callback handler for tracing and budgets |
| `@flowaid/nodes-langchain` | a node package of LangChain-powered nodes (chat, runnable, agent, loaders, splitters, embeddings, vector stores, retrievers, output parsers) and the "Knowledge assistant (LangChain RAG)" template  |

The FlowAId importer (`@flowaid/importer`) also maps LangChain-based nodes from external flow
exports onto these nodes (see [Importing external flows](importing-external-flows.md)).

## How the nodes reach a workflow

`@flowaid/nodes-langchain` is built like any plugin and ships inside the worker image as a
**bundled plugin**. At boot the worker loads the packages named in `FLOWAID_BUNDLED_PLUGINS`
(default `@flowaid/nodes-langchain`), records their manifests in the `plugins` table and seeds
their templates. The API serves those manifests from the table — `GET /v1/nodes`, the builder's
palette and the compiler all see the nodes — without ever loading LangChain itself.
`features.langchain` is on while the plugin row is enabled; an administrator can disable it, and
`FLOWAID_FEATURES_DISABLED=langchain` turns it off entirely.

LangChain nodes use ordinary JSON Schema ports, so they connect to decision, tool and human nodes
like any other node, and their model calls go through FlowAId's credentials, pricing, tracing and
bounds.

## Pages

- [Providers](providers.md): LangChain models inside FlowAId, FlowAId models inside LangChain
- [Tools](tools.md): tools in both directions, and workflows as LangChain tools
- [Nodes](nodes.md): the node package, node by node
- [Retrieval (RAG)](rag.md): loading, splitting, indexing and retrieving
- [Agents](agents.md): the LangGraph agent node and its bounds
- [Callbacks and tracing](callbacks-and-tracing.md): what LangChain activity looks like in a run
- [Importing external flows](importing-external-flows.md)
- [FAQ](faq.md)
