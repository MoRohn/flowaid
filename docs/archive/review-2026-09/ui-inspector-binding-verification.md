# Verification: ui-inspector-binding-components

Verdict: **stands (not refuted)**. Severity: **high**. Effort: XL.

## Evidence

- `packages/ui/src/inspector/Inspector.tsx:59-78` — `InspectorTabId` union and `INSPECTOR_TABS` are
  `config | input | output | decision | timing | logs | state | errors`. These are run-detail tabs.
- `docs/design/UI.md:41-43, 65-69` — spec tabs are `Config · Inputs · Policy · Info` plus a `Run` tab
  (`NodeRunDetail`, §7.3 at line 225). Line 73 assigns `InspectorHeader, PortRow, RefPicker,
DependencyPanel` to `inspector`, and `NodeRunDetail` to `trace`.
- `docs/design/UI.md:160` — `x-ui.bindable: true` → `BindingField` (literal ⇄ ref/template/expr).
- `docs/design/UI.md:165-167` — `SecretSlotPicker` above config; Inputs tab = `PortRow` per input port
  with binding chip + picker; Info tab = dependency panel (OR/AND control groups, optional data deps,
  guard in words).
- `grep -rln 'PortRow|RefPicker|DependencyPanel|BindingField|SecretSlotPicker|NodeRunDetail' packages/ui/src`
  → 0 files.
- `grep -rn 'x-ui|bindable' packages/ui/src/forms/schema.ts packages/ui/src/forms/widgets.tsx` → 0 hits,
  so SchemaForm has no bindable-field hook either.
- `Inspector.tsx` has no `policy`, `manifest`, or `binding` handling; the config tab is a slot
  (`line 350`: "forms/ injects the SchemaForm").

## Partial building blocks that exist (reuse, do not duplicate)

- `forms/ExpressionReferencePicker.tsx` — scope-path picker (nodes → output fields) without
  compatibility ordering; a reasonable base for `RefPicker` once `isSubschema` from workflow-core is applied.
- `forms/CredentialPicker.tsx` — picks _credentials_, not definition `secrets` slots; `SecretSlotPicker`
  is a different surface (lists `definition.secrets` by `credentialType` + "declare new secret").
- `forms/RetryPolicyEditor.tsx` — covers retry only; the Policy tab needs timeout/onError/pool/privacy
  via `SchemaForm` over `NodePolicySchema`.
- `inspector/PortTypeLabel.tsx`, `inspector/SchemaTree.tsx` — type summaries for `PortRow`.

## Why high

The Inspector is the primary editing surface in the builder (UI.md §3). Without Inputs/Policy/Info and
binding controls, a user cannot wire data between nodes, set node policy, or see why a node runs from
the UI; only the read-only run views exist. This blocks the builder work packages that depend on
`setBinding`/`setNodePolicy` (UI.md:95) rather than being a "not built yet" platform gap.
