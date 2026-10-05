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

Human tasks that closed without an answer are read-only: an expired or cancelled task shows its
status instead of a countdown, says why it closed (expired, or the run was cancelled, reached its
time limit or failed), and has no answer buttons, comment box or shortcuts. An answer is sent once:
the card stays locked after the API accepts it, so a double click or a second A sends nothing, and a
409 "already answered" reads as done instead of an error. Resolved lists every closed task
(answered, expired, cancelled) with an outcome filter and a workflow filter; `GET /v1/human-tasks`
takes several statuses (`status=responded,expired,cancelled`). A closed task's guidance reads
"About this task" and no longer gives a due time for a cancelled task.

Answer controls no longer claim a model decided when none did: a choice nobody ranked shows no
"Model pick", and a value to review reads "Proposed by the workflow" (or "by the step" for a paused
step) instead of "by the model", in the app and on external review links. On your own computer
(local mode) the task page drops Escalate and the inbox drops "Assign to me", since there is nobody
else to hand a task to. The escalation dialog's "Notify now" box, which sent nothing, is gone, and
the escalation reason is now kept on the audit trail as the dialog says. Assignees read as names
("Admins", a member's name) instead of ids.

Cancelling a run asks first, in the trace header and the runs list's row menu: the confirmation
says it can't be undone and names the task that will close unanswered, takes an optional reason
(kept with the run), and offers "Keep running". The run's story ends with the reason.

The Overview keeps its time range, workflow and environment in the URL (`?range=7d&workflow=…&env=…`),
so a reload or a shared link shows the same view (7d used to come back as 24h). Open approvals follow
the environment filter like everything else on the page, the success-rate hint counts timed-out runs
with the failures, the page and its getting-started checklist share one workflow list, and "Publish
and deploy" ticks off only once a version is deployed, not just published.
