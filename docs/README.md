# FlowAId documentation

## Start here

| Document                                         | What it is                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [STATUS.md](STATUS.md)                           | What is built, what passes, what is next                                                                                              |
| [UPGRADE_PLAN.md](UPGRADE_PLAN.md)               | The active delivery plan: phases P0–P6 and tracks J (Jev) and L (Lean). Machine-readable copy: [upgrade-plan.json](upgrade-plan.json) |
| [design/SPEC.md](design/SPEC.md)                 | The product specification                                                                                                             |
| [design/ARCHITECTURE.md](design/ARCHITECTURE.md) | The authoritative architecture                                                                                                        |

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
