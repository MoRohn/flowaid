"use client";
/**
 * An index's outline: the document's section tree with page spans and summaries. Every section
 * opens the source viewer at its first page.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@flowaid/ui/primitives";
import { get, currentWorkspace } from "~/api/client";
import { QueryView } from "~/admin/ui";
import { pageSpan, type IndexReference, type OutlineNode } from "./model";

function Section({
  node,
  depth,
  onOpenPage,
}: {
  node: OutlineNode;
  depth: number;
  onOpenPage: (page: number) => void;
}) {
  const children = node.children ?? [];
  const [open, setOpen] = useState(depth === 0);
  const regionId = `outline-${node.nodeId}`;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-start gap-1.5">
        {children.length ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={regionId}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.title}`}
            onClick={() => setOpen(!open)}
            className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-xs text-ink-3 hover:bg-surface-3 hover:text-ink"
          >
            <ChevronRight
              className={`size-3.5 transition-transform duration-(--dur-fast) motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-ink">{node.title}</span>
            <span className="font-mono text-2xs text-ink-3">
              {pageSpan(node.startPage, node.endPage)}
            </span>
            <button
              type="button"
              className="text-2xs text-accent-text hover:underline"
              onClick={() => onOpenPage(node.startPage)}
              aria-label={`Open page ${node.startPage}: ${node.title}`}
            >
              Open page {node.startPage}
            </button>
          </div>
          {node.summary ? <p className="mt-0.5 text-xs text-ink-2">{node.summary}</p> : null}
        </div>
      </div>
      {children.length && open ? (
        <ul id={regionId} className="ml-3 flex flex-col gap-2 border-l border-border pl-3">
          {children.map((c) => (
            <Section key={c.nodeId} node={c} depth={depth + 1} onOpenPage={onOpenPage} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OutlineTree({
  outline,
  onOpenPage,
}: {
  outline: readonly OutlineNode[];
  onOpenPage: (page: number) => void;
}) {
  if (outline.length === 0)
    return <p className="text-xs text-ink-3">The index found no sections in this document.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Sections">
      {outline.map((n) => (
        <Section key={n.nodeId} node={n} depth={0} onOpenPage={onOpenPage} />
      ))}
    </ul>
  );
}

export function OutlineDialog({
  index,
  onOpenPage,
  onClose,
}: {
  index: IndexReference;
  onOpenPage: (page: number) => void;
  onClose: () => void;
}) {
  const outline = useQuery({
    queryKey: ["pageindex-outline", currentWorkspace(), index.indexId],
    queryFn: () =>
      get<{ outline: OutlineNode[] }>(
        `/v1/pageindex/indexes/${encodeURIComponent(index.indexId)}/outline`,
      ),
    staleTime: 60_000,
  });
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Outline of {index.displayName}</DialogTitle>
          <DialogDescription>
            Version {index.documentVersion} · index #{index.indexVersion}
            {index.indexModel ? ` · summaries by ${index.indexModel}` : ""}. Pages are positions in
            the file.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] overflow-y-auto">
          <QueryView query={outline} rows={5}>
            {(r) => <OutlineTree outline={r.outline} onOpenPage={onOpenPage} />}
          </QueryView>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
