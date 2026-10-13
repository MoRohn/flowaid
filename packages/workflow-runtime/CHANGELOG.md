# @flowaid/workflow-runtime

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

- Updated dependencies [e8b6267]
- Updated dependencies [d568cf6]
- Updated dependencies [08d7faf]
  - @flowaid/observability@0.10.0
  - @flowaid/workflow-core@0.10.0
  - @flowaid/workflow-compiler@0.10.0
  - @flowaid/credentials@0.10.0
  - @flowaid/node-sdk@0.10.0
  - @flowaid/providers@0.10.0
  - @flowaid/env@0.10.0
  - @flowaid/shared@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [b19f9bc]
- Updated dependencies [d3e7936]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [371cb0c]
- Updated dependencies [c630951]
- Updated dependencies [6b5c535]
  - @flowaid/credentials@0.9.0
  - @flowaid/env@0.9.0
  - @flowaid/providers@0.9.0
  - @flowaid/workflow-compiler@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/node-sdk@0.9.0
  - @flowaid/observability@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- @flowaid/credentials@0.8.0
  - @flowaid/env@0.8.0
  - @flowaid/node-sdk@0.8.0
  - @flowaid/observability@0.8.0
  - @flowaid/providers@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/workflow-compiler@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Patch Changes

- @flowaid/credentials@0.7.0
  - @flowaid/env@0.7.0
  - @flowaid/node-sdk@0.7.0
  - @flowaid/observability@0.7.0
  - @flowaid/providers@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/workflow-compiler@0.7.0
  - @flowaid/workflow-core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [680d9e3]
- Updated dependencies [e67dd32]
  - @flowaid/workflow-compiler@0.6.0
  - @flowaid/env@0.6.0
  - @flowaid/credentials@0.6.0
  - @flowaid/observability@0.6.0
  - @flowaid/node-sdk@0.6.0
  - @flowaid/providers@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/workflow-core@0.5.0
  - @flowaid/credentials@0.5.0
  - @flowaid/node-sdk@0.5.0
  - @flowaid/observability@0.5.0
  - @flowaid/providers@0.5.0
  - @flowaid/workflow-compiler@0.5.0
  - @flowaid/env@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [dff6c83]
- Updated dependencies [bf0de6e]
- Updated dependencies [0a0ec14]
  - @flowaid/env@0.4.0
  - @flowaid/workflow-core@0.4.0
  - @flowaid/credentials@0.4.0
  - @flowaid/node-sdk@0.4.0
  - @flowaid/observability@0.4.0
  - @flowaid/providers@0.4.0
  - @flowaid/workflow-compiler@0.4.0
  - @flowaid/shared@0.4.0
