---
"@flowaid/ui": patch
---

The workspace switcher opens from the collapsed navigation rail again, by mouse, Enter or Space.
`Tooltip` now passes any other props and its ref to the trigger, so it can sit inside another
`asChild` trigger such as a menu button; its ref now points at the trigger instead of the tooltip
bubble (nothing used the old target).
