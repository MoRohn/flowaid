---
"@flowaid/web": patch
"@flowaid/ui": patch
"@flowaid/database": patch
"@flowaid/api": patch
"@flowaid/workflow-sdk": patch
"@flowaid/cli": patch
---

Runs, human tasks and the Overview. Many open run pages no longer freeze FlowAId: a run page holds
its live stream only while the run moves and the tab is visible, checks every 10 seconds while the
run waits for a person, and falls back to checking with a "Reconnect" button when the stream drops
or can't connect (six waiting-run tabs used to hold every connection the browser allows, and no
other page loaded).

"Retry node" reads as running while the retry runs (the header said Failed), the attempt it
replaced reads failed instead of staying active for good, and a finished run's "Started" and
"Ended" times keep counting.

Runs search and the created range cover every run, not the 50 loaded: `GET /v1/runs` takes `q` (the
start of a run id, the workflow's name or the error text), `from` and `to`, and the list sends them.
While older runs exist the count reads "50 runs loaded", an empty result says so and points at
"Load older runs", and a sort other than newest first says it orders the loaded runs. Version numbers
come with the runs (`include=version`, combinable as `include=decisions,version`), so the list no
longer asks for every workflow's versions, and it refreshes every 15 s instead of 3 s while its runs
only wait for a person.

"What happened, in plain words" no longer says a person answered when nobody did: a person's step
closed by a cancelled, timed-out or failed run reads "Nobody answered … before the run was
cancelled" (or reached its time limit, or failed), and "after 1 minute" is the time the person took,
not the step's own run time. A step retried in place reads once. A timed-out run gets a banner with
the limit it reached and a "Workflow settings" button, and its Guide steps no longer send you to a
failed step and Retry that don't exist.
