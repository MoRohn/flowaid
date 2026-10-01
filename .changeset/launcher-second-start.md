---
"@flowaid/web": patch
---

Starting FlowAId while it is already running finds it at once on every platform: the second start
asks the running launcher's control channel instead of a slow Windows process query, which could
take over a minute on a busy machine. A start that stops processes an earlier FlowAId left behind
now waits for their ports to be released before checking them.
