"use client";
/**
 * The audit log: filter by action, resource and time; page with the keyset cursor; inspect details;
 * export the filtered range as CSV or JSON. The resource types offered are the ones the log holds.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { Download, ScrollText } from "lucide-react";
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
  toast,
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
import { Section, downloadFrom, useMembers } from "../ui";
import { errorMessage } from "~/shell/states";

const ANY = "__any";
/** Days back; null: everything the log still holds (retention keeps 400 days by default). */
const RANGES = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: null,
} as const satisfies Record<string, number | null>;
const RANGE_LABEL: Record<keyof typeof RANGES, string> = {
  "24h": "Last 24h",
  "7d": "Last 7d",
  "30d": "Last 30d",
  "90d": "Last 90d",
  "1y": "Last year",
  all: "All time",
};

/** The list's and the export's filters, as query parameters. */
export function auditFilters(o: {
  action: string;
  resource: string;
  range: keyof typeof RANGES;
  /** for tests; the current time otherwise */
  now?: number;
}): Record<string, string | undefined> {
  const days = RANGES[o.range];
  const now = o.now ?? Date.now();
  return {
    action: o.action || undefined,
    resourceType: o.resource === ANY ? undefined : o.resource,
    from: days === null ? undefined : new Date(now - days * 86_400_000).toISOString(),
  };
}

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
          ...auditFilters({ action: actionQ, resource, range }),
        })}`,
      ),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  // the types the log holds, not a fixed list that misses new kinds of resource
  const types = useQuery({
    queryKey: ["audit-types", s.ws],
    queryFn: () => get<string[]>("/v1/audit/resource-types"),
    staleTime: 60_000,
  });
  const resourceTypes = useMemo(
    () => [...new Set([...(types.data ?? []), ...(resource === ANY ? [] : [resource])])].sort(),
    [types.data, resource],
  );
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const exportLog = async (format: "csv" | "json") => {
    setExporting(format);
    try {
      const day = new Date().toISOString().slice(0, 10);
      await downloadFrom(
        `/v1/audit/export${qs({
          format,
          ...auditFilters({ action: actionQ, resource, range }),
        })}`,
        `audit-${s.ws}-${day}.${format}`,
      );
    } catch (e) {
      toast.error("Could not export the audit log", { description: errorMessage(e) });
    } finally {
      setExporting(null);
    }
  };
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
              {resourceTypes.map((r) => (
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
              {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RANGE_LABEL[r]}
                </SelectItem>
              ))}
            </Select>
            <span className="ml-auto flex items-center gap-1">
              {(["csv", "json"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant="ghost"
                  leadingIcon={<Download strokeWidth={1.75} />}
                  loading={exporting === f}
                  disabled={exporting !== null}
                  title="Downloads every event that matches these filters, newest first"
                  onClick={() => void exportLog(f)}
                >
                  Export {f.toUpperCase()}
                </Button>
              ))}
            </span>
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
