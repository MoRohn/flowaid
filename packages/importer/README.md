# @flowaid/importer

The FlowAId importer (ARCHITECTURE.md §10.9): turns external flow exports into FlowAId workflow
definitions, with a migration report that says what happened to every source node.

```ts
import { importExternalFlow } from "@flowaid/importer";

const { definition, report } = importExternalFlow(JSON.parse(fileText), { name: "Support router" });
report.counts; // { imported, converted, needsConfig, unsupported }
report.issues; // W_IMPORT_APPROXIMATE, W_IMPORT_PROVIDER_CHANGED, E_IMPORT_UNSUPPORTED, …
```

Two export shapes are read (both are `{ nodes, edges }` canvas graphs, optionally wrapped in a
record whose `flowData` holds the graph as a string):

- **Agent flows** (`*Agentflow` nodes): start → `input`, LLM → `flowaid.ai.generate`, condition
  → `branch`, condition agent → `flowaid.decision.router` (a TypeSafe decision,
  `W_IMPORT_PROVIDER_CHANGED`), human input → `human`, HTTP → `flowaid.tools.http`, custom
  function → `flowaid.tools.code` (flagged), iteration → `foreach`, loop-back → a `loop`
  container around its body, execute flow → `subflow`, agent and retriever →
  `@flowaid/nodes-langchain`, direct reply → `output`, sticky note → `note`.
- **LangChain chat flows** (components wired into a chain or agent): rebuilt as explicit steps
  on `@flowaid/nodes-langchain` — optional ingestion (loader → splitter → vector store),
  retrieval, then chat or agent — by `src/langchain-map.ts`.

Templates are translated (`{{ question }}`, `{{ nodeId }}`, `{{ nodeId.output.path }}`,
`$flow.state.x` → `$vars.x`, `$form.x` → `start.x`, `$iteration` → `$scope.item`, rich-text
mention chips unwrapped). Credential ids, API keys, passwords and auth headers are removed and
reported; the definition declares the secrets to bind instead. A node without an equivalent
becomes a `flowaid.dev.todo` placeholder that fails compilation with `E_IMPORT_UNSUPPORTED`,
so nothing degrades silently.

The API exposes it as `POST /v1/workflows/import` with `external` (and
`POST /v1/workflows/import/preview` for the report alone), the web app's _New workflow →
Import_, and the CLI's `flowaid import external <file>`.
