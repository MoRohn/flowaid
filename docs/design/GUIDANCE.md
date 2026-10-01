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

| Capability   | Destination                                                                                             | Guidance                                                                                                    | Guided flows                                                                           | Live checks                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Overview     | `/[ws]`                                                                                                 | Getting started checklist; intro on reading tiles, Needs attention, What changed (insight rules and limits) | —                                                                                      | onboarding steps                                                                                       |
| Workflows    | `/workflows`, `/workflows/new`, `/workflows/[id]/{runs,versions,versions/compare,deployments,settings}` | Intro per page: draft vs version vs deployment                                                              | New workflow (name → how to start → create); Publish review                            | TypeSafe key, text model, role, published versions, secrets per environment, triggers, evaluation link |
| Builder      | `/workflows/[id]`                                                                                       | Guide panel (existing); Agent preset, MCP and OpenAPI pickers by name                                       | Publish dialog                                                                         | compiler diagnostics                                                                                   |
| Agents       | `/agents`                                                                                               | Intro, quality tips                                                                                         | New/Edit agent (job → model → instructions → tools → limits → review → next steps)     | text model, tools, role                                                                                |
| Runs         | `/runs`, `/runs/[id]`                                                                                   | Reading a run: statuses, trace, confidence, recorded cost; what retry, replay, fork, restart do             | Confirm dialogs name paid re-execution                                                 | —                                                                                                      |
| Human tasks  | `/human-tasks`, `/human-tasks/[id]`                                                                     | Inbox intro; "Before you answer": why it came to a person, what each answer does, expiry                    | —                                                                                      | role can answer                                                                                        |
| Templates    | `/templates`                                                                                            | Intro: business vs technical templates                                                                      | Use template (needs → name → servers → review)                                         | TypeSafe key, text model, MCP servers, role                                                            |
| Triggers     | `/triggers` (Webhooks, Schedules, MCP tools)                                                            | Intro per tab: draft → publish → deploy; "What these settings mean"                                         | Add webhook, Add schedule, Expose workflow, token                                      | published workflows, unsigned or secretless webhooks, failed schedules, disabled exposures             |
| Integrations | `/integrations` (MCP, OpenAPI, Providers, Plugins)                                                      | Intro per tab with "Which tab do I need?"                                                                   | Connect MCP server, tool policy, OpenAPI import (preview first)                        | server errors, tool counts, provider keys, plugin load failures                                        |
| Knowledge    | `/knowledge`, `/knowledge/[id]`                                                                         | Intro; "Using this source"; status line; how to read test-search scores                                     | New source (holds → from → search → chunking → review)                                 | embedding key, PageIndex service, role                                                                 |
| Evaluations  | `/evaluations`, `/evaluations/sets/[id]`, `/evaluations/runs/[id]`                                      | Intro; "Writing good cases" with coverage; "How to read this report"                                        | New set; Start evaluation warns of cost                                                | workflows to test, role                                                                                |
| Credentials  | `/credentials`                                                                                          | Intro                                                                                                       | New credential (service → secret → where → review → how workflows use it)              | TypeSafe key, text model, server keys                                                                  |
| Settings     | `/settings` (Workspace, API keys, Environments, Notifications, Audit)                                   | Intro per tab                                                                                               | New API key (5 steps, key shown once with example); Add channel (test only on request) | budget, published workflows, expiring keys, protected environments, unrouted events                    |

## Known gaps (backend)

- Evaluation judge checks always fail: the worker is not given a judge provider.
- An MCP exposure is switched off by the next deploy of its workflow unless the version declares
  an MCP trigger, which the builder cannot add; there is no endpoint to re-enable it.
- stdio MCP servers are never tested or discovered, so their tools never reach the catalog; a
  server can only be tested after it is saved.
- Schedule catch-up `skip` and `one` behave the same; scheduled runs skip input validation.
- A knowledge source's chunking and embedding can change through the API but not the UI.
- Email delivery (`SMTP_URL`) and retention are not visible to or applied from the web app.
- `GET /v1/workflow-versions/:id` returns no execution plan, so a run's graph draws data
  connections from the bindings (as the builder does) rather than from the compiled plan.
- Decision steps (Choice, Yes/No, batch) declare their TypeSafe slot as required although they
  resolve the key through the provider, which falls back to the server key. The builder binds
  such a slot to an optional secret automatically; a slot left unbound still fails to publish.
- Replay's "Reuse recorded results" fails with a conflict when the run's step results were not
  stored; the web app cannot tell beforehand because runs do not report `privacy.replayable`.

## Audit record (2026-09-30)

Every navigation entry was walked in the running app (web on :3100 against the real API and the
local Postgres) at 1440, 1024 and 390 wide, by keyboard and pointer, without starting paid runs,
evaluations or deploys. Defects found and fixed are listed in `.changeset/ux-audit-fixes.md`.
Still open, all minor:

- The builder header crowds the workflow title at 390 wide; the settings tab row clips without a
  scroll cue on phones.
- Radix returns focus to `<body>` when a dialog opened from a menu closes (Add webhook, Publish).
- Edit agent: a Max cost of 0 is accepted without saying what it does.
- Grid view of Workflows has no "no matches" state for a search.
- The OpenAPI toolset row offers only Delete (no re-read or view).
- No workflow in the local workspace has a published version, so Versions, Compare and
  Deployments were checked in their empty states, and no evaluation report existed to read.
