import type { CapabilityGuide } from "./types";

const STATUSES =
  "Statuses: queued and running are in progress; waiting and waiting for a person are paused until an event or an answer arrives; completed ended normally; failed stopped at a step with an error; timed out hit the run's time limit; cancelled was stopped by someone.";

export const RUNS: CapabilityGuide = {
  id: "runs",
  title: "Runs",
  what: "Find any run in this workspace and see how it ended: from the builder, the API, webhooks, schedules, evaluations, replays and forks.",
  when: "When a result looks wrong, a workflow shows failures on the Overview, or you want to know why a run is still waiting.",
  needs: "Nothing: runs appear as soon as a workflow runs anywhere.",
  start:
    "Narrow the list with the filters: status (start with failed or waiting), workflow, environment, where it started, and time range. Save a filter you use often as a view. Then open a run.",
  result:
    "The run's trace: what each step received and returned, why each decision went the way it did, and what it cost.",
  reading: {
    title: "Reading the list",
    items: [
      STATUSES,
      "Active runs refresh on their own. Older runs load with Load older runs at the bottom.",
      "Replay from a row asks first, then starts a new run with the same input. Running every step again makes the model and decision calls again, at their usual cost; reusing recorded results does not.",
    ],
  },
};

export const RUN_DETAIL: CapabilityGuide = {
  id: "run-detail",
  title: "Reading a run",
  what: "Read what one run did, step by step, and act on it: open a waiting task, retry a failed step, replay, fork or restart, or keep it as an evaluation case.",
  when: "When a run failed, took an unexpected path, or gave an answer you want to check.",
  needs:
    "Nothing to read it. Replay, fork, restart and retry need the replay permission; Add to evaluation needs an evaluation set for this workflow.",
  start:
    "Read “What happened, in plain words” first. Then open the first failed or surprising step in the Timeline to see its input, output and error.",
  result:
    "An explanation of the run. Replay, fork, restart and retry each run steps again only after you confirm them in their dialog.",
  reading: {
    title: "How to read the trace",
    items: [
      "Timeline shows each step in order with its duration; Graph shows the path taken on the workflow; Events is the full record; Output shows the run's input and result; Logs and Cost break it down further.",
      "A decision step shows TypeSafe's answer and how sure it was. Low confidence is the model saying the question or the input is unclear; it is not an error.",
      "Cost is what each model, decision and paid tool call recorded while running. Steps with nothing recorded show no cost; nothing is estimated.",
      STATUSES,
    ],
  },
  quality: {
    title: "Acting on a run",
    items: [
      "Retry step: only on a failed run. Reopens this run and runs the failed step again, then continues. Use it for passing errors like a timeout.",
      "Replay: a new run with the same input on the same version. Run every step again (calls are made and charged again) or reuse recorded results where the inputs match.",
      "Fork: a new run on a version you choose, or the draft, with input you can edit. Use it to test a fix against this exact case.",
      "Restart from a step (in a step's panel): a new run that reuses results before that step and runs it and everything after.",
      "Add to evaluation: keeps this input, and optionally this output as the expected answer, as a case to test future versions against. Check the output is right before using it as the expectation.",
    ],
  },
};
