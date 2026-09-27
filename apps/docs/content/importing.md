# Importing external flows

The FlowAId importer (`@flowaid/importer`) converts external flow exports, both agent flows and
chat flows, into FlowAId workflow definitions, and explains the result in a migration report.
Nothing is created until you confirm.

## What it reads

- **Agent flow exports** (`nodes` and `edges` with agent flow node types): start, LLM, agent,
  condition, condition agent, human input, HTTP, custom function, iteration, loop, direct reply,
  variable assignment, retriever, tool and sticky notes.
- **Chat flow exports** (LangChain component graphs): chat models, chains, conversational
  agents, retrieval QA, document loaders, splitters, embeddings, vector stores, memory and tools.
  These map onto the bundled LangChain nodes; see
  [LangChain: importing external flows](../../../docs/langchain/importing-external-flows.md).

## The migration report

Every source node lands in one of four groups:

| Group               | Meaning                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imported            | Mapped one-to-one onto a FlowAId node.                                                                                                                                                                |
| Converted           | Mapped onto a different construct, for example a condition agent becomes a TypeSafe router decision, an iteration becomes a for-each container and a back edge becomes a loop.                        |
| Needs configuration | Mapped, but a value could not be carried across (a credential, a vector store connection, a code body that needs review).                                                                             |
| Unsupported         | No equivalent. The node becomes a placeholder (`flowaid.dev.todo`) that keeps its ports so the rest of the graph stays wired; the compiler reports `E_IMPORT_UNSUPPORTED` on it until you replace it. |

Templates are translated as well: `{{ question }}` reads the start input, flow state becomes
workflow variables, iteration items become `$scope.item`, and references to other nodes become
typed port references. Credentials are never imported; each credential slot becomes a symbolic
secret you bind in _Settings → Secrets_.

## In the web app

_Workflows → New workflow → Import an external flow export…_, or drop the export on the Import
card. The dialog shows the report; **Import** creates the workflow as a draft.

## From the command line

```sh
flowaid import external ./support-router.json --dry-run      # print the report only
flowaid import external ./support-router.json --name "Support router"
flowaid import external ./support-router.json --local --out support-router.flowaid.json
```

`--local` converts without a server and writes the definition to `--out`.

## Over HTTP

`POST /v1/workflows/import/preview` returns the definition and the report without creating
anything; `POST /v1/workflows/import` with `{ "external": <export>, "name": "…" }` creates the
workflow and returns the same report. See the [HTTP API reference](/reference/api).
