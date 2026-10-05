import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { setWorkspace } from "~/api/client";
import { doc, index } from "./fixtures";
import { MAX_PDF_BYTES, type DocumentSummary, type OutlineNode } from "./model";
import { PageIndexSource } from "./PageIndexSource";
import { apiError, callsTo, stubApi, withClient, type Handler } from "./testApi";

beforeAll(() => {
  installDomStubs();
  setWorkspace("acme");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const DOCS = "GET /v1/pageindex/sources/src-1/documents";
const STATUS = "GET /v1/pageindex/status";
const reachable = () => ({ enabled: true, reachable: true, sdkVersion: "0.2.20", protocol: 1 });

function setup(routes: Record<string, Handler>, canWrite = true) {
  const fetchMock = stubApi({ [STATUS]: reachable, ...routes });
  render(withClient(<PageIndexSource sourceId="src-1" canWrite={canWrite} />));
  return fetchMock;
}

const pdf = (name = "Handbook.pdf", size?: number, type = "application/pdf") => {
  const f = new File(["%PDF-1.7 test"], name, { type });
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
};

const choose = (files: File[]) =>
  act(() => {
    fireEvent.change(screen.getByLabelText("PDF files"), { target: { files } });
  });

describe("the document list", () => {
  it("shows loading, then the empty state", async () => {
    setup({ [DOCS]: () => ({ items: [] }) });
    expect(screen.getByRole("grid", { name: "Documents" }).getAttribute("aria-busy")).toBe("true");
    expect(await screen.findByText("No PDFs yet")).toBeTruthy();
  });

  it("shows the API error with a retry", async () => {
    setup({ [DOCS]: () => apiError(500, "INTERNAL", "database down") });
    expect(await screen.findByText("database down")).toBeTruthy();
  });

  it("lists version, pages, the index state with its stage, index version and model", async () => {
    setup({
      [DOCS]: () => ({
        items: [
          doc({ state: "ready", indexVersion: 2 }),
          doc({ state: "running", stage: "writing summaries" }, "Contract.pdf", "doc-2"),
        ],
      }),
    });
    const table = await screen.findByRole("grid", { name: "Documents" });
    const ready = (await within(table).findByText("Handbook.pdf")).closest('[role="row"]');
    const running = within(table).getByText("Contract.pdf").closest('[role="row"]');
    if (!(ready instanceof HTMLElement) || !(running instanceof HTMLElement))
      throw new Error("rows missing");
    expect(within(ready).getByText("Ready")).toBeTruthy();
    expect(within(ready).getByText("v1")).toBeTruthy();
    expect(within(ready).getByText("12")).toBeTruthy();
    expect(within(ready).getByText("#2")).toBeTruthy();
    expect(within(ready).getByText("ollama/qwen2.5:3b")).toBeTruthy();
    expect(within(running).getByText("Indexing")).toBeTruthy();
    expect(within(running).getByText("writing summaries")).toBeTruthy();
    expect(table.textContent).not.toMatch(/%/);
    // a build in flight can be canceled, not reindexed
    expect(
      within(running).getByRole("button", { name: "Cancel indexing Contract.pdf" }),
    ).toBeTruthy();
    expect(within(running).queryByRole("button", { name: /Reindex/ })).toBeNull();
  });

  it("polls while an index is running and stops once it is ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const fetchMock = setup({
      [DOCS]: () => {
        n += 1;
        return { items: [doc({ state: n < 2 ? "running" : "ready" })] };
      },
    });
    expect(await screen.findByText("Indexing")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Ready")).toBeTruthy();
    const settled = callsTo(fetchMock, DOCS).length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(callsTo(fetchMock, DOCS).length).toBe(settled);
  });

  it("explains a scanned PDF and offers a retry", async () => {
    const fetchMock = setup({
      [DOCS]: () => ({
        items: [
          doc({
            state: "failed",
            error: { code: "NO_TEXT_LAYER", message: "no extractable text on any page" },
          }),
        ],
      }),
      "POST /v1/pageindex/documents/doc-1/index": () =>
        Response.json({ index: index({ state: "queued" }), created: true }, { status: 202 }),
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Handbook.pdf could not be indexed. This PDF has no text layer (scanned). Run OCR first; local PageIndex does not OCR.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry indexing Handbook.pdf" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST /v1/pageindex/documents/doc-1/index")).toHaveLength(1),
    );
    expect(await screen.findByText("Indexing queued")).toBeTruthy();
  });

  it("cancels a running build", async () => {
    const fetchMock = setup({
      [DOCS]: () => ({ items: [doc({ state: "running" })] }),
      "POST /v1/pageindex/indexes/ix-1/cancel": () => index({ state: "cancel_requested" }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel indexing Handbook.pdf" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST /v1/pageindex/indexes/ix-1/cancel")).toHaveLength(1),
    );
    expect(await screen.findByText("Canceling…")).toBeTruthy();
  });

  it("deletes after a confirmation that explains the revocation", async () => {
    const fetchMock = setup({
      [DOCS]: () => ({ items: [doc({ state: "ready" })] }),
      "DELETE /v1/pageindex/documents/doc-1": () => new Response(null, { status: 202 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete Handbook.pdf" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Delete Handbook\.pdf/ });
    expect(within(dialog).getByText(/Access is revoked at once/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete document" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "DELETE /v1/pageindex/documents/doc-1")).toHaveLength(1),
    );
  });

  it("hides the changes from readers", async () => {
    setup({ [DOCS]: () => ({ items: [doc({ state: "ready" })] }) }, false);
    await screen.findByText("Handbook.pdf");
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose PDFs" })).toBeNull();
  });

  it("says when the service is not answering", async () => {
    setup({
      [STATUS]: () => ({ ...reachable(), reachable: false }),
      [DOCS]: () => ({ items: [] }),
    });
    expect(await screen.findByText(/The PageIndex service is not answering/)).toBeTruthy();
  });

  it("says when PageIndex is not configured", async () => {
    setup({
      [STATUS]: () => apiError(409, "PAGEINDEX_DISABLED", "disabled"),
      [DOCS]: () => apiError(409, "PAGEINDEX_DISABLED", "disabled"),
    });
    expect(await screen.findByText(/PageIndex is not configured on this server/)).toBeTruthy();
  });
});

describe("uploads", () => {
  it("checks type and size before sending", async () => {
    const fetchMock = setup({ [DOCS]: () => ({ items: [] }) });
    await screen.findByText("No PDFs yet");
    choose([pdf("scan.png", undefined, "image/png"), pdf("huge.pdf", MAX_PDF_BYTES + 1)]);
    const list = screen.getByRole("list", { name: "Uploads" });
    expect(within(list).getByText(/Not a PDF\. PageIndex reads PDF files only\./)).toBeTruthy();
    expect(within(list).getByText(/Larger than 50 MiB/)).toBeTruthy();
    expect(callsTo(fetchMock, "POST /v1/pageindex/sources/src-1/documents")).toHaveLength(0);
  });

  it("sends each PDF as the raw body and shows its result", async () => {
    let n = 0;
    const fetchMock = setup({
      [DOCS]: () => ({ items: [] }),
      "POST /v1/pageindex/sources/src-1/documents": () => {
        n += 1;
        if (n === 2) return apiError(415, "UNSUPPORTED_MEDIA_TYPE", "not a pdf");
        if (n === 3) return apiError(413, "PAYLOAD_TOO_LARGE", "too large");
        const d: DocumentSummary = doc({ state: "queued" });
        return Response.json(
          { document: d, version: d.latestVersion, index: d.latestIndex, created: true },
          { status: 201 },
        );
      },
    });
    await screen.findByText("No PDFs yet");
    choose([pdf("A.pdf"), pdf("B.pdf"), pdf("C.pdf")]);
    const list = screen.getByRole("list", { name: "Uploads" });
    expect(await within(list).findByText(/Uploaded; indexing queued/)).toBeTruthy();
    expect(
      await within(list).findByText(/The server read this file and it is not a PDF\./),
    ).toBeTruthy();
    expect(await within(list).findByText(/Larger than the 50 MiB limit\./)).toBeTruthy();
    const [url, init] = callsTo(fetchMock, "POST /v1/pageindex/sources/src-1/documents")[0] ?? [];
    expect(url).toBe("/v1/pageindex/sources/src-1/documents");
    expect(init?.body).toBeInstanceOf(File);
    expect(init?.headers).toMatchObject({
      "content-type": "application/pdf",
      "x-file-name": "A.pdf",
    });
  });

  it("uploads a new version of a document", async () => {
    const fetchMock = setup({
      [DOCS]: () => ({ items: [doc({ state: "ready" })] }),
      "POST /v1/pageindex/sources/src-1/documents": () => {
        const d = doc({ state: "queued", documentVersion: 2 });
        return Response.json(
          {
            document: d,
            version: { ...d.latestVersion, version: 2 },
            index: d.latestIndex,
            created: true,
          },
          { status: 201 },
        );
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Upload a new version of Handbook.pdf" }),
    );
    act(() => {
      fireEvent.change(screen.getByLabelText("PDF file for the new version"), {
        target: { files: [pdf("Handbook v2.pdf")] },
      });
    });
    expect(await screen.findByText(/as a new version: Version 2/)).toBeTruthy();
    const [url] = callsTo(fetchMock, "POST /v1/pageindex/sources/src-1/documents")[0] ?? [];
    expect(url).toBe("/v1/pageindex/sources/src-1/documents?documentId=doc-1");
  });

  it("takes dropped files", async () => {
    setup({ [DOCS]: () => ({ items: [] }) });
    await screen.findByText("No PDFs yet");
    act(() => {
      fireEvent.drop(screen.getByRole("group", { name: "Upload PDFs" }), {
        dataTransfer: { files: [pdf("notes.docx", undefined, "application/msword")] },
      });
    });
    expect(await screen.findByText(/Not a PDF/)).toBeTruthy();
  });
});

const OUTLINE: OutlineNode[] = [
  {
    nodeId: "n1",
    title: "Employment",
    startPage: 3,
    endPage: 9,
    summary: "Hiring, probation and termination.",
    children: [
      { nodeId: "n2", title: "Termination", startPage: 7, endPage: 8, summary: "Notice periods." },
    ],
  },
];

describe("the outline and the source viewer", () => {
  it("renders the section tree and opens a section's page in the viewer", async () => {
    const created: Blob[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: (b: Blob) => {
          created.push(b);
          return "blob:pdf-1";
        },
        revokeObjectURL: () => undefined,
      }),
    );
    const fetchMock = setup({
      [DOCS]: () => ({ items: [doc({ state: "ready" })] }),
      "GET /v1/pageindex/indexes/ix-1/outline": () => ({ outline: OUTLINE }),
      "GET /v1/pageindex/documents/doc-1/versions/ver-1/file": () =>
        new Response(new Blob(["%PDF"], { type: "application/pdf" })),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Outline of Handbook.pdf" }));
    const outline = await screen.findByRole("dialog", { name: /Outline of Handbook\.pdf/ });
    expect(await within(outline).findByText("Employment")).toBeTruthy();
    expect(within(outline).getByText("pp. 3–9")).toBeTruthy();
    expect(within(outline).getByText("Hiring, probation and termination.")).toBeTruthy();
    expect(within(outline).getByText("Termination")).toBeTruthy();
    fireEvent.click(within(outline).getByRole("button", { name: "Collapse Employment" }));
    expect(within(outline).queryByText("Termination")).toBeNull();

    fireEvent.click(within(outline).getByRole("button", { name: "Open page 3: Employment" }));
    const viewer = await screen.findByRole("dialog", { name: "Handbook.pdf" });
    expect(within(viewer).getByText(/Page 3 of the file/)).toBeTruthy();
    const frame = await within(viewer).findByTitle("Handbook.pdf, version 1, page 3 of the file");
    expect(frame.getAttribute("src")).toBe("blob:pdf-1#page=3");
    expect(
      within(viewer)
        .getByRole("link", { name: /Open in new tab/ })
        .getAttribute("href"),
    ).toBe("blob:pdf-1#page=3");
    expect(
      callsTo(fetchMock, "GET /v1/pageindex/documents/doc-1/versions/ver-1/file"),
    ).toHaveLength(1);
    const init = callsTo(
      fetchMock,
      "GET /v1/pageindex/documents/doc-1/versions/ver-1/file",
    )[0]?.[1];
    expect(init?.headers).toMatchObject({ "x-workspace": "acme" });
    expect(created).toHaveLength(1);
  });
});
