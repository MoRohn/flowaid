import { describe, expect, it } from "vitest";
import {
  chunkingChanged,
  chunkingError,
  originError,
  scoreReading,
  sourceReviewNotes,
  sourceStatusHelp,
} from "./guidance";
import { EMPTY_SOURCE, badUrls, sourceFormError, type SourceForm } from "./model";

const form = (over: Partial<SourceForm> = {}): SourceForm => ({
  ...EMPTY_SOURCE,
  name: "Help center",
  ...over,
});
const ids = (notes: { id: string; state: string }[]) => notes.map((n) => `${n.id}:${n.state}`);
const ready = { provider: "openai", model: "text-embedding-3-small", ready: true };

describe("originError", () => {
  it("asks for what each kind of source loads from", () => {
    expect(originError(form())).toBeNull();
    expect(originError(form({ kind: "url", urls: " \n " }))).toBe("add at least one page URL");
    expect(originError(form({ kind: "url", urls: "https://a.example" }))).toBeNull();
    expect(originError(form({ kind: "sitemap" }))).toBe("add the sitemap URL");
    expect(originError(form({ kind: "github", repo: "acme" }))).toBe(
      "name the repository as owner/name",
    );
    expect(originError(form({ kind: "github", repo: "acme/docs" }))).toBeNull();
  });
});

describe("chunking", () => {
  it("needs the overlap below the chunk size, except for PageIndex", () => {
    expect(chunkingError(form({ chunkTokens: 100, overlapTokens: 100 }))).toMatch(/overlap/);
    expect(chunkingError(form({ kind: "pageindex", chunkTokens: 100, overlapTokens: 100 }))).toBe(
      null,
    );
    expect(chunkingChanged(form())).toBe(false);
    expect(chunkingChanged(form({ strategy: "markdown" }))).toBe(true);
  });
});

describe("sourceReviewNotes", () => {
  it("says what saving a saved source's settings does to its documents", () => {
    const next = (editing: { reindex: boolean; refetch: boolean; changed: boolean }) =>
      sourceReviewNotes(form(), {
        embedding: ready,
        indexReady: true,
        editing: { documents: 3, ...editing },
      }).find((n) => n.id === "next")?.message;
    expect(next({ reindex: true, refetch: false, changed: true })).toBe(
      "Saving indexes its 3 documents again with the new settings, in the background.",
    );
    expect(next({ reindex: false, refetch: false, changed: false })).toBe("Nothing changed yet.");
  });

  it("says what a keyword-only source cannot do", () => {
    const notes = sourceReviewNotes(form(), { embedding: null, indexReady: true });
    expect(ids(notes)).toEqual(["keyword-only:info", "next:info"]);
    expect(notes[0]?.message).toMatch(/Retrieve steps and Semantic searches/);
  });

  it("warns when the embedding model has no key, and says who bills a ready one", () => {
    expect(
      ids(sourceReviewNotes(form(), { embedding: { ...ready, ready: false }, indexReady: true })),
    ).toContain("embedding-key:warning");
    const ok = sourceReviewNotes(form(), { embedding: ready, indexReady: true });
    expect(ok[0]).toMatchObject({ id: "embedding", state: "ok" });
    expect(ok[0]?.message).toMatch(/provider bills/);
  });

  it("blocks on a missing name, origin or bad chunking", () => {
    const notes = sourceReviewNotes(
      form({ name: " ", kind: "url", chunkTokens: 50, overlapTokens: 60 }),
      { embedding: ready, indexReady: true },
    );
    expect(notes.filter((n) => n.state === "blocker").map((n) => n.id)).toEqual([
      "name",
      "origin",
      "chunking",
    ]);
  });

  it("explains that PageIndex drops the search and chunking settings", () => {
    const notes = sourceReviewNotes(form({ kind: "pageindex" }), {
      embedding: ready,
      indexReady: false,
    });
    expect(ids(notes)).toEqual(["index-key:warning", "pageindex-settings:info", "next:info"]);
  });

  it("notes a whole sitemap and a public repository", () => {
    expect(
      ids(
        sourceReviewNotes(form({ kind: "sitemap", urls: "https://a/sitemap.xml" }), {
          embedding: ready,
          indexReady: true,
        }),
      ),
    ).toContain("sitemap-all:info");
    expect(
      ids(
        sourceReviewNotes(form({ kind: "github", repo: "a/b" }), {
          embedding: ready,
          indexReady: true,
        }),
      ),
    ).toContain("github-public:info");
  });
});

describe("sourceStatusHelp", () => {
  const src = {
    kind: "files" as const,
    status: "ready" as const,
    documents: 3,
    stats: {},
    lastError: null,
  };
  it("reads each status, pointing at failed documents", () => {
    expect(sourceStatusHelp({ ...src, status: "new", documents: 0 })).toMatch(/add documents/);
    expect(sourceStatusHelp({ ...src, kind: "url", status: "new" })).toMatch(/first sync/);
    expect(
      sourceStatusHelp({
        ...src,
        stats: { lastRun: { indexed: 2, unchanged: 0, deleted: 0, failed: 1 } },
      }),
    ).toMatch(/1 document failed/);
    expect(sourceStatusHelp({ ...src, status: "error", lastError: "401" })).toMatch(/retry/);
  });

  it("does not point at the table's badges once the failed documents are gone", () => {
    const failed = { lastRun: { indexed: 0, unchanged: 0, deleted: 0, failed: 1 } };
    const help = sourceStatusHelp({
      ...src,
      kind: "text",
      status: "error",
      documents: 0,
      stats: failed,
      lastError: "no key",
    });
    expect(help).not.toMatch(/Error badge in the table/);
    expect(help).toMatch(/no document is left/);
  });
});

describe("scoreReading", () => {
  it("never presents a score as correctness", () => {
    for (const mode of ["hybrid", "vector", "keyword"] as const)
      expect(scoreReading(mode)).toMatch(/do not say whether a passage answers/);
    expect(scoreReading("hybrid")).toMatch(/0\.033/);
  });
});

describe("page addresses", () => {
  it("rejects lines that are not http(s) URLs, in the step and the form", () => {
    const f = {
      ...EMPTY_SOURCE,
      name: "Docs",
      kind: "url" as const,
      urls: "not a url\nftp://x\nhttps://ok.example",
    };
    expect(badUrls(f.urls)).toEqual(["not a url", "ftp://x"]);
    expect(originError(f)).toBe("fix the addresses that are not http(s) URLs");
    expect(sourceFormError(f)).toMatch(/^Not a web address/);
    expect(originError({ ...f, urls: "https://ok.example" })).toBeNull();
  });
});
