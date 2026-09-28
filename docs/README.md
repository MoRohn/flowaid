# FlowAId documentation

## Start here

| Document                                         | What it is                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [STATUS.md](STATUS.md)                           | What is built, what passes, what is next                                                                                              |
| [RELEASING.md](RELEASING.md)                     | Changesets, the release workflow, the published images and how to verify them                                                         |
| [UPGRADE_PLAN.md](UPGRADE_PLAN.md)               | The active delivery plan: phases P0–P6 and tracks J (Jev) and L (Lean). Machine-readable copy: [upgrade-plan.json](upgrade-plan.json) |
| [design/SPEC.md](design/SPEC.md)                 | The product specification                                                                                                             |
| [design/ARCHITECTURE.md](design/ARCHITECTURE.md) | The authoritative architecture                                                                                                        |

## Operations (`operations/`)

| Document                                                  | What it covers                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [BACKUP_AND_RESTORE.md](operations/BACKUP_AND_RESTORE.md) | Backing up the database and the master key together, restoring them, and checking the key after restore |
| [UPGRADES.md](operations/UPGRADES.md)                     | Pinning image tags, upgrading, how migrations run, and rolling back by restoring                        |
| [RUNBOOK.md](operations/RUNBOOK.md)                       | Health checks, logs, metrics, stuck runs, the queue, scaling workers and key rotation                   |

## V2 (`FLOWAID_V2_*`, `architecture/`, `ai/`, `data/`, `security/`, `operations/`)

| Document                                                         | What it is                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [FLOWAID_V2_CODE_REVIEW.md](FLOWAID_V2_CODE_REVIEW.md)           | The assessment that opened V2: findings with evidence, severity and priority  |
| [FLOWAID_V2_REFACTOR_PLAN.md](FLOWAID_V2_REFACTOR_PLAN.md)       | P0–P3 stabilisation work                                                      |
| [FLOWAID_V2_PRODUCT_STRATEGY.md](FLOWAID_V2_PRODUCT_STRATEGY.md) | Vision, users, journeys, principles, and what V2 does not do                  |
| [FLOWAID_V2_ROADMAP.md](FLOWAID_V2_ROADMAP.md)                   | The phases, initiative by initiative                                          |
| [FLOWAID_AI_EVALUATION.md](FLOWAID_AI_EVALUATION.md)             | How the assistant, change detection and AI builder are measured, with results |
| [FLOWAID_V2_FINAL_AUDIT.md](FLOWAID_V2_FINAL_AUDIT.md)           | What V2 delivered, what was verified, and what is deferred                    |
| [architecture/V2_OVERVIEW.md](architecture/V2_OVERVIEW.md)       | Where the V2 modules sit                                                      |
| [ai/ASSISTANT.md](ai/ASSISTANT.md)                               | Ask FlowAId: tools, grounding, guardrails, model strategy                     |
| [data/INSIGHTS.md](data/INSIGHTS.md)                             | "Needs attention" and "What changed": data, tests, lifecycle                  |
| [security/THREAT_MODEL.md](security/THREAT_MODEL.md)             | Assets, boundaries, threats and controls                                      |
| [operations/](operations/RUNBOOK.md)                             | Backup and restore, upgrades, the runbook                                     |

## PageIndex document intelligence (`pageindex/`)

| Document                                               | What it is                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [pageindex/SETUP.md](pageindex/SETUP.md)               | Install, configure, first document and answer, verification, troubleshooting |
| [pageindex/ADR.md](pageindex/ADR.md)                   | The verified upstream contract and the architecture decisions                |
| [pageindex/CAPABILITIES.md](pageindex/CAPABILITIES.md) | Local and cloud capability matrix for the pinned release                     |
| [pageindex/API.md](pageindex/API.md)                   | The HTTP routes                                                              |
| [pageindex/EVALUATION.md](pageindex/EVALUATION.md)     | The evaluation set, thresholds and measured results                          |
| [pageindex/EXTENDING.md](pageindex/EXTENDING.md)       | Where each part lives and the rules for changing it                          |

## Design (`design/`)

The design is authoritative. Where documents disagree, `CONTRACTS.ts` wins, then ARCHITECTURE.

| Document                                                | Scope                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](design/ARCHITECTURE.md)               | Monorepo, contracts, compiler, runtime, providers, security, demo workflows                                                        |
| [CONTRACTS.ts](design/CONTRACTS.ts)                     | Frozen Zod contracts implemented by `@flowaid/workflow-core`                                                                       |
| [RFCS.md](design/RFCS.md)                               | Contract change proposals and their status ([`rfcs/`](rfcs/) holds the full texts)                                                 |
| [DATABASE.md](design/DATABASE.md)                       | PostgreSQL schema, projections, retention                                                                                          |
| [API.md](design/API.md)                                 | HTTP routes, auth, SSE, error envelope, SDK and CLI                                                                                |
| [UI.md](design/UI.md)                                   | Web app routes, builder layout, canvas mapping, trace viewer                                                                       |
| [TYPESAFE_API.md](design/TYPESAFE_API.md)               | The TypeSafe Jev System One API, as verified live                                                                                  |
| [JEV_ENGINEERING.md](design/JEV_ENGINEERING.md)         | Decision contracts, packets, routing, calibration, receipts                                                                        |
| [LEAN_VERIFICATION.md](design/LEAN_VERIFICATION.md)     | Lean 4 verified, self-critical evaluation                                                                                          |
| [CODE_EXPORT.md](design/CODE_EXPORT.md)                 | "Download code": a flow as a runnable code package                                                                                 |
| [LANGCHAIN.md](design/LANGCHAIN.md)                     | The compartmentalized LangChain integration                                                                                        |
| [VERSIONS.md](design/VERSIONS.md)                       | Pinned dependency versions                                                                                                         |
| [IMPLEMENTATION_PLAN.md](design/IMPLEMENTATION_PLAN.md) | The original work-package definitions (WP-xx). Sequencing is superseded by UPGRADE_PLAN.md; the done criteria are still referenced |

## Guides

- [`jev/`](jev/overview.md): Jev engineering in FlowAId, eleven pages from decision contracts to failure modes.
- Package READMEs: [`workflow-core`](../packages/workflow-core/README.md), [`jev`](../packages/jev/README.md), [`ui`](../packages/ui/README.md), [`env`](../packages/env/README.md).
- [`../brand/IDENTITY.md`](../brand/IDENTITY.md): the visual identity and UI rules.
- [`../docker/README.md`](../docker/README.md): the Compose stack.

## Research (`research/`)

Source material the design is built on. Kept verbatim; not formatted by Prettier.

- [`research/jev/`](research/jev/): the _Jev Engineering for Production Agents_ handbook and the team's expert guide.
- [`research/lean4/`](research/lean4/): the Lean 4 article, sources, the expert guide and the hands-on report.

## Archive (`archive/`)

- [`archive/review-2026-09/`](archive/review-2026-09/): the September 2026 system review (seven review lenses, 165 verified findings) that produced UPGRADE_PLAN.md. Point-in-time notes, not maintained.
