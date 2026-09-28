import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_SOURCE, countsLine, sourceBody, sourceFormError } from "../model";
import {
  MAX_PDF_BYTES,
  PROCESSING,
  filePath,
  indexErrorHint,
  pageFragment,
  pdfFileError,
  pollInterval,
  readConfig,
  readableIndex,
  splitAnswer,
  uploadErrorMessage,
} from "./model";
import { doc, index } from "./fixtures";

describe("PageIndex source form", () => {
  it("builds the contract's create body, with no chunker or embedding", () => {
    const f = { ...EMPTY_SOURCE, name: " Policies ", kind: "pageindex" as const };
    expect(sourceFormError(f)).toBeNull();
    expect(sourceBody(f)).toEqual({
      name: "Policies",
      kind: "pageindex",
      config: {
        indexModel: { provider: "ollama", model: "qwen2.5:3b" },
        credentialId: null,
        mode: "flash",
        optimize: "off",
      },
    });
    expect(sourceFormError({ ...f, indexModel: " " })).toBe("Name the indexing model");
  });

  it("reads a stored config defensively", () => {
    expect(
      readConfig({ indexModel: { provider: "openai", model: "gpt-4.1-mini" }, mode: "standard" }),
    ).toEqual({
      indexModel: { provider: "openai", model: "gpt-4.1-mini" },
      credentialId: null,
      mode: "standard",
      optimize: "off",
    });
    expect(readConfig({ indexModel: { provider: "gemini", model: "x" } })).toBeNull();
    expect(readConfig({})).toBeNull();
  });

  it("counts documents only", () => {
    expect(countsLine({ documents: 1, chunks: 0, kind: "pageindex" })).toBe("1 document");
  });

  it("keeps the disclosure in step with @flowaid/pageindex MODES", async () => {
    const src = await readFile(
      resolve(import.meta.dirname, "../../../../../packages/pageindex/src/capabilities.ts"),
      "utf8",
    );
    const flat = src.replace(/"\s*\+\s*"/g, "").replace(/\s+/g, " ");
    expect(flat).toContain(PROCESSING.local);
    expect(flat).toContain(PROCESSING.cloud);
  });
});

describe("PDF checks", () => {
  const f = (name: string, type: string, size = 1000) => ({ name, type, size });
  it("accepts PDFs by type, or by name when the browser gives no type", () => {
    expect(pdfFileError(f("a.pdf", "application/pdf"))).toBeNull();
    expect(pdfFileError(f("a.PDF", ""))).toBeNull();
    expect(pdfFileError(f("scan.png", "image/png"))).toMatch(/Not a PDF/);
    expect(pdfFileError(f("a.txt", ""))).toMatch(/Not a PDF/);
  });
  it("refuses empty files and files over 50 MiB", () => {
    expect(pdfFileError(f("a.pdf", "application/pdf", 0))).toMatch(/empty/);
    expect(pdfFileError(f("a.pdf", "application/pdf", MAX_PDF_BYTES))).toBeNull();
    expect(pdfFileError(f("a.pdf", "application/pdf", MAX_PDF_BYTES + 1))).toMatch(/50 MiB/);
  });
  it("explains 415 and 413", () => {
    expect(uploadErrorMessage(415, "UNSUPPORTED_MEDIA_TYPE", "x")).toMatch(/not a PDF/);
    expect(uploadErrorMessage(413, "PAYLOAD_TOO_LARGE", "x")).toMatch(/50 MiB/);
    expect(uploadErrorMessage(400, "VALIDATION", "bad name")).toBe("bad name");
  });
});

describe("index states", () => {
  it("polls only while an index is queued, running or being canceled", () => {
    expect(pollInterval(undefined)).toBe(false);
    expect(pollInterval([doc({ state: "ready" })])).toBe(false);
    expect(pollInterval([doc({ state: "failed" }), doc({ state: "running" })])).toBe(3000);
    expect(pollInterval([doc({ state: "queued" })])).toBe(3000);
    expect(pollInterval([doc({ state: "cancel_requested" })])).toBe(3000);
    expect(pollInterval([doc({ state: "canceled" })])).toBe(false);
  });

  it("offers the active index's outline while a newer build runs", () => {
    const d = {
      ...doc({ state: "running" }),
      activeIndex: index({ state: "ready", indexId: "ix-old" }),
    };
    expect(readableIndex(d)?.indexId).toBe("ix-old");
    expect(readableIndex(doc({ state: "failed" }))).toBeNull();
  });

  it("turns a scanned-PDF failure into the OCR advice", () => {
    expect(indexErrorHint({ code: "NO_TEXT_LAYER", message: "no text" })).toBe(
      "This PDF has no text layer (scanned). Run OCR first; local PageIndex does not OCR.",
    );
    expect(indexErrorHint({ code: "INDEX_FAILED", message: "the PDF looks scanned" })).toMatch(
      /Run OCR first/,
    );
    expect(indexErrorHint({ code: "INDEX_FAILED", message: "timeout" })).toBe("timeout");
  });
});

describe("the source viewer URL", () => {
  it("addresses the stored version and a physical page", () => {
    expect(filePath("d 1", "v1")).toBe("/v1/pageindex/documents/d%201/versions/v1/file");
    expect(pageFragment(7)).toBe("#page=7");
    expect(pageFragment(0)).toBe("#page=1");
  });
});

describe("answers", () => {
  it("cuts the text at citation markers", () => {
    expect(
      splitAnswer("Notice is 30 days [1], or 60 [12].", [{ marker: "[1]" }, { marker: "[12]" }]),
    ).toEqual([
      { text: "Notice is 30 days " },
      { citation: 0 },
      { text: ", or 60 " },
      { citation: 1 },
      { text: "." },
    ]);
    expect(splitAnswer("No citations.", [])).toEqual([{ text: "No citations." }]);
  });
});
