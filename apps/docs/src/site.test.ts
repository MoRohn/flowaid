import { coreManifests } from "@flowaid/nodes-core/manifest";
import { describe, expect, it } from "vitest";
import { buildSite } from "./build.js";
import { brokenLinks, linkBetween, nodeSlug, pageFile, renderMarkdown, REPO_URL } from "./site.js";

describe("the docs site", () => {
  const site = buildSite();

  it("builds with every source present and no broken links", () => {
    expect(site.problems).toEqual([]);
  });

  it("has a page for every core node and the generated references", () => {
    for (const m of coreManifests) expect(site.files.has(pageFile(nodeSlug(m.id)))).toBe(true);
    expect(site.files.get("nodes/index.html")).toContain("Node reference");
    expect(site.files.get("reference/api/index.html")).toContain("/v1/workflows/import");
    expect(site.files.get("langchain/index.html")).toBeDefined();
    expect(site.files.get("guides/importing-external-flows/index.html")).toContain(
      "migration report",
    );
  });

  it("ships the brand tokens with both themes", () => {
    const tokens = site.files.get("assets/tokens.css") ?? "";
    expect(tokens).toContain("prefers-color-scheme: dark");
    expect(tokens).toContain('[data-theme="dark"]');
  });
});

describe("links", () => {
  const bySource = new Map([
    ["docs/langchain/overview.md", "langchain"],
    ["docs/langchain/rag.md", "langchain/rag"],
  ]);
  const from = { slug: "langchain", file: "docs/langchain/overview.md" };

  it("rewrites links to published sources as relative page links", () => {
    const html = renderMarkdown("[RAG](rag.md#stores)", from, bySource);
    expect(html).toContain('href="rag/index.html#stores"');
    expect(linkBetween("langchain/rag", "")).toBe("../../index.html");
  });

  it("sends other repository links to GitHub and reports them", () => {
    const seen: string[] = [];
    const html = renderMarkdown("[env](../../packages/env/src/index.ts)", from, bySource, (t) =>
      seen.push(t),
    );
    expect(html).toContain(`${REPO_URL}/blob/main/packages/env/src/index.ts`);
    expect(seen).toEqual(["packages/env/src/index.ts"]);
  });

  it("resolves site paths and leaves external links alone", () => {
    const html = renderMarkdown("[n](/nodes) [x](https://example.com)", from, bySource);
    expect(html).toContain('href="../nodes/index.html"');
    expect(html).toContain('href="https://example.com"');
  });

  it("finds links to pages that do not exist", () => {
    const files = new Map([
      ["index.html", '<a href="a/index.html">a</a> <a href="missing/index.html">m</a>'],
      ["a/index.html", '<a href="../index.html#top">home</a>'],
    ]);
    expect(brokenLinks(files)).toEqual([{ file: "index.html", href: "missing/index.html" }]);
  });
});
