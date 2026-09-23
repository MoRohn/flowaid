# @flowaid/ui

The FlowAId React component library: every screen of the product is composed from
this package. It ships primitives, the decision visualisations (the probability ruler,
confidence meters, gauges), canvas nodes and the canvas itself, the trace viewer, the
inspector, schema-driven forms, the application shell, data tables, observability charts,
the human-review surfaces and the AI-builder panels.

Components take plain view-model props (see `src/types.ts`) and callbacks. They never
fetch, never own server state and never know about routing; the app adapts runtime
objects to view models and wires the callbacks.

The visual language is defined in `/brand/IDENTITY.md`; `src/tokens.css` is the token
sheet (light and dark) and `src/styles.css` layers Tailwind v4 on top of it. Rules the
library follows everywhere:

- controls are 28 px tall with a 5 px radius and a 1 px border; the primary button is the
  only filled button on a screen;
- cobalt means decision: the accent is spent on decision intelligence and the primary
  action, and status hues (running blue, waiting amber, completed green, failed red) are
  separate from node-category hues;
- everything a machine produced (probabilities, durations, tokens, cost, ids, node kinds)
  is set in JetBrains Mono with tabular numerals; everything a person reads is Instrument
  Sans;
- colours only ever come from tokens (`var(--accent)`, `text-ink-3`, `bg-ok-soft`, …).
  No hex literals in components, and no purple, pink or teal anywhere. Charts draw in
  graphite by default (series slot 0 and single-series charts are `--ink-2`, the heat ramp is
  ink at rising alpha); `--cat-decision` / `--p-*` appear only on an explicit decision slot
  (`seriesColor("decision")`) and in `ConfidenceHistogram`, `CalibrationChart`,
  `CalibrationMini`;
- type never goes below the 11 px floor (`text-2xs`), and shadows are the `shadow-1…3`
  tokens. ESLint (`eslint.config.js`) rejects arbitrary `text-[…]` sizes, raw `rgba(`
  colours and native `title=` hints on DOM elements; hints go through `Tooltip` (interactive
  elements) or `Hint` / `sr-only` text;
- the theme is always explicit: `ThemeProvider` writes the resolved theme (`light` or `dark`,
  following the OS under "system") to `data-theme`, so the `dark:` variant always applies;
  the `prefers-color-scheme` block in tokens.css only covers the moment before hydration;
- every canvas action is keyboard reachable (UI.md §9): the canvas is a Tab stop, its
  shortcuts are registered through `useShortcut` (so `KeyboardShortcutsDialog` lists them),
  C on a focused node opens the connect list and Enter opens the inspector.

## Groups and the import direction

```
src/
  lib/            cn(), formatters, node categories and run statuses
  types.ts        view-model types shared by every group
  theme/          ThemeProvider + useTheme (light / dark / system)
  primitives/     Button, Input, Select, Badge, StatusChip, Tabs, Dialog, Popover, …
  decision/       ProbabilityRuler, DistributionList, ConfidenceMeter, NoulGauge,
                  ScoreScale, DecisionBadge, DecisionCard, ConfidenceGateEditor, …
  data/           DataTable, RunsTable, WorkflowsTable, FilterBar, DateRangePicker,
                  JsonView, DiffView and the text-diff helpers
  inspector/      CodeBlock, SchemaTree, KeyValueList, Inspector, WorkflowDiffSummary
  forms/          SchemaForm + widget registry (x-ui hints, ajv validation), BindingField,
                  Combobox, SecretSlotPicker, ExpressionInput, CriteriaEditor,
                  ThresholdField, RetryPolicyEditor, Credential/ModelPicker, CodeEditor
  node/           xyflow node cards per card variant (cardVariantFor), Join/Wait/NoteCard,
                  ContainerFrame (loop/foreach group node: NodeResizer, iteration badge + stepper),
                  TypedHandle + handleId (out:/in:/ctl:/ctl-in), nodeTypes { flowaid, container, note }
  canvas/         FlowCanvas (onSetParent on drop into / out of a frame), ControlEdge / DataEdge
                  (edgeTypes { control, data }), WeightedEdge, schema-aware connection validation,
                  palette, selection toolbar, compound auto-layout, applyLayoutChanges
  trace/          RunHeader, TraceTimeline, EventLog, LogViewer, RunStatusTimeline
  observability/  MetricTile, TimeSeriesChart, BarChart, histograms, heatmap, health
  human/          ApprovalCard, ReviewQueue, ReviewPage, ManualChoice, Escalation
  builder/        AIBuilderPanel, WorkflowCriticPanel, CostOptimizer, TemplateGallery,
                  VersionCompare, EvaluationReport, ImportDialog, BottomPanel
  shell/          AppShell, TopBar, SideNav, CommandMenu, EnvironmentSwitcher, shortcuts
```

