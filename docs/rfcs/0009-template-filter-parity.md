# RFC-0009: the template scanner accepts every `TemplateFilter`

- Status: accepted (2026-09-23)
- Raised by: `wc-template-filter-parity` (docs/review/workflow-core.md §10)
- Implemented by: P0-13
- Affects: no `CONTRACTS.ts` change (`TemplateFilterSchema` §2 is unchanged); ARCHITECTURE.md §2.3 (filter grammar); observable compile results of `@flowaid/workflow-core` (0.3.0)

## Motivation

`TemplateFilterSchema` declares `string | json | json_pretty | join_lines | join_comma | upper | lower | trim` and `applyTemplateFilter` implemented all eight, but the scanner's `TEMPLATE_HOLE_FILTERS` was a hand-written list of four, so `{{ n.p.s | upper }}` was a syntax error ("unknown template filter (expected json, json_pretty, join_lines, join_comma)"). Three contract members were unreachable from template source. Recorded as an RFC because the fix changes what compiles, not the contract itself.

## Change

- `TEMPLATE_HOLE_FILTERS` is derived from `TemplateFilterSchema.options` minus `'string'` (type `TemplateHoleFilter = Exclude<TemplateFilter, 'string'>`), so the scanner and the contract cannot drift again; `template.test.ts` asserts the derivation.
- ARCHITECTURE.md §2.3 lists the grammar `filter := 'json' | 'json_pretty' | 'join_lines' | 'join_comma' | 'upper' | 'lower' | 'trim'` and the semantics of each: `json`/`json_pretty` serialise any value; `join_lines`/`join_comma` join an array's items as text (a non-array is a runtime `TYPE` error); `upper`/`lower`/`trim` coerce to text like a bare hole.
- `filterAcceptsContainers(filter)` is true only for `json`, `json_pretty`, `join_lines`, `join_comma` (`TEMPLATE_CONTAINER_FILTERS`). A hole whose static type is object/array with `upper`, `lower`, `trim` or no filter is `E_TEMPLATE_OBJECT_COERCION`, exactly as for a bare hole — the three text filters are scalar-coercing and never a way around the diagnostic.

## Compatibility

- Templates that previously failed to parse with the three filters now parse; nothing that parsed before changes meaning. Stored plans are unaffected (a compiled template carries its `filter` member, which the schema already admitted).

## Tests

- `template.test.ts`: parse rows for `| upper`, `| lower`, `| trim` (with and without whitespace), the derivation of `TEMPLATE_HOLE_FILTERS`, render rows on strings, numbers, booleans, `null` and containers, and `E_TEMPLATE_OBJECT_COERCION` still firing for the scalar-coercing filters on container-typed holes while never firing on scalar-typed ones.
