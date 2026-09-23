# Review lens: @flowaid/ui quality

Scope: `packages/ui` (12 groups, 185 components, 72 test files / 618 tests) against
`docs/design/UI.md`, `brand/IDENTITY.md` and `docs/design/CONTRACTS.ts`.

## Method

- Baseline: `pnpm typecheck`, `pnpm lint`, `pnpm test` all green (618/618).
- Playground started with `vite --port 5179` (5178 was busy), every gallery page
  screenshotted light + dark with `agent-browser --session review-ui` (theme via the
  LIGHT/DARK buttons). Session closed and server stopped afterwards.
- Note for future reviewers: the playground scrolls inside `<main>`, so `screenshot --full`
  only captures the viewport. I injected a style to let the document grow; that style
  persisted across same-origin hash navigations and produced two false layout anomalies in
  the Shell page (a `nav { position: sticky }` rule hit `<nav aria-label="Breadcrumb">`).
  Verified with a hard reload: Shell renders correctly. Nothing about the shell is reported.
- Static sweeps: banned colour words, hex/rgb literals, Tailwind palette classes, control
  heights and radii per group, aria/role usage, memo/virtualisation, test shape,
  UI.md component inventory by name, handle-id format, `x-ui` vs `x-flowaid`.

## What is good (no action)

- Brand compliance is strong: zero purple/pink/teal/violet/magenta/cyan, zero hex literals
  outside `tokens.css` (the only hits are ticket numbers in fixtures), zero Tailwind palette
  colours, tokens.css identical to `brand/tokens.css`. One `rgba()` literal (Switch thumb
  shadow) is the only colour not from a token.
- Controls are 28px / 5px radius / 1px border everywhere that matters (Button md `h-7`,
  Input/Select md `h-7`, IconButton md `size-7`); chips are 22px pills; nodes 232px /
  8px radius; trace rows 30px; mono + tabular numerals for machine values throughout.
- Both themes render correctly on all 12 pages; no blank or broken sections found.
- Tests that exist are good: role-based queries and real keyboard interaction, no snapshots.
- Virtualisation exists where it matters most (DataTable, TraceTimeline, EventLog).
- Reduced motion is respected in CSS and via `useReducedMotion`.

## Findings (detail)

### 1. `src/types.ts` drifts from the frozen contracts; no adapter exists (critical)

`packages/ui/README.md` documents an adapter table, but no adapter code exists and the view
types cannot be produced from the contracts without inventing data:

- `NodeRunStatus` (`src/lib/categories.ts:53-62`): `retrying`, `waiting_for_human` vs
  contract `NodeRunStatusSchema` (CONTRACTS.ts:1177): `waiting`, `retry_wait`, `reused`.
  `reused` is absent from `StatusChip.statusTone`, `node.css` and `deriveEdgeState`; UI.md
  §4.3 wants a green dashed border for it. 61 non-test usages of the wrong names.
- `RunView.trigger` (`src/types.ts:139`) vs `RunOriginSchema` (CONTRACTS.ts:1182) — `manual`
  does not exist; `ui`, `mcp`, `subflow`, `restart`, `fork` are missing. `FilterBar.RUN_TRIGGERS`
  and `RunsTable.TRIGGER_ICON/LABEL` are typed on the wrong union.
- `RunEventType` (`src/types.ts:150-175`): `RUN_QUEUED`, `CHECKPOINT_SAVED`, `LOOP_ITERATION`,
  `GENERATION_CHUNK` do not exist in `RunEventSchema` (CONTRACTS.ts:1262-1330); ~30 real types
  are missing (`RUN_CREATED`, `NODE_SCHEDULED`, `NODE_WAITING`, `BRANCH_EVALUATED`,
  `JOIN_ARRIVED`, `LOOP_ITERATION_STARTED/COMPLETED`, `FOREACH_*`, `SUBFLOW_*`, `TIMER_*`,
  `DECISION_REQUESTED`, `GENERATION_DELTA`, `HUMAN_TASK_ESCALATED/EXPIRED`, `METRIC`,
  `ARTIFACT_CREATED`, `STATE_WRITTEN`, `RUN_OUTPUT`, `HEARTBEAT`, …). `trace/summarizeEvent.ts`
  is exhaustive over the wrong enum and reads payload keys (`durationMs`, `routeTaken`,
  `checkpointId`) that the contract never emits (`latencyMs`, `firedPorts`, `checkpointSeq`).
