---
"@flowaid/workflow-compiler": minor
"@flowaid/web": minor
"@flowaid/ui": minor
---

Clearer errors, a sharper Guide and smarter Add node.

- **Config errors in plain words.** `E_CONFIG_INVALID` names the setting by its title, says what it
  expects and what it holds now ("Max steps must be at most 50; it is the number 90") and never
  prints a schema regex. A template placeholder left anywhere in a node's config (such as a
  knowledge source id in a list) is reported once as "Choose the knowledge source…", with a link to
  Knowledge in the builder, instead of a pattern error or a failure at run time.
- **The Guide** docks beside the page only where there is room (1680px and wider) and floats as a
  card otherwise, so the canvas keeps its width. Collapsible sections, numbered steps, the workflow
  as a timeline, outcomes as chips and settings with their current values.
- **Add node** suggests the steps likely to come next, each with a reason, and remembers recent
  ones. With a step selected, the new step is placed beside it in free space and connected from its
  first free port (one undo); otherwise it is moved clear of other steps instead of on top of them.
