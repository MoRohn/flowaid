"use client";
/**
 * Live schedules (materialised per environment on deploy): next and last runs, the last error,
 * and the environment-specific policy — enabled, overlap, missed runs (catch-up and its limit)
 * and jitter — plus a manual trigger, confirmed first (it is a real run in that environment). The
 * cron and timezone belong to the workflow definition (the API answers 409 to a cron edit), so they
 * show as a read-only field.
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarClock, Play } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Hint,
  Input,
  NumberInput,
  Select,
  SelectItem,
  Switch,
  toast,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { getAll, patch, post } from "~/api/client";
import { useSession } from "~/session";
import type { Schedule } from "../types";
import { Notice, QueryView, useMutate } from "../ui";
import { formatJitter, parseJitterSeconds } from "./logic";
import { NoTriggers } from "./AddTriggerDialog";
import { ListHelp, SCHEDULE_TERMS } from "./ListHelp";

/** The live schedules (one workflow's, or all); shared with the Triggers page's checks. */
export function useSchedules(workflowId?: string) {
  const s = useSession();
  return useQuery({
    queryKey: ["triggers", s.ws, workflowId ?? "*", "schedules"],
    queryFn: () => getAll<Schedule>("/v1/schedules", { workflowId }),
    enabled: s.can("schedules:write"),
    refetchInterval: 30_000,
  });
}

