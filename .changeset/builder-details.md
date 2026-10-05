---
"@flowaid/web": patch
"@flowaid/ui": patch
"@flowaid/api": patch
---

Builder details. The description you give a new workflow now shows in the builder too. Typing in a
step's setting undoes as one change instead of one character at a time. A Branch added after a
yes/no decision routes on its answer instead of always taking "yes", and a Branch condition offers
the earlier steps' outputs as you type. Publishing no longer clears the run you were looking at,
and its toast offers **Deploy** for the new version. The header menu says "Duplicate workflow"
(⌘D on the canvas duplicates steps), canvas edges have names that tell a control edge from a data
edge, and a workflow whose only key is optional (a TypeSafe step's) no longer reads "none of this
workflow's do yet".
