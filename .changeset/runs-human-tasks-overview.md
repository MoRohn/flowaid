---
"@flowaid/web": patch
---

Runs, human tasks and the Overview. Many open run pages no longer freeze FlowAId: a run page holds
its live stream only while the run moves and the tab is visible, checks every 10 seconds while the
run waits for a person, and falls back to checking with a "Reconnect" button when the stream drops
or can't connect (six waiting-run tabs used to hold every connection the browser allows, and no
other page loaded).
