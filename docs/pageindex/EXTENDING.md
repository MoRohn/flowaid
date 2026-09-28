# Extending the PageIndex integration

Where each part lives, and the rules that keep it correct.

| layer                | where                                                                                   | owns                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| contract             | RFC-0022, `packages/workflow-core/src/documentIndex.ts`, node-sdk `DocumentIndexAccess` | the types every other layer speaks                                                            |
| lifecycle            | `packages/database/src/stores/PgDocumentIndexes.ts`, migration 0010                     | versions, dedupe, promotion, cancellation, revocation, scope resolution                       |
| retrieval, citations | `packages/pageindex/src/{retrieve,cite}.ts`                                             | tree navigation, budgets, evidence, citation support. Pure: decisions and reads are injected. |
| service protocol     | `packages/pageindex/src/protocol.ts`, `apps/pageindex`                                  | protocol v1 (framed job upload, jobs, tree, pages, delete)                                    |
| worker               | `apps/worker/src/services/documents.ts`, `jobs/pageindex.ts`                            | `ctx.documents`, the index and cleanup jobs, reconciliation, resuming waiting runs            |
| API                  | `apps/api/src/routes/pageindex.ts`, `services/pageindex.ts`                             | uploads, files, index requests, cancel, delete, the query playground ([API.md](API.md))       |
| nodes                | `packages/nodes-core/src/retrieval/pageindex.ts`, `ai/agentDocuments.ts`                | `flowaid.pageindex.index`, `.retrieve`, `.cite`, and the agent's document tools               |
| web                  | `apps/web/src/knowledge/pageindex/`                                                     | source dialog, document manager, outline, viewer, test panel, node config pickers             |

## Rules

- **Never trust a model-supplied id.**
  - Everything that reads goes through `ctx.documents`, which is bound to the run's workspace,
    and is checked against the node's configured scope first.
  - New tools must check each argument against the resolved scope and fail without a lookup.
  - The service keeps one store per workspace, and every service call names the workspace.
- **A job id is not an index.** Only `ready` (or pinned `superseded`) indexes are readable.
  Anything that starts a build returns a queued index and waits: the index node suspends on
  `pageindex.index.<indexId>`.
- **Don't publish a cancelled build.**
  - Use `markIndexReady`, which refuses unless the row is still `running`.
  - If it returns false, delete the upstream document.
- **Don't invent locations.**
  - Locators are physical pages.
  - `pageLabel` stays null.
  - Add block ids or boxes only when the backend provides them, and update
    [CAPABILITIES.md](CAPABILITIES.md) and `LOCAL_CAPABILITIES` in the same change.
- **Document text is data.** Wrap it (`wrapUntrusted`) wherever it reaches a model, and never
  let it select tools or scope.
- **Keep one budget owner.** `retrieveEvidence` counts decisions, sections and pages. Agents
  count their tool calls. Don't nest another loop with its own limits.

## Common changes

- **Upgrade the SDK.**
  1. Bump `apps/pageindex/requirements.in`, then regenerate the lock:
     `uv pip compile --python-version 3.12 --generate-hashes --universal requirements.in -o requirements.lock`.
  2. Update `PINNED_SDK` and `PAGEINDEX_SDK_VERSION`, and the version in `LICENSE-THIRD-PARTY.md`.
  3. Run `pnpm pageindex:test` and the live test (`test_live.py`), then `pnpm eval:pageindex`,
     and compare against [EVALUATION.md](EVALUATION.md).
  4. The configuration hash includes the SDK version, so the next request for each document
     builds a new index; existing ones stay readable.
  5. Recheck the one private call (`LocalAPI.raw_tree`).
- **Add a format.** Local 0.2.20 is PDF-only. Supporting Markdown (`md_to_tree` exists upstream)
  needs:
  - a new media type in `LOCAL_CAPABILITIES.formats`;
  - an upload check;
  - a service path that doesn't go through `submit_document`;
  - a locator kind that isn't `pdf_page`, which means an RFC-0022 follow-up.
- **Enable cloud mode.** It needs credentials to verify against. Then:
  - add `mode: "cloud"` to the contract, the config schema, the capability matrix and the
    service (a separate client);
  - show the data-handling difference before any upload;
  - never fall back to cloud automatically.
- **Tune retrieval.** Change `DEFAULT_BUDGET`, or the option text in `retrieve.ts`, only
  together with an evaluation run. The section-snippet fix was found and measured that way.
