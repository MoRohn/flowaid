# Live option menus

> "A decision model must choose from what exists now." (§VIII.A)

When the options of a Choice can change (workers, browser controls, sources, models, files), the
menu is **runtime state**. FlowAId builds it immediately before evaluation, versions it, counts
what was filtered and why, and always gives the model a way out. The implementation is
`buildOptionSet` in [`packages/jev/src/menu.ts`](../../packages/jev/src/menu.ts); the normative
design is [`JEV_ENGINEERING.md` §10](../design/JEV_ENGINEERING.md).

## Static and dynamic menus

A contract's Choice question has either a **static** menu (fixed outcomes such as `billing`,
`technical`, `general`, `none`) or a **dynamic** menu (`source: "dynamic"`). A dynamic menu
declares its escape hatches (`stop`, `review`, `other`), a `maxOptions` bound, a key strategy, a
`maxAgeMs` freshness bound and guidance for descriptions. "An internal menu written when the run
began is not a reliable program representation. If a selected option no longer exists, the model
did not necessarily infer badly; the harness evaluated an invalid graph" (§VIII.A).

## How `buildOptionSet` builds a menu

The handbook's sequence for large option sets is "Deterministic code removes impossible candidates.
Retrieval or embeddings create a shortlist. Jev resolves the remaining ambiguity" (§VIII.B). The
builder follows it and records a count at every step:

1. **Dedupe** candidates by id (first wins).
2. **Keep**: deterministic exclusion (unavailable, disabled, hidden, not permitted).
3. **Eligible**: data-class trust and provider policy decided by code (§VII.G).
4. **Budget**: drop candidates that cost more than the remaining budget.
5. **Shortlist**: keep the top K by a score, in a stable order.
6. **Key** each survivor with a stable, TypeSafe-safe slug (`optionKey`: lowercase, `[a-z0-9_]`,
   starting with a letter).
7. **Append the escapes** declared by the menu.
8. **Cap** at the TypeSafe limit of 255 options including escapes. On overflow the builder either
   truncates, keeping the shortlist order and listing what was cut, or refuses to build
   (`overflow: "error"`).
9. **Version** the set by hashing its entries, so equal candidates give an equal version.

"Log both the original candidate count and the survivors so failures can be assigned to filtering,
retrieval, or semantic choice" (§VIII.B). The set's `counts` carry original, kept, eligible,
affordable, shortlisted and final sizes. Its report lists duplicates and excluded, ineligible,
over-budget, not-shortlisted and truncated candidates.

## Descriptions distinguish, never praise

"Two workers described as fast and capable create an under-specified menu. Criteria should state
the evidence conditions under which each worker is the correct branch. Where options overlap, add a
review or none outcome" (§VIII.F). The contract lint flags praise-only descriptions
(`isPraiseOnly`) and pairs of descriptions that overlap heavily (word-set Jaccard similarity).

## Stop is an outcome

"Dynamic menus should usually include stop. Without it, the agent is forced to keep acting after
the goal is complete or when no safe action exists" (§VIII.G). In FlowAId, `stop` is a declared
escape. It carries criteria, may be marked automatable, and routes with the reason `stop_outcome`.

## Freshness and invalidation

Every option has an invalidation condition (Table VII):

| Object          | Invalidation                 | Correction                    |
| --------------- | ---------------------------- | ----------------------------- |
| Worker          | Unavailable or overloaded    | Refresh registry and load     |
| Browser control | Hidden, disabled, or removed | Observe the current page      |
| Source          | Content or timestamp changed | Re-fetch and version          |
| Budget          | Spend increased              | Read the current ledger       |
| Permission      | Scope revoked                | Re-evaluate policy            |
| File            | Artifact moved or replaced   | Resolve current path and hash |

`isOptionSetStale(optionSet, menu, now, inputsSeq)` treats a set as stale when it is older than
`maxAgeMs`, or when it was built before newer inputs arrived. A stale set is rebuilt before
evaluation. A choice whose option turns out stale at action time is recorded as `stale_option`,
and the `stale_options` drift alarm watches that rate ([calibration.md](calibration.md)).

Caching is allowed only with an explicit invalidation rule: "Time-based expiry alone is
insufficient for permissions, budgets, and live controls. Prefer event-driven invalidation"
(§VIII.H). The planned `flowaid.jev.menu` node requires at least one `invalidateOn` event for any
cache.

## The receipt names the menu

"The decision receipt should identify the option-set version. When an incident involves a stale
choice, the team can then distinguish inference error from invalidation failure" (§VIII.H). Every
Choice receipt carries an `optionSet` reference: version, source, size, escape keys, counts and
age at evaluation.

## Test the builder separately

"A correct Choice cannot recover an option removed by a faulty builder" (§VIII.D Option-Set
Tests). Menu builders have their own fixtures, separate from contract tests: unavailable workers,
disabled controls, expired sources, exhausted budgets and permission changes. In some fixtures the
expected result is only `stop` and `review`.

## Status

- **Built** (`@flowaid/jev`): dynamic menu schema, `buildOptionSet`, `optionKey`, versioning, counts and report, `optionSetCriteria`, staleness checks, option-set refs for receipts, and the description lints. All are covered by tests.
- **Waiting on other packages**: the `flowaid.jev.menu` node and live candidate sources from tools and the model catalog (nodes-core, mcp, providers).
