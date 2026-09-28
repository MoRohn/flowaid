# FlowAId V2 roadmap

The phases that take FlowAId from 0.x to 2.0.0. The findings (S1, A1, …) are in
[FLOWAID_V2_CODE_REVIEW.md](FLOWAID_V2_CODE_REVIEW.md); the P-items are in
[FLOWAID_V2_REFACTOR_PLAN.md](FLOWAID_V2_REFACTOR_PLAN.md); the why is in
[FLOWAID_V2_PRODUCT_STRATEGY.md](FLOWAID_V2_PRODUCT_STRATEGY.md). What shipped is recorded in
[FLOWAID_V2_FINAL_AUDIT.md](FLOWAID_V2_FINAL_AUDIT.md).

Every initiative is complete when its tests pass in `pnpm check` and the PostgreSQL suites, its
documentation is updated, and nothing listed under "security" is left open.

## Phase 0: discovery and baseline

**Done 2026-09-28.** Five review lenses, the baseline (`pnpm check` green; PostgreSQL suites
database 56, runtime 89, api 117, worker 47), and these four documents.

## Phase 1: stabilisation

### 1.1 Local mode only on loopback (P0-1, S1)

- **Objective:** a LAN client cannot get the local owner session.
- **Affected:** `scripts/start.ts`, `apps/web/src/server/proxy.ts`, `apps/api/src/routes/auth.ts`.
- **API:** `POST /v1/auth/local` refuses when the request came through untrusted forwarding.
- **Tests:** the attack request (`Host: localhost`, `X-Forwarded-For: 127.0.0.1` from a LAN
  address) is refused; loopback still signs in.
- **Rollout:** `pnpm start --host 0.0.0.0` now needs password mode; the message says how.

### 1.2 Runtime correctness (P0-2 to P0-5, A1, D1–D4)

- **Objective:** no run hangs or data loss from bus, trigger or queue handling; bounded storage.
- **Affected:** `packages/database` (run store, queue, retention), `packages/workflow-runtime`
  (orchestrator), `apps/worker`, `apps/api/src/main.ts`.
- **Database:** no destructive change; the retention sweep deletes only what DATABASE.md's
  retention classes already promise to delete.
- **Tests:** Redis-mode commit notices reach subscribers; `busy` is retried; a crash-looping job
  dead-letters; each retention step is batched and makes progress.
- **Rollout:** the first sweep on a large database is batched; the runbook says what it removes.

### 1.3 Honest cost (P0-6, AI1, P2-3)

- **Objective:** streamed generations are priced, unpriced models are visible.
- **Affected:** `packages/workflow-runtime/src/providers.ts`, `packages/nodes-core/src/ai/*`,
  `packages/providers/src/catalog`.
- **Tests:** a streamed Generate node with a priced fake model reports a non-zero cost and a
  `GENERATION_COMPLETED` event.

### 1.4 Release gate (P0-7, O1)

- **Objective:** no tag or image from a commit whose CI or E2E failed.
- **Affected:** `.github/workflows/release.yml`, `docs/RELEASING.md`.

## Phase 2: platform foundation

### 2.1 Security hardening (P1-1 to P1-4, P2-4)

Redirect header stripping, the database-node address guard, CORS, environment pins on every
environment-taking route, stdio MCP env deny-list, IPv6 blocklist. Each with a test that fails
before the fix.

### 2.2 Production-traffic metrics (P1-8, D5)

- **Objective:** dashboards and insights measure real traffic.
- **API:** `GET /v1/metrics/*` accept `origin` (default: `manual`, `api`, `trigger`, `schedule`,
  `webhook`, `subflow`, … whichever origins are production in `RunOrigin`); evaluation, replay,
  restart and fork runs are excluded by default.
- **Tests:** PostgreSQL metrics suite with mixed origins.

### 2.3 Operability (P1-9 to P1-11, O2–O5)

`docs/operations/` (backup and restore, upgrades, runbook); dead OIDC configuration removed;
readiness hardened; queue and worker metrics recorded.

## Phase 3: UX

### 3.1 Trust and orientation (P1-12, F2–F7, F9)

- Run detail in a sheet below `lg`; pending-approval count in the navigation and ⌘K; page titles;
  links for breadcrumbs and rows; skip link; parallel session bootstrap; a route error boundary.
- AI builder provenance (model, tokens, cost, compile passes, diagnostics) and distinct
  generating/saving states; critic findings show their source and preview their fix.
- **Tests:** component tests per behaviour; the axe gallery stays green.

### 3.2 An actionable Overview (F1)