- `DecisionResultView` (`src/types.ts:17-36`) lacks `pYes`, `normalized`, `level`,
  `levelLabel`, `levels[]`, `costUsd` (required), `requestId`, `attempts[]`; invents
  `failover: {from, reason}` and `legend`. `question` lives on `DECISION_COMPLETED`, not on
  the result. `DecisionCard`/`TraceDecisionDetail` cannot show the provider chain UI.md §7.3
  requires ("every attempts[] hop").
- `ApprovalRequestView`/`ApprovalResponse` (`src/types.ts:203-240`) vs `HumanRequest`/
  `HumanResponse` (CONTRACTS.ts:1128-1155): kinds `approve_reject|select|edit_output|
provide_text|form` vs modes `approval|review|form|choice`; `provide_text` has no
  counterpart; response is `action: approve|reject|choose|submit|escalate` with `value`,
  `option`, `to: string[]` (view has `to: string`). `origin` (`human_node|task_suspend|
decision_failover`) — which should drive the "why you are seeing this" line — is absent.
- `DiagnosticView` (`src/types.ts:66-75`) is flat `{nodeId, edgeId, path}`; contract
  `DiagnosticSchema` has `location.{nodeId, edgeId, port, path, bindingPath, range, scope}`,
  `related[]` and `fix {title, patch}`. `DiagnosticsBar`/`Inspector` have no quick-fix
  affordance (UI.md §3 ProblemsPanel "with quick-fix buttons").

`boundaries.json` already allows `ui → workflow-core`, and UI.md §3 says
`lib/categories.ts` must re-export the contract enums (WP-01).

Enhancement: add `@flowaid/workflow-core` as a dependency; replace the local unions with
`import type { NodeRunStatus, RunStatus, RunOrigin, RunEventType, NodeCategory, Diagnostic }`
from it; create `packages/ui/src/adapters/` with `toDecisionResultView`, `toRunView`,
`toNodeRunView`, `toRunEventView`, `toApprovalRequestView(HumanRequest, origin)`,
`toHumanResponse(ApprovalResponse)`; extend `DecisionResultView` with the score/boolean
fields and `attempts[]`; add `reused`/`waiting`/`retry_wait` handling in `StatusChip`,
`node.css`, `deriveEdgeState`, `TraceTimeline`; rewrite `summarizeEvent` against the real
event union; add a contract-conformance test that feeds Zod-validated fixtures through the
adapters.

### 2. `nodeKindFor` sends every real decision node to the default renderer (high)

`NodeTypeIdSchema` (CONTRACTS.ts:178-179) documents ids like `flowaid.decision.choice`.
`src/node/nodeUtils.ts:796-809` resolves kind by "last segment, then first segment, then
aliases": `flowaid.decision.choice` → segments `[flowaid, decision, choice]` → neither
`choice` nor `flowaid` is a kind → `default`. Verified: `flowaid.decision.{choice,score,
boolean}` and `flowaid.data.transform` all resolve to `DefaultFlowNode`; only ids whose last
segment happens to be a kind (`flowaid.tools.http`) work. The gallery fixtures use the
non-canonical `decision.choice`, which hides the bug. Also missing renderers for contract
kinds `join`, `wait`, `foreach`, `note` (NoteCard) and `input`/`output` mapping.

Enhancement: make `nodeKindFor` take `{ kind: NodeKind, nodeType?: NodeTypeId, category }`
and decide from `kind` first (branch/join/loop/foreach/subflow/wait/human/note/input/output),
then from the manifest `category` + a small `nodeType` suffix table for task nodes
(`decision.*`, `tools.http`, `llm.*`, `code`); add `WorkflowNodeView.kind` and
`WorkflowNodeView.nodeType`; add Join/Wait/Note renderers; add tests with canonical ids.

### 3. Canvas edges and handles do not follow UI.md §4.2 (high)

- Handle ids are the raw port id (`TypedHandle.tsx:326-338`, `NodeCard.tsx:171-195`,
  `nodeTypes.tsx:463-496`); UI.md mandates `out:<port>`, `in:<port>`, `ctl:<port>`, `ctl-in`.
