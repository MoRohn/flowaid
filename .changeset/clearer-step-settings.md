---
"@flowaid/web": minor
"@flowaid/ui": minor
---

Clearer step settings in the builder.

- Inputs and output results that are built from several fields (object and array bindings) now
  open as editable Fields / List instead of an empty value box, so opening a step no longer hides
  its wiring and typing into it no longer replaces it by accident.
- The value source switch reads Value · Reference · Template · Expression, with a one-line
  explanation of the current choice; step inputs and output results have visible labels.
- "Execution policy" is now "Errors & limits": what happens when the step fails, attempts, time
  limit, cost and token limits as plain controls (with their defaults shown), and the full policy
  still editable as JSON.
- Output steps explain the outcome label and "End the run early".
- Workspace settings say what the retention, queue and budget values actually do today, show
  "Unsaved changes", and ask before a link or reload discards them.
- Environment tags read dev · stg · prod; optional boolean criteria are no longer announced as
  required; "Add a key for LLM" instead of "llm".
- Template fields speak the compiler's grammar everywhere: the footer counts the references a
  template really reads (`start.order_id`, `$vars.limit`), holes that name a missing step,
  output or setting are underlined with the fix, parse errors show under the field, single-line
  template fields complete references too, and the value switch's Template mode no longer offers
  the old picker whose `input.*` / `nodes.*` insertions did not compile.
- Unsaved edits in Settings and workflow settings survive switching tabs; tabs with unsaved
  edits carry a dot, sections have Discard, and leaving the page asks first.
- The mouse wheel zooms the canvas toward the pointer instead of panning it; pan with space-drag,
  the middle or right button, or the minimap.
