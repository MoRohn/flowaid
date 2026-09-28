"use client";
/**
 * PDF uploads into a PageIndex source: each picked or dropped file is checked here (type, 50 MiB),
 * then sent as the raw request body one after another. Every file keeps its own line: waiting,
 * uploading, uploaded (indexing queued), already uploaded, or why it was refused.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { FileUp, X } from "lucide-react";
import { Button, IconButton, Spinner } from "@flowaid/ui/primitives";
import { ApiError, currentWorkspace, upload } from "~/api/client";
import { errorMessage } from "~/shell/states";
import { formatBytes, pdfFileError, uploadErrorMessage, type UploadResult } from "./model";

export type UploadState = "waiting" | "uploading" | "uploaded" | "existing" | "failed";

export interface UploadItem {
  key: number;
  name: string;
  bytes: number;
  state: UploadState;
  /** what happened, for `failed` (and the new version for a version upload) */
  message: string | null;
  /** a new version of this document */
  documentId: string | null;
}

let nextKey = 1;

export function useUploads(sourceId: string) {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const patch = (key: number, p: Partial<UploadItem>) =>
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const add = useCallback(
    (files: readonly File[], documentId: string | null = null) => {
      const fresh = files.map((f) => {
        const problem = pdfFileError(f);
        return {
          file: f,
          item: {
            key: nextKey++,
            name: f.name,
            bytes: f.size,
            state: problem ? "failed" : "waiting",
            message: problem,
            documentId,
          } satisfies UploadItem,
        };
      });
      setItems((all) => [...fresh.map((x) => x.item), ...all]);
      for (const { file, item } of fresh) {
        if (item.state === "failed") continue;
        queue.current = queue.current.then(async () => {
          patch(item.key, { state: "uploading" });
          try {
            const q = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
            const r = await upload<UploadResult>(
              `/v1/pageindex/sources/${encodeURIComponent(sourceId)}/documents${q}`,
              file,
              { contentType: "application/pdf", fileName: file.name },
            );
            patch(item.key, {
              state: r.created ? "uploaded" : "existing",
              message: documentId && r.created ? `Version ${r.version.version}` : null,
            });
          } catch (error) {
            patch(item.key, {
              state: "failed",
              message:
                error instanceof ApiError
                  ? uploadErrorMessage(error.status, error.code, error.message)
                  : errorMessage(error),
            });
          }
          await qc.invalidateQueries({
            queryKey: ["pageindex-documents", currentWorkspace(), sourceId],
          });
        });
      }
    },
    [qc, sourceId],
  );
  const dismiss = (key: number) => setItems((all) => all.filter((i) => i.key !== key));
  const clearDone = () =>
    setItems((all) => all.filter((i) => i.state === "waiting" || i.state === "uploading"));
  return { items, add, dismiss, clearDone };
}

const STATE_TEXT: Record<UploadState, string> = {
  waiting: "Waiting",
  uploading: "Uploading…",
  uploaded: "Uploaded; indexing queued",
  existing: "Already uploaded (same file)",
  failed: "Not uploaded",
};

export function UploadList({
  items,
  onDismiss,
  onClear,
}: {
  items: readonly UploadItem[];
  onDismiss: (key: number) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const settled = items.some((i) => i.state !== "waiting" && i.state !== "uploading");
  return (
    <div className="flex flex-col gap-1.5">
      <ul aria-label="Uploads" aria-live="polite" className="flex flex-col gap-1">
        {items.map((i) => (
          <li
            key={i.key}
            className="flex items-start gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
          >
            {i.state === "uploading" ? (
              <Spinner size="xs" className="mt-0.5" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 flex-1">
              <span className="font-medium text-ink">{i.name}</span>{" "}
              <span className="font-mono text-2xs text-ink-3">{formatBytes(i.bytes)}</span>
              <p className={i.state === "failed" ? "text-danger-text" : "text-ink-3"}>
                {STATE_TEXT[i.state]}
                {i.documentId && i.state !== "failed" ? " as a new version" : ""}
                {i.message ? `: ${i.message}` : ""}
              </p>
            </div>
            {i.state === "waiting" || i.state === "uploading" ? null : (
              <IconButton
                size="sm"
                variant="ghost"
                label={`Dismiss ${i.name}`}
                onClick={() => onDismiss(i.key)}
              >
                <X strokeWidth={1.75} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {settled ? (
        <button
          type="button"
          className="self-start text-2xs text-ink-3 hover:text-ink hover:underline"
          onClick={onClear}
        >
          Clear finished
        </button>
      ) : null}
    </div>
  );
}

/** A drop zone with a "Choose PDFs" button (the keyboard path); dropping anything is checked. */
export function PdfDropZone({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  };
  return (
    <div
      role="group"
      aria-label="Upload PDFs"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-wrap items-center gap-3 rounded-md border border-dashed px-4 py-3 text-xs text-ink-3 transition-colors duration-(--dur-fast) motion-reduce:transition-none ${
        over ? "border-accent bg-accent-soft" : "border-border-strong"
      }`}
    >
      <Button
        type="button"
        leadingIcon={<FileUp strokeWidth={1.75} />}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Choose PDFs
      </Button>
      <span>or drop them here. PDFs with a text layer, up to 50 MiB each.</span>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        aria-label="PDF files"
        tabIndex={-1}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
