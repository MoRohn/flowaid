"use client";
/**
 * Beside a human task: why the workflow asked a person, what each answer does to the run, what
 * happens if nobody answers, and how to decide well. Open while the task waits; folded once
 * it is answered, expired or cancelled.
 */
import type { WorkflowNode } from "@flowaid/workflow-core";
import { Compass } from "lucide-react";
import { RelativeTime } from "@flowaid/ui/data";
import type { HumanTask } from "~/api/types";
import { HUMAN_TASK } from "~/guide/capabilities/humanTasks";
import { taskGuidance } from "./taskGuidance";

export function TaskGuidancePanel({
  task,
  node,
  className,
}: {
  task: Pick<HumanTask, "request" | "expiresAt" | "status">;
  node: WorkflowNode | undefined;
  className?: string;
}) {
  const g = taskGuidance(task, node);
  return (
    <details
      open={task.status === "open"}
      className={`rounded-md border border-border bg-surface px-4 py-3 text-sm ${className ?? ""}`}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded-xs font-medium text-ink focus-visible:shadow-(--focus) focus-visible:outline-none">
        <Compass className="size-4 text-accent-text" strokeWidth={1.75} aria-hidden />
        Before you answer
      </summary>
      <dl className="m-0 mt-3 grid gap-3">
        <div>
          <dt className="text-xs font-medium text-ink-3">Why it came to a person</dt>
          <dd className="m-0 text-ink-2">{g.why}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-ink-3">What your answer does</dt>
          <dd className="m-0">
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-ink-2">
              {g.outcomes.map((o) => (
                <li key={o.answer}>
                  <span className="font-medium text-ink">{o.answer}</span> {o.effect}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-ink-3">If nobody answers</dt>
          <dd className="m-0 text-ink-2">
            {task.expiresAt ? (
              <p className="m-0">
                {task.status === "open" ? "Expires " : "Was due "}
                <RelativeTime date={task.expiresAt} />.
              </p>
            ) : null}
            {g.timing.length ? (
              g.timing.map((t) => (
                <p key={t} className="m-0">
                  {t}
                </p>
              ))
            ) : (
              <p className="m-0">
                It waits until someone answers, unless the run reaches its own time limit first.
              </p>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-ink-3">{HUMAN_TASK.quality?.title}</dt>
          <dd className="m-0">
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-xs text-ink-2">
              {HUMAN_TASK.quality?.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </details>
  );
}
