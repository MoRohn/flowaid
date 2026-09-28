# PageIndex documents: setup, first run and troubleshooting

PageIndex turns a PDF into its section tree once. After that, workflows and agents answer
questions by navigating that tree and reading the pages it leads to. Every answer cites
physical pages of the exact file version you uploaded.

- **Why it is built this way:** [ADR.md](ADR.md)
- **What works in which mode:** [CAPABILITIES.md](CAPABILITIES.md)

## 1. Requirements

| for                     | you need                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the service             | Python 3.10 or newer (`python3.12 --version`). The Compose image carries its own.                                                                                         |
| indexing                | a model that writes section summaries: Ollama on this computer (nothing leaves it), or an OpenAI or Anthropic key                                                         |
| navigating and checking | TypeSafe (`TYPESAFE_API_KEY`) is recommended: it chooses sections and checks citations with calibrated probabilities. Without it, the workspace's decision chain decides. |
| answers                 | a generation model (Ollama, OpenAI or Anthropic), the same one the AI builder uses                                                                                        |

## 2. Start it

### On your own computer

```sh
pnpm start --pageindex
```

The first run creates `.flowaid/pageindex-venv` and installs the pinned, hash-checked packages
(about 20 seconds). It generates the shared token into `.flowaid/dev.env`, starts the service on
`127.0.0.1:8765`, and points the API and worker at it. Open **http://flowaid.localhost:3000**.

To index with a local model, run Ollama and pull one model. With Docker:

```sh
docker run -d --name flowaid-ollama -p 127.0.0.1:11434:11434 -v flowaid-ollama:/root/.ollama ollama/ollama
docker exec flowaid-ollama ollama pull qwen2.5:3b
echo "OLLAMA_HOST=http://127.0.0.1:11434" >> .env.local
```

### With Docker Compose

Add to `.env`:

```sh
FLOWAID_PAGEINDEX_URL=http://pageindex:8765
FLOWAID_PAGEINDEX_TOKEN=<openssl rand -hex 32>
```

Then:

```sh
docker compose --profile pageindex up -d --build
```

The `pageindex` service has no published port. It runs non-root with a read-only root
filesystem, and it refuses to start without the token. Its data (one store per workspace, plus
job records) lives in the `pageindex-data` volume; back it up with the others
([operations/BACKUP_AND_RESTORE.md](../operations/BACKUP_AND_RESTORE.md)). The service can be
rebuilt from the uploaded files, which FlowAId keeps in artifact storage.

### Settings

| variable                                                                         | where       | meaning                                                           |
| -------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| `FLOWAID_PAGEINDEX_URL`, `FLOWAID_PAGEINDEX_TOKEN`                               | api, worker | where the service is. Set both, or neither to turn PageIndex off. |
| `FLOWAID_PAGEINDEX_TOKEN`                                                        | service     | the same token (at least 32 characters)                           |
| `FLOWAID_PAGEINDEX_DATA_DIR`                                                     | service     | stores and job records (`/data` in the image)                     |
| `FLOWAID_PAGEINDEX_MAX_BYTES`, `…_MAX_PAGES`, `…_CONCURRENCY`, `…_JOB_TIMEOUT_S` | service     | 50 MiB, 500 pages, 2 jobs at once, 1,800 s per job                |

When PageIndex is not configured, `features.pageindex` is off. The Knowledge page shows the kind
as unavailable with a link here, and the rest of FlowAId is unaffected.

## 3. First document, first answer

1. **Knowledge → New source → PageIndex documents (PDF).**
   - Pick the indexing model, for example Ollama `qwen2.5:3b`.
   - Keep **Flash** mode and **Keep sections**.
   - Read the data-handling note: files are parsed on this machine, and page text goes to the
     indexing model's provider.
2. **Upload** `fixtures/pageindex/northwind-travel-policy.pdf`. The row shows `queued`, then
   `running` with the service's stage, then `ready` with its page count. Uploading the same file
   again joins the same index; a changed file becomes version 2 with a new index.
3. **View outline** shows the sections (1. Booking travel › 1.3 Hotels, …) with their pages.
4. **Test a question** such as "What is the nightly hotel limit in London?"
   - **Retrieve** shows the sections the navigator chose, with its confidence, and the page
     text.
   - **Retrieve and answer** adds an answer with `[E1]` citations. Click one to open the PDF at
     that page.
5. **Templates → Document Q&A (PageIndex).**
   - Bind the source, then run it with `{"question": "…"}`.
   - The output has `answer`, `citations` (page, supported or not), `status` (sufficient,
     partial or insufficient) and `limitations`.
   - The same index is reused on every run and after a restart.

The other templates:

- **Compare documents (PageIndex)** covers two sources and reports contradictions and missing
  coverage.
- **Document agent (PageIndex)** gives an agent read-only `document_outline`, `document_read_pages` and
  `document_search` tools, limited to its sources.

## 4. Verify an installation

```sh
curl -s http://127.0.0.1:8765/healthz        # {"ok": true, "protocol": "1", "sdk": "0.2.20", …}
curl -s http://127.0.0.1:8765/readyz         # {"ready": true, "problems": []}
pnpm pageindex:test                          # the service's protocol tests
FLOWAID_PAGEINDEX_LIVE_MODEL=ollama/qwen2.5:3b FLOWAID_PAGEINDEX_LIVE_API_BASE=http://127.0.0.1:11434 \
  .flowaid/pageindex-venv/bin/python -m unittest discover -s apps/pageindex/tests   # real SDK + model
pnpm eval:pageindex                          # the evaluation set, end to end (see EVALUATION.md)
```

In the app, `GET /v1/pageindex/status` reports `enabled`, `reachable`, the SDK version and the
mode matrix.

## 5. Troubleshooting

| symptom                                                 | cause and fix                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| the source kind is greyed out                           | PageIndex isn't configured. Start with `--pageindex`, or set both `FLOWAID_PAGEINDEX_*` variables.                                              |
| banner "the PageIndex service is not answering"         | The service is down or the token differs. Check the `pidx` lines in `pnpm start`, or `docker compose logs pageindex`.                           |
| `SCANNED_PDF`: "This PDF has no text layer …"           | Local PageIndex does not run OCR. Run OCR (for example `ocrmypdf in.pdf out.pdf`) and upload the result.                                        |
| `ENCRYPTED_PDF`                                         | Remove the password and upload again.                                                                                                           |
| `MODEL_AUTH` / `MODEL_RATE_LIMITED`                     | The indexing model's credential is wrong or throttled. Fix it in the source settings, then **Retry**.                                           |
| `TIMEOUT`                                               | The build ran past `FLOWAID_PAGEINDEX_JOB_TIMEOUT_S`. Use a faster model, fewer pages, or a longer limit.                                       |
| `NO_STRUCTURE`                                          | Flash found no layout structure. Switch the source to **Standard** mode (the model builds the tree).                                            |
| `SERVICE_RESTARTED` / `PAGEINDEX_UNAVAILABLE`           | The service restarted or was unreachable. The worker resubmits automatically (5 attempts); **Retry** after that.                                |
| an index stays `queued`                                 | No worker is consuming the ingest queue. Check the worker. Reconciliation at worker start re-queues it.                                         |
| answers come back `insufficient`                        | The documents don't say, or retrieval missed it. Open **Retrieve** to see which sections were chosen, and check the source has a `ready` index. |
| a deleted document still appears in the service's store | Upstream cleanup retries in the background (`pageindex.cleanup`). Reads were revoked when you deleted it.                                       |
