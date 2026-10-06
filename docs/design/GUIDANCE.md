# In-product guidance

How FlowAId explains itself on each page, and the coverage checklist to keep it complete. The
navigation (`apps/web/src/shell/nav.tsx`) is the scope: every entry, the pages it leads to, and
the create, configure, run and result screens reached from them.

## Building blocks (`apps/web/src/guide`)

| Piece                     | What it does                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities/<page>.ts`  | The page's text: what, when, needs, start, result, and optional "reading" and "quality" tips.                                                                           |
| `PageIntro`               | "Start here" under the page header. Collapses to one line (remembered per browser) that still flags missing setup. Starts collapsed on a page that already has content. |
| `Readiness`               | `CheckList` of `Check`s computed from real state (ok, blocker, warning, info, optional, checking); `QualityNote` says valid is not the same as good.                    |
| `GuidedFlow`              | A form as steps. `done` comes from the draft, never from Next; "All fields" shows the same form at once; going back keeps later work.                                   |
| `useKeptDraft`            | Unsent new-item drafts in sessionStorage, per workspace, with secrets omitted; cleared on create.                                                                       |
| `useConnections`          | Provider key readiness shared with the getting-started checklist.                                                                                                       |
| `pages.ts` / `GuidePanel` | The side Guide: page steps, glossary, builder and run explanations.                                                                                                     |

Rules: never start a run, an evaluation, a sync, a publish or a deploy because a step advanced;
only an explicitly labelled button does. No cost or quality estimates without real data.

## Coverage checklist

| Capability   | Destination                                                                                             | Guidance                                                                                                    | Guided flows                                                                                        | Live checks                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Overview     | `/[ws]`                                                                                                 | Getting started checklist; intro on reading tiles, Needs attention, What changed (insight rules and limits) | —                                                                                                   | onboarding steps                                                                                       |
| Workflows    | `/workflows`, `/workflows/new`, `/workflows/[id]/{runs,versions,versions/compare,deployments,settings}` | Intro per page: draft vs version vs deployment                                                              | New workflow (name → how to start → create); Publish review                                         | TypeSafe key, text model, role, published versions, secrets per environment, triggers, evaluation link |
| Builder      | `/workflows/[id]`                                                                                       | Guide panel (existing); Agent preset, MCP and OpenAPI pickers by name                                       | Publish dialog                                                                                      | compiler diagnostics                                                                                   |
| Agents       | `/agents`                                                                                               | Intro, quality tips                                                                                         | New/Edit agent (job → model → instructions → tools → limits → review → next steps)                  | text model, tools, role                                                                                |
| Runs         | `/runs`, `/runs/[id]`                                                                                   | Reading a run: statuses, trace, confidence, recorded cost; what retry, replay, fork, restart do             | Confirm dialogs name paid re-execution                                                              | —                                                                                                      |
| Human tasks  | `/human-tasks`, `/human-tasks/[id]`                                                                     | Inbox intro; "Before you answer": why it came to a person, what each answer does, expiry                    | —                                                                                                   | role can answer                                                                                        |
| Templates    | `/templates`                                                                                            | Intro: business vs technical templates                                                                      | Use template (needs → name → servers → review)                                                      | TypeSafe key, text model, MCP servers, role                                                            |
| Triggers     | `/triggers` (Webhooks, Schedules, MCP tools)                                                            | Intro per tab: draft → publish → deploy; "What these settings mean"                                         | Add webhook, Add schedule, Expose workflow, token                                                   | published workflows, unsigned or secretless webhooks, failed schedules, disabled exposures             |
| Integrations | `/integrations` (MCP, OpenAPI, Providers, Plugins)                                                      | Intro per tab with "Which tab do I need?"                                                                   | Connect MCP server, tool policy, OpenAPI import (preview first)                                     | server errors, tool counts, provider keys, plugin load failures                                        |
| Knowledge    | `/knowledge`, `/knowledge/[id]`                                                                         | Intro; "Using this source"; status line; how to read test-search scores                                     | New source (holds → from → search → chunking → review); Settings (same steps, re-index asked first) | embedding key, PageIndex service, role                                                                 |
| Evaluations  | `/evaluations`, `/evaluations/sets/[id]`, `/evaluations/runs/[id]`                                      | Intro; "Writing good cases" with coverage; "How to read this report"                                        | New set; Start evaluation warns of cost                                                             | workflows to test, role                                                                                |
| Credentials  | `/credentials`                                                                                          | Intro                                                                                                       | New credential (service → secret → where → review → how workflows use it)                           | TypeSafe key, text model, server keys                                                                  |
| Settings     | `/settings` (Workspace, API keys, Environments, Notifications, Audit)                                   | Intro per tab                                                                                               | New API key (5 steps, key shown once with example); Add channel (test only on request)              | budget, published workflows, expiring keys, protected environments, unrouted events                    |

## Known gaps (backend)

- `GET /v1/workflow-versions/:id` returns no execution plan, so a run's graph draws data
  connections from the bindings (as the builder does) rather than from the compiled plan.
- Decision steps (Choice, Yes/No, batch) declare their TypeSafe slot as required although they
  resolve the key through the provider, which falls back to the server key. The builder binds
  such a slot to a secret automatically, which is also what makes a workspace TypeSafe key reach
  the step, so the slot stays required: a slot left unbound still fails to publish.
- Whether `SMTP_URL` is set is not shown in the app; an email channel's test send is the check.
  Retention is set in Settings → Workspace and applied by the nightly sweep, whose results only
  the worker heartbeat records.
- Webhook callbacks (`callbackUrl`) and `responseMode: stream` are not implemented (API.md §6).

Resolved since the 2026-09-30 record: knowledge sources have a Settings dialog (name, search,
embedding, chunking); a recorded replay can never conflict on `privacy.replayable` (nothing marks
a run unreplayable), and a step whose output was not stored now runs again instead of being reused.

## Audit record (2026-10-05)

Five audit lenses walked every navigation entry in the running app (1440 and 390 wide, keyboard
and pointer) and traced each journey through the code. The findings, the roadmap they produced
and the verification of each item are in
[project/PRODUCT_ROADMAP_2026-10.md](../project/PRODUCT_ROADMAP_2026-10.md). Of the 2026-09-30
open minors, focus return after dialogs (F-05), Max cost 0 (D-05), the Workflows grid's empty
search (B-12), the OpenAPI toolset row (E-08, except re-import) and the settings tab row on
phones (scrolls with an edge fade) are resolved; Versions, Compare, Deployments and evaluation
reports were checked with real data.