- One edge type only: `edgeTypes = { weighted }` (`WeightedEdge.tsx:769`). No `ControlEdge`
  (dashed, arrowhead, route label) / `DataEdge` (solid, schema tooltip) / dotted implicit
  template-expr edges; `WorkflowEdgeView.kind` (`types.ts:101`) is ignored by the canvas.
- No control-in "single notch at top-left" (UI.md §6 node anatomy).
- `useConnectionValidation.isPortTypeCompatible` compares string type names; UI.md
  requires `isSubschema(sourceSchema, targetSchema)` from workflow-core and "rebinding
  replaces"; `PortView.type: string` cannot carry a schema.

Enhancement: `PortView.schema?: JsonSchema`; `TypedHandle` gets `kind: "in"|"out"|"ctl"|
"ctl-in"` and derives the id; `flowNodeHandles` emits the prefixed ids; add
`canvas/ControlEdge.tsx` and `canvas/DataEdge.tsx` (WeightedEdge becomes the
probability-weighted variant of ControlEdge for route exits) and `edgeTypes = { control,
data }`; `FlowCanvas` maps `WorkflowEdgeView.kind` to the type; validation via
`isSubschema`; tests for id format and edge-type selection.

### 4. ContainerFrame / NodeResizer missing; loops cannot contain nodes (high)

grep for `ContainerFrame`/`NodeResizer` = 0. `LoopNodeCard` is a plain 232px card, `toFlowNode`
never sets `parentId`/`extent`, `autoLayout.ts` is flat, and there is no `setParent`
callback on `FlowCanvas`. UI.md §4.2 requires group nodes with header (name, bounds
summary, iteration badge), `NodeResizer`, children `extent: 'parent'`, and an iteration
stepper during runs.

Enhancement: `node/ContainerFrame.tsx` (xyflow `NodeResizer`, header, iteration badge from
`LOOP_ITERATION_*` / `FOREACH_ITEM_COMPLETED`), `nodeTypes.container`, `toFlowNode` reads
`node.parent`, `FlowCanvas.onSetParent`, compound-aware `autoLayout`, gallery + tests.

### 5. Inspector tabs and the binding/inspector components are missing (high)

`Inspector.tsx:59-68` tabs: config/input/output/decision/timing/logs/state/errors. UI.md §3/§5:
Config · Inputs · Policy · Info (+ Run tab = NodeRunDetail). Missing: `PortRow` (per-input
binding chip), `RefPicker` (upstream nodes → ports → fields, compatible first, incompatible
greyed with reason), `DependencyPanel` (control groups OR/AND, data deps with optional
markers, guard in words), Policy form (`NodePolicySchema`), Info (manifest docs,
capabilities, idempotency), `BindingField` (literal ⇄ ref/template/expr, `x-ui.bindable`),
`SecretSlotPicker` (credential slots above the config).

Enhancement: add the six components; restructure `Inspector` to `config | inputs | policy |
info | run`, folding the existing run-detail tabs into a `NodeRunDetail` used by both the
inspector Run tab and the trace side sheet (UI.md §7.3).

### 6. SchemaForm: hint key and resolution order differ from the spec (medium)

`FieldHints` is read from `"x-flowaid"` (`src/types.ts:305`, 42 refs) while UI.md §5 and the
node manifests use `x-ui`. `resolveWidgetName` (`SchemaForm.tsx:117-147`) goes
`hints.widget → ref:<Def> → enum → type`; the spec is `x-ui.widget → format → type` and
`format: 'cron'` must reach a `CronEditor`. `x-ui.showWhen`, `x-ui.collapsed`,
`x-ui.optionsProvider` and `x-ui.bindable` are not read at all.

Enhancement: read `x-ui` (accept `x-flowaid` as a deprecated alias for one release); add a
`format` step (`cron`, `uri`, `date-time`, `multiline`); implement `showWhen` (evaluate
against `useWatch()` values), `collapsed`, and the async `Combobox` for `optionsProvider`
through a `SchemaFormEnvironment.loadOptions(nodeType, name)` callback.

### 7. Missing form widgets required by UI.md §5 (high, XL)