Groups form a strict layering. A group may import only from groups to its **left**:

```
lib / types / theme
  → primitives
    → decision
      → data
        → inspector
          → forms
            → node
              → canvas
                → trace · observability · human · builder · shell
```

`JsonView`, `DiffView` and the text-diff helpers live in `data`; `inspector` re-exports them
for one release (deprecated). `BottomPanel` lives in `builder`; the `shell` export is a thin
wrapper that wires it to the `AppShell` state, also kept for one release.

The leaf groups on the last line are siblings and must not import each other. If a leaf
needs something another leaf built, the shared piece moves down a layer (usually into
`primitives`, `decision` or `inspector`) rather than being imported sideways. `src/index.ts`
re-exports every group, so exported names are unique across the package.

Each group is also a subpath export (`@flowaid/ui/decision`, `@flowaid/ui/forms`, …) for
apps that want to tree-shake by feature. Styles come from `@flowaid/ui/styles.css` (which
imports `tokens.css`); the app must render inside `<ThemeProvider>` and, for anything with
tooltips, a `<TooltipProvider>`.

## Running it

```bash
pnpm install                       # from the repo root
cd packages/ui
pnpm dev                           # playground at http://127.0.0.1:5178
pnpm typecheck                     # tsc --noEmit
pnpm lint                          # eslint src playground
pnpm test                          # vitest (happy-dom, testing-library)
```

The playground (`playground/`) has one page per group, registered in
`playground/gallery.ts`; each group owns a `gallery.tsx` that renders every component in
every state with realistic sample data. Pages are lazily imported so a broken group does not
take down the rest. The LIGHT / DARK / SYSTEM buttons in the nav switch the theme; every
gallery is expected to read correctly in both.

Tests live next to the code as `*.test.tsx` and use `@testing-library/react`. CodeMirror,
xyflow and ResizeObserver are stubbed in `vitest.setup.ts` / `primitives/testStubs.ts`.

## The widget registry (forms)

`SchemaForm` renders a JSON Schema (`JsonSchema` in `src/types.ts`, the 2020-12 subset Zod
emits; `fromContractSchema` narrows a workflow-core schema such as a manifest `configSchema`)
with react-hook-form. Rendering hints live under **`x-ui`**, typed as `UiHints` from
`@flowaid/workflow-core` (RFC-0012). The old `x-flowaid` block is still read for one release as
a deprecated alias (a development-only console warning names each block; `advanced` is read as
`collapsed`).

Each leaf field is drawn by a **widget**, resolved in this order (UI.md §5):

1. `x-ui.widget` — the manifest vocabulary: `text`, `textarea`, `template`, `code`
   (+ `x-ui.language`), `json`, `number`, `slider`, `switch`, `select`, `combobox`, `model`,
   `criteria`, `keyvalue`, `list`, `cron`, `binding`, `hidden` (`levels`, `questions` and
   `schema` arrive with P1-07; until then they warn and fall back to the type widget);
2. `x-ui.optionsProvider` — an async `Combobox` (see below);
3. the `$ref` definition name, looked up as `ref:<Name>` (`ref:RetryPolicy` is built in);
4. discriminated `oneOf`/`anyOf` → segmented control (`ToggleGroup`) switching sub-forms;
   `enum` → select;
5. `format` on strings: `cron` → cron widget (a mono input until P1-07 registers
   `CronEditor` under the same name), `uri`/`url` → URL input, `date-time` → local date-time
   input storing ISO 8601 UTC, `multiline` → textarea; `x-secret: true` → masked input;
6. the JSON type: string → text, number/integer → number, boolean → switch,
   array → repeatable list, object → fieldset, `additionalProperties` object → key/value editor.

