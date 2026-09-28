import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { doc, queryResponse } from "./fixtures";
import { MODEL_DISCLOSURE } from "./model";
import { QueryPanel } from "./QueryPanel";
import { bodyOf, callsTo, stubApi, withClient } from "./testApi";

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const QUERY = "POST /v1/pageindex/query";
const DOCS = [doc({ state: "ready" }), doc({ state: "ready" }, "Contract.pdf", "doc-2")];

function setup(withAnswer: boolean) {
  const fetchMock = stubApi({ [QUERY]: () => queryResponse(withAnswer) });
  const onOpen = vi.fn();
  render(withClient(<QueryPanel sourceId="src-1" documents={DOCS} onOpen={onOpen} />));
  fireEvent.change(screen.getByLabelText("Question"), {
    target: { value: "What is the notice period?" },
  });
  return { fetchMock, onOpen };
}

const body = (fetchMock: ReturnType<typeof stubApi>) => bodyOf(callsTo(fetchMock, QUERY)[0]?.[1]);

describe("the test query panel", () => {
  it("retrieves evidence for the whole source and shows the activity and evidence cards", async () => {
    const { fetchMock, onOpen } = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "Retrieve" }));
    const evidence = await screen.findByRole("list", { name: "Evidence" });
    expect(body(fetchMock)).toEqual({
      query: "What is the notice period?",
      scope: { sourceIds: ["src-1"] },
      answer: false,
    });

    const activity = screen.getByLabelText("Retrieval activity");
    expect(within(activity).getByText("Sections inspected").nextSibling?.textContent).toBe("9");
    expect(within(activity).getByText("Pages read").nextSibling?.textContent).toBe("2");
    expect(within(activity).getByText("Decisions").nextSibling?.textContent).toBe("3");
    expect(within(activity).getByText("2.4 s")).toBeTruthy();
    expect(within(activity).getByText("$0.0012")).toBeTruthy();
    expect(screen.getByText("One document was still indexing and was skipped.")).toBeTruthy();

    expect(within(evidence).getByText("E1")).toBeTruthy();
    expect(within(evidence).getByText("Employment › Termination")).toBeTruthy();
    expect(within(evidence).getByText(/Either party may terminate/)).toBeTruthy();
    expect(within(evidence).getByText("Excerpt cut to the evidence budget")).toBeTruthy();
    expect(within(evidence).getByText(/confidence 0\.82 · typesafe/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();

    fireEvent.click(within(evidence).getByRole("button", { name: /Open page 7 of Handbook\.pdf/ }));
    expect(onOpen).toHaveBeenCalledWith({
      documentId: "doc-1",
      versionId: "ver-1",
      displayName: "Handbook.pdf",
      version: 1,
      page: 7,
    });
  });

  it("answers with citations that open the cited page, their support and limitations", async () => {
    const { fetchMock, onOpen } = setup(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Contract.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Retrieve and answer" }));
    const answer = await screen.findByRole("region", { name: "Answer" });
    expect(body(fetchMock)).toMatchObject({ scope: { documentIds: ["doc-2"] }, answer: true });

    expect(within(answer).getByText("partial")).toBeTruthy();
    expect(within(answer).getByText(MODEL_DISCLOSURE)).toBeTruthy();
    expect(within(answer).getByText(/The notice period is 30 days/)).toBeTruthy();
    const citations = within(answer).getByRole("list", { name: "Citations" });
    expect(within(citations).getByText("Unsupported · lexical 0.12")).toBeTruthy();
    expect(within(answer).getByText("The handbook does not cover contractors.")).toBeTruthy();
    expect(screen.getByText(/answer by openai\/gpt-4\.1-mini/)).toBeTruthy();

    fireEvent.click(
      within(answer).getByRole("button", { name: "Citation [E1]: open page 8 of Handbook.pdf" }),
    );
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: "doc-1", page: 8 }),
      ),
    );
  });

  it("waits for a question", () => {
    stubApi({});
    render(withClient(<QueryPanel sourceId="src-1" documents={DOCS} onOpen={() => undefined} />));
    expect(screen.getByRole("button", { name: "Retrieve" }).hasAttribute("disabled")).toBe(true);
  });
});
