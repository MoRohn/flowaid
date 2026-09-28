"use client";
/**
 * The body of a PageIndex source's page: the service banner, the document manager and the test
 * query panel, sharing one source viewer (outline sections, evidence and citations open it).
 */
import { useState } from "react";
import { DocumentManager, ServiceBanner, usePageIndexDocuments } from "./DocumentManager";
import { readableIndex } from "./model";
import { QueryPanel } from "./QueryPanel";
import { SourceViewer, type ViewerTarget } from "./SourceViewer";

export function PageIndexSource({ sourceId, canWrite }: { sourceId: string; canWrite: boolean }) {
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);
  const documents = usePageIndexDocuments(sourceId);
  return (
    <div className="flex flex-col gap-5">
      <ServiceBanner />
      <DocumentManager sourceId={sourceId} canWrite={canWrite} onOpen={setViewing} />
      <QueryPanel
        sourceId={sourceId}
        documents={(documents.data?.items ?? []).filter((d) => readableIndex(d) !== null)}
        onOpen={setViewing}
      />
      {viewing ? <SourceViewer target={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