An unknown widget name logs a development warning (`unknown widget "…" for field "…"`) and
falls back to the next step.

| `x-ui` key                                                  | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `showWhen: { path, equals?, oneOf?, truthy? }`              | The field renders only while every given condition holds against the current values (`useWatch`); `path` is a JSON Pointer from the config root (`/method`) or a dotted path. Hidden fields keep their value and are not validated.                                                                                                                                                                                                  |
| `collapsed`                                                 | An object fieldset starts closed; a leaf field moves into its section's closed "Advanced" disclosure.                                                                                                                                                                                                                                                                                                                                |
| `optionsProvider`                                           | `Combobox` backed by `loadOptions(nodeType, name, config, search)` (the app calls `POST /v1/nodes/:type/options/:name`): loads on mount, on the refresh button and (debounced) on search; loading and error (with Retry) states in place. Without a loader the options come from `enum`.                                                                                                                                             |
| `bindable`                                                  | `BindingField` wraps the field's own widget with a Literal ⇄ Ref / Template / Expr switch. Literal stores the plain value (wrapped as `{ kind: 'literal', value }` only when it would read as a binding); the other modes store `{ kind: 'ref', ref }`, `{ kind: 'template', source }`, `{ kind: 'expr', source }` (validated with `parseRef` / `parseTemplate` / `parseExpression`). `widget: 'binding'` always stores a `Binding`. |
| `widget: 'list'`                                            | Repeatable list; `x-ui.min`/`max` (or `minItems`/`maxItems`) bound add and remove.                                                                                                                                                                                                                                                                                                                                                   |
| `widget: 'hidden'`                                          | Not rendered; the value (default) is kept.                                                                                                                                                                                                                                                                                                                                                                                           |
| `help`, `placeholder`, `group`, `order`, `min`/`max`/`step` | Field hint, placeholder, section, order, numeric bounds.                                                                                                                                                                                                                                                                                                                                                                             |

**Extensions.** `radio`, `secret`, `credential`, `expression`, `threshold` and `retry-policy`
are registered widgets for forms the app writes itself (credential dialogs, human-task
forms, policy editors), never manifest values. They are selected with the forms-only
**`x-ui-ext`** block (`{ widget, credentialType, modelKind, language }`), which also selects
any name added with `registerWidget`.

