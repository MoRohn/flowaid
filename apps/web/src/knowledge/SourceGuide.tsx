"use client";
/**
 * "Using this source" on a knowledge source's page: how its documents arrive, how to tell they are
 * indexed, how to test it and where it is used. Open while the source is empty, one line once it
 * has documents; the reader's choice is remembered per browser.
 */
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Compass } from "lucide-react";
import { Button } from "@flowaid/ui/primitives";
import { usePref } from "~/guide/storage";
import { isPageIndexKind, isUploadKind, type KnowledgeSource } from "./model";

export function SourceGuide({ source }: { source: Pick<KnowledgeSource, "kind" | "documents"> }) {
  const [pref, setPref] = usePref("flowaid:intro:knowledge-source", "");
  const open = pref === "" ? source.documents === 0 : pref === "shown";
  const items = itemsFor(source);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setPref("shown")}
        aria-expanded={false}
        className="inline-flex items-center gap-1.5 self-start rounded-xs text-xs font-medium text-ink-2 hover:text-ink focus-visible:shadow-(--focus) focus-visible:outline-none"
      >
        <ChevronRight className="size-3.5 text-ink-3" strokeWidth={1.75} aria-hidden />
        <Compass className="size-3.5 text-accent-text" strokeWidth={1.75} aria-hidden />
        Using this source
      </button>
    );

  return (
    <section
      aria-labelledby="source-guide"
      className="rounded-md border border-border bg-surface shadow-1"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Compass className="size-4 text-accent-text" strokeWidth={1.75} aria-hidden />
        <h2 id="source-guide" className="m-0 flex-1 text-sm font-semibold text-ink">
          Using this source
        </h2>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<ChevronDown strokeWidth={1.75} />}
          aria-expanded
          onClick={() => setPref("hidden")}
        >
          Hide
        </Button>
      </div>
      <ol className="m-0 grid list-none gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
        {items.map((it, i) => (
          <li key={it.title} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-mono text-2xs text-ink-3 tabular"
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-ink">{it.title}</span>
              <span className="block text-xs text-ink-2">{it.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function itemsFor(source: Pick<KnowledgeSource, "kind">): { title: string; body: ReactNode }[] {
  if (isPageIndexKind(source.kind))
    return [
      {
        title: "Upload PDFs",
        body: "Each PDF is indexed into a tree of sections by the source's indexing model. Uploading a new version of a document keeps the old index answering until the new one is ready.",
      },
      {
        title: "Check the index",
        body: "A document's state shows whether its index is ready or failed. Open its outline to see the sections the model found.",
      },
      {
        title: "Try a question",
        body: "Shows the sections a retrieval step would navigate to, with their pages. Ask for an answer too and it is written by a model: open the cited pages to check it.",
      },
      {
        title: "Use it in a workflow",
        body: "Add a PageIndex: Retrieve evidence step and pick this source. PageIndex: Check citations can then test whether an answer is supported.",
      },
    ];
  const upload = isUploadKind(source.kind);
  return [
    upload
      ? {
          title: "Add documents",
          body: "Text, Markdown, HTML or JSON, up to 100 files at a time, or paste one. Each is chunked and indexed in the background; a document with the same name replaces the earlier one.",
        }
      : {
          title: "Keep it current",
          body: "Sync now fetches the documents again and indexes only what changed. Pages that no longer exist are removed from the index.",
        },
    {
      title: "Check what is indexed",
      body: "Each document shows Indexed, Pending or Error; point at an Error badge for the reason. The chunks button shows exactly how a document was split.",
    },
    {
      title: "Try a search",
      body: "Ask what people really ask. The hits are what a retrieval step would receive; if the right passage is missing or cut off, the content or the chunking needs work.",
    },
    {
      title: "Use it in a workflow",
      body: "Add a Knowledge base step (a cited context block ready for a prompt) or a Hybrid search step (the hits themselves) and pick this source.",
    },
  ];
}
