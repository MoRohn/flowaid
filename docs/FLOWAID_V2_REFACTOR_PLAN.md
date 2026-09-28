# FlowAId V2 refactor plan

The foundational work that comes before V2 features, derived from
[FLOWAID_V2_CODE_REVIEW.md](FLOWAID_V2_CODE_REVIEW.md) (finding IDs in brackets). Each item is
fixed test-first: reproduce with a failing test, then change the code. Behaviour is preserved
unless the item says otherwise. Status is tracked in
[FLOWAID_V2_FINAL_AUDIT.md](FLOWAID_V2_FINAL_AUDIT.md).

## P0 — critical

Security, data integrity and correctness bugs. Nothing else ships until these do.

| item | work                                                                                                                                                                                                                                         | finding | size |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| P0-1 | Local mode only on loopback: `pnpm start` refuses local mode for a non-loopback bind; the web proxy drops client-supplied `X-Forwarded-*` and sets its own; the API's loopback sign-in does not trust client-controllable forwarded headers. | S1      | S    |
| P0-2 | One channel for durable commit notices in both bus modes, with a Redis-mode integration test for SSE and subflow completion.                                                                                                                 | A1      | S    |
| P0-3 | Schedule and consume the retention sweep; make every sweep step batched and filtered inside the batch; sweep `queue_jobs` and `alert_deliveries`.                                                                                            | D1, D2  | M    |
| P0-4 | A `busy` trigger is retried, not acknowledged; timer-fired marks and delegated-result deletion happen only after the events that consume them are appended.                                                                                  | D3      | M    |
| P0-5 | Dead-letter queue jobs at claim when `attempts >= max_attempts`; log handler failures.                                                                                                                                                       | D4, D6  | S    |
| P0-6 | Price streamed generations and emit `GENERATION_COMPLETED` from the stream path.                                                                                                                                                             | AI1     | S    |
| P0-7 | Gate tagging and image publishing on CI and E2E success for the same commit.                                                                                                                                                                 | O1      | S    |

## P1 — foundational

Needed for V2's reliability, trust and operability.

| item  | work                                                                                                                                                         | finding        | size |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---- |
| P1-1  | Strip credential-bearing headers on cross-origin redirects (allow-list on cross-origin hops).                                                                | S2             | S    |
| P1-2  | Private-address guard for the database query node.                                                                                                           | S3             | S    |
| P1-3  | Refuse `CORS_ORIGINS=*` with credentials in every environment.                                                                                               | S4             | S    |
| P1-4  | One `assertEnvironmentAllowed` for every route that takes an environment.                                                                                    | B1             | S    |
| P1-5  | Untrusted-content envelope with size caps for tool results, agent context and knowledge context; strict `maxContextTokens`.                                  | AI2            | S    |
| P1-6  | Pre-turn worst-case budget check in the agent.                                                                                                               | AI3            | S    |
| P1-7  | Rubric inside the AI builder's repair loop; strict response parsing; prompt hash in the result and audit; rate-limit the critic judge.                       | AI8, AI5       | S    |
| P1-8  | Metrics count production traffic by default (exclude evaluation, replay, restart, fork) with an explicit origin filter.                                      | D5             | S    |
| P1-9  | Operations runbook: backup and restore (including the master key), upgrades and rollback, health, metrics, stuck runs, dead letters, scaling.                | O2, O3, O4     | M    |
| P1-10 | Remove the dead OIDC/invitation configuration and documentation.                                                                                             | O5             | S    |
| P1-11 | Readiness returns a fixed error code; record `queueDepth` and `workerActiveRuns`; expired leases on the database clock; release leases on shutdown.          | B5, D6, D7     | S    |
| P1-12 | Run detail on narrow screens; per-page titles; real links for breadcrumbs and rows; skip link; parallel session bootstrap with a route-level error boundary. | F2, F6, F7, F9 | M    |

## P2 — strategic

Improvements that V2 capabilities lean on.

| item | work                                                                                                          | finding | size |
| ---- | ------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| P2-1 | Kish effective sample size and a multiplicity correction in Jev threshold recommendation.                     | M2      | S    |
| P2-2 | Paired significance (exact McNemar) for evaluation regression warnings.                                       | M3      | S    |
| P2-3 | Surface unpriced models instead of silently costing $0.                                                       | AI4     | S    |
| P2-4 | stdio MCP environment deny-list; complete the IPv6 blocklist.                                                 | S5      | S    |
| P2-5 | CI: run the database query node's Postgres tests; replace fixed sleeps in browser tests; cache turbo outputs. | O6      | S    |
| P2-6 | Move publish/deploy/gate logic out of route handlers into services.                                           | A3      | M    |

## P3 — optimisation (not blocking)

| item | work                                                                                                                                | finding |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P3-1 | Lazy-load CodeMirror, the compiler and the AI panels in the builder; set a bundle budget.                                           | F8      |
| P3-2 | Pagination on the remaining list endpoints.                                                                                         | B2      |
| P3-3 | Redis-backed rate limit, throttle and replay stores when `REDIS_URL` is set.                                                        | A4      |
| P3-4 | Foreign keys on lineage columns; denormalised `workspace_id` on run-scoped tables to drop the SECURITY DEFINER visibility function. | D7, S6  |
| P3-5 | Remove unused dependencies and add an unused-dependency check.                                                                      | —       |
| P3-6 | Audit rows inside the route's transaction (outbox).                                                                                 | B4      |
| P3-7 | A `flowaid keys rotate-master` command.                                                                                             | O4      |

## Rules for the refactor

- Add the failing test first where the behaviour can be reproduced.
- One logical change per commit; migrations are additive and forward-only (see
  [operations/UPGRADES.md](operations/UPGRADES.md)).
- `pnpm check` and the PostgreSQL suites pass after every merge into `v2.0`.
- No contract (`workflow-core`) change without an RFC entry.