**Validation.** Field rules give immediate messages (required, bounds, lengths, pattern,
email/URL formats, item counts). On top, the whole value is validated with ajv (draft 2020-12,
the compiler's engine) after the compiler's view is applied: fields hidden by `showWhen` and
ref/template/expr bindings are skipped, literal wrappers unwrapped, unset optional fields
dropped, and discriminated unions validated against the selected member only. Issues show
under the owning field; issues no mounted field shows (root keywords, collapsed fields) are
listed at the end of the form once it is edited or submitted, and block `onSubmit`. `onChange`
reports `isValid` over both layers.

**Credential slots.** `secretSlots` renders `SecretSlotPicker` above the fields: one picker per
`NodeManifest.credentials[]` slot listing the workflow's `definition.secrets` of a matching
`credentialType`, "None" for optional slots and "Declare new secret…" (`onDeclareSecret`).

Widgets are plain components taking `SchemaWidgetProps` (`name`, `schema`, `hints`, `label`,
`value`, `onChange`, `onBlur`, `disabled`, `invalid`, `required`). They read the form
environment (expression scope, credentials, models, the node's `irreversible` flag, historic
confidence samples, `nodeType`, `loadOptions`, `getValues`) through `useSchemaFormEnvironment()`.

```ts
import { registerWidget, type SchemaWidgetProps } from "@flowaid/ui/forms";

function ColourWidget({ value, onChange, disabled }: SchemaWidgetProps) {
  return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
}
registerWidget("colour", ColourWidget);           // then: "x-ui-ext": { "widget": "colour" }
registerWidget("cron", CronEditor);               // replace a built-in (format: "cron" reaches it)
registerWidget("ref:CronSchedule", CronWidget);   // bind to a $defs entry by name
```

`getWidget(name)` and `listWidgets()` inspect the registry; `BLOCK_WIDGETS` lists the widgets
that take the full row (no inline label). A single form can also override widgets locally
through its `widgets` prop without touching the global registry.

## Mapping runtime types to view models

Components take the runtime contracts from `@flowaid/workflow-core` directly wherever the
shape is plain JSON: `DecisionResult` (and its `BooleanDecision` / `ChoiceDecision` /
`ScoreDecision` kinds), `HumanRequest` / `HumanResponse`, `RunEvent`, `Diagnostic` (with
`location`, `related` and `fix`), `NodeRun`, `TokenUsage`, `ProviderAttempt`, `ErrorInfo`
and the closed enums (`RunStatus`, `NodeRunStatus`, `RunOrigin`, `NodeCategory`, whose
option lists `lib/categories.ts` re-exports from the Zod schemas; only the labels live here).
The view types left in `src/types.ts` exist for the joins the API does not return in one
object, and `lib/adapters.ts` builds them:

| Runtime (CONTRACTS.ts)               | View model (`src/types.ts`)             | Adapter                              | The join                                                                                                                                            |
| ------------------------------------ | --------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Run`                                | `RunView`                               | `toRunView(run, joins)`              | `workflowName`, `version`, `environment` (`{ id, name, protected }`), the run's `NodeRunView[]`, the open `pendingApproval`.                        |
| `NodeRun`                            | `NodeRunView`                           | `toNodeRunView(nodeRun, joins)`      | `category` from the node manifest, the enclosing `parentNodeRunId`; `scope` becomes `iteration`, `firedPorts` becomes `routeTaken`.                 |
| `Span` (`GET /v1/runs/:id/trace`)    | `TraceNodeRow`                          | `spanToTraceRow(span, { attempts })` | Attempts of one node stacked into one timeline row.                                                                                                 |
| `RunEvent[]` (durable + SSE)         | `NodeRunView[]` + run fields            | `foldRunEvents(events, options)`     | Node status/timing, the decision and its question, tool calls, log lines and streamed text folded per node run; malformed events reported by index. |
| `human_tasks` row (`HumanRequest`)   | `ApprovalRequestView`                   | `humanTaskToApproval(task, joins)`   | `nodeName`, the triggering `DecisionResult` and the "why you are seeing this" line derived from `request.origin`.                                   |
| `WorkflowDefinition.nodes[]/edges[]` | `WorkflowNodeView` / `WorkflowEdgeView` | (app projection, UI.md §4.2)         | Canvas projection: ports flattened to `PortView[]`, branch/router/gate exits as `routes`.                                                           |

`WorkflowDiff` (the compiler's `diff(a, b)`, ARCHITECTURE.md §4.7) is consumed as is by
`WorkflowDiffSummary` and `VersionCompare`; `lib/workflowDiff.ts` only reads it (node rows,
counts). Text diffs for JSON views come from `data/textDiff.ts`; there is no local workflow
diff engine.

Environments are workspace data, never an enum: `EnvironmentSwitcher`, `FilterBar`,
`WorkflowsTable` and the run views take `environments: { id, name, protected }[]`.

The confidence gate follows ARCHITECTURE.md §6.3. The UI's two-threshold model
`ConfidenceThresholds { review, auto }` maps onto the runtime's `{ threshold, reviewBand }`
through `thresholdsFromGate` / `gateFromThresholds` (`auto := threshold`,
`review := threshold − (reviewBand ?? threshold)`), and `gateOutcome(confidence, thresholds)`
returns `pass` / `review` / `fail`; a review floor of 0 is the two-way gate.
`ConfidenceGateEditor` / `ThresholdField` take either the thresholds (`value`) or the
runtime config (`gate`, `defaultGate`) and report both (`onChange`, `onGateChange`);
`ConfidenceGateNodeCard` reads `threshold` / `reviewBand` / `requireValue` and routes a run's
decision with `gateOutcomeForDecision`, the runtime rule verbatim. Timestamps are
ISO strings everywhere; components format them with the helpers in `lib/format.ts`
(`formatMs`, `formatProbability`, `formatCost`, `formatTokens`) so numbers look the same in
every group.

UI.md §3 lists every group's exports; it is generated from the `index.ts` files by
`pnpm ui:inventory` and checked by `scripts/ui-inventory.test.ts`.
