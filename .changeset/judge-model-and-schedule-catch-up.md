---
"@flowaid/evaluation": minor
"@flowaid/providers": minor
"@flowaid/workflow-compiler": minor
"@flowaid/worker": minor
"@flowaid/api": minor
"@flowaid/web": minor
---

Evaluation judge checks now run, and schedules catch up and check their input as documented.

- Judge checks in an evaluation are graded by the same model the AI builder uses: the workspace's
  chosen model, else the first of Anthropic, OpenAI or Ollama with a key (a workspace credential
  or the server's own). Judge calls are priced like any model call: each case's result carries
  `judgeCostUsd`, and the summary's `costUsd` gains `judge`, counted in `total` but not in
  `perCase` (the workflow's own cost, which the regression report compares). Cancelling an
  evaluation stops judge calls in progress. Without a usable model a judge check fails with "no
  judge model available: add an OpenAI, Anthropic or Ollama key".
- Schedule catch-up modes now differ. After downtime with missed run times, Skip starts none of
  them and waits for the next run time (a run time at most 60 seconds late still counts as on
  time); Run once starts exactly one run for all of them; Run all starts one per missed time, the
  most recent ones up to the limit, which is at most 100. Skipped runs are noted on the schedule.
- A schedule's input is checked against the workflow's inputs: deploying a version whose schedule
  trigger has an input that does not match is refused with a pointer to that trigger
  (`/triggers/<i>/input`), and a schedule that fires with such an input starts no run and records
  the reason (and sends the schedule-failed alert) instead.