export function ScheduleList({
  workflowId,
  workflowName,
}: {
  workflowId?: string;
  workflowName?: (id: string) => string;
}) {
  const s = useSession();
  const router = useRouter();
  const key = ["triggers", s.ws, workflowId ?? "*", "schedules"];
  const schedules = useSchedules(workflowId);
  const envName = (id: string) => s.environments.find((e) => e.id === id)?.name ?? id.slice(0, 8);
  // Run now asks first: it starts a real run in the schedule's environment
  const [confirmRun, setConfirmRun] = useState<Schedule | null>(null);
  const patchSchedule = useMutate(
    (v: { id: string; body: Record<string, unknown> }) => patch(`/v1/schedules/${v.id}`, v.body),
    { success: "Schedule updated", invalidate: [key], errorTitle: "Could not update the schedule" },
  );
  const fire = useMutate((id: string) => post<{ run_id: string }>(`/v1/schedules/${id}/trigger`), {
    invalidate: [key],
    onSuccess: (r) =>
      toast.success("Run started", {
        action: { label: "Open run", onClick: () => router.push(`/${s.ws}/runs/${r.run_id}`) },
      }),
    errorTitle: "The run did not start",
  });
  // a switch shows its change is being saved, and can't be flipped again meanwhile
  const pendingRow = (id: string) => patchSchedule.isPending && patchSchedule.variables.id === id;
  const confirmEnv = confirmRun
    ? s.environments.find((e) => e.id === confirmRun.environmentId)
    : undefined;

  if (!s.can("schedules:write"))
    return <Notice tone="info">You need the schedules:write scope to manage schedules.</Notice>;
  return (
    <QueryView query={schedules} rows={2}>
      {(rows) =>
        rows.length === 0 ? (
          <NoTriggers kind="schedule" {...(workflowId ? { workflowId } : {})} />
        ) : (
          <>
            <ListHelp terms={SCHEDULE_TERMS} />
            <ul
              className="flex flex-col divide-y divide-border rounded-md border border-border"
              role="list"
            >
              {rows.map((x) => (
                <li key={x.id} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <CalendarClock
                      strokeWidth={1.75}
                      className="size-3.5 shrink-0 text-ink-3"
                      aria-hidden="true"
                    />
                    {workflowName ? (
                      <a
                        className="shrink-0 font-medium text-ink hover:underline"
                        href={`/${s.ws}/workflows/${x.workflowId}/settings?tab=triggers`}
                      >
                        {workflowName(x.workflowId)}
                      </a>
                    ) : null}
                    <Badge mono>{envName(x.environmentId)}</Badge>
                    <Hint hint="The cron and timezone are part of the workflow definition: change the trigger in the builder and redeploy.">
                      <Input
                        size="sm"
                        mono
                        disabled
                        className="w-36"
                        aria-label="Cron (defined in the workflow)"
                        value={x.cron}
                        readOnly
                      />
                    </Hint>
                    <span className="text-ink-3">{x.timezone}</span>
                    <span className="ml-auto text-2xs text-ink-3">
                      {x.enabled && x.nextRunAt ? (
                        <>
                          next <RelativeTime date={x.nextRunAt} />
                        </>
                      ) : (
                        "paused"
                      )}
                      {x.lastRunAt ? (
                        <>
                          {" "}
                          · last <RelativeTime date={x.lastRunAt} />
                          {x.lastRunId ? (
                            <>
                              {" "}
                              <a
                                className="text-accent-text hover:underline"
                                href={`/${s.ws}/runs/${x.lastRunId}`}
                              >
                                Open last run
                              </a>
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  </div>
                  {x.lastError ? <Notice tone="danger">{x.lastError}</Notice> : null}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
                    <label className="flex items-center gap-2">
                      <Switch
                        size="sm"
                        checked={x.enabled}
                        disabled={pendingRow(x.id)}
                        aria-busy={pendingRow(x.id)}
                        onCheckedChange={(c) =>
                          patchSchedule.mutate({ id: x.id, body: { enabled: c } })
                        }
                      />
                      Enabled
                    </label>
                    <label className="flex items-center gap-2">
                      Overlap
                      <Select
                        size="sm"
                        aria-label="Overlap"
                        value={x.overlap}
                        className="w-28"
                        onValueChange={(v) =>
                          patchSchedule.mutate({ id: x.id, body: { overlap: v } })
                        }
                      >
                        <SelectItem value="skip">Skip</SelectItem>
                        <SelectItem value="allow">Allow</SelectItem>
                      </Select>
                    </label>
                    <label className="flex items-center gap-2">
                      Missed runs
                      <Select
                        size="sm"
                        aria-label="Missed runs"
                        value={x.catchUp}
                        className="w-32"
                        onValueChange={(v) =>
                          patchSchedule.mutate({ id: x.id, body: { catchUp: v } })
                        }
                      >
                        <SelectItem value="skip">Skip</SelectItem>
                        <SelectItem value="one">Run once</SelectItem>
                        <SelectItem value="all">Run all</SelectItem>
                      </Select>
                    </label>
                    {x.catchUp === "all" ? (
                      <label className="flex items-center gap-2">
                        at most
                        <NumberInput
                          size="sm"
                          className="w-20"
                          aria-label="Maximum missed runs"
                          min={1}
                          max={100}
                          defaultValue={x.maxCatchUp}
                          key={`${x.id}:${x.maxCatchUp}`}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isInteger(n) && n >= 1 && n <= 100 && n !== x.maxCatchUp)
                              patchSchedule.mutate({ id: x.id, body: { maxCatchUp: n } });
                          }}
                        />
                      </label>
                    ) : null}
                    <label className="flex items-center gap-2">
                      Jitter (s)
                      <Input
                        size="sm"
                        mono
                        className="w-20"
                        inputMode="numeric"
                        aria-label="Jitter in seconds"
                        aria-describedby={`jitter-${x.id}`}
                        defaultValue={String(Math.round(x.jitterMs / 1000))}
                        key={`${x.id}:${x.jitterMs}`}
                        onBlur={(e) => {
                          const ms = parseJitterSeconds(e.target.value);
                          if (ms !== null && ms !== x.jitterMs)
                            patchSchedule.mutate({ id: x.id, body: { jitterMs: ms } });
                        }}
                      />
                      <span id={`jitter-${x.id}`} className="text-2xs text-ink-3">
                        {formatJitter(x.jitterMs)}
                      </span>
                    </label>
                    {s.can("runs:create") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        title={`Start one real run now with this schedule's input, in ${envName(x.environmentId)}`}
                        leadingIcon={<Play strokeWidth={1.75} />}
                        loading={fire.isPending && fire.variables === x.id}
                        onClick={() => setConfirmRun(x)}
                      >
                        Run now
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <ConfirmDialog
              open={confirmRun !== null}
              onOpenChange={(o) => {
                if (!o) setConfirmRun(null);
              }}
              title={
                confirmRun && workflowName
                  ? `Run ${workflowName(confirmRun.workflowId)} now in ${confirmEnv?.name ?? "its environment"}?`
                  : `Run this schedule now in ${confirmEnv?.name ?? "its environment"}?`
              }
              description="This starts one real run with the schedule's input, as a scheduled run would: its steps call their services, and paid model steps are charged."
              confirmLabel={`Run now in ${confirmEnv?.name ?? "this environment"}`}
              onConfirm={async () => {
                // a failure is toasted by the mutation; the dialog closes either way
                if (confirmRun) await fire.mutateAsync(confirmRun.id).catch(() => undefined);
              }}
            >
              <div className="flex flex-col gap-2 text-xs text-ink-2">
                {confirmEnv?.protected ? (
                  <Notice>
                    {confirmEnv.name} is a protected environment: this run uses its credentials and
                    reaches the same systems as its scheduled runs.
                  </Notice>
                ) : null}
                {confirmRun?.overlap === "skip" ? (
                  <p className="m-0 text-ink-3">
                    Overlap is Skip: a scheduled time that comes while this run is still going is
                    skipped.
                  </p>
                ) : null}
              </div>
            </ConfirmDialog>
          </>
        )
      }
    </QueryView>
  );
}
