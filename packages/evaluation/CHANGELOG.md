# @flowaid/evaluation

## 0.10.0

### Patch Changes

- bde0473: Evaluations score a Decision batch step per question. Such a step (the Message triage starter and
  every business template use one) answers several questions, but only one answer reached the
  evaluation, so a case expecting the topic was compared with the yes/no answer. Expectations can now
  name one question (`"triage.topic"`); a case that names only the step is checked against the one
  question that can give the expected value, so existing cases keep their meaning. Add to evaluation
  captures every answer, and accuracy, calibration and confusion are shown per question. A batch step
  with more questions than one request takes now asks them in several batches rather than one by
  one, and answers a person gave are recorded per question too.

  Evaluation reports say what happened. A run with no gate reads "No gate set" (it read "Gate passed
  with warnings") and offers Publish as a secondary action; the Block publish button, which did
  nothing, is gone. Each failed case lists the checks it failed and why. A cancelled or failed
  evaluation says how many of the set's cases ran and that every figure covers only those, and a
  baseline that scored other cases is no longer shown as differences.

  Deleting an evaluation set clears the publish-gate link of the workflows that used it (they kept
  the id of a set that no longer existed), and the confirmation names those workflows.
  `GET /v1/evaluations/sets/:id` lists them as `gateOf`.

  Smaller evaluation fixes: Add to evaluation also offers sets tied to no workflow and will not add
  a run the set already holds; the gate's minimum pass rate is entered in percent, as its text
  speaks of it; a new case's form no longer shows "Fill in the required field" before anything is
  typed; and a set's description ends its sentence in the header.

- Updated dependencies [d568cf6]
  - @flowaid/workflow-core@0.10.0
  - @flowaid/providers@0.10.0
  - @flowaid/shared@0.10.0

## 0.9.0

### Minor Changes

- d3e7936: Evaluation judge checks now run, and schedules catch up and check their input as documented.

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

### Patch Changes

- Updated dependencies [d3e7936]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [6b5c535]
  - @flowaid/providers@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- @flowaid/providers@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Patch Changes

- @flowaid/providers@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/workflow-core@0.7.0

## 0.6.0

### Patch Changes

- @flowaid/providers@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/workflow-core@0.5.0
  - @flowaid/providers@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [0a0ec14]
  - @flowaid/workflow-core@0.4.0
  - @flowaid/providers@0.4.0
  - @flowaid/shared@0.4.0
