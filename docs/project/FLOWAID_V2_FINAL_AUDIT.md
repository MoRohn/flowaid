# FlowAId V2 final audit — 2026-09-28

This audit covers what V2 delivered, how it was verified, and what is still open. It was
performed on branch `v2.0`: 52 commits after `55297df`, 213 files changed, +12,266/−820 lines.

The status words used below:

- **Complete:** built, tested and verified with the commands in [Verification](#verification).
- **Partial:** some of the item shipped; what remains is named.
- **Deferred:** decided against for V2, with the reason.
- **Blocked:** needs something this environment did not have.

The findings (S1, A1, …) are defined in [FLOWAID_V2_CODE_REVIEW.md](FLOWAID_V2_CODE_REVIEW.md).
The P-items are defined in [FLOWAID_V2_REFACTOR_PLAN.md](FLOWAID_V2_REFACTOR_PLAN.md).

## Verification

Run on 2026-09-28 against the final tree, before this document was committed.

| check                                                                                                      | result                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm check` (audit, boundaries, env/SDK/UI-inventory generators, docs, format, lint, types, build, tests) | pass: 148/148 turbo tasks, 0 lint errors                                                                           |
| PostgreSQL and Redis suites (`FLOWAID_TEST_DATABASE_URL`, `FLOWAID_TEST_REDIS_URL`)                        | pass: database 60, workflow-runtime 94, nodes-core 161, api 137, worker 57                                         |
| Tests in total                                                                                             | 5,831 passing locally with PageIndex (5,638 at the V2 audit), skipped ones need CI or Docker; baseline was 5,471   |
| Acceptance journey (`pnpm test:acceptance`) against `start.ts --prod` with provider fixtures replayed      | pass: 9 passed, 2 skipped (the sign-in page, which local mode does not show)                                       |
| Secret canaries in the stack log                                                                           | none found (3 canaries checked)                                                                                    |
| Real-browser pass (agent-browser, 1440 and 390 px)                                                         | Overview panels, ⌘K, page titles and the skip link work. One phone-width overflow was found and fixed (`61cbbdf`). |
| Docker image `api` (`docker/Dockerfile --target api`)                                                      | pass: builds, and `@flowaid/insights` resolves inside the image                                                    |
| Live-model evaluation of Ask FlowAId                                                                       | **blocked**: no Anthropic, OpenAI or Ollama model on this machine                                                  |

## Engineering

| area              | status   | notes                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture      | complete | V2 adds two modules within the existing boundaries: `@flowaid/insights`, which is pure and browser-safe, and the assistant loop in `@flowaid/advisor`. There are no new tables or services. See [architecture/V2_OVERVIEW.md](../architecture/V2_OVERVIEW.md).                                                                    |
| P0 stabilisation  | complete | P0-1 to P0-7, each with a test that failed before the fix: loopback-only local mode, the commit-notice bus, retention, busy triggers, queue dead-letters, streamed pricing, the release gate.                                                                                                                                     |
| P1 foundational   | complete | P1-1 to P1-12, except P1-12's dashboard filters in the URL (partial, below).                                                                                                                                                                                                                                                      |
| P2 strategic      | partial  | Done: P2-1 Kish n + Bonferroni, P2-2 McNemar, P2-3 unpriced models, P2-4 MCP env and IPv6, P2-5 CI suites, sleeps and cache. **Open:** P2-6 (move publish, deploy and gate logic from routes into services).                                                                                                                      |
| P3 optimisation   | deferred | P3-1 builder bundle lazy-loading, P3-2 pagination everywhere, P3-4 lineage foreign keys, P3-5 unused dependencies. Done after the audit: P3-3 Redis-backed limits, P3-4 RLS bypass gating, P3-6 audit rows in the change's transaction, P3-7 `keys rotate-master`. None blocks V2; all are listed in the threat model or roadmap. |
| Code quality      | complete | 0 `as any`, 0 `@ts-ignore`, 0 TODO/FIXME. New code follows the non-null-assertion ban and the `process.env` boundary (one documented exemption, for the `eval:assistant` developer command).                                                                                                                                      |
| Dependency health | complete | No new third-party dependencies. `pnpm audit --prod --audit-level=high` passes.                                                                                                                                                                                                                                                   |
| Repository drift  | complete | `pnpm db:migrate` and `db:generate` run again. Migration numbers in comments are corrected. The dead OIDC settings and routes are removed. STATUS records migrations through 0009.                                                                                                                                                |

## Product

| capability                                                                 | status   | notes                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs attention (Overview)                                                 | complete | Open approvals (oldest, expiring within a day) and failing workflows, each a link.                                                                                                                              |
| What changed (Overview, `GET /v1/insights`)                                | complete | Five kinds of change, with evidence and version attribution stated as coincidence.                                                                                                                              |
| Ask FlowAId (`POST /v1/assistant/ask`, panel, ⌘K)                          | complete | Six read-only tools, typed and cited statements, limits, audit. On only when the workspace has a generation model.                                                                                              |
| Honest metrics                                                             | complete | Production origins by default; streamed generations priced on runs and nodes.                                                                                                                                   |
| Private-network opt-in (`FLOWAID_ALLOW_PRIVATE_NETWORK`)                   | complete | One setting for every outbound connection; off by default.                                                                                                                                                      |
| Operations guides                                                          | complete | [Backup and restore](../operations/BACKUP_AND_RESTORE.md) (the pg_dump/restore and key-check commands were run against containers), [upgrades](../operations/UPGRADES.md), [runbook](../operations/RUNBOOK.md). |
| AI builder inside the builder page (refine an open workflow)               | deferred | Still reachable only from "New workflow" and the API. Needs a diff-and-accept surface on the canvas.                                                                                                            |
| Assistant actions (replay, publish, approve) with preview and confirmation | deferred | Read-only by design for V2 ([ai/ASSISTANT.md](../ai/ASSISTANT.md)).                                                                                                                                             |

## UX and UI

| area                                                 | status   | notes                                                                                                                                                                                                                             |
| ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actionable Overview                                  | complete | Two panels above the metrics, stacked to one column on phones (verified at 390 px).                                                                                                                                               |
| Trust signals for AI                                 | complete | AI builder: model, tokens, cost, compile passes, diagnostics, and distinct generating and saving states. Critic: rule or AI-judge badge and a fix preview. Assistant: kind badges, source links, provenance, unverified warnings. |
| Orientation                                          | complete | Per-page titles, real links for breadcrumbs and run ids, a pending-approval badge in the nav, and ⌘K entries for "Go to run", pending approvals and Ask.                                                                          |
| Responsive                                           | complete | Run detail opens in a sheet below 1024 px. The Overview reflows. The assistant panel caps at the viewport width.                                                                                                                  |
| Design-system consistency                            | complete | Existing tokens only; the brand lint test enforces the colour rules (no purple, pink or teal).                                                                                                                                    |
| Dashboard filters in the URL                         | partial  | The time range, workflow and environment still reset on reload (F8 in the review).                                                                                                                                                |
| Chart text summaries; more distinct category colours | deferred | F9 and F14 in the UX review.                                                                                                                                                                                                      |

## Accessibility

- **Automated:** axe (WCAG 2.x A and AA) passes on every main route in both themes in the
  acceptance journey, and on the UI gallery in `pnpm check`.
- **Added in V2:**
  - a skip link;
  - page titles (WCAG 2.4.2);
  - screen-reader text for the nav count ("3 pending");
  - `aria-live` and `aria-busy` on the assistant's answers;
  - labelled question input, keyboard submit, focus moved to the input on open;
  - a visible focus ring on the import file picker.
- **Not done:** a manual screen-reader pass (VoiceOver or NVDA). Automated checks do not prove
  accessibility, so this is open.

## AI

| area              | status   | notes                                                                                                                                                                                                            |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model abstraction | complete | Existing provider registry. The assistant reuses the workspace's advisor model resolution.                                                                                                                       |
| Grounding         | complete | Citations are validated against tool results, and uncited claims are downgraded and flagged.                                                                                                                     |
| Tool calling      | complete | Typed (Zod), tenant-scoped, read-only. Errors are sanitised.                                                                                                                                                     |
| Prompt injection  | complete | Shared untrusted-content envelope across agents, knowledge and the assistant. Tested in harness, pg and eval-scorer tests.                                                                                       |
| Evaluation        | partial  | The harness and scorer are verified in CI. **The live-model run is blocked here** (no provider key). The AI builder has no live evaluation set yet ([FLOWAID_AI_EVALUATION.md](../ai/FLOWAID_AI_EVALUATION.md)). |
| Cost and latency  | complete | Per-question limits ($0.25, 6 rounds); cost, tokens and model in every answer and audit event. Latency is measured by the eval runner; no live number yet.                                                       |
| Safety of agents  | complete | Pre-turn budget checks; capped, delimited tool output.                                                                                                                                                           |
| Open              | deferred | AI6: uncalibrated LLM decision probabilities are routed like Jev's during failover. AI7: tool calls record `capability: null`.                                                                                   |

## ML and data science

| area                                | status   | notes                                                                                                                                       |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Change detection                    | complete | Classical tests, BH correction, practical floors, minimum samples. Measured: 3.5% false-positive trials and 94% power in seeded simulation. |
| Statistical fixes                   | complete | Kish effective n and a Bonferroni-corrected Wilson bound for Jev thresholds; exact McNemar for evaluation regressions.                      |
| Reproducibility                     | complete | Seeded simulations; deterministic tests with reference values.                                                                              |
| Trained models                      | deferred | Not justified by the data volume ([product strategy](FLOWAID_V2_PRODUCT_STRATEGY.md)).                                                      |
| Jev calibration in the product (M1) | deferred | Needs a labelling workflow.                                                                                                                 |
| Forecasting and rollups             | deferred | Needs 30+ days of history per workspace.                                                                                                    |

## Security

All High and Medium security findings are fixed with tests: S1–S5, B1, B5, AI2 and AI3. Accepted
risks and open items are listed in
[security/THREAT_MODEL.md](../security/THREAT_MODEL.md#accepted-risks-and-open-items):

- plugins are trusted code;
- the api and the worker share the database role that may lift RLS;
- mutations that commit nothing through the database are audited after the fact;
- the request rate limit fails open on a Redis error;
- master-key rotation needs the api and the worker stopped.

Fixed after the audit (2026-10-01): the RLS bypass is gated on membership in
`flowaid_rls_bypass`, which the sandbox host's role lacks (P3-4); rate limits, login throttles and
webhook replays are shared through Redis with `REDIS_URL` (P3-3); audit rows are written in the
change's transaction (P3-6); `flowaid keys rotate-master` exists (P3-7).

## Performance

- **Frontend:** the builder chunk is unchanged at about 718 KB gzipped (P3-1 deferred). The
  Overview adds one request, refreshed every 60 seconds.
- **Backend:** insights run six indexed aggregate queries with capped samples. No load test was
  run, so latency under load is **not measured**.
- **Database:** no schema changes. Retention now bounds `run_events`, `node_runs` and the queue
  tables.
- **AI:** no new calls on page load. The assistant runs only when asked, within its limits.

## Reliability

- **Complete:**
  - the Redis-mode bus fix;
  - retention;
  - busy-trigger re-queue;
  - dead-lettering;
  - lease release at shutdown;
  - database-clock lease expiry;
  - readiness with Redis;
  - queue and worker gauges;
  - backup and restore runbook;
  - database-clock timers (`PgRunStore.dueTimers`, fixed after the audit).
- **Open:**
  - Compose worker replicas share one heartbeat file (documented in the runbook).

## Testing

| layer       | added in V2                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| unit        | insights statistics and detectors (20), assistant harness (10), eval scorer (4), web logic and components (dashboard, assistant, commands, shell), security helpers                  |
| integration | insights (3), assistant (4), environment pins, hardening (CORS, readiness), local auth, Redis-mode bus and subflows, retention, queue dead-letter, streamed cost                     |
| end to end  | Existing journey rerun against the V2 production build. No new browser spec covers the insights panels or the assistant: **open**, and it needs recorded fixtures for the assistant. |
| AI          | evaluation set and scorer; a live run is blocked here                                                                                                                                |
| regression  | full `pnpm check` and PostgreSQL suites after every merge                                                                                                                            |

## Documentation

**Created:**

- the six `FLOWAID_*` documents;
- [architecture/V2_OVERVIEW.md](../architecture/V2_OVERVIEW.md);
- [ai/ASSISTANT.md](../ai/ASSISTANT.md);
- [data/INSIGHTS.md](../data/INSIGHTS.md);
- [security/THREAT_MODEL.md](../security/THREAT_MODEL.md);
- `operations/`, with three guides;
- `packages/insights/README.md`;
- a changeset.

**Updated:**

- README: what's new, docs table, roadmap, test count;
- `docs/README.md`;
- STATUS;
- SECURITY and CONTRIBUTING;
- RELEASING;
- API.md and UI.md, with the dead routes removed;
- ARCHITECTURE: rotate-master marked as planned (shipped after the audit);
- DATABASE.md;
- the env README (generated).

## Docker

`docker build -f docker/Dockerfile --target api .` builds (exit 0), and
`import('@flowaid/insights')` resolves inside the image. The web and worker images and a full
`docker compose up` were **not rebuilt** for V2; CI's image jobs cover them on push.

## PageIndex document intelligence (added after the V2 audit above)

Specified in [pageindex/ADR.md](../pageindex/ADR.md); measured in [pageindex/EVALUATION.md](../pageindex/EVALUATION.md).
Each item below is from the integration brief's acceptance list, with how it was verified.

| #   | acceptance item                                                                                   | status   | how it was verified                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Clean install starts and discovers the nodes                                                      | complete | `pnpm check` (manifest check), `./flowaid --pageindex` run from scratch (first run installs the pinned venv), catalog lists `flowaid.pageindex.*`                                                        |
| 2   | A real sample indexes through the packaged backend and survives a restart                         | complete | live: travel policy via the real SDK and qwen2.5:3b through `./flowaid --pageindex`; after a full stack restart the same index (v1, ready) answered again; service `test_live.py` restart case           |
| 3   | A workflow answers with citations opening the correct page                                        | complete | live: Document Q&A template run → `sufficient`, citation page 1 ("$260") supported 0.98; browser: citation opened the viewer at version 1, page 2 of the file                                            |
| 4   | Repeated questions reuse the index; repeated indexing requests join the same work                 | complete | live (one index after restart and repeated runs); PG tests for dedupe of requests and identical uploads                                                                                                  |
| 5   | Unsupported/scanned files fail clearly                                                            | complete | live: scanned sample → `SCANNED_PDF` with OCR advice; API 415 for non-PDF; service tests                                                                                                                 |
| 6   | Changed content yields a new version without corrupting the old                                   | complete | PG tests (API and worker): version 2, new index, atomic promotion, pinned superseded index still readable                                                                                                |
| 7   | Cross-tenant and out-of-scope access rejected, incl. discovery and caches                         | complete | PG tests (API 404s from a second workspace; worker access scoping), service tests (per-workspace stores), node tests (pinned ids outside scope, forged document names in agent tools)                    |
| 8   | Provider errors, throttling, timeout, cancellation, worker/service restart leave consistent state | complete | worker PG tests (503 then success, retries exhausted, cancel mid-run, cancel at completion, service restart → resubmission), service tests (deadline, kill on cancel, restart reporting)                 |
| 9   | Malicious document instructions cannot expand permissions or call management actions              | complete | no management tools exist; scope comes from node config; evidence wrapped as untrusted; agent-tool tests; the injection case pattern from the assistant evaluation                                       |
| 10  | Save/reload/export/import preserve configuration and prompt for remapping                         | partial  | definitions store only ids (no bytes or credentials); the web pickers flag unknown ids as "unavailable resource — pick again" (component tests); not exercised through a real export → import round trip |
| 11  | Deletion and revocation stop retrieval and citation access                                        | complete | PG tests: delete → lists, file route and query scope exclude it at once; cleanup job removes upstream documents and bytes; source deletion cleans up first                                               |
| 12  | FlowAId works when PageIndex is off or unavailable                                                | complete | feature off by default; env pairing validated; API 409 and worker BAD_REQUEST only for document features; acceptance journey passes with PageIndex off                                                   |

- **Evaluation** (thresholds fixed before the first run):
  - **Passing:** evidence recall 89–100%, citation validity 100% and abstention 100%.
  - **Missing:** citation support (70–78%) and answer correctness (44–56%) miss their thresholds
    with the 3B local answer writer.
  - A 7B writer did not fit this machine's Docker memory. A hosted writer is **not measured** (no
    key here).
- **Cloud mode:** not enabled, because it could not be verified without credentials.
- **Found and fixed through the live journey:**
  - misleading section options (shared page summaries);
  - sentence splitting in citation checks;
  - new templates missing on upgraded installs;
  - local Ollama unreachable by default (`OLLAMA_HOST` ignored by the provider and blocked by the
    egress guard);
  - `./flowaid` failing after one `--pageindex` run;
  - truncated table columns.
- **Also delivered with it:**
  - the branded address **http://flowaid.localhost:3000**, with the API on 3001 and the next free
    port when a default one is busy;
  - `./flowaid` as the single start command;
  - a two-step Quick Start.

## Release

V2 is on branch `v2.0`, **not merged or pushed**. The package versions are still 0.1.0 under
changesets (`fixed` group). Choosing the version number (for example 2.0.0 as a product release)
and merging are the owner's decisions. Release PR #13 is still open from before V2.
