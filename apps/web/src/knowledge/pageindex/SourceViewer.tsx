"use client";
/**
 * The source viewer: one stored PDF version in the browser's own PDF viewer, opened at a physical
 * page (`#page=N`). The file is fetched with the session's headers (the workspace travels as a
 * header an iframe could not send) and shown from a local object URL. Page numbers are positions
 * in the file; printed page labels are never invented.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@flowaid/ui/primitives";
import { api, currentWorkspace } from "~/api/client";
import { ErrorPanel } from "~/shell/states";
import { filePath, pageFragment } from "./model";

export interface ViewerTarget {
  documentId: string;
  versionId: string;
  displayName: string;
  version: number;
  /** physical, 1-based page */
  page: number;
}

/** An object URL for a blob, revoked when the blob changes or the component unmounts. */
function useObjectUrl(blob: Blob | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

export function SourceViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const path = filePath(target.documentId, target.versionId);
  const file = useQuery({
    queryKey: ["pageindex-file", currentWorkspace(), target.documentId, target.versionId],
    queryFn: async () => (await api<Response>("GET", path, { raw: true })).blob(),
    staleTime: Infinity,
    gcTime: 0,
  });
  const url = useObjectUrl(file.data);
  const fragment = pageFragment(target.page);
  const where = `${target.displayName}, version ${target.version}, page ${target.page} of the file`;

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{target.displayName}</DialogTitle>
          <DialogDescription>
            Version {target.version} · Page {target.page} of the file
            {url ? (
              <>
                {" · "}
                <a
                  href={`${url}${fragment}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent-text hover:underline"
                >
                  Open in new tab
                  <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden="true" />
                </a>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {file.isError ? (
            <ErrorPanel error={file.error} onRetry={() => void file.refetch()} />
          ) : url ? (
            <iframe
              key={`${url}${fragment}`}
              src={`${url}${fragment}`}
              title={where}
              className="h-[70vh] w-full rounded-md border border-border bg-surface-2"
            />
          ) : (
            <Skeleton className="h-[70vh] w-full" aria-label="Loading the PDF" />
          )}
          <p className="mt-2 text-2xs text-ink-3">
            Pages are counted from the start of the file, which may differ from the numbers printed
            on them.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
