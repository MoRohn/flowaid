# FlowAId status — 2026-09-23

No background workflows are running. This file records where everything stands so work can
restart from a known state. The repository is published at
[github.com/MoRohn/flowaid](https://github.com/MoRohn/flowaid), and CI runs on every push to `main`.

## Gates

| gate                | result                                              |
| ------------------- | --------------------------------------------------- |
| `pnpm typecheck`    | pass                                                |
| `pnpm lint`         | pass (0 errors; 19 warnings in `@flowaid/ui`)       |
| `pnpm boundaries`   | pass (67 tests)                                     |
| `pnpm test`         | pass                                                |
| `pnpm format:check` | pass                                                |
| CI                  | `.github/workflows/ci.yml`: jobs `check` and `test` |

## Packages

| package                      | state                                                                                                                                                                                                                                                                                                                                                   | tests |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `@flowaid/config`            | done                                                                                                                                                                                                                                                                                                                                                    | n/a   |
| `@flowaid/shared`            | done; browser-safe SHA-256 via `@noble/hashes`                                                                                                                                                                                                                                                                                                          | 81    |
| `@flowaid/env`               | done; production guards and new variables                                                                                                                                                                                                                                                                                                               | 55    |
| `@flowaid/workflow-compiler` | done (P1-01): passes 1–8, 94 diagnostic codes with one fixture each, guard DNF with family-cover simplification, exclusive groups, batching, redaction, canonical (key-order independent) compilation, `checkBinding`, `diff`, `migrateDefinition`, `verifyPlan`; golden plan byte-equal; three demos compile with zero errors; browser bundle verified | 160   |
| `@flowaid/workflow-core`     | done; contracts, FlowExpr (with `concat`, RFC-0018), templates, `isSubschema`, fixtures and manifests for every demo node type, with the P0-10 to P0-14 fixes                                                                                                                                                                                           | 2,665 |
| `@flowaid/ui`                | 12 groups plus a Jev group; built on the workflow-core contracts; `ImportDialog` for external flow exports                                                                                                                                                                                                                                              | 829   |
| `@flowaid/jev`               | library core done: contracts, TypeSafe question mapping, packets, bundles, routing, blind-retry guard, live menus, receipts and hash chains, calibration, shadow comparison, lints, failure-mode catalog; six harness templates; README                                                                                                                 | 183   |
| apps                         | not started                                                                                                                                                                                                                                                                                                                                             | —     |
| other platform packages      | not started (upgrade phases P1 to P4)                                                                                                                                                                                                                                                                                                                   | —     |
| `lean/`                      | not started; the toolchain (Lean 4.34.0) is installed and verified in `~/.elan`                                                                                                                                                                                                                                                                         | —     |

## Upgrade plan (`docs/UPGRADE_PLAN.md`)

- **Phase 0 done:** P0-01, P0-02, P0-04 (formatting part), P0-06, P0-07, P0-09 to P0-19.
- **Phase 0 not done:** P0-20 (UI visual/axe regression suite; state unverified), P0-03 (dist exports; partly present), P0-05 (partly done: `ci.yml` with the `check` and `test` jobs and Dependabot are in; release, e2e and Docker workflows, git hooks, changesets and coverage thresholds remain), P0-08 (repo docs), P0-04 (version pins and supply-chain part).
- **Phase 1:** P1-01 (workflow compiler), P1-03 (node SDK), P1-04 (providers) and P1-05 (credentials) done. P1-02, P1-06, P1-07 not started.
- **Phases 2 to 6:** not started.
- **Track J (Jev):** J-01 to J-07 library core built in `@flowaid/jev`. Still to come in the library: tool-proposal normalizer and tool policy, receipt reconstruction and replay planning, workflow analyzers, incident review. J-08 onward needs RFC acceptance and platform packages.
- **Track L (Lean verification):** designed in `docs/design/LEAN_VERIFICATION.md`, RFC-0017 proposed, items L-01 to L-15 added. L-01 to L-09 and L-13 are buildable now.

## Research and design

- Jev engineering: handbook, expert guide and design in `docs/research/jev/` and `docs/design/JEV_ENGINEERING.md`; all 11 pages of `docs/jev/` written.
- Lean 4: article, expert guide and hands-on report in `docs/research/lean4/`; design in `docs/design/LEAN_VERIFICATION.md`.
- Design set in `docs/design/` (including CODE_EXPORT, LANGCHAIN, JEV_ENGINEERING, LEAN_VERIFICATION, RFCS). The 2026-09 review notes are archived in `docs/archive/review-2026-09/`.

## Final pass (2026-09-23)

- README gained a product tour with light and dark screenshots from the UI playground (`docs/assets/screenshots/`).
- UI fixes: decision contract cards stack zones and authority when the card is narrow, and `environmentShortLabel` abbreviates "Development" to "Dev" as documented.

- `pnpm start` (preflight, install when stale, build, serve the playground; `--prod`, `--verify`, `--open`, `--port`, `--host`), `pnpm preflight` and `pnpm check` (every CI gate), with a README Quick start.

## Loose ends

None open from the 2026-09-23 list. Next on the critical path: P2-01 (runtime), with the rest of Phase 1; the rest of Phase 1 (database, credentials, observability, UI widgets) runs alongside, as do tracks J and L where they are buildable.
