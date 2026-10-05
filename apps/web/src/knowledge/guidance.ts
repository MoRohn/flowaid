/**
 * Guidance for knowledge sources: what each step of the new-source flow still needs, the notes its
 * review shows, and how to read a source's state and its search results. Pure, so the wording is
 * tested against the same rules the API applies (`/v1/knowledge/*`, packages/knowledge).
 */
import { providerName } from "~/admin/providerNames";
import {
  EMPTY_SOURCE,
  badUrls,
  isPageIndexKind,
  isUploadKind,
  parseUrls,
  type KnowledgeSource,
  type SearchMode,
  type SourceForm,
} from "./model";

export interface SourceNote {
  id: string;
  state: "ok" | "blocker" | "warning" | "info";
  message: string;
}

/** What the "where documents come from" step still needs (null when it is done). */
export function originError(f: SourceForm): string | null {
  if (f.kind === "url" && parseUrls(f.urls).length === 0) return "add at least one page URL";
  if (f.kind === "sitemap" && !f.urls.trim()) return "add the sitemap URL";
  if ((f.kind === "url" || f.kind === "sitemap") && badUrls(f.urls).length)
    return "fix the addresses that are not http(s) URLs";
  if (f.kind === "github" && !/^[\w.-]+\/[\w.-]+$/.test(f.repo.trim()))
    return "name the repository as owner/name";
  return null;
}

/** What the chunking step still needs (null when the numbers are usable). */
export function chunkingError(f: SourceForm): string | null {
  if (isPageIndexKind(f.kind)) return null;
  return f.overlapTokens >= f.chunkTokens ? "make the overlap smaller than the chunk size" : null;
}

/** The chunking differs from the defaults every new source starts with. */
export function chunkingChanged(f: SourceForm): boolean {
  return (
    f.strategy !== EMPTY_SOURCE.strategy ||
    f.chunkTokens !== EMPTY_SOURCE.chunkTokens ||
    f.overlapTokens !== EMPTY_SOURCE.overlapTokens
  );
}

export const STRATEGY_LABEL: Record<SourceForm["strategy"], string> = {
  recursive: "By paragraph",
  markdown: "By Markdown heading",
  fixed: "Fixed windows",
};

/**
 * The review's notes for a draft. `embedding` is the chosen model (null: keywords only) and
 * whether this workspace can call it; `indexReady` is the same for a PageIndex indexing model.
 */
