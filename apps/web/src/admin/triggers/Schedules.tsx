"use client";
/**
 * Live schedules (materialised per environment on deploy): next and last runs, the last error,
 * and the environment-specific policy — enabled, overlap, missed runs (catch-up and its limit)
 * and jitter — plus a manual trigger. The cron and timezone belong to the workflow definition
 * (the API answers 409 to a cron edit), so they show as a read-only field.
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Play } from "lucide-react";
import {
  Badge,
  Button,
  Hint,
  Input,
  NumberInput,
  Select,
  SelectItem,
  Switch,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { get, patch, post, qs } from "~/api/client";
import { useSession } from "~/session";
import type { Schedule } from "../types";
import { Notice, QueryView, useMutate } from "../ui";
import { formatJitter, parseJitterSeconds } from "./logic";

export function ScheduleList({
  workflowId,
  workflowName,
}: {
  workflowId?: string;
  workflowName?: (id: string) => string;
}) {
  const s = useSession();
  const key = ["triggers", s.ws, workflowId ?? "*", "schedules"];
  const schedules = useQuery({
    queryKey: key,
    queryFn: () => get<Schedule[]>(`/v1/schedules${qs({ workflowId })}`),
    enabled: s.can("schedules:write"),
    refetchInterval: 30_000,
  });
  const envName = (id: string) => s.environments.find((e) => e.id === id)?.name ?? id.slice(0, 8);
  const patchSchedule = useMutate(
    (v: { id: string; body: Record<string, unknown> }) => patch(`/v1/schedules/${v.id}`, v.body),
    { success: "Schedule updated", invalidate: [key] },
  );
  const fire = useMutate((id: string) => post<{ run_id: string }>(`/v1/schedules/${id}/trigger`), {
    success: "Run started",
    invalidate: [key],
  });

  if (!s.can("schedules:write"))
    return <Notice tone="info">You need the schedules:write scope to manage schedules.</Notice>;
  return (
    <QueryView query={schedules} rows={2}>
      {(rows) =>
        rows.length === 0 ? (
          <p className="text-xs text-ink-3">
            No schedule is live. Add a schedule trigger in the builder, publish and deploy.
          </p>
        ) : (
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
                              (run)
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
                      leadingIcon={<Play strokeWidth={1.75} />}
                      loading={fire.isPending && fire.variables === x.id}
                      onClick={() => fire.mutate(x.id)}
                    >
                      Run now
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </QueryView>
  );
}
