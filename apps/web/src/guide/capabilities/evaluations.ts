import type { CapabilityGuide } from "./types";

export const EVALUATIONS: CapabilityGuide = {
  id: "evaluations",
  title: "Evaluations",
  what: "Keep test cases for a workflow (an input and what a right run looks like) and score the draft or any published version against them.",
  when: "Before publishing a change to a prompt, model or branch: see which cases it fixes and which it breaks, compared with the version in use now.",
  needs:
    "A workflow to test, with the keys its steps use. Cases are quickest to collect from real runs: open a finished run and choose Add to evaluation.",
  start:
    "Press New set, say what it checks and which workflow it tests. Then add cases and run it against a version with Run evaluation.",
  result:
    "A report for each run of the set: the pass rate, which expectation failed in each case, latency, cost and, for Decision steps, how well their confidence matches how often they are right. Publishing can require a pass rate on a set.",
  reading: {
    title: "Reading a report",
    items: [
      "Completed means every case ran. The pass rate counts the cases that met every expectation: a run that finished with the wrong answer fails.",
      "A failed case names the check that failed, such as a branch or an output value. Open its run to see why.",
      "Calibration compares a decision's stated confidence with how often it was right: the lower the ECE, the more its confidence can be trusted.",
    ],
  },
  quality: {
    title: "What makes a useful set",
    items: [
      "Typical requests, awkward edge cases, and requests that must be passed to a person.",
      "Cases taken from real runs, so the inputs look like real traffic.",
      "Expectations about the answer (an output, decision or branch), not only that the run finished.",
      "Running a set runs the workflow once per case, calling its models and tools for real: keep it as large as it needs to be, not larger.",
    ],
  },
};
