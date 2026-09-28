"use client";
/**
 * The documents of a PageIndex source: upload PDFs (and new versions), watch each index build by
 * its state and stage (never a made-up percentage), open outlines and pages, reindex, cancel and
 * delete. The list polls every 3 s while an index is queued, running or being canceled.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { CircleStop, FileText, ListTree, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge, ConfirmDialog, EmptyState, Hint, IconButton } from "@flowaid/ui/primitives";
import {
  DataTable,
  RelativeTime,
  createDataTableColumns,
  type DataTableColumns,
} from "@flowaid/ui/data";
import { ApiError, currentWorkspace, del, get, post } from "~/api/client";
import { Notice, Section, useConfirm, useMutate } from "~/admin/ui";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";
import { errorMessage } from "~/shell/states";
import {
  STATE_LABEL,
  indexErrorHint,
  isInFlight,
  pollInterval,
  readableIndex,
  rowIndex,
  stateTone,
  type DocumentSummary,
  type IndexReference,
  type PageIndexStatus,
} from "./model";
import { OutlineDialog } from "./OutlineDialog";
import { PdfDropZone, UploadList, useUploads } from "./uploads";
import type { ViewerTarget } from "./SourceViewer";

export const documentsKey = (sourceId: string) =>
  ["pageindex-documents", currentWorkspace(), sourceId] as const;

/** The source's documents, polled while any index is still being built. */
export function usePageIndexDocuments(sourceId: string) {
  return useQuery({
    queryKey: documentsKey(sourceId),
    queryFn: () =>
      get<{ items: DocumentSummary[] }>(
        `/v1/pageindex/sources/${encodeURIComponent(sourceId)}/documents`,
      ),
    refetchInterval: (q) => pollInterval(q.state.data?.items),
  });
}

/** Whether the service is configured and answering (`GET /v1/pageindex/status`). */
export function ServiceBanner() {
  const status = useQuery({
    queryKey: ["pageindex-status", currentWorkspace()],
    queryFn: () => get<PageIndexStatus>("/v1/pageindex/status"),
    staleTime: 30_000,
    refetchInterval: (q) => (q.state.data && !q.state.data.reachable ? 15_000 : false),
  });
  const guide = <LearnMore href={HELP.pageindexSetup} label="Setup guide" />;
  if (status.error instanceof ApiError && status.error.code === "PAGEINDEX_DISABLED")
    return (
      <Notice tone="warn">
        PageIndex is not configured on this server, so documents cannot be uploaded or indexed.{" "}
        {guide}
      </Notice>
    );
  if (status.data && !status.data.reachable)
    return (
      <Notice tone="danger">
        The PageIndex service is not answering. New uploads wait and indexes cannot be built until
        it runs again. {guide}
      </Notice>
    );
  return null;
}

function IndexCell({ d }: { d: DocumentSummary }) {
  const ix = rowIndex(d);
  if (!ix) return <span className="text-xs text-ink-3">Not indexed</span>;
  const badge = (
    <Badge tone={stateTone(ix.state)} dot>
      {STATE_LABEL[ix.state]}
    </Badge>
  );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {ix.error ? <Hint hint={indexErrorHint(ix.error)}>{badge}</Hint> : badge}
      {isInFlight(ix.state) && ix.stage ? (
        <span className="truncate text-2xs text-ink-3">{ix.stage}</span>
      ) : null}
    </span>
  );
}

