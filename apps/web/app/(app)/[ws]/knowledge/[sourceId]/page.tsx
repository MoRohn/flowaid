"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import { FileText, Layers, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  IconButton,
  Input,
  NumberInput,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import {
  DataTable,
  RelativeTime,
  createDataTableColumns,
  type DataTableColumns,
} from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { del, get, post, qs } from "~/api/client";
import type { Page } from "~/api/types";
import { Notice, QueryView, Section, useConfirm, useMutate } from "~/admin/ui";
import {
  KIND_LABEL,
  countsLine,
  documentTone,
  isUploadKind,
  mimeOf,
  sourceTone,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type KnowledgeSource,
  type QueryResult,
  type SearchMode,
} from "~/knowledge/model";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { errorMessage } from "~/shell/states";

interface Draft {
  title: string;
  text: string;
  mimeType: ReturnType<typeof mimeOf>;
}

function UploadDialog({
  source,
  open,
  onOpenChange,
}: {
  source: KnowledgeSource;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const s = useSession();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Draft[]>([]);
  const docs: Draft[] = files.length
    ? files
    : text.trim()
      ? [{ title: title.trim() || "Untitled", text, mimeType: "text/markdown" }]
      : [];
  const upload = useMutate(
    () =>
      post<{ documents: KnowledgeDocument[] }>(`/v1/knowledge/sources/${source.id}/documents`, {
        documents: docs.map((d) => ({ externalId: d.title, ...d })),
      }),
    {
      success: (r) => `Added ${r.documents.length} document${r.documents.length === 1 ? "" : "s"}`,
      invalidate: [
        ["knowledge-documents", s.ws, source.id],
        ["knowledge-source", s.ws, source.id],
      ],
      onSuccess: () => {
        setTitle("");
        setText("");
        setFiles([]);
        onOpenChange(false);
      },
    },
  );
  const readFiles = async (list: FileList | null) => {
    const picked = [...(list ?? [])].slice(0, 100);
    setFiles(
      await Promise.all(
        picked.map(async (f) => ({
          title: f.name,
          text: await f.text(),
          mimeType: mimeOf(f.name),
        })),
      ),
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (docs.length) upload.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>Add documents</DialogTitle>
            <DialogDescription>
              Text, Markdown, HTML or JSON. A document with the same name replaces the earlier one;
              indexing runs in the background.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow label="Files" htmlFor="kd-files" hint="Up to 100 text files">
              <input
                id="kd-files"
                type="file"
                multiple
                accept=".txt,.md,.mdx,.markdown,.html,.htm,.json,text/*"
                className="text-xs text-ink-2 file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-ink"
                onChange={(e) => void readFiles(e.target.files)}
              />
            </FieldRow>
            {files.length ? (
              <p className="text-xs text-ink-3">
                {files.length} file{files.length === 1 ? "" : "s"} selected:{" "}
                {files.map((f) => f.title).join(", ")}
              </p>
            ) : (
              <>
                <FieldRow label="Or paste a document" htmlFor="kd-title">
                  <Input
                    id="kd-title"
                    value={title}
                    maxLength={500}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Refund policy"
                  />
                </FieldRow>
                <Textarea
                  aria-label="Document text"
                  rows={8}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="# Refunds&#10;&#10;Refunds go back to the original card within five business days."
                />
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={upload.isPending}
              disabled={docs.length === 0}
            >
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChunksDialog({ doc, onClose }: { doc: KnowledgeDocument; onClose: () => void }) {
  const s = useSession();
  const chunks = useQuery({
    queryKey: ["knowledge-chunks", s.ws, doc.id],
    queryFn: () => get<KnowledgeChunk[]>(`/v1/knowledge/documents/${doc.id}/chunks`),
  });
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{doc.title ?? doc.externalId}</DialogTitle>
          <DialogDescription>
            {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}, in order
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          <QueryView query={chunks} rows={3}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-xs text-ink-3">
                  No chunks here yet: the document is pending, or its source keeps chunks in a
                  remote index.
                </p>
              ) : (
                rows.map((c) => (
                  <div key={c.id} className="rounded-md border border-border p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">
                      <Badge tone="outline" mono>
                        #{c.ordinal + 1}
                      </Badge>
                      <span className="font-mono">{c.tokens} tokens</span>
                      {typeof c.metadata.heading === "string" ? (
                        <span>· {c.metadata.heading}</span>
                      ) : null}
                      {c.embedded ? null : <Badge size="sm">not embedded</Badge>}
                    </div>
                    <p className="whitespace-pre-wrap text-xs text-ink-2">{c.content}</p>
                  </div>
                ))
              )
            }
          </QueryView>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Playground({ source }: { source: KnowledgeSource }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<SearchMode>(source.pipeline.embedding ? "hybrid" : "keyword");
  const [topK, setTopK] = useState(5);
  const query = useMutate(
    () =>
      post<QueryResult>(`/v1/knowledge/sources/${source.id}/query`, {
        text: text.trim(),
        topK,
        mode,
      }),
    { errorTitle: "Search failed" },
  );
  return (
    <Section
      title="Try a search"
      description="What a retrieval node would get for this query: the best chunks and their scores."
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) query.mutate(undefined);
        }}
      >
        <FieldRow label="Query" htmlFor="kq-text" className="min-w-64 flex-1">
          <Input
            id="kq-text"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            placeholder="How long do refunds take?"
          />
        </FieldRow>
        <FieldRow label="Mode" htmlFor="kq-mode" className="w-36 shrink-0">
          <Select id="kq-mode" value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
            <SelectItem value="hybrid" disabled={!source.pipeline.embedding}>
              Hybrid
            </SelectItem>
            <SelectItem value="vector" disabled={!source.pipeline.embedding}>
              Semantic
            </SelectItem>
            <SelectItem value="keyword">Keyword</SelectItem>
          </Select>
        </FieldRow>
        <FieldRow label="Results" htmlFor="kq-k" className="shrink-0">
          <NumberInput
            id="kq-k"
            value={topK}
            min={1}
            max={50}
            onValueChange={(v) => setTopK(v ?? 5)}
            className="w-20"
          />
        </FieldRow>
        <Button
          type="submit"
          variant="primary"
          leadingIcon={<Search strokeWidth={1.75} />}
          loading={query.isPending}
          disabled={!text.trim() || source.chunks === 0}
        >
          Search
        </Button>
      </form>
      {source.chunks === 0 ? (
        <p className="mt-3 text-xs text-ink-3">Nothing is indexed yet.</p>
      ) : null}
      {query.data ? (
        <ol className="mt-4 flex flex-col gap-2" aria-label="Search results">
          {query.data.hits.length === 0 ? (
            <li className="text-xs text-ink-3">No matching chunks.</li>
          ) : (
            query.data.hits.map((h, i) => (
              <li key={h.chunkId} className="rounded-md border border-border p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">
                  <Badge tone="accent" mono>
                    {i + 1}
                  </Badge>
                  <span className="font-medium text-ink">{h.title ?? "Untitled"}</span>
                  <span>· chunk {h.ordinal + 1}</span>
                  <span className="ml-auto font-mono">score {h.score.toFixed(4)}</span>
                </div>
                <p className="line-clamp-4 whitespace-pre-wrap text-xs text-ink-2">{h.content}</p>
              </li>
            ))
          )}
        </ol>
      ) : null}
    </Section>
  );
}

export default function KnowledgeSourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = use(params);
  const s = useSession();
  const router = useRouter();
  const canWrite = s.can("knowledge:write");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<KnowledgeDocument | null>(null);
  const confirmDoc = useConfirm<KnowledgeDocument>();
  const busy = (x?: KnowledgeSource) => x?.status === "syncing" || x?.status === "new";

  const source = useQuery({
    queryKey: ["knowledge-source", s.ws, sourceId],
    queryFn: () => get<KnowledgeSource>(`/v1/knowledge/sources/${sourceId}`),
    refetchInterval: (q) => (busy(q.state.data) ? 2000 : false),
  });
  const documents = useQuery({
    queryKey: ["knowledge-documents", s.ws, sourceId],
    queryFn: () =>
      get<Page<KnowledgeDocument>>(
        `/v1/knowledge/sources/${sourceId}/documents${qs({ limit: 200 })}`,
      ),
    refetchInterval: (q) =>
      busy(source.data) || q.state.data?.items.some((d) => d.status === "pending") ? 2000 : false,
  });
  const invalidate = [
    ["knowledge-source", s.ws, sourceId],
    ["knowledge-documents", s.ws, sourceId],
    ["knowledge-sources", s.ws],
  ];
  const sync = useMutate(() => post(`/v1/knowledge/sources/${sourceId}/sync`), {
    success: "Sync queued",
    invalidate,
  });
  const removeDoc = useMutate((d: KnowledgeDocument) => del(`/v1/knowledge/documents/${d.id}`), {
    success: "Document removed",
    invalidate,
    onSuccess: () => confirmDoc.close(),
  });
  const removeSource = useMutate(() => del(`/v1/knowledge/sources/${sourceId}`), {
    success: "Source deleted",
    invalidate: [["knowledge-sources", s.ws]],
    onSuccess: () => router.push(`/${s.ws}/knowledge`),
  });

  const col = createDataTableColumns<KnowledgeDocument>();
  const columns = useMemo<DataTableColumns<KnowledgeDocument>>(
    () =>
      col.columns([
        col.accessor((d) => d.title ?? d.externalId, {
          id: "title",
          header: "Document",
          size: 320,
          meta: { grow: true },
          cell: ({ row }) => (
            <button
              type="button"
              className="block max-w-full truncate text-left text-ink hover:underline"
              onClick={() => setViewing(row.original)}
            >
              {row.original.title ?? row.original.externalId}
            </button>
          ),
        }),
        col.accessor("status", {
          header: "Status",
          size: 110,
          cell: ({ row }) => (
            <Badge
              tone={documentTone(row.original.status)}
              dot
              className="capitalize"
              {...(row.original.error ? { title: row.original.error } : {})}
            >
              {row.original.status}
            </Badge>
          ),
        }),
        col.accessor("chunkCount", {
          header: "Chunks",
          size: 90,
          meta: { numeric: true, mono: true },
        }),
        col.accessor("updatedAt", {
          header: "Updated",
          size: 130,
          cell: ({ getValue }) => <RelativeTime date={getValue()} />,
        }),
        col.display({
          id: "actions",
          size: 88,
          cell: ({ row }) => (
            <span className="flex justify-end gap-1">
              <IconButton
                size="sm"
                variant="ghost"
                label={`Chunks of ${row.original.title ?? row.original.externalId}`}
                onClick={() => setViewing(row.original)}
              >
                <Layers strokeWidth={1.75} />
              </IconButton>
              {canWrite ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Remove ${row.original.title ?? row.original.externalId}`}
                  onClick={() => confirmDoc.ask(row.original)}
                >
                  <Trash2 strokeWidth={1.75} />
                </IconButton>
              ) : null}
            </span>
          ),
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite],
  );

  const x = source.data;
  return (
    <AppFrame
      crumbs={[
        { label: s.workspaceName },
        { label: "Knowledge", href: `/${s.ws}/knowledge` },
        { label: x?.name ?? "Source" },
      ]}
    >
      <PageBody>
        <QueryView query={source}>
          {(src) => (
            <>
              <PageHeader
                title={src.name}
                description={`${KIND_LABEL[src.kind]} · ${countsLine(src)} · ${
                  src.pipeline.embedding
                    ? `${src.pipeline.embedding.provider}/${src.pipeline.embedding.model}`
                    : "keyword search only"
                }`}
                actions={
                  canWrite ? (
                    <>
                      <Button
                        variant="ghost"
                        leadingIcon={<Trash2 strokeWidth={1.75} />}
                        onClick={() => setDeleting(true)}
                      >
                        Delete
                      </Button>
                      <Button
                        leadingIcon={<RefreshCw strokeWidth={1.75} />}
                        loading={sync.isPending}
                        disabled={src.status === "syncing"}
                        onClick={() => sync.mutate(undefined)}
                      >
                        Sync now
                      </Button>
                      {isUploadKind(src.kind) ? (
                        <Button
                          variant="primary"
                          leadingIcon={<Upload strokeWidth={1.75} />}
                          onClick={() => setUploading(true)}
                        >
                          Add documents
                        </Button>
                      ) : null}
                    </>
                  ) : null
                }
              />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-ink-3">
                <Badge tone={sourceTone(src.status)} dot className="capitalize">
                  {src.status}
                </Badge>
                {src.lastSyncAt ? (
                  <span>
                    Last synced <RelativeTime date={src.lastSyncAt} />
                  </span>
                ) : (
                  <span>Never synced</span>
                )}
                {src.stats.lastRun ? (
                  <span className="font-mono">
                    · {src.stats.lastRun.indexed} indexed, {src.stats.lastRun.unchanged} unchanged,{" "}
                    {src.stats.lastRun.deleted} removed
                    {src.stats.lastRun.failed ? `, ${src.stats.lastRun.failed} failed` : ""}
                  </span>
                ) : null}
              </div>
              {src.lastError ? (
                <div className="mt-3">
                  <Notice tone={src.status === "error" ? "danger" : "warn"}>{src.lastError}</Notice>
                </div>
              ) : null}
              <div className="mt-5 flex flex-col gap-5">
                <Section title={`Documents (${src.documents})`}>
                  <DataTable
                    columns={columns}
                    data={documents.data?.items ?? []}
                    getRowId={(d) => d.id}
                    loading={documents.isPending}
                    error={
                      documents.isError
                        ? {
                            message: errorMessage(documents.error),
                            onRetry: () => void documents.refetch(),
                          }
                        : null
                    }
                    emptyState={
                      <EmptyState
                        size="sm"
                        icon={<FileText strokeWidth={1.5} />}
                        title="No documents yet"
                        description={
                          isUploadKind(src.kind)
                            ? "Add files or paste text; they are chunked and indexed in the background."
                            : "Sync the source to fetch its documents."
                        }
                      />
                    }
                    itemLabel={["document", "documents"]}
                    aria-label="Documents"
                  />
                </Section>
                <Playground source={src} />
              </div>
              <UploadDialog source={src} open={uploading} onOpenChange={setUploading} />
            </>
          )}
        </QueryView>
      </PageBody>
      {viewing ? <ChunksDialog doc={viewing} onClose={() => setViewing(null)} /> : null}
      <ConfirmDialog
        open={confirmDoc.target !== null}
        onOpenChange={(o) => (o ? undefined : confirmDoc.close())}
        title={`Remove ${confirmDoc.target?.title ?? "this document"}?`}
        description="Its chunks leave the index; retrieval stops finding it."
        variant="danger"
        confirmLabel="Remove"
        loading={removeDoc.isPending}
        onConfirm={() => {
          if (confirmDoc.target) removeDoc.mutate(confirmDoc.target);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${x?.name ?? "this source"}?`}
        description="Its documents and chunks are deleted. Workflows that search it will find nothing."
        variant="danger"
        confirmLabel="Delete source"
        loading={removeSource.isPending}
        onConfirm={() => removeSource.mutate(undefined)}
      />
    </AppFrame>
  );
}
