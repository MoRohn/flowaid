# Importing external flows

The FlowAId importer reads flow exports from other visual flow builders — both control-flow
**agent flows** and LangChain **chat flows** — and turns them into FlowAId workflows.

Where to start it:

- **Web:** _Workflows → New workflow → Import → Import an external flow export…_ Drop the
  exported `.json`; the dialog shows what each node becomes before anything is saved.
- **API:** `POST /v1/workflows/import/preview { external }` returns the migration report and
  diagnostics; `POST /v1/workflows/import { external, name? }` saves the workflow.
- **CLI:** `flowaid import external flow.json [--dry-run]`, or `--local --out workflow.json` to
  translate without a server.

## What LangChain chat flows become

A chat flow wires components into one chain. The importer recognises the roles and rebuilds the
pipeline as explicit steps on `@flowaid/nodes-langchain`:

| source components                                                          | FlowAId                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| document loaders (text, PDF, CSV, JSON, web, GitHub)                       | `document_loader` (file contents become workflow inputs) |
| text splitters                                                             | `text_splitter`                                          |
| vector stores (in-memory, Pinecone, Qdrant; others to the workspace store) | `vector_store` (upsert) and `retriever`                  |
| retrieval QA chains                                                        | `retriever` → `chat` with a `{context}` prompt           |
| conversation and LLM chains, prompt templates                              | `chat` with the template's messages and values           |
| agents                                                                     | `agent` (tools to be re-added as workflow tools)         |
| chat and embedding models                                                  | model configuration on those nodes                       |
| memory                                                                     | not carried between runs (reported)                      |

Each change is reported: `W_IMPORT_APPROXIMATE` where behaviour differs,
`W_IMPORT_PROVIDER_CHANGED` where a vendor had to be switched, `W_IMPORT_CREDENTIAL_REMOVED` for
every key or credential that was dropped. Components without an equivalent become
`flowaid.dev.todo` placeholders that fail compilation with `E_IMPORT_UNSUPPORTED`, so nothing
degrades silently. Agent-flow condition agents become TypeSafe routers with calibrated
confidence rather than LLM classifications.

The same guide, for agent flows, is in the docs site's _Importing external flows_ page.
