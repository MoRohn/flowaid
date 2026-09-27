import { describe, expect, it } from "vitest";
import type { SafeFetch } from "@flowaid/workflow-core";
import {
  KnowledgeService,
  MemoryIndex,
  MemoryKnowledgeStore,
  chunkText,
  estimateTokens,
  fakeEmbeddingProvider,
  htmlToMarkdown,
  loadGithub,
  loadSitemap,
  loadUrl,
  normalize,
  reciprocalRankFusion,
} from "./index.js";
import { vectorIndexContract } from "./testing.js";

let n = 0;
const newId = () => `id-${++n}`;

vectorIndexContract("memory", () => new MemoryIndex(), { newId });

describe("chunkText", () => {
  const para = (i: number) =>
    `Paragraph ${i} explains one idea in a few plain sentences. It keeps going for a while so it has weight.`;
  const text = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");

  it("keeps every chunk under the token budget and overlaps neighbours", () => {
    const chunks = chunkText(text, { chunkTokens: 80, overlapTokens: 16 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(80);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    // the start of each chunk repeats words from the end of the previous one
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = (chunks[i - 1]?.content ?? "").split(" ").slice(-3).join(" ");
      expect(
        chunks[i]?.content.includes(prevTail) ||
          (chunks[i]?.start ?? 0) < (chunks[i - 1]?.end ?? 0),
      ).toBe(true);
    }
    // offsets point into the text
    for (const c of chunks) expect(text.slice(c.start, c.end)).toBe(c.content);
  });

  it("splits on paragraphs before sentences and on words before characters", () => {
    const chunks = chunkText(`${para(1)}\n\n${para(2)}`, { chunkTokens: 30, overlapTokens: 0 });
    expect(chunks[0]?.content.startsWith("Paragraph 1")).toBe(true);
    expect(chunks.every((c) => !/\S{40,}/.test(c.content))).toBe(true);
  });

  it("records the markdown heading a chunk sits under", () => {
    const md = `# Refunds\n\n${para(1)}\n\n${para(2)}\n\n## Chargebacks\n\n${para(3)}\n\n${para(4)}`;
    const chunks = chunkText(md, { strategy: "markdown", chunkTokens: 40, overlapTokens: 0 });
    expect(chunks.find((c) => c.content.includes("Paragraph 3"))?.heading).toBe("Chargebacks");
    expect(chunks.find((c) => c.content.includes("Paragraph 1"))?.heading).toBe("Refunds");
  });

  it("fixed windows, empty text and invalid settings", () => {
    expect(
      chunkText("x".repeat(1000), { strategy: "fixed", chunkTokens: 50, overlapTokens: 10 }).length,
    ).toBe(6);
    expect(chunkText("  \n ")).toEqual([]);
    expect(() => chunkText("a", { chunkTokens: 20, overlapTokens: 20 })).toThrow(RangeError);
    expect(estimateTokens("abcd efgh")).toBe(3);
  });
});

describe("normalize", () => {
  it("reduces HTML to readable markdown", () => {
    const html = `<html><head><title>Help &amp; FAQ</title><style>p{}</style></head><body><nav>menu</nav>
      <main><h1>Refunds</h1><p>Money back in <b>5</b>&nbsp;days.</p><ul><li>Card</li><li>Bank</li></ul>
      <a href="/policy">Read the policy</a><script>track()</script></main><footer>©</footer></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Refunds");
    expect(md).toContain("Money back in 5 days.");
    expect(md).toContain("- Card");
    expect(md).toContain("[Read the policy](/policy)");
    expect(md).not.toMatch(/menu|track|©|<|p\{\}/);
  });
  it("pretty-prints JSON and tidies text", () => {
    expect(normalize('{"a":1}', "application/json")).toBe('{\n  "a": 1\n}');
    expect(normalize("a  \n\n\n\n b", "text/plain")).toBe("a\n\nb");
  });
});

function fakeFetch(
  routes: Record<string, { body: string; type?: string; status?: number }>,
  calls: string[] = [],
): SafeFetch {
  return (url) => {
    calls.push(url);
    const r = routes[url];
    return Promise.resolve(
      r
        ? new Response(r.body, {
            status: r.status ?? 200,
            headers: { "content-type": r.type ?? "text/html" },
          })
        : new Response("nope", { status: 404 }),
    );
  };
}

describe("loaders", () => {
  it("loads a page with its title and a sitemap filtered by path", async () => {
    const fetch = fakeFetch({
      "https://docs.example.com/sitemap.xml": {
        type: "application/xml",
        body: `<urlset><url><loc>https://docs.example.com/help/a</loc></url><url><loc>https://docs.example.com/blog/b</loc></url><url><loc>https://docs.example.com/help/missing</loc></url></urlset>`,
      },
      "https://docs.example.com/help/a": { body: "<title>A</title><body><p>Alpha</p></body>" },
    });
    const page = await loadUrl(fetch, "https://docs.example.com/help/a");
    expect(page).toMatchObject({ title: "A", text: "Alpha", mimeType: "text/html" });
    const { documents, errors } = await loadSitemap(fetch, "https://docs.example.com/sitemap.xml", {
      include: ["/help"],
    });
    expect(documents.map((d) => d.externalId)).toEqual(["https://docs.example.com/help/a"]);
    expect(errors.map((e) => e.url)).toEqual(["https://docs.example.com/help/missing"]);
  });

  it("loads markdown files of a GitHub repository through the API", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch(
      {
        "https://api.github.com/repos/acme/docs": {
          type: "application/json",
          body: '{"default_branch":"main"}',
        },
        "https://api.github.com/repos/acme/docs/git/trees/main?recursive=1": {
          type: "application/json",
          body: JSON.stringify({
            tree: [
              { path: "guide/refunds.md", type: "blob" },
              { path: "logo.png", type: "blob" },
              { path: "src/x.ts", type: "blob" },
            ],
          }),
        },
        "https://api.github.com/repos/acme/docs/contents/guide/refunds.md?ref=main": {
          type: "application/json",
          body: JSON.stringify({
            encoding: "base64",
            content: btoa("# Refunds\n\nFive days."),
            html_url: "https://github.com/acme/docs/blob/main/guide/refunds.md",
          }),
        },
      },
      calls,
    );
    const docs = await loadGithub(fetch, { repo: "acme/docs", path: "guide" });
    expect(docs).toEqual([
      expect.objectContaining({
        externalId: "acme/docs:guide/refunds.md",
        mimeType: "text/markdown",
        text: "# Refunds\n\nFive days.",
      }),
    ]);
    await expect(loadGithub(fetch, { repo: "not a repo" })).rejects.toThrow(/owner\/name/);
  });
});

