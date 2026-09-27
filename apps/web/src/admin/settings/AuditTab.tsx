"use client";
/** The audit log: filter by action, resource and time; page with the keyset cursor; inspect details. */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  SelectItem,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@flowaid/ui/primitives";
import {
  DataTable,
  JsonView,
  RelativeTime,
  createDataTableColumns,
  type DataTableColumns,
} from "@flowaid/ui/data";
import { KeyValueList } from "@flowaid/ui/inspector";
import { get, qs } from "~/api/client";
import type { Page } from "~/api/types";
import { useSession } from "~/session";
import type { AuditEvent } from "../types";
import { Section, useMembers } from "../ui";
import { errorMessage } from "~/shell/states";

const ANY = "__any";
const RESOURCES = [
  "workflow",
  "workflow_version",
  "run",
  "human_task",
  "credential",
  "api_key",
  "membership",
  "environment",
  "workspace",
  "mcp_server",
  "mcp_exposure",
  "tool",
  "webhook",
  "schedule",
  "evaluation_set",
  "evaluation_run",
] as const;
const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

const actionTone = (a: string): "danger" | "warn" | "accent" | "neutral" =>
  /delete|revoke|remove|purge/.test(a)
    ? "danger"
    : /rotate|role|password|logout/.test(a)
      ? "warn"
      : /publish|deploy/.test(a)
        ? "accent"
        : "neutral";

export function AuditTab() {
  const s = useSession();
  const [action, setAction] = useState("");
  const [resource, setResource] = useState<string>(ANY);
  const [range, setRange] = useState<keyof typeof RANGES>("7d");
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const actionQ = useDeferredValue(action.trim());
  const log = useInfiniteQuery({
    queryKey: ["audit", s.ws, actionQ, resource, range],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<Page<AuditEvent>>(
        `/v1/audit${qs({
          limit: 100,
          cursor: pageParam,
          action: actionQ || undefined,
          resourceType: resource === ANY ? undefined : resource,
          from: new Date(Date.now() - RANGES[range] * 86_400_000).toISOString(),
        })}`,
      ),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const rows = useMemo(() => log.data?.pages.flatMap((p) => p.items) ?? [], [log.data]);
  const names = useMembers();

  const col = createDataTableColumns<AuditEvent>();
  const columns = useMemo<DataTableColumns<AuditEvent>>(
    () =>
      col.columns([
        col.accessor("at", {
          header: "When",
          size: 120,
          cell: ({ getValue }) => <RelativeTime date={getValue()} mono className="text-ink-2" />,
        }),
        col.accessor("action", {
          header: "Action",
          size: 220,
          cell: ({ getValue }) => (
            <Badge tone={actionTone(getValue())} mono>
              {getValue()}
            </Badge>
          ),
        }),
        col.accessor((a) => `${a.actorType}:${a.actorId ?? ""}`, {
          id: "actor",
          header: "Actor",
          size: 200,
          cell: ({ row }) => (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-ink-2">
                {(row.original.actorType === "user" && row.original.actorId
                  ? names.get(row.original.actorId)
                  : undefined) ?? row.original.actorType.replace(/_/g, " ")}
              </span>
              <span className="truncate font-mono text-2xs text-ink-3">
                {row.original.actorId ?? "—"}
              </span>
            </span>
          ),
        }),
        col.accessor((a) => a.resourceType ?? "", {
          id: "resource",
          header: "Resource",
          size: 240,
          meta: { grow: true },
          cell: ({ row }) => (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-ink-2">
                {row.original.resourceType?.replace(/_/g, " ") ?? "—"}
              </span>
              <span className="truncate font-mono text-2xs text-ink-3">
                {row.original.resourceId ?? ""}
              </span>
            </span>
          ),
        }),
        col.accessor((a) => a.ip ?? "", {
          id: "ip",
          header: "IP",
          size: 120,
          meta: { mono: true },
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [names],
  );

  return (
    <Section
      title="Audit log"
      description="Every change to workflows, credentials, access and runs, with who did it and from where."
    >
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(a) => a.id}
        loading={log.isPending}
        error={
          log.isError
            ? { message: errorMessage(log.error), onRetry: () => void log.refetch() }
            : null
        }
        emptyState={
          <EmptyState
            size="sm"
            icon={<ScrollText strokeWidth={1.5} />}
            title="No events"
            description="Nothing matches these filters in this period."
          />
        }
        onRowClick={(a) => setOpen(a)}
        itemLabel={["event", "events"]}
        aria-label="Audit events"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Action"
              placeholder="Action, e.g. workflow.publish"
              className="w-56 font-mono"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
            <Select
              aria-label="Resource type"
              value={resource}
              onValueChange={setResource}
              className="w-44"
            >
              <SelectItem value={ANY}>All resources</SelectItem>
              {RESOURCES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Period"
              value={range}
              onValueChange={(v) => setRange(v as keyof typeof RANGES)}
              className="w-32"
            >
              {Object.keys(RANGES).map((r) => (
                <SelectItem key={r} value={r}>
                  Last {r}
                </SelectItem>
              ))}
            </Select>
          </div>
        }
        footer={
          log.hasNextPage ? (
            <Button
              size="sm"
              variant="ghost"
              loading={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              Load more
            </Button>
          ) : undefined
        }
      />
      <Sheet open={open !== null} onOpenChange={(o) => (o ? undefined : setOpen(null))}>
        <SheetContent width={480}>
          <SheetHeader>
            <SheetTitle className="font-mono">{open?.action}</SheetTitle>
            <SheetDescription>{open ? new Date(open.at).toLocaleString() : ""}</SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-4">
            {open ? (
              <>
                <KeyValueList
                  items={[
                    {
                      label: "Actor",
                      value: `${open.actorType}${open.actorId ? ` · ${open.actorId}` : ""}`,
                      mono: true,
                    },
                    {
                      label: "Resource",
                      value: `${open.resourceType ?? "—"}${open.resourceId ? ` · ${open.resourceId}` : ""}`,
                      mono: true,
                    },
                    { label: "IP", value: open.ip ?? "—", mono: true },
                    { label: "User agent", value: open.userAgent ?? "—" },
                    { label: "Request", value: open.requestId ?? "—", mono: true },
                  ]}
                />
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-ink">Details</h3>
                  <JsonView value={open.details ?? {}} expandDepth={3} />
                </div>
              </>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Section>
  );
}
