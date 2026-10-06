---
"@flowaid/web": patch
"@flowaid/ui": patch
---

The builder no longer loses an edit made just before you leave it. Clicking a tab, the sidebar or
a breadcrumb within a second of an edit used to drop that edit silently; the builder now sends it
on the way out, opens on it when you come back, and tells you if the save was refused. Two quick
saves (⌘S twice) send one request after the other instead of colliding. Options in the Add node
palette can be clicked again: a click used to close the palette and add nothing.