export function sourceReviewNotes(
  f: SourceForm,
  ctx: {
    embedding: { provider: string; model: string; ready: boolean } | null;
    indexReady: boolean;
    /** a saved source's Settings: what saving the changes does to its documents */
    editing?: { documents: number; reindex: boolean; refetch: boolean; changed: boolean };
  },
): SourceNote[] {
  const notes: SourceNote[] = [];
  const next = (createMessage: string): SourceNote => {
    const e = ctx.editing;
    if (!e) return { id: "next", state: "info", message: createMessage };
    const n = `${e.documents} document${e.documents === 1 ? "" : "s"}`;
    return {
      id: "next",
      state: "info",
      message: !e.changed
        ? "Nothing changed yet."
        : e.reindex
          ? `Saving indexes its ${n} again with the new settings, in the background.`
          : e.refetch
            ? "Saving fetches its documents again from the new addresses."
            : "Saving changes nothing in its index.",
    };
  };
  const origin = originError(f);
  if (!f.name.trim())
    notes.push({ id: "name", state: "blocker", message: "Give the source a name" });
  if (origin) notes.push({ id: "origin", state: "blocker", message: capitalise(origin) });

  if (isPageIndexKind(f.kind)) {
    if (!f.indexModel.trim())
      notes.push({ id: "index-model", state: "blocker", message: "Name the indexing model" });
    if (!ctx.indexReady)
      notes.push({
        id: "index-key",
        state: "warning",
        message: `${providerName(f.indexProvider)} has no key on the server and no credential is chosen: the source can be ${ctx.editing ? "saved" : "created"}, but every PDF fails to index until one is added.`,
      });
    notes.push({
      id: "pageindex-settings",
      state: "info",
      message:
        "PageIndex builds a section tree for each PDF, so the search and chunking settings are not used and are not saved.",
    });
    notes.push(
      ctx.editing
        ? {
            id: "next",
            state: "info",
            message: ctx.editing.changed
              ? "New indexing settings apply to the PDFs uploaded from now on; the ones indexed already keep their index."
              : "Nothing changed yet.",
          }
        : next("PDFs are uploaded on the source's page after it is created."),
    );
    return notes;
  }

  const chunking = chunkingError(f);
  if (chunking) notes.push({ id: "chunking", state: "blocker", message: capitalise(chunking) });
  if (!ctx.embedding)
    notes.push({
      id: "keyword-only",
      state: "info",
      message:
        "Keywords only: a search finds passages that use its words, so a question worded differently from the documents can find nothing. Retrieve steps and Semantic searches need an embedding model and fail on this source.",
    });
  else if (!ctx.embedding.ready)
    notes.push({
      id: "embedding-key",
      state: "warning",
      message: `${providerName(ctx.embedding.provider)} has no key in this workspace: the source can be ${ctx.editing ? "saved" : "created"}, but every document fails to index until a key is added under Credentials.`,
    });
  else
    notes.push({
      id: "embedding",
      state: "ok",
      message: `Meaning search with ${providerName(ctx.embedding.provider)} · ${ctx.embedding.model}. Every chunk is embedded when it is indexed, and every search query too; the provider bills those calls.`,
    });
  notes.push(
    next(
      isUploadKind(f.kind)
        ? "Documents are added on the source's page after it is created."
        : "Creating it starts the first sync: pages are fetched, chunked and indexed in the background.",
    ),
  );
  if (f.kind === "sitemap" && parseUrls(f.include).length === 0)
    notes.push({
      id: "sitemap-all",
      state: "info",
      message:
        "Every page in the sitemap is fetched. On a large site, limit it with Only pages under.",
    });
  if (f.kind === "github" && !f.credentialId)
    notes.push({
      id: "github-public",
      state: "info",
      message: "No token: this works for public repositories only.",
    });
  return notes;
}

/** One line saying what a source's status means and what to do about it. */
export function sourceStatusHelp(
  src: Pick<KnowledgeSource, "kind" | "status" | "documents" | "stats" | "lastError">,
): string {
  const failed = src.stats.lastRun?.failed ?? 0;
  // the failed documents may have been removed since: point at the table only while it has rows
  const failedNote =
    failed && src.documents > 0
      ? ` ${failed} document${failed === 1 ? "" : "s"} failed on the last sync: the Error badge in the table gives each reason.`
      : "";
  if (src.status === "error" && isUploadKind(src.kind) && src.documents === 0)
    return "Indexing failed and no document is left: add documents again once the cause below is fixed.";
  switch (src.status) {
    case "new":
      return isUploadKind(src.kind) && src.documents === 0
        ? "Nothing to search yet: add documents and they are indexed in the background."
        : "Waiting for its first sync.";
    case "syncing":
      return "Fetching, chunking and indexing in the background. This page refreshes by itself.";
    case "ready":
      return `Everything that synced is searchable.${failedNote}`;
    case "stale":
      return "Its settings or documents changed since the last sync: sync it to index them again.";
    case "error":
      return `The last sync failed${src.lastError ? "; the reason and a retry are below" : ""}.${failedNote}`;
  }
}

/** How to read the scores of a test search in a given mode. */
export function scoreReading(mode: SearchMode): string {
  const rank =
    "Scores only order the hits within this search: they do not say whether a passage answers the question. Read the text.";
  switch (mode) {
    case "hybrid":
      return `Hybrid scores come from fusing the meaning and keyword rankings, so they are small numbers by design (at most about 0.033). ${rank}`;
    case "vector":
      return `Semantic scores are the similarity between the query and each passage. ${rank}`;
    case "keyword":
      return `Keyword scores rank how well a passage matches the query's words; passages without them are not found. ${rank}`;
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
