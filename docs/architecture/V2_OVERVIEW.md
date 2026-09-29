# FlowAId V2 architecture overview

V2 keeps V1's architecture ([design/ARCHITECTURE.md](../design/ARCHITECTURE.md) stays
authoritative) and adds an intelligence layer on top of data the runtime already records. This
page shows where the V2 pieces sit and how they connect.

```
                      apps/web (Next 16)
   Overview ── Needs attention · What changed        Ask FlowAId panel (⌘K, top bar)
        │ GET /v1/insights                                 │ POST /v1/assistant/ask
        ▼                                                  ▼
                      apps/api (Fastify)
   routes/insights.ts ─► services/insights.ts        routes/assistant.ts
        │                    │  SQL: per-workflow         │  ask() loop ─► workspace model
        │                    │  aggregates + capped       │  (advisorModel: Anthropic,
        │                    ▼  samples                   │   OpenAI or Ollama)
        │           @flowaid/insights                     ▼
        │           (Fisher, Mann–Whitney,       services/assistant.ts: 6 read-only tools
        │            Benjamini–Hochberg)          (list_workflows, list_runs, get_run,
        │                                          get_metrics, get_insights ◄─┘ reuses insights,
        │                                          list_open_approvals)
        ▼                                                  │
   services/metrics.ts (production origins) ◄──────────────┘
        │
        ▼  db.tenant(workspaceId): RLS + explicit workspace filters + API-key pins
   PostgreSQL: runs, node_runs, human_tasks, workflow_versions (no new tables in V2)
```

## New and changed modules

| module                                                      | kind              | responsibility                                                                                                                            |
| ----------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/insights`                                         | new, browser-safe | Statistical tests and `detectChanges`: pure functions over data the caller loads ([data/INSIGHTS.md](../data/INSIGHTS.md))                |
| `packages/advisor/src/assistant.ts`                         | new               | The Ask FlowAId loop: tool calls, untrusted wrapping, citation validation, round and spend limits ([ai/ASSISTANT.md](../ai/ASSISTANT.md)) |
| `packages/advisor/src/evals/`                               | new               | The assistant's evaluation set and scorer ([FLOWAID_AI_EVALUATION.md](../ai/FLOWAID_AI_EVALUATION.md))                                    |
| `apps/api/src/services/insights.ts`, `routes/insights.ts`   | new               | `GET /v1/insights`                                                                                                                        |
| `apps/api/src/services/assistant.ts`, `routes/assistant.ts` | new               | `POST /v1/assistant/ask` and its tools                                                                                                    |
| `apps/api/src/services/metrics.ts`                          | changed           | Production traffic by default (`origin=all` restores every run)                                                                           |
| `apps/web/src/dashboard/Attention.tsx`                      | new               | The Overview's two panels                                                                                                                 |
| `apps/web/src/assistant/`                                   | new               | Provider (conversation state in the workspace layout), panel, logic                                                                       |
| `packages/shared/src/untrusted.ts`                          | new               | One helper for untrusted content in prompts, shared by agents, knowledge retrieval and the assistant                                      |

## Boundaries

- `@flowaid/insights` depends on nothing but `shared` (see `boundaries.json`), so it can run in the browser and the CLI.
- The assistant loop in `@flowaid/advisor` is pure. It receives `generate` and the tools, so it
  never touches the database, credentials or HTTP.
- The tools live in the API, next to the routes whose visibility rules they reuse.
- Data access is unchanged: every query runs in `db.tenant(workspaceId)` under forced row-level
  security, with the principal's workflow and environment pins applied.

## Runtime changes in V2 (stabilisation)

These are not new features. They are correctness fixes that the new features depend on; the
details are in [FLOWAID_V2_CODE_REVIEW.md](../project/FLOWAID_V2_CODE_REVIEW.md) and the git history.

- **Event bus:** durable commit notices always travel over Postgres LISTEN/NOTIFY. Redis carries
  only live deltas.
- **Retention:** the retention sweep runs on the maintenance queue and every step is batched.
- **Contended triggers:** a trigger the orchestrator reports as "busy" is re-queued. Timers and
  delegated results are consumed only after the run has handled them.
- **Queue:** jobs that exhausted their attempts are dead-lettered when claimed. Queue depth and
  active runs are recorded as metrics.
- **Cost:** streamed generations are priced and recorded on the run and on the node.