- **Objective:** the first screen answers "what needs me?".
- **UX:** a Needs attention section above the metrics (pending and overdue approvals, failing
  workflows, significant regressions from 4.1), each item linking to the filtered list or record;
  metric tiles link to Runs with the matching filter; filters live in the URL.
- **Responsive:** the section is a single column list on phones and comes before the charts.

## Phase 4: intelligence layer

### 4.1 Change detection (`@flowaid/insights`, M4)

- **Objective:** say what changed per workflow, with evidence, and only when it is real.
- **Method:** a recent window against a baseline window of equal or longer length, per workflow:
  - failure rate: Fisher's exact test (one-sided, increase);
  - latency of runs that did not wait for a person, and cost per run: Mann–Whitney U with a tie
    correction, effect size as the ratio of medians;
  - new error codes: codes with at least 3 occurrences in the window and none in the baseline;
  - decision confidence: Mann–Whitney U on node decision confidence (a drop).
    Benjamini–Hochberg across every test in a request (q < 0.05), minimum sample sizes, and minimum
    practical effects (e.g. failure rate +5 points and ×1.5; latency or cost ×1.25).
- **Attribution:** when most recent runs ran a version absent from the baseline, the insight
  names it.
- **API:** `GET /v1/insights?window=…&workflowId=…&environmentId=…` →
  `{ computedAt, window, baseline, attention, insights }`.
- **Tests:** unit tests against reference values for each test; simulation tests for the
  false-positive rate under no change and detection power under a known change; PostgreSQL route
  test.
- **Security:** workspace-scoped through `db.tenant`; API keys pinned to workflows see only those.

### 4.2 Ask FlowAId (AI9)

- **Objective:** answer questions about the workspace with cited, typed statements.
- **Design:**
  - The tool loop lives in `@flowaid/advisor`; the tools live in the API and call the same services
    as the routes, inside the principal's tenant transaction. The loop stops after at most 6 tool
    rounds, and each question has a cost limit.
  - Read-only tools: list workflows, list runs (filtered), run summary (status, error and failed
    nodes; no node I/O), metrics, insights, pending approvals.
  - The answer is structured: statements with a kind (`fact`, `calculation`, `recommendation`,
    `uncertain`) and source IDs. A source ID must have appeared in a tool result in the same
    conversation, or the statement is marked uncertain.
  - Tool output is wrapped as untrusted data.
- **API:** `POST /v1/assistant/ask { question, history? }`, which is audited and rate limited.
- **UX:** an Ask panel opened from the top bar and ⌘K. It shows kind badges, source links, and the
  model, tokens and cost.
- **Tests and evaluation:** scripted-model scenarios (tool choice, citation validation, injection in
  tool output, budget stop, no provider configured), and a live evaluation set run through a CLI
  script when a provider key is present. See [FLOWAID_AI_EVALUATION.md](FLOWAID_AI_EVALUATION.md).

### 4.3 AI hardening (P1-5 to P1-7)

Untrusted-content envelope and caps for agents and retrieval, pre-turn budget checks, rubric in the
builder's repair loop, prompt hashes.

## Phase 5: analytics and ML

### 5.1 Statistics that hold up (P2-1, P2-2)

Kish effective n and a multiplicity correction in Jev threshold recommendations; exact McNemar
for evaluation regressions.

### 5.2 Deferred

- **Jev calibration in the product (M1):** a job computing calibration metrics per decision contract
  from receipts and labels, with a panel. This needs a labelling workflow first.
- **Forecasting spend** once there are 30+ days of history, and daily rollups so baselines outlive
  retention.

## Phase 6: performance and reliability

- Lazy-load the builder's heavy pieces and set a bundle budget (P3-1).
- Pagination everywhere (P3-2).
- Redis-backed rate limits in scale mode (P3-3).
- Statement and request timeouts (B3).

## Phase 7: quality and security

- CI runs the database node's PostgreSQL tests.
- Browser tests use condition waits.
- Evaluation sets for the AI builder.
- Foreign keys on lineage columns (P3-4).
- A master-key rotation command (P3-7).

## Phase 8: production readiness and the 2.0.0 release

- Update STATUS, README, the CHANGELOG and a changeset for 2.0.0.
- Complete the final audit.
- The release goes through the gated workflow from 1.4.

## Sequencing

```
Phase 1 ─┬─> Phase 2 ─┬─> 3.2 Overview ─┐
         │            └─> 4.1 Insights ─┴─> 4.2 Assistant ─> Phase 8
         └─> 3.1 UX (parallel)       4.3 (parallel with Phase 2)
```

The Phase 1 and 2 items and 3.1 run in parallel, on disjoint parts of the tree. 4.1 needs 2.2, so
that metrics count only production traffic. 4.2 uses 4.1's insights as one of its tools.
