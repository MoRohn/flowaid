---
"@flowaid/web": patch
"@flowaid/ui": patch
---

A failed draft run names the step and shows it failed. The builder stopped following a run as soon
as its record said it ended, sometimes before the events that say which step failed had been read:
the step kept showing Running and the Output tab could not name it or its message. The builder now
reads the run until its end is in, and settles any step still in progress against the run's error.
Developer steps such as Assert and Log draw as ordinary steps instead of an empty code card.
