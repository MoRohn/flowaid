# PageIndex HTTP API

The API routes behind PageIndex document sources. Types are RFC-0022's (`IndexReference`,
`DocumentReference`, `OutlineNode`, `RetrievalResult`, `GroundedAnswer`,
`packages/workflow-core/src/documentIndex.ts`). Every route:

- is workspace-scoped: it runs in `db.tenant`, and ids from another workspace answer 404;
- requires `features.pageindex`, answering 409 `PAGEINDEX_DISABLED` when the service is not
  configured (except `GET /v1/pageindex/status`, and `GET /v1/pageindex/sources/:id/documents`,
  which lists the stored documents from the database so a source's page can show what it holds);
- uses the knowledge scopes: `knowledge:read` to read, `knowledge:write` to change anything.

## Sources

PageIndex documents live in a knowledge source of kind `pageindex`, created with the existing
`POST /v1/knowledge/sources`:

```json
{
  "name": "Policies",
  "kind": "pageindex",
  "config": {
    "indexModel": { "provider": "ollama", "model": "qwen2.5:3b" },
    "credentialId": null,
    "mode": "flash",
    "optimize": "off"
  }
}
```

The config fields:

- **`indexModel`** writes the section summaries: `openai`, `anthropic` or `ollama`, nothing else.
- **`credentialId`** is a workspace credential of the model's type. When it is null, the server
  key is used (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`); Ollama uses `OLLAMA_HOST`.
- **`mode`**: `flash` (layout-based, the default) or `standard` (a tree built by the LLM).
- **`optimize`**: `off` (default: keeps the detected section hierarchy), `merge` (folds short sections together) or `full` (merge plus model expansion).

Changing `indexModel`, `mode` or `optimize` changes the configuration hash. The next index
request then builds a new index version; existing indexes stay readable until it is promoted.

## Routes

| method and path                                                    | body / result                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/pageindex/status`                                         | `{ enabled, reachable, sdkVersion, protocol, modes }`. `modes` is `MODES` from `@flowaid/pageindex` (local available, cloud not, with the processing disclosure).                                                                                                                                                                                                                              |
| `GET /v1/pageindex/sources/:sourceId/documents`                    | `{ items: DocumentSummary[] }`. `DocumentSummary = { documentId, title, status, versions, latestVersion: DocumentReference, activeIndex: IndexReference \| null, latestIndex: IndexReference \| null }`, newest first                                                                                                                                                                          |
| `POST /v1/pageindex/sources/:sourceId/documents`                   | Upload: body is the PDF itself (`Content-Type: application/pdf`, at most 50 MiB), `X-File-Name` URL-encoded. `?documentId=` uploads a new version of an existing document. Answers 201 `{ document: DocumentSummary, version: DocumentReference, index: IndexReference, created }`. The same bytes again answer 200 with the existing version and index. A body that is not a PDF answers 415. |
| `GET /v1/pageindex/documents/:documentId`                          | `{ document: DocumentSummary, versions: DocumentReference[], indexes: IndexReference[] }`                                                                                                                                                                                                                                                                                                      |
| `GET /v1/pageindex/documents/:documentId/versions/:versionId/file` | The original PDF, `inline`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. Deleted documents answer 404.                                                                                                                                                                                                                                                               |
| `POST /v1/pageindex/documents/:documentId/index`                   | Builds (or joins) the index of the latest version with the source's current settings; retries a failed build. Answers `{ index: IndexReference, created }` (202 when created, 200 when joined).                                                                                                                                                                                                |
| `DELETE /v1/pageindex/documents/:documentId`                       | 202. Access is revoked at once: the indexes become `deleted`, the document `deleted`, and reads stop. Cleanup runs as a job (`pageindex.cleanup`).                                                                                                                                                                                                                                             |
| `GET /v1/pageindex/indexes/:indexId`                               | `IndexReference`                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /v1/pageindex/indexes/:indexId/outline`                       | `{ outline: OutlineNode[] }` (ready or superseded indexes only; otherwise 409 `INDEX_NOT_READY`)                                                                                                                                                                                                                                                                                               |
| `POST /v1/pageindex/indexes/:indexId/cancel`                       | `IndexReference`. A queued build becomes `canceled`, a running one `cancel_requested`.                                                                                                                                                                                                                                                                                                         |
| `POST /v1/pageindex/query`                                         | `{ query, scope: DocumentScope, answer?: boolean, budget?: Partial<RetrievalBudget> }` → `{ retrieval: RetrievalResult, answer: GroundedAnswer \| null, model: { provider, model } \| null }`. Retrieval navigates with the workspace's decision chain. `answer: true` writes an answer with the advisor model and checks its citations. Rate limited to 20 per minute.                        |

## Errors

The existing envelope, `{ error: { code, message } }`, with these codes:

- `PAGEINDEX_DISABLED` (409)
- `PAGEINDEX_UNAVAILABLE` (503, the service did not answer)
- `UNSUPPORTED_MEDIA_TYPE` (415)
- `PAYLOAD_TOO_LARGE` (413)
- `INDEX_NOT_READY` (409)
- `NOT_FOUND` (404)
- the usual validation errors