export function DocumentManager({
  sourceId,
  canWrite,
  onOpen,
}: {
  sourceId: string;
  canWrite: boolean;
  onOpen: (t: ViewerTarget) => void;
}) {
  const documents = usePageIndexDocuments(sourceId);
  const uploads = useUploads(sourceId);
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionOf, setVersionOf] = useState<DocumentSummary | null>(null);
  const [outlineOf, setOutlineOf] = useState<{
    doc: DocumentSummary;
    index: IndexReference;
  } | null>(null);
  const confirmDelete = useConfirm<DocumentSummary>();
  const invalidate = [documentsKey(sourceId), ["knowledge-source", currentWorkspace(), sourceId]];

  const reindex = useMutate(
    (d: DocumentSummary) =>
      post<{ index: IndexReference; created: boolean }>(
        `/v1/pageindex/documents/${encodeURIComponent(d.documentId)}/index`,
      ),
    {
      success: (r) =>
        r.created
          ? "Indexing queued"
          : isInFlight(r.index.state)
            ? "Already being indexed"
            : "Already indexed with the current settings",
      invalidate,
      errorTitle: "Could not start indexing",
    },
  );
  const cancel = useMutate(
    (ix: IndexReference) =>
      post<IndexReference>(`/v1/pageindex/indexes/${encodeURIComponent(ix.indexId)}/cancel`),
    {
      success: (r) => (r.state === "canceled" ? "Indexing canceled" : "Canceling…"),
      invalidate,
      errorTitle: "Could not cancel",
    },
  );
  const remove = useMutate(
    (d: DocumentSummary) => del(`/v1/pageindex/documents/${encodeURIComponent(d.documentId)}`),
    {
      success: (_r, d) => `Deleted ${d.title}`,
      invalidate,
      onSuccess: () => confirmDelete.close(),
      errorTitle: "Could not delete",
    },
  );

  const openFile = (d: DocumentSummary, page = 1) =>
    onOpen({
      documentId: d.documentId,
      versionId: d.latestVersion.versionId,
      displayName: d.title,
      version: d.latestVersion.version,
      page,
    });
  const openOutline = (d: DocumentSummary) => {
    const index = readableIndex(d);
    if (index) setOutlineOf({ doc: d, index });
  };

  const col = createDataTableColumns<DocumentSummary>();
  const columns = useMemo<DataTableColumns<DocumentSummary>>(
    () =>
      col.columns([
        col.accessor("title", {
          header: "Document",
          size: 280,
          meta: { grow: true },
          cell: ({ row }) =>
            readableIndex(row.original) ? (
              <button
                type="button"
                className="block max-w-full truncate text-left text-ink hover:underline"
                onClick={() => openOutline(row.original)}
              >
                {row.original.title}
              </button>
            ) : (
              <span className="block truncate text-ink">{row.original.title}</span>
            ),
        }),
        col.accessor((d) => d.latestVersion.version, {
          id: "version",
          header: "Version",
          size: 80,
          meta: { mono: true },
          cell: ({ getValue }) => `v${getValue()}`,
        }),
        col.accessor((d) => d.latestVersion.pageCount ?? rowIndex(d)?.pageCount ?? null, {
          id: "pages",
          header: "Pages",
          size: 70,
          meta: { numeric: true, mono: true },
          cell: ({ getValue }) => getValue() ?? "—",
        }),
        col.accessor((d) => rowIndex(d)?.state ?? "", {
          id: "index",
          header: "Index",
          size: 170,
          cell: ({ row }) => <IndexCell d={row.original} />,
        }),
        col.accessor((d) => rowIndex(d)?.indexVersion ?? null, {
          id: "indexVersion",
          header: "Index #",
          size: 76,
          meta: { mono: true },
          cell: ({ getValue }) => {
            const v = getValue();
            return v === null ? "—" : `#${v}`;
          },
        }),
        col.accessor((d) => rowIndex(d)?.indexModel ?? "", {
          id: "model",
          header: "Model",
          size: 150,
          cell: ({ getValue }) => (
            <span className="block truncate font-mono text-2xs">{getValue() || "—"}</span>
          ),
        }),
        col.accessor((d) => rowIndex(d)?.readyAt ?? rowIndex(d)?.createdAt ?? "", {
          id: "updated",
          header: "Updated",
          size: 110,
          cell: ({ getValue }) => (getValue() ? <RelativeTime date={getValue()} /> : "—"),
        }),
        col.display({
          id: "actions",
          size: 180,
          cell: ({ row }) => {
            const d = row.original;
            const ix = rowIndex(d);
            const failed = ix?.state === "failed" || ix?.state === "canceled";
            return (
              <span className="flex justify-end gap-0.5">
                {readableIndex(d) ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Outline of ${d.title}`}
                    onClick={() => openOutline(d)}
                  >
                    <ListTree strokeWidth={1.75} />
                  </IconButton>
                ) : null}
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Open ${d.title}`}
                  onClick={() => openFile(d)}
                >
                  <FileText strokeWidth={1.75} />
                </IconButton>
                {canWrite && ix && isInFlight(ix.state) ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Cancel indexing ${d.title}`}
                    disabled={ix.state === "cancel_requested"}
                    onClick={() => cancel.mutate(ix)}
                  >
                    <CircleStop strokeWidth={1.75} />
                  </IconButton>
                ) : null}
                {canWrite && !(ix && isInFlight(ix.state)) ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`${failed ? "Retry indexing" : "Reindex"} ${d.title}`}
                    onClick={() => reindex.mutate(d)}
                  >
                    <RefreshCw strokeWidth={1.75} />
                  </IconButton>
                ) : null}
                {canWrite ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Upload a new version of ${d.title}`}
                    onClick={() => {
                      setVersionOf(d);
                      versionInput.current?.click();
                    }}
                  >
                    <Upload strokeWidth={1.75} />
                  </IconButton>
                ) : null}
                {canWrite ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Delete ${d.title}`}
                    onClick={() => confirmDelete.ask(d)}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </IconButton>
                ) : null}
              </span>
            );
          },
        }),
      ]),
    // the mutations are stable; the table re-renders cells from the rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite],
  );

  const items = documents.data?.items ?? [];
  const failed = items.filter((d) => {
    const ix = rowIndex(d);
    return ix?.state === "failed" && ix.error;
  });

  return (
    <Section
      title={`Documents (${items.length})`}
      description="Each PDF is indexed into a tree of sections with their pages. A new version is indexed again; the previous index keeps answering until the new one is ready."
    >
      <div className="flex flex-col gap-3">
        {canWrite ? (
          <>
            <PdfDropZone onFiles={(files) => uploads.add(files)} />
            <input
              ref={versionInput}
              type="file"
              accept=".pdf,application/pdf"
              aria-label="PDF file for the new version"
              tabIndex={-1}
              className="sr-only"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])].slice(0, 1);
                e.target.value = "";
                if (files.length && versionOf) uploads.add(files, versionOf.documentId);
                setVersionOf(null);
              }}
            />
            <UploadList
              items={uploads.items}
              onDismiss={uploads.dismiss}
              onClear={uploads.clearDone}
            />
          </>
        ) : null}
        {failed.map((d) => {
          const ix = rowIndex(d);
          return ix?.error ? (
            <Notice key={d.documentId} tone="danger">
              <span className="font-medium">{d.title}</span> could not be indexed.{" "}
              {indexErrorHint(ix.error)}
            </Notice>
          ) : null;
        })}
        <DataTable
          columns={columns}
          data={items}
          getRowId={(d) => d.documentId}
          loading={documents.isPending}
          error={
            documents.isError
              ? { message: errorMessage(documents.error), onRetry: () => void documents.refetch() }
              : null
          }
          emptyState={
            <EmptyState
              size="sm"
              icon={<FileText strokeWidth={1.5} />}
              title="No PDFs yet"
              description="Upload PDFs with a text layer; each is indexed into sections in the background."
            />
          }
          itemLabel={["document", "documents"]}
          aria-label="Documents"
        />
      </div>
      {outlineOf ? (
        <OutlineDialog
          index={outlineOf.index}
          onClose={() => setOutlineOf(null)}
          onOpenPage={(page) => {
            const { doc, index } = outlineOf;
            onOpen({
              documentId: doc.documentId,
              versionId: index.versionId,
              displayName: doc.title,
              version: index.documentVersion,
              page,
            });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete.target !== null}
        onOpenChange={(o) => (o ? undefined : confirmDelete.close())}
        title={`Delete ${confirmDelete.target?.title ?? "this document"}?`}
        description="Access is revoked at once: every version and index stops answering, so retrieval and workflows can no longer read or cite it. The stored file and indexes are then removed in the background. This cannot be undone."
        variant="danger"
        confirmLabel="Delete document"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirmDelete.target) remove.mutate(confirmDelete.target);
        }}
      />
    </Section>
  );
}
