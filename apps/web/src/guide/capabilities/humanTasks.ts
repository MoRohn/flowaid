import type { CapabilityGuide } from "./types";

export const HUMAN_TASKS: CapabilityGuide = {
  id: "human-tasks",
  title: "Human tasks",
  what: "Answer the approvals, reviews, choices and forms that workflows are waiting on. Each run stays paused, safely, until someone answers or the task expires.",
  when: "Whenever the Overview says approvals are waiting, or a run's status is waiting for a person.",
  needs:
    "Nothing to set up. Tasks come from Human steps, agent tools that need approval, and decision steps that hand a question to a person when TypeSafe cannot answer.",
  start:
    "Open the oldest task, or those due soonest. Mine shows tasks assigned to you; Resolved shows what was answered, by whom and with what comment.",
  result:
    "Your answer is recorded with your name and comment, and the run carries on along the path for that answer.",
  reading: {
    title: "Reading the inbox",
    items: [
      "Each row shows the step that asked, its workflow, the reason, how long it has waited, who it is assigned to, and under SLA how long is left before it expires. The list is sorted by that time left.",
      "Assign to me tells others you are on it; the task stays open until answered.",
      "Open tasks refresh every few seconds, so a task answered elsewhere disappears on its own.",
    ],
  },
};

export const HUMAN_TASK: CapabilityGuide = {
  id: "human-task",
  title: "Answering a task",
  what: "Decide on one request with the run's context beside it: what the workflow found so far, and why it came to a person.",
  when: "When you are the right person to decide. If you are not, reassign it rather than guess.",
  needs: "The approve permission. Without it you can read the task but not answer it.",
  start:
    "Read the request and the context, open the steps before it if something is unclear, then answer with a short comment saying why.",
  result:
    "The run resumes at once along the path for your answer. An answer cannot be taken back; a new run is needed to decide again.",
  quality: {
    title: "Deciding well",
    items: [
      "Check the facts the decision rests on in the context, not only the workflow's suggestion.",
      "A confidence shown beside an answer is TypeSafe's, not a guarantee. Low confidence is exactly why a person is asked.",
      "Write a comment a colleague could understand later: it is kept with the run and shown under Resolved.",
      "When editing a value in a review, change only what is wrong; the edited value is what the run continues with.",
    ],
  },
};