Absent: `TemplateEditor` (`{{` mention picker over plan ports, `$vars/$scope/$run`,
functions, hole squiggles from `location.range`), `LevelsList` as a standalone `levels`
widget (2–10 ordered, draggable — CriteriaEditor's score mode has the pieces), `QuestionsEditor`
(batch node), `JsonSchemaEditor` (tree + JSON, validated), `CronEditor`, `oneOf` discriminator
as a segmented control (today a variant `Select`). `ExpressionInput` covers a subset of
TemplateEditor but has no function/`$scope` completions.

Enhancement: build each as a registered widget (`registerWidget("template"|"levels"|
"questions"|"schema"|"cron")`), reuse `ReorderableList`, `CodeEditor`, `SchemaTree`,
`expressionExtensions`; render diagnostics `location.range` as CodeMirror decorations.

### 8. Builder dialogs and overlays missing; ImportDialog accepts only one source format (medium)

grep = 0 for `PublishDialog`, `ConflictDialog`, `ProblemsOverlay`, `ExportDialog`,
`ImportDialog`, `DraftStatusPill`, `RunMenu`. UI.md §3/§8 and CODE_EXPORT.md need: Publish
(embeds latest `EvaluationReport` + gate), Conflict (412: theirs / mine / diff), canvas
Problems overlay with jump-to-node, Export ("Download code": version, npm/vendored,
sample input, recorded run, progress), Import for JSON/YAML/external flow export, the top-bar
"draft rev 12 · 2 errors" pill and the Run menu. Also a `RunPanel` (InputForm from the
`inputs` schema ⇄ JSON editor) for the BottomPanel.

Enhancement: add the six components (reuse `EvaluationReport`, `ThresholdMeter`,
`SideBySideDiff`, `NodeDiagnosticsMarker`); give `ImportDialog`
a `source: "json"|"yaml"|"external"` prop.

### 9. Naming vs UI.md inventory and genuinely missing pieces (medium)

Implemented under other names: `MetricTile` (StatTile), `UsageSummary` (CostBreakdown, but
without price snapshots / by-node), `DecisionBadge` (ConfidenceChip), `ReviewQueue`/
`ApprovalCard` (TaskCard/ReviewForm), `ReviewPage` (ExternalReviewPage), `NodePaletteMenu`
(PaletteSheet). Missing outright: `ConfusionMatrix` (choice nodes in evaluation reports),
`DistributionPopover`, `GenerationCard`, `NodeRunDetail`, `NoteCard`, `SpanRow` as an
exported piece, `CostBreakdown` by provider/model/node with price snapshots.

Enhancement: export aliases for the renamed ones and update UI.md §3 to the implemented
names; add ConfusionMatrix, DistributionPopover (Popover + DistributionList, attach to
DecisionBadge), GenerationCard, NodeRunDetail (shared with finding 5), NoteCard, CostBreakdown.

### 10. Canvas keyboard accessibility (medium)

`FlowCanvas.tsx:451-459`: wrapper is `tabIndex={-1}` with `focus-visible:shadow-none`, so
the canvas (and its ⌘K, `/`, arrows, ⌘0, ⇧L shortcuts) is unreachable by Tab; handles are
`<div>`s with `aria-label` but no keyboard operation, so a connection cannot be made
without a pointer; the selection toolbar only appears after pointer multi-select; canvas
shortcuts are handled in a local `onKeyDown` rather than `ShortcutProvider`, so
`KeyboardShortcutsDialog` cannot list them. UI.md §9 requires keyboard reachability of every
canvas action.

Enhancement: `tabIndex={0}`, `role="application"`, `aria-label`, `aria-describedby` shortcut
summary, visible focus ring; a keyboard connect mode (focused node + `C` opens a
RefPicker-style list of compatible targets; Enter → `onConnect` with prefixed handle ids);
Enter on a focused node opens the inspector; register shortcuts through `useShortcuts`.

### 11. Cobalt is used for non-decision series in charts (medium, brand)

IDENTITY.md: "Cobalt means decision … Nothing else is blue." `chartMath.ts:226-235`
`SERIES_COLORS[0] = var(--cat-decision)` and single-series charts default to it, so "Runs"
line, run-latency histogram, P50-by-node bars, runs-by-workflow, retry-rate sparkline and
the hour heatmap render in the accent (observability screenshots, both themes).

Enhancement: series slot 0 → a graphite (`--ink-2`) or `--cat-tool`; `Sparkline`/`BarChart`
default stroke → `--ink-2`; `heatRamp` → an ink-based ramp; keep `--cat-decision`/`--p-*` for
`ConfidenceHistogram`, `CalibrationChart`, `CalibrationMini` only; gallery + test update.

### 12. `dark:` utilities never apply under "system" theme (low)

`styles.css:12` `@custom-variant dark (&:where([data-theme="dark"], …))` matches only the
explicit attribute; `ThemeProvider.tsx:45-49` removes `data-theme` for `system`, so the 3
`dark:` utilities are dead under OS dark mode.

Enhancement: `ThemeProvider` always writes the resolved theme to `data-theme` (keep the
media-query block in tokens.css as the pre-hydration fallback), or delete the `dark:`
utilities and lint against them.

### 13. Tests and visual regression (medium)

72 test files for 185 components. Untested: `FlowCanvas`, `WeightedEdge`, `ConnectionLine`,
`TypedHandle`, 15 of 18 node cards, most observability charts individually, `Dialog`/`Sheet`/
`Popover`/`Tabs`/`Switch`/`Checkbox`/`Slider`/`Tooltip`, `TopBar`, `CommandMenu`,
`ReviewPage`, `EscalationDialog`, `ImportDialog`, `VersionCompare`, `SideBySideDiff`,
`ThemeProvider`. No Playwright light/dark screenshot suite (UI.md §9) and no axe checks.
Exports never shown in a gallery: `ExpressionReferencePicker`, `NodeRouteList`,
`NodeTerminalPill`, `ReorderableList`, `SideBySideDiff`, `TraceJsonBlock`, `TraceTimeRuler`.
The Node gallery and `NodeCard.test.tsx` render `TypedHandle` outside a node, producing
"[React Flow]: Handle: No node id found" ×5 on every playground page (console accumulates).

Enhancement: Playwright project in `packages/ui` that visits `#/<slug>` × {light, dark},
asserts no console errors/warnings, runs `@axe-core/playwright`, and snapshots; unit tests
for the listed files; wrap gallery/test cards in xyflow's `NodeIdContext.Provider`; add the
missing gallery sections; `vitest --coverage` with a threshold.

### 14. Performance: LogViewer and FlowCanvas selection effect (low)

`LogViewer.tsx:230` renders every filtered line (no virtualiser, unlike EventLog); a long
run's LOG stream will render thousands of rows. `FlowCanvas.tsx:244-248` re-runs
`onSelectionChange` on every `nodes` change because `selectedNodes` is a fresh `.filter`
result (fires per drag frame); `nodeName` (`FlowCanvas.tsx:411`) is O(n) per diagnostic row.

Enhancement: `useVirtualizer` in LogViewer above the same threshold EventLog uses; compare
selected-id sets before calling `onSelectionChange`; keep a `Map<id, node>` memo.

### 15. Accessibility details (medium)

- `Inspector.tsx:203-215`: `<button>` contains `<h2>` (invalid content model; screen readers
  announce it inconsistently). Put the button inside the heading.
- `StackedAreaChart.tsx` is the only chart without `role="img"`/`<title>`.
- `WeightedEdge.tsx:744-763` edge label `<div>` is `pointer-events-auto` with no role/label.
- 43 `title=` tooltips on non-interactive elements are not reachable by keyboard; route
  them through `Tooltip` or `sr-only` text (e.g. `NodeCard.tsx:83`, `Inspector.tsx:296`).
- `DecisionBadge`, `DecisionCard`, `KeyValueList`, `TraceDecisionDetail`, `UsageSummary`
  carry no aria at all; DecisionBadge promises "hover or focus shows the full distribution"
  but is not focusable.

### 16. Sub-11px type and one raw shadow (low)

IDENTITY.md sets 11–12px mono as the floor. 12 `text-[10px]`/`text-[9px]` uses (Badge sm,
Kbd, Avatar, Tooltip shortcut, handle labels, edge labels, TraceTimeRuler, RunStatusTimeline)
and `font-size: 10px` in `node.css:682/690`. `Switch.tsx:40` uses `shadow-[0_1px_2px_rgba(0,0,0,0.25)]`.

Enhancement: add `--text-3xs: 0.625rem` to `brand/tokens.css` (and the `@theme` map) if
10px is accepted, otherwise lift to `text-2xs`; replace the Switch shadow with `shadow-1`.

## Not findings

- Shell page layout: verified clean after a hard reload (see Method).
- Control heights/radii/chips: consistent across groups.
- Colour rules: compliant apart from finding 11.
