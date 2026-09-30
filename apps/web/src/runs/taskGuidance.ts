/**
 * What a person answering a human task should know: why the workflow asked, what each answer
 * does to the run, and what happens if nobody answers. Read from the task's origin and the
 * asking step's definition, following the runtime's rules (workflow-runtime `step.ts`).
 */
import type { WorkflowNode } from "@flowaid/workflow-core";
import type { HumanTask } from "~/api/types";

export interface TaskOutcome {
  answer: string;
  effect: string;
}

export interface TaskGuidance {
  why: string;
  outcomes: TaskOutcome[];
  /** what happens if nobody answers: escalation and expiry; empty when neither applies */
  timing: string[];
}

type HumanNode = Extract<WorkflowNode, { kind: "human" }>;

function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

const PATH_NOTE = "If the workflow connects nothing to that answer, the run goes no further there.";

export function taskGuidance(
  task: Pick<HumanTask, "request" | "expiresAt">,
  node: WorkflowNode | undefined,
): TaskGuidance {
  const { origin, mode } = task.request;
  const human: HumanNode | undefined = node?.kind === "human" ? node : undefined;

  if (origin === "decision_failover")
    return {
      why: "A decision step could not get an answer from TypeSafe or its fallbacks, so the question came to a person instead.",
      outcomes: [
        {
          answer: "Your answer",
          effect:
            "becomes the decision step's answer, and the run continues on the path for it as if TypeSafe had answered.",
        },
      ],
      timing: task.expiresAt
        ? [
            "If nobody answers in time, the decision step fails, and so does the run unless the workflow handles the error.",
          ]
        : [],
    };

  if (origin === "task_suspend")
    return {
      why: "A step paused to ask before going on. For an agent this is a tool call marked as needing approval: it has not been made yet.",
      outcomes: [
        {
          answer: "Approve",
          effect: "lets the step go on; for an agent, the waiting tool calls are made now.",
        },
        {
          answer: "Reject",
          effect:
            "stops that action; an agent is told the call was not approved (with your comment) and continues without it.",
        },
      ],
      timing: task.expiresAt
        ? [
            "If nobody answers in time, the step fails, and so does the run unless the workflow handles the error.",
          ]
        : [],
    };

  const outcomes: TaskOutcome[] =
    mode.type === "choice"
      ? mode.options.map((o) => ({
          answer: o.label,
          effect: `continues on the “${o.label}” path. ${PATH_NOTE}`,
        }))
      : mode.type === "form"
        ? [
            {
              answer: "Submit",
              effect: `continues on the submitted path with the values you enter. ${PATH_NOTE}`,
            },
          ]
        : [
            {
              answer: "Approve",
              effect:
                mode.type === "review"
                  ? `continues on the approved path with the value as you leave it, edits included. ${PATH_NOTE}`
                  : `continues on the approved path. ${PATH_NOTE}`,
            },
            { answer: "Reject", effect: `continues on the rejected path. ${PATH_NOTE}` },
          ];

  const timing: string[] = [];
  if (human?.escalation)
    timing.push(
      `After ${duration(human.escalation.afterMs)} without an answer, it is also offered to the people set for escalation.`,
    );
  if (task.expiresAt || human?.expiresInMs) {
    const onExpire = human?.onExpire ?? "fail";
    timing.push(
      onExpire === "route"
        ? "If nobody answers in time, the run continues on this step's expired path."
        : onExpire === "escalate"
          ? `If nobody answers in time, the task goes to the people set for escalation and waits${human?.expiresInMs ? ` another ${duration(human.expiresInMs)}` : " again"}.`
          : "If nobody answers in time, this step fails, and so does the run unless the workflow handles the error.",
    );
  }

  return {
    why: "The workflow has a Human step here: at this point it always asks a person before going on.",
    outcomes,
    timing,
  };
}
