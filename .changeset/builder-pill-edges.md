---
"@flowaid/ui": patch
---

Data edges leave the Input step from its handles again. The start and end pills declared handle
positions that replaced the canvas's measurement on every update, so edges from Input started at the
pill's left edge; pills are now measured, and measured again when their ports change. Dragging a
connection over a pill no longer logs an unknown `handleReasons` prop, and a refused handle on a
pill says why, as it does on other steps.
