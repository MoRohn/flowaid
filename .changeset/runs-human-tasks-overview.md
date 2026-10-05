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
