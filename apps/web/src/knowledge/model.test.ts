import { describe, expect, it } from "vitest";
import {
  EMPTY_SOURCE,
  countsLine,
  mimeOf,
  parseUrls,
  sourceBody,
  sourceFormError,
  sourceTone,
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
