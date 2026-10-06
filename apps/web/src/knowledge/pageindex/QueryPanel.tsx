"use client";
/**
 * Try a question against the source: what a PageIndex retrieval node would get (the evidence, with
 * its section path and pages, and how retrieval went), and optionally a grounded answer whose
 * citation markers open the cited page.
 */
import { useState } from "react";
import { MessageSquareText, Search } from "lucide-react";
import { Badge, Button, Checkbox, FieldRow, Textarea } from "@flowaid/ui/primitives";
import { post } from "~/api/client";
import { Notice, Section, useMutate } from "~/admin/ui";
import {
  MODEL_DISCLOSURE,
  pageSpan,
  splitAnswer,
  type DocumentSummary,
  type Evidence,
  type GroundedAnswer,
  type QueryResponse,
  type RetrievalResult,
} from "./model";
import type { ViewerTarget } from "./SourceViewer";

const ANSWER_TONE: Record<GroundedAnswer["status"], "ok" | "warn" | "danger"> = {
  sufficient: "ok",
  partial: "warn",
  insufficient: "danger",
};

const RETRIEVAL_TONE: Record<RetrievalResult["status"], "ok" | "warn" | "neutral"> = {
  complete: "ok",
  partial: "warn",
  empty: "neutral",
};

const toTarget = (e: Evidence, page: number): ViewerTarget => ({
  documentId: e.documentId,
  versionId: e.versionId,
  displayName: e.displayName,
  version: e.documentVersion,
  page,
});