describe("reciprocalRankFusion", () => {
  it("rewards items ranked well in both lists", () => {
    const fused = reciprocalRankFusion(
      [
        ["a", "b", "c"],
        ["c", "a", "d"],
      ],
      (x) => x,
    );
    expect(fused.map((f) => f.item)).toEqual(["a", "c", "b", "d"]);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
  });
});

describe("KnowledgeService", () => {
  const setup = (o: { keywordOnly?: boolean } = {}) => {
    const store = new MemoryKnowledgeStore();
    const index = new MemoryIndex();
    const calls: string[][] = [];
    const source = store.addSource({
      id: "src-1",
      name: "Help center",
      kind: "files",
      pipeline: {
        chunker: { chunkTokens: 40, overlapTokens: 5 },
        embedding: o.keywordOnly ? null : { provider: "fake", model: "hashed-bow" },
      },
    });
    const service = new KnowledgeService({
      store,
      index: () => index,
      embedder: () => Promise.resolve(fakeEmbeddingProvider({ calls })),
      newId,
    });
    return { store, index, service, calls, source };
  };
  const refunds =
    "# Refunds\n\nRefunds go back to the original card within five business days. Contact billing for faster refunds.";
  const password =
    "# Passwords\n\nReset a forgotten password from the sign-in page using the emailed link.";

  it("indexes a document once and re-indexes only when its content changes", async () => {
    const { service, calls, store } = setup();
    const first = await service.upsertDocument({
      sourceId: "src-1",
      externalId: "refunds.md",
      text: refunds,
      mimeType: "text/markdown",
      title: "Refunds",
    });
    expect(first).toMatchObject({ unchanged: false });
    expect(first.chunks).toBeGreaterThan(0);
    const again = await service.upsertDocument({
      sourceId: "src-1",
      externalId: "refunds.md",
      text: refunds,
      mimeType: "text/markdown",
    });
    expect(again).toMatchObject({ unchanged: true, documentId: first.documentId });
    expect(calls).toHaveLength(1);
    await service.upsertDocument({
      sourceId: "src-1",
      externalId: "refunds.md",
      text: `${refunds} Updated.`,
      mimeType: "text/markdown",
    });
    expect(calls).toHaveLength(2);
    expect((await store.listSources())[0]).toMatchObject({ documents: 1 });
  });

  it("searches by vector, keyword and hybrid, with titles and sources on every hit", async () => {
    const { service } = setup();
    await service.upsertDocument({
      sourceId: "src-1",
      externalId: "refunds.md",
      text: refunds,
      title: "Refunds",
    });
    await service.upsertDocument({
      sourceId: "src-1",
      externalId: "password.md",
      text: password,
      title: "Passwords",
    });
    for (const mode of ["vector", "keyword", "hybrid"] as const) {
      const r = await service.search({
        sourceIds: ["src-1"],
        query: "how long do refunds take to reach my card",
        mode,
        k: 2,
      });
      expect(r.mode).toBe(mode);
      expect(r.hits[0]).toMatchObject({ sourceId: "src-1", title: "Refunds" });
    }
    const all = await service.search({ sourceIds: [], query: "forgotten password" });
    expect(all.mode).toBe("hybrid");
    expect(all.hits[0]?.title).toBe("Passwords");
  });

  it("falls back to keyword search for sources without an embedding model", async () => {
    const { service, calls } = setup({ keywordOnly: true });
    await service.upsertDocument({ sourceId: "src-1", externalId: "p", text: password });
    const r = await service.search({ sourceIds: ["src-1"], query: "password reset" });
    expect(r.mode).toBe("keyword");
    expect(r.hits).toHaveLength(1);
    expect(calls).toHaveLength(0);
    await expect(
      service.search({ sourceIds: ["src-1"], query: "x", mode: "vector" }),
    ).rejects.toThrow(/keyword/);
  });

  it("deletes documents from the store and the index", async () => {
    const { service, index } = setup();
    await service.upsertDocument({ sourceId: "src-1", externalId: "p", text: password });
    expect(await service.deleteDocument("src-1", "p")).toBe(true);
    expect(await service.deleteDocument("src-1", "p")).toBe(false);
    expect(await index.stats("src-1")).toEqual({ documents: 0, chunks: 0 });
    await expect(service.search({ sourceIds: ["missing"], query: "x" })).rejects.toThrow(
      /not found/,
    );
  });

  it("accepts pre-made chunks with their own embeddings", async () => {
    const { service, calls } = setup();
    const r = await service.upsertDocument({
      sourceId: "src-1",
      externalId: "c",
      chunks: [
        { content: "alpha", embedding: new Array<number>(64).fill(0.1) },
        { content: "beta" },
      ],
    });
    expect(r.chunks).toBe(2);
    expect(calls).toEqual([["beta"]]);
  });
});
