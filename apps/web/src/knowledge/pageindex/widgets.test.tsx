import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { SchemaForm, getWidget } from "@flowaid/ui/forms";
import { doc } from "./fixtures";
import { UNAVAILABLE } from "./widgets";
import { apiError, stubApi, withClient } from "./testApi";

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SCHEMA = {
  type: "object",
  properties: {
    scope: {
      type: "object",
      title: "Scope",
      properties: {
        sourceIds: {
          type: "array",
          title: "Sources",
          items: { type: "string" },
          "x-ui-ext": { widget: "pageindexSources" },
        },
        documentIds: {
          type: "array",
          title: "Documents",
          items: { type: "string" },
          "x-ui-ext": { widget: "pageindexDocuments" },
        },
      },
    },
    documentId: {
      type: "string",
      title: "Document",
      "x-ui-ext": { widget: "pageindexDocuments" },
    },
  },
};

const source = (id: string, name: string, kind = "pageindex") => ({ id, name, kind });

function api() {
  return stubApi({
    "GET /v1/knowledge/sources": () => [
      source("src-1", "Policies"),
      source("src-2", "Web help", "url"),
    ],
    "GET /v1/pageindex/sources/src-1/documents": () => ({
      items: [doc({ state: "ready" }), doc({ state: "running" }, "Contract.pdf", "doc-2")],
    }),
  });
}

function form(defaultValues: Record<string, unknown>) {
  const onChange = vi.fn();
  render(
    withClient(
      <SchemaForm
        schema={SCHEMA as never}
        defaultValues={defaultValues}
        onChange={onChange}
        aria-label="PageIndex retrieve configuration"
      />,
    ),
  );
  return onChange;
}

describe("PageIndex pickers", () => {
  it("registers both widget names", async () => {
    await import("./widgets");
    expect(getWidget("pageindexSources")).toBeTypeOf("function");
    expect(getWidget("pageindexDocuments")).toBeTypeOf("function");
  });

  it("lists PageIndex sources and their documents, and writes the ids", async () => {
    await import("./widgets");
    api();
    const onChange = form({ scope: { sourceIds: [], documentIds: [] } });
    const policies = await screen.findByRole("checkbox", { name: "Policies" });
    expect(screen.queryByRole("checkbox", { name: "Web help" })).toBeNull();
    act(() => {
      fireEvent.click(policies);
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: expect.objectContaining({ sourceIds: ["src-1"] }) as unknown,
        }),
        expect.anything(),
      ),
    );
    const contract = await screen.findByRole("checkbox", { name: /Contract\.pdf/ });
    act(() => {
      fireEvent.click(contract);
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: expect.objectContaining({ documentIds: ["doc-2"] }) as unknown,
        }),
        expect.anything(),
      ),
    );
  });

  it("asks to pick again for ids this workspace does not have (imports, deletions)", async () => {
    await import("./widgets");
    api();
    const onChange = form({
      scope: { sourceIds: ["src-gone"], documentIds: ["doc-1"] },
      documentId: "doc-gone",
    });
    await waitFor(() => expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(2));
    expect(screen.getByText("src-gone")).toBeTruthy();
    expect(screen.getByText("doc-gone")).toBeTruthy();
    expect(
      (await screen.findByRole("checkbox", { name: /Handbook\.pdf/ })).getAttribute("aria-checked"),
    ).toBe("true");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Remove unavailable source src-gone" }));
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: expect.objectContaining({ sourceIds: [] }) as unknown }),
        expect.anything(),
      ),
    );
  });

  it("falls back to typed ids when the lists cannot load", async () => {
    await import("./widgets");
    stubApi({ "GET /v1/knowledge/sources": () => apiError(500, "INTERNAL", "down") });
    const onChange = form({ scope: { sourceIds: ["a"] } });
    const inputs = await screen.findAllByPlaceholderText("id, id, …");
    expect((inputs[0] as HTMLInputElement).value).toBe("a");
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: "a, b" } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: expect.objectContaining({ sourceIds: ["a", "b"] }) as unknown,
        }),
        expect.anything(),
      ),
    );
    expect(screen.getAllByText(/Could not load the PageIndex/).length).toBeGreaterThan(0);
  });
});
