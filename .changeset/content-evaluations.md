---
"@flowaid/ui": patch
"@flowaid/evaluation": patch
"@flowaid/workflow-runtime": patch
"@flowaid/nodes-core": patch
"@flowaid/worker": patch
"@flowaid/api": patch
"@flowaid/web": patch
---

Evaluations score a Decision batch step per question. Such a step (the Message triage starter and
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