function Activity({ r, model }: { r: RetrievalResult; model: QueryResponse["model"] }) {
  const a = r.activity;
  const stats: [string, string][] = [
    ["Documents", String(a.documents)],
    ["Sections inspected", String(a.sectionsInspected)],
    ["Pages read", String(a.pagesRead)],
    ["Decisions", String(a.decisions)],
    ["Elapsed", `${(a.elapsedMs / 1000).toFixed(1)} s`],
    ["Cost", `$${r.costUsd.toFixed(4)}`],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
        <Badge tone={RETRIEVAL_TONE[r.status]} dot className="capitalize">
          Retrieval {r.status}
        </Badge>
        {model ? (
          <span className="font-mono">
            answer by {model.provider}/{model.model}
          </span>
        ) : null}
      </div>
      <dl
        aria-label="Retrieval activity"
        className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-6"
      >
        {stats.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-2xs text-ink-3">{k}</dt>
            <dd className="font-mono text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {r.warnings.length ? (
        <Notice tone="warn">
          <ul className="list-disc pl-4">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}

function EvidenceCard({ e, onOpen }: { e: Evidence; onOpen: (t: ViewerTarget) => void }) {
  const { page, endPage } = e.locator;
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">
        <Badge tone="accent" mono>
          {e.id}
        </Badge>
        <span className="font-medium text-ink">{e.displayName}</span>
        <span>
          · v{e.documentVersion} · index #{e.indexVersion}
        </span>
        <button
          type="button"
          className="ml-auto text-accent-text hover:underline"
          onClick={() => onOpen(toTarget(e, page))}
          aria-label={`Open page ${page} of ${e.displayName} (${e.id})`}
        >
          {pageSpan(page, endPage)} · Open page {page}
        </button>
      </div>
      {e.sectionPath.length ? (
        <p className="text-xs text-ink-2">{e.sectionPath.join(" › ")}</p>
      ) : null}
      <p className="whitespace-pre-wrap text-xs text-ink-2">{e.excerpt}</p>
      <div className="flex flex-wrap gap-x-3 text-2xs text-ink-3">
        {e.truncated ? <span>Excerpt cut to the evidence budget</span> : null}
        <span>
          Chosen by tree navigation
          {e.provenance.confidence !== null
            ? ` · confidence ${e.provenance.confidence.toFixed(2)}`
            : ""}
          {e.provenance.provider ? ` · ${e.provenance.provider}` : ""}
        </span>
      </div>
    </li>
  );
}

function Answer({
  answer,
  evidence,
  onOpen,
}: {
  answer: GroundedAnswer;
  evidence: readonly Evidence[];
  onOpen: (t: ViewerTarget) => void;
}) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const open = (i: number) => {
    const c = answer.citations[i];
    const e = c ? byId.get(c.evidenceId) : undefined;
    if (c && e) onOpen({ ...toTarget(e, c.page), versionId: c.versionId });
  };
  return (
    <section
      aria-label="Answer"
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ANSWER_TONE[answer.status]} dot className="capitalize">
          {answer.status}
        </Badge>
        <span className="text-2xs text-ink-3">{MODEL_DISCLOSURE}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-ink">
        {splitAnswer(answer.answer, answer.citations).map((part, k) => {
          if ("text" in part) return <span key={k}>{part.text}</span>;
          const c = answer.citations[part.citation];
          if (!c) return null;
          const e = byId.get(c.evidenceId);
          return (
            <button
              key={k}
              type="button"
              onClick={() => open(part.citation)}
              disabled={!e}
              aria-label={`Citation ${c.marker}: open page ${c.page}${e ? ` of ${e.displayName}` : ""}`}
              className={`mx-0.5 rounded-xs px-1 font-mono text-2xs ${
                c.supported === false
                  ? "bg-danger-soft text-danger-text"
                  : "bg-accent-soft text-accent-text"
              } hover:underline`}
            >
              {c.marker}
            </button>
          );
        })}
      </p>
      {answer.citations.length ? (
        <ul aria-label="Citations" className="flex flex-col gap-1 text-xs">
          {answer.citations.map((c, i) => {
            const e = byId.get(c.evidenceId);
            return (
              <li key={`${c.marker}-${i}`} className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-ink">{c.marker}</span>
                <span className="text-ink-2">
                  {e?.displayName ?? c.evidenceId}, page {c.page}
                </span>
                {c.supported === true ? (
                  <Badge tone="ok">
                    Supported
                    {c.support ? ` · ${c.support.method} ${c.support.score.toFixed(2)}` : ""}
                  </Badge>
                ) : c.supported === false ? (
                  <Badge tone="danger">
                    Unsupported
                    {c.support ? ` · ${c.support.method} ${c.support.score.toFixed(2)}` : ""}
                  </Badge>
                ) : (
                  <Badge tone="outline">Not checked</Badge>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {answer.limitations.length ? (
        <div className="text-xs text-ink-2">
          <p className="font-medium text-ink">Limitations</p>
          <ul className="list-disc pl-4">
            {answer.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function QueryPanel({
  sourceId,
  documents,
  off = false,
  onOpen,
}: {
  sourceId: string;
  documents: readonly DocumentSummary[];
  /** the service is turned off: nothing can be asked */
  off?: boolean;
  onOpen: (t: ViewerTarget) => void;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const run = useMutate(
    (answer: boolean) =>
      post<QueryResponse>("/v1/pageindex/query", {
        query: text.trim(),
        scope: picked.size ? { documentIds: [...picked] } : { sourceIds: [sourceId] },
        answer,
      }),
    { errorTitle: "Retrieval failed" },
  );
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const r = run.data;
  const can = !off && text.trim().length > 0 && documents.length > 0 && !run.isPending;

  return (
    <Section
      title="Try a question"
      description="What a PageIndex retrieval node would get: the sections it navigates to, with their pages."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (can) run.mutate(false);
        }}
      >
        <FieldRow label="Question" htmlFor="pq-question">
          <Textarea
            id="pq-question"
            rows={2}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            placeholder="What is the notice period for terminating the contract?"
          />
        </FieldRow>
        {documents.length > 1 ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-ink-2">
              Search in {picked.size ? `${picked.size} selected` : "every document of this source"}
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {documents.map((d) => (
                <Checkbox
                  key={d.documentId}
                  size="sm"
                  label={d.title}
                  checked={picked.has(d.documentId)}
                  onCheckedChange={(v) => toggle(d.documentId, v === true)}
                />
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            leadingIcon={<Search strokeWidth={1.75} />}
            loading={run.isPending && run.variables === false}
            disabled={!can}
          >
            Retrieve
          </Button>
          <Button
            type="button"
            variant="primary"
            leadingIcon={<MessageSquareText strokeWidth={1.75} />}
            loading={run.isPending && run.variables === true}
            disabled={!can}
            onClick={() => run.mutate(true)}
          >
            Retrieve and answer
          </Button>
        </div>
        {off ? (
          <p className="text-xs text-ink-3">Questions can be asked once PageIndex is on.</p>
        ) : documents.length === 0 ? (
          <p className="text-xs text-ink-3">No document is indexed yet.</p>
        ) : null}
      </form>
      <div aria-live="polite" className="mt-4 flex flex-col gap-3 empty:hidden">
        {r ? (
          <>
            <Activity r={r.retrieval} model={r.model} />
            {r.answer ? (
              <Answer answer={r.answer} evidence={r.retrieval.evidence} onOpen={onOpen} />
            ) : null}
            {r.retrieval.evidence.length === 0 ? (
              <p className="text-xs text-ink-3">No section of these documents matched.</p>
            ) : (
              <ol aria-label="Evidence" className="flex flex-col gap-2">
                {r.retrieval.evidence.map((e) => (
                  <EvidenceCard key={e.id} e={e} onOpen={onOpen} />
                ))}
              </ol>
            )}
          </>
        ) : null}
      </div>
    </Section>
  );
}
