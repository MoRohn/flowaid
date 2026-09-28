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
| Tests in total                                                                                             | 5,638 passing locally, 17 skipped here (they need CI's Node 24 isolated-vm or Docker); baseline was 5,471          |
| Acceptance journey (`pnpm test:acceptance`) against `start.ts --prod` with provider fixtures replayed      | pass: 9 passed, 2 skipped (the sign-in page, which local mode does not show)                                       |
| Secret canaries in the stack log                                                                           | none found (3 canaries checked)                                                                                    |
| Real-browser pass (agent-browser, 1440 and 390 px)                                                         | Overview panels, ⌘K, page titles and the skip link work. One phone-width overflow was found and fixed (`61cbbdf`). |
| Docker image `api` (`docker/Dockerfile --target api`)                                                      | pass: builds, and `@flowaid/insights` resolves inside the image                                                    |
| Live-model evaluation of Ask FlowAId                                                                       | **blocked**: no Anthropic, OpenAI or Ollama model on this machine                                                  |

## Engineering

| area              | status   | notes                                                                                                                                                                                                                                                                           |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture      | complete | V2 adds two modules within the existing boundaries: `@flowaid/insights`, which is pure and browser-safe, and the assistant loop in `@flowaid/advisor`. There are no new tables or services. See [architecture/V2_OVERVIEW.md](architecture/V2_OVERVIEW.md).                     |
| P0 stabilisation  | complete | P0-1 to P0-7, each with a test that failed before the fix: loopback-only local mode, the commit-notice bus, retention, busy triggers, queue dead-letters, streamed pricing, the release gate.                                                                                   |
| P1 foundational   | complete | P1-1 to P1-12, except P1-12's dashboard filters in the URL (partial, below).                                                                                                                                                                                                    |
| P2 strategic      | partial  | Done: P2-1 Kish n + Bonferroni, P2-2 McNemar, P2-3 unpriced models, P2-4 MCP env and IPv6, P2-5 CI suites, sleeps and cache. **Open:** P2-6 (move publish, deploy and gate logic from routes into services).                                                                    |
| P3 optimisation   | deferred | P3-1 builder bundle lazy-loading, P3-2 pagination everywhere, P3-3 Redis-backed limits, P3-4 lineage foreign keys and RLS bypass gating, P3-5 unused dependencies, P3-6 audit outbox, P3-7 `keys rotate-master`. None blocks V2; all are listed in the threat model or roadmap. |
| Code quality      | complete | 0 `as any`, 0 `@ts-ignore`, 0 TODO/FIXME. New code follows the non-null-assertion ban and the `process.env` boundary (one documented exemption, for the `eval:assistant` developer command).                                                                                    |
| Dependency health | complete | No new third-party dependencies. `pnpm audit --prod --audit-level=high` passes.                                                                                                                                                                                                 |
| Repository drift  | complete | `pnpm db:migrate` and `db:generate` run again. Migration numbers in comments are corrected. The dead OIDC settings and routes are removed. STATUS records migrations through 0009.                                                                                              |

## Product

| capability                                                                 | status   | notes                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Needs attention (Overview)                                                 | complete | Open approvals (oldest, expiring within a day) and failing workflows, each a link.                                                                                                                     |
| What changed (Overview, `GET /v1/insights`)                                | complete | Five kinds of change, with evidence and version attribution stated as coincidence.                                                                                                                     |
| Ask FlowAId (`POST /v1/assistant/ask`, panel, ⌘K)                          | complete | Six read-only tools, typed and cited statements, limits, audit. On only when the workspace has a generation model.                                                                                     |
| Honest metrics                                                             | complete | Production origins by default; streamed generations priced on runs and nodes.                                                                                                                          |
| Private-network opt-in (`FLOWAID_ALLOW_PRIVATE_NETWORK`)                   | complete | One setting for every outbound connection; off by default.                                                                                                                                             |
| Operations guides                                                          | complete | [Backup and restore](operations/BACKUP_AND_RESTORE.md) (the pg_dump/restore and key-check commands were run against containers), [upgrades](operations/UPGRADES.md), [runbook](operations/RUNBOOK.md). |
| AI builder inside the builder page (refine an open workflow)               | deferred | Still reachable only from "New workflow" and the API. Needs a diff-and-accept surface on the canvas.                                                                                                   |
| Assistant actions (replay, publish, approve) with preview and confirmation | deferred | Read-only by design for V2 ([ai/ASSISTANT.md](ai/ASSISTANT.md)).                                                                                                                                       |

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

| area              | status   | notes                                                                                                                                                                                                      |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model abstraction | complete | Existing provider registry. The assistant reuses the workspace's advisor model resolution.                                                                                                                 |
| Grounding         | complete | Citations are validated against tool results, and uncited claims are downgraded and flagged.                                                                                                               |
| Tool calling      | complete | Typed (Zod), tenant-scoped, read-only. Errors are sanitised.                                                                                                                                               |
| Prompt injection  | complete | Shared untrusted-content envelope across agents, knowledge and the assistant. Tested in harness, pg and eval-scorer tests.                                                                                 |
| Evaluation        | partial  | The harness and scorer are verified in CI. **The live-model run is blocked here** (no provider key). The AI builder has no live evaluation set yet ([FLOWAID_AI_EVALUATION.md](FLOWAID_AI_EVALUATION.md)). |
| Cost and latency  | complete | Per-question limits ($0.25, 6 rounds); cost, tokens and model in every answer and audit event. Latency is measured by the eval runner; no live number yet.                                                 |
| Safety of agents  | complete | Pre-turn budget checks; capped, delimited tool output.                                                                                                                                                     |
| Open              | deferred | AI6: uncalibrated LLM decision probabilities are routed like Jev's during failover. AI7: tool calls record `capability: null`.                                                                             |

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
[security/THREAT_MODEL.md](security/THREAT_MODEL.md#accepted-risks-and-open-items):

- plugins are trusted code;
- the RLS bypass is a custom setting;
- rate limits are in memory;
- audit rows are written after commit;
- there is no master-key rotation command.

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
  - backup and restore runbook.
- **Open:**
  - `PgRunStore.dueTimers` still uses the worker's clock;
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
- [architecture/V2_OVERVIEW.md](architecture/V2_OVERVIEW.md);
- [ai/ASSISTANT.md](ai/ASSISTANT.md);
- [data/INSIGHTS.md](data/INSIGHTS.md);
- [security/THREAT_MODEL.md](security/THREAT_MODEL.md);
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
- ARCHITECTURE: rotate-master marked as planned;
- DATABASE.md;
- the env README (generated).

## Docker

`docker build -f docker/Dockerfile --target api .` builds (exit 0), and
`import('@flowaid/insights')` resolves inside the image. The web and worker images and a full
`docker compose up` were **not rebuilt** for V2; CI's image jobs cover them on push.

## Release

V2 is on branch `v2.0`, **not merged or pushed**. The package versions are still 0.1.0 under
changesets (`fixed` group). Choosing the version number (for example 2.0.0 as a product release)
and merging are the owner's decisions. Release PR #13 is still open from before V2.
