# FlowAId V2 product strategy

## Where V1 stands

V1 (the P0–P6 upgrade plan) made FlowAId a complete build-and-run platform: a typed canvas and
compiler, a durable event-sourced runtime, calibrated Jev decisions, human approval, replay and
fork, evaluations with a publish gate, knowledge bases, agents, MCP and OpenAPI tools, triggers,
code export, and a local-first start (`pnpm start`, no sign-in on your own computer).

What V1 does not do is help you _operate_ what you built. The Overview shows totals: 312 runs,
94% success, p95 4.1 s. It does not tell you that one workflow started failing after yesterday's
publish, that an approval has been waiting for two days, or why last week cost twice as much.
To find that out you open Runs, filter, open traces and compare by hand. The AI features help you
_author_ workflows (the builder, the critic), not understand them.

## Vision for V2

**FlowAId tells you what needs your attention, why, and what to do about it, and shows its
evidence.**

V2 turns the data the runtime already records (every run's status, cost, tokens, latency,
version, environment, decision confidence and error) into:

1. **Needs attention**: a short, ranked list of things that need a person, such as pending
   approvals, failing workflows and statistically significant regressions, each with a link to act.
2. **What changed**: change detection per workflow that separates real shifts from noise, and
   says when a change coincides with a new version.
3. **Ask FlowAId**: a workspace assistant that answers questions about your runs, workflows and
   costs using read-only tools, and labels each statement as a fact, a calculation, a
   recommendation or uncertain, with links to the runs it came from.

Around these sit the trust and stability fixes the code review found (the P0 and P1 items in
[FLOWAID_V2_REFACTOR_PLAN.md](FLOWAID_V2_REFACTOR_PLAN.md)). Without them the numbers the new
features rest on are wrong: streamed generations cost $0, metrics count replays as traffic, and
runs can hang.

## Who it is for

From the repository (README, SPEC, the local-first decision), not invented:

- **The builder-operator:** a developer or AI engineer who runs FlowAId on their own computer,
  builds a handful of workflows, and keeps them running. This is the primary user. They switch
  between building and operating, and have little time for dashboards.
- **The small-team operator:** the same person running the Compose stack on a server for a team,
  with API keys pinned to environments and a password sign-in. They care about backups, upgrades
  and whether a release broke something.
- **The reviewer:** someone who approves human tasks, often through a review link, without
  building anything. They need the approval queue to be visible and quick to reach.

## Problems V2 solves

| problem                                  | today                                           | V2                                                                   |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| "Is anything broken?"                    | Read six tiles, then filter Runs                | Needs attention lists it, ranked, with links                         |
| "Did my last publish make things worse?" | Compare runs by hand                            | What changed flags significant regressions and names the version     |
| "Why did this cost so much?"             | Streamed generations were missing from the cost | Correct cost; ask the assistant for a breakdown with sources         |
| "Something is waiting for me"            | Open Human tasks to find out                    | Count in the navigation and ⌘K, and at the top of Overview           |
| "Can I trust what the AI built or said?" | Rationale only                                  | Model, cost, compile passes, diagnostics; statements typed and cited |
| "My machine died"                        | One sentence in the Compose README              | A tested backup and restore runbook, including the master key        |

## Journeys

- **Onboarding** (unchanged, V1 is good): `pnpm start`, the getting-started checklist, templates.
- **Daily check (new):** open Overview → Needs attention (approvals, failures, regressions) →
  click through to the filtered runs or the task → act.
- **Investigation (new):** a regression card shows the evidence (rates, sample sizes, the
  q-value, the version that coincides) → open the runs → or ask "why did support-triage start
  failing?" → the assistant lists the error codes it found in those runs, cited.
- **Authoring with AI (improved):** the AI builder shows provenance and diagnostics; critic
  findings say whether a rule or the AI judge produced them, and preview their fix.
- **Recovery (new):** backup, restore, upgrade and rollback are documented and verified.

## Principles

1. **Evidence before assertion.** Every insight carries its numbers: sample sizes, effect size,
   the statistical test and its adjusted p-value. Every assistant statement carries its kind and
   its sources. Nothing probabilistic is shown as certain.
2. **Human-controlled.** The assistant is read-only. It links to where you act; it does not act.
   AI-built workflows and critic fixes are previewed and applied only on acceptance, as one
   undoable step.
3. **Quiet by default.** An insight appears only when it is both statistically significant after
   correcting for multiple comparisons and practically large. Below the minimum sample size,
   nothing is claimed.
4. **Local-first and private.** No new service, no telemetry leaves the machine. The assistant
   sees run metadata, errors, metrics and workflow structure, not node inputs and outputs.
5. **Measured, not impressed.** Detector false-positive rates are tested on simulated data; the
   assistant's harness is tested on scripted scenarios, including prompt injection. See
   [FLOWAID_AI_EVALUATION.md](FLOWAID_AI_EVALUATION.md).
6. **No ML for show.** No trained models: the data is small per workflow, and classical
   statistics answer the questions with interpretable evidence. Calibration and forecasting wait
   for the data to support them (see the roadmap).

## What V2 deliberately does not do

- **No sign-in features:** invitations, MFA, OIDC and RBAC beyond the existing roles are out of
  scope ([local-first decision](STATUS.md)).
- **No trained predictive models.** "Will this run fail?" has too few examples per workflow on a
  single machine. Change detection with tests gives honest answers now.
- **No autonomous AI actions.** An assistant that replays, cancels or publishes needs a
  confirmation and preview design of its own. It is on the roadmap, not in V2.0.
- **No new charts for decoration.** The Overview gains lists that lead to actions, not more tiles.
