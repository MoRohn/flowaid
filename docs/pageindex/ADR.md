# ADR: PageIndex document intelligence in FlowAId

- Status: accepted, 2026-09-28
- Contract: [RFC-0022](../rfcs/0022-document-index-access.md)
- Related: [capabilities](CAPABILITIES.md), [setup](SETUP.md), [HTTP API](API.md), [extending](EXTENDING.md)

## Context

FlowAId answers questions over documents today with knowledge sources: chunks, embeddings and
similarity search (RFC-0021). Long, structured documents such as policies, contracts, manuals and
filings are better served by a different method. The method:

1. Builds the document's section hierarchy once.
2. Answers a question by navigating that hierarchy and reading the pages it leads to.
3. Cites physical pages of an immutable version of the file.

[PageIndex](https://github.com/VectifyAI/PageIndex) (Vectify AI, MIT) implements the indexing
half as an open-source Python SDK.

## What upstream actually offers

Verified against the pinned release, **pageindex 0.2.20** from PyPI (tag `v0.2.20`,
Python ≥ 3.10), by reading its source and running it with a local model. Nothing here comes from
marketing material.

- **Local mode** (`PageIndexLocalClient`):
  - **Input:** PDF only. The SDK refuses anything that does not end in `.pdf`, and refuses PDFs
    with no text layer ("run OCR before indexing"); there is no local OCR.
  - **Indexing:** synchronous. It extracts a layout-based section tree (`flash`), or builds one
    with the LLM (`standard`).
  - **Model calls:** summaries, and optionally tree optimisation, call a model through LiteLLM.
    Local mode therefore still sends page text to that model's provider, unless the model is
    local (Ollama).
  - **Storage:** documents go under a storage path. `list_documents` returns everything under
    it: there is no tenancy.
  - **Pages:** 1-based **physical** positions. There are no printed page labels, no block ids
    and no bounding boxes in local mode.
- **Cloud mode** (`PageIndexCloudClient`, `api_key`): managed OCR, folders and block-level
  features. It could not be verified here without credentials, so it is not enabled (see below).
- **Agent tools** (`agent_tools.py`, `as_openai_tools`, `openai_agent_config`, …):
  - They address documents **by name**.
  - `browse_documents` lists the whole store.
  - `document_context()` only steers the prompt; it is not access control.
  - The tools run inside upstream's own agent loops (OpenAI Agents SDK, Claude Agent SDK).

## Decisions

1. **A private Python service holds the SDK.**
   - FlowAId is TypeScript, so `apps/pageindex` is a small service (standard-library HTTP,
     the pinned SDK) behind a typed, versioned protocol (`@flowaid/pageindex`
     `PageIndexServiceClient`, protocol v1) and a shared bearer token.
   - It listens only on loopback (`pnpm start --pageindex`) or the Compose `internal` network.
   - No new queue, database or framework was added.
2. **One upstream store per workspace.** The service keeps `workspaces/<id>/` stores and every
   call names the workspace. This isolates documents at the storage layer, not only in FlowAId's
   queries.
3. **FlowAId owns the durable state.**
   - Uploaded files are immutable versions: artifact storage plus `document_versions`,
     deduplicated by sha256.
   - Indexes are rows in `document_indexes`, with explicit states: queued, running, ready,
     failed, cancel_requested, canceled, superseded, deleted.
   - Each document has at most one active index, and each version and configuration at most one
     live build.
   - New indexes are promoted atomically. The previous index becomes `superseded` but stays
     readable for runs that pinned it.
   - The service's own job records exist so the worker can poll. A service restart reports
     interrupted jobs as failed, and the worker resubmits them (job ids make submission
     idempotent).
4. **Indexing runs off request threads.**
   - An upload records the version and queues `pageindex.index` on the existing ingest queue.
   - The worker submits the job, polls its stage, and publishes the result. Cancellation is
     checked at every poll, and a cancelled build is never published.
   - The service runs each job in a child process with a deadline, so a timeout or cancel
     actually stops it.
5. **FlowAId owns retrieval; upstream's agents are not used.**
   - Retrieval follows the PageIndex method in TypeScript (`retrieveEvidence`): choose sections
     level by level, open or read them, and return the source text of real pages as `Evidence`
     with physical-page locators.
   - Choosing sections is a **decision**. It uses the workspace's decision chain, which is
     TypeSafe Jev when configured (a calibrated `choice` with a probability per section);
     FlowAId's rule, LLM or human hops follow workspace policy, and the provider is recorded on
     each piece of evidence.
   - There are no nested autonomous loops. One loop owns the decision, section and page budgets
     and reports `partial` when it stops early.
   - Upstream's agent tools are not exposed, because they address documents by name and can
     browse the whole store.
6. **Access control is server-side.**
   - Nodes reach indexes only through `ctx.documents` (RFC-0022), which is bound to the run's
     workspace.
   - A node's configured scope (`sourceIds`, `documentIds`) is its allowlist. Pinned `indexIds`
     outside it are refused.
   - The agent's document tools check every argument against the resolved scope. There are no
     management tools.
   - Document text reaching a model is wrapped as untrusted data.
7. **TypeSafe decides; a generation model writes.**
   - TypeSafe Jev is a decision model and does not generate text. It navigates, and checks
     whether cited text supports each claim (a yes/no question per citation).
   - The answer itself comes from the workspace's generation model (`flowaid.ai.generate` or an
     agent).
   - `flowaid.pageindex.cite` validates every citation against retrieved evidence and reports
     the answer as `sufficient`, `partial` or `insufficient`.
8. **Local mode only in this release.**
   - Cloud mode is shown in the capability matrix as not available, and no document is ever sent
     to it.
   - Local processing failures are reported; nothing falls back to cloud.
9. **Credentials stay in FlowAId's secret system.**
   - The indexing model's credential is a workspace credential (or the server key), decrypted by
     the worker and passed to the service for one job only.
   - The service gives it to the child process through the environment, never disk or logs.
10. **`optimize: "off"` is the default.** On the sample travel policy, `merge` folded sections
    into one node per page; `off` kept the chapters and their numbered subsections.

## Consequences

- **Python 3.10+ is required** for the service (the Compose image carries it). FlowAId without
  PageIndex configured is unchanged: the feature is off and document nodes fail with a clear
  message.
- **Exported code packages** have no `ctx.documents` unless the host provides it (the codegen
  README says so).
- **Superseded indexes are kept** until their document is deleted, so pinned runs keep working.
  This costs disk.
- **Only a small candidate set is navigated:** at most 5 documents per retrieval. There is no
  corpus-scale discovery.

## Upstream internals relied on

`LocalAPI.raw_tree` (via `client._api`) is used to read stored page spans, because the public
`get_tree` drops `end_index`. It is pinned by version and covered by the live test. If it
disappears, the service falls back to deriving spans from the public tree.
