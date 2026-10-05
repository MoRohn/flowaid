import { describe, expect, it } from "vitest";
import {
  EMPTY_SOURCE,
  countsLine,
  mimeOf,
  parseUrls,
  sourceBody,
  sourceFormError,
  sourceTone,
  embeddingOptions,
  formOf,
  indexingErrorFix,
  sourcePatch,
  type KnowledgeSource,
} from "./model";

describe("knowledge source form", () => {
  it("validates by kind", () => {
    expect(sourceFormError(EMPTY_SOURCE)).toBe("Give the source a name");
    const named = { ...EMPTY_SOURCE, name: "Docs" };
    expect(sourceFormError(named)).toBeNull();
    expect(sourceFormError({ ...named, kind: "url" })).toBe("Add at least one URL");
    expect(sourceFormError({ ...named, kind: "github", repo: "acme" })).toMatch(/owner\/name/);
    expect(sourceFormError({ ...named, overlapTokens: 400 })).toMatch(/Overlap/);
  });

  it("builds the create body with loader config and pipeline", () => {
    expect(
      sourceBody({
        ...EMPTY_SOURCE,
        name: " Site ",
        kind: "url",
        urls: "https://a.dev/x\n\n https://a.dev/y ",
      }),
    ).toMatchObject({
      name: "Site",
      kind: "url",
      config: { urls: ["https://a.dev/x", "https://a.dev/y"] },
      pipeline: {
        chunker: { strategy: "recursive", chunkTokens: 400, overlapTokens: 60 },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
      },
    });
    const gh = sourceBody({
      ...EMPTY_SOURCE,
      name: "Repo",
      kind: "github",
      repo: "acme/app",
      path: "docs",
      embeddingProvider: "",
      credentialId: "c1",
    });
    expect(gh).toMatchObject({
      config: { repo: "acme/app", path: "docs" },
      pipeline: { embedding: null },
      credentialId: "c1",
    });
    expect(gh.config).not.toHaveProperty("ref");
  });

  it("parses URLs, guesses MIME types and labels counts and statuses", () => {
    expect(parseUrls(" a \n\nb")).toEqual(["a", "b"]);
    expect(mimeOf("README.md")).toBe("text/markdown");
    expect(mimeOf("page.HTML")).toBe("text/html");
    expect(mimeOf("notes")).toBe("text/plain");
    expect(sourceTone("error")).toBe("danger");
    expect(sourceTone("stale")).toBe("warn");
    expect(countsLine({ documents: 1, chunks: 1200 })).toBe("1 document · 1,200 chunks");
  });
});

describe("embeddingOptions", () => {
  const models = [
    { provider: "openai", model: "text-embedding-3-small", kind: "embedding" },
    { provider: "google", model: "gemini-embedding-001", kind: "embedding" },
    { provider: "ollama", model: "nomic-embed-text", kind: "embedding" },
    { provider: "openai", model: "text-embedding-ada-002", kind: "embedding", deprecated: true },
    { provider: "openai", model: "gpt-4.1-mini", kind: "chat" },
  ];

  it("lists embedding models, ready ones first", () => {
    const out = embeddingOptions(
      models,
      [
        { id: "openai", configuredOnServer: false },
        { id: "ollama", configuredOnServer: true },
      ],
      new Set(["google.api_key"]),
    );
    expect(out.map((o) => `${o.provider}/${o.model}:${o.ready}`)).toEqual([
      "google/gemini-embedding-001:true",
      "ollama/nomic-embed-text:true",
      "openai/text-embedding-3-small:false",
    ]);
  });

  it("marks nothing ready without a key", () => {
    expect(embeddingOptions(models, [], new Set()).every((o) => !o.ready)).toBe(true);
  });
});

describe("a source's settings", () => {
  const saved: KnowledgeSource = {
    id: "s1",
    name: "Docs",
    kind: "github",
    config: { repo: "acme/docs", path: "docs", maxFiles: 50 },
    pipeline: {
      chunker: { strategy: "markdown", chunkTokens: 300, overlapTokens: 40 },
      embedding: { provider: "google", model: "gemini-embedding-001" },
      index: { adapter: "pgvector" },
      embeddingCredentialId: "cred-g",
    } as KnowledgeSource["pipeline"],
    credentialId: null,
    status: "ready",
    stats: {},
    documents: 3,
    chunks: 12,
    lastSyncAt: null,
    lastError: null,
    createdAt: "",
    updatedAt: "",
  };

  it("opens on the saved values and sends nothing when nothing changed", () => {
    const f = formOf(saved);
    expect(f).toMatchObject({
      name: "Docs",
      repo: "acme/docs",
      path: "docs",
      strategy: "markdown",
      chunkTokens: 300,
      embeddingProvider: "google",
    });
    expect(sourcePatch(saved, f)).toEqual({ body: {}, reindex: false, refetch: false });
    // a rename alone indexes nothing again
    expect(sourcePatch(saved, { ...f, name: " Handbook " })).toEqual({
      body: { name: "Handbook" },
      reindex: false,
      refetch: false,
    });
  });

  it("re-indexes for new chunking or search, keeping what the form doesn't show", () => {
    const f = formOf(saved);
    const keyword = sourcePatch(saved, { ...f, embeddingProvider: "", embeddingModel: "" });
    expect(keyword.reindex).toBe(true);
    // the old provider's credential goes; the index adapter stays
    expect(keyword.body.pipeline).toEqual({
      chunker: { strategy: "markdown", chunkTokens: 300, overlapTokens: 40 },
      embedding: null,
      index: { adapter: "pgvector" },
    });
    const bigger = sourcePatch(saved, { ...f, chunkTokens: 600 });
    expect(bigger.body.pipeline).toMatchObject({
      chunker: { chunkTokens: 600 },
      embeddingCredentialId: "cred-g",
    });
  });

  it("fetches again for new addresses, keeping config the form doesn't show", () => {
    const moved = sourcePatch(saved, { ...formOf(saved), path: "" });
    expect(moved).toEqual({
      body: { config: { repo: "acme/docs", maxFiles: 50 } },
      reindex: false,
      refetch: true,
    });
  });
});

describe("indexingErrorFix", () => {
  it("sends key problems to Credentials and everything else to a retry", () => {
    expect(indexingErrorFix("No openai.api_key credential is bound for openai")).toBe(
      "credentials",
    );
    expect(indexingErrorFix("provider answered 401 Unauthorized")).toBe("credentials");
    expect(indexingErrorFix("fetch failed: ECONNRESET")).toBe("retry");
  });
});
