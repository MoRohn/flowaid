/**
 * The builder's save: an edit made just before the builder closes (in-app navigation unmounts it
 * inside the autosave delay) is sent on the way out with keepalive, the cached workflow then opens
 * on it, and the builder page's load waits for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { WorkflowDefinition } from "@flowaid/workflow-core";
import { toast } from "@flowaid/ui/primitives";
import type { WorkflowDetail } from "~/api/types";
import { apiError, bodyOf, callsTo, stubApi } from "~/knowledge/pageindex/testApi";
import { blankDefinition } from "./model";
import { createBuilderStore } from "./store";
import { AUTOSAVE_MS, draftSaved, putDraft, useDraftSave } from "./useDraftSave";

const ID = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";
const DRAFT = `PUT /v1/workflows/${ID}/draft`;

afterEach(async () => {
  cleanup();
  // unmounting sends what is left: let it land on the stub before the stub goes
  await draftSaved(ID);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(revision = 3) {
  const definition = blankDefinition(ID, "Refunds");
  const store = createBuilderStore({ workflowId: ID, definition, draftRevision: revision });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<Partial<WorkflowDetail>>(["workflow", ID], {
    id: ID,
    draft: definition,
    draftRevision: revision,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useDraftSave({ store, workflowId: ID, ws: "acme", enabled: true }),
    { wrapper },
  );
  const rename = (name: string) =>
    act(() => store.getState().updateDefinition((d) => void (d.name = name), "Rename"));
  return { store, qc, hook, rename };
}

describe("saving the draft when the builder closes", () => {
  it("sends an edit made inside the autosave delay as the builder unmounts, with keepalive", async () => {
    const fetchMock = stubApi({ [DRAFT]: () => ({ draftRevision: 4 }) });
    const { store, qc, hook, rename } = setup();
    rename("Refunds v2");
    expect(callsTo(fetchMock, DRAFT)).toHaveLength(0);

    hook.unmount();
    await draftSaved(ID);

    const calls = callsTo(fetchMock, DRAFT);
    expect(calls).toHaveLength(1);
    const init = calls[0]?.[1];
    expect(init?.keepalive).toBe(true);
    expect(new Headers(init?.headers).get("if-match")).toBe('"3"');
    expect((bodyOf(init) as { definition: WorkflowDefinition }).definition.name).toBe("Refunds v2");
    expect(store.getState().savedVersion).toBe(store.getState().version);
    // the next visit opens on the saved draft, not the one the builder first loaded
    await vi.waitFor(() =>
      expect(qc.getQueryData<WorkflowDetail>(["workflow", ID])?.draftRevision).toBe(4),
    );
    expect(qc.getQueryData<WorkflowDetail>(["workflow", ID])?.draft.name).toBe("Refunds v2");
  });

  it("sends nothing when the draft was already saved", async () => {
    const fetchMock = stubApi({ [DRAFT]: () => ({ draftRevision: 4 }) });
    const { hook } = setup();
    hook.unmount();
    await draftSaved(ID);
    expect(callsTo(fetchMock, DRAFT)).toHaveLength(0);
  });

  it("autosaves after the delay, one save at a time", async () => {
    vi.useFakeTimers();
    let revision = 3;
    const fetchMock = stubApi({ [DRAFT]: () => ({ draftRevision: ++revision }) });
    const { store, hook, rename } = setup();
    rename("A");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10);
    });
    expect(callsTo(fetchMock, DRAFT)).toHaveLength(1);
    expect(store.getState().draftRevision).toBe(4);

    // ⌘S twice while a change is pending: the second waits and finds nothing left to send
    rename("B");
    await act(async () => {
      await Promise.all([hook.result.current(), hook.result.current()]);
    });
    const calls = callsTo(fetchMock, DRAFT);
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1]?.[1]?.headers).get("if-match")).toBe('"4"');
  });

  it("reports a failed last save, since the builder that would show it is gone", async () => {
    const failed = vi.spyOn(toast, "error");
    stubApi({ [DRAFT]: () => apiError(412, "PRECONDITION_FAILED", "revision mismatch") });
    const { store, hook, rename } = setup();
    rename("Refunds v2");
    hook.unmount();
    await draftSaved(ID);
    expect(failed).toHaveBeenCalledWith("Your last change to the draft was not saved", {
      description: expect.stringMatching(/changed elsewhere/) as unknown,
    });
    failed.mockRestore();
    expect(store.getState().saveError).toBe("revision mismatch");
    expect(store.getState().savedVersion).not.toBe(store.getState().version);
  });
});

describe("putDraft", () => {
  it("sends a draft too large for keepalive as an ordinary request", async () => {
    const fetchMock = stubApi({ [DRAFT]: () => ({ draftRevision: 9 }) });
    const big = blankDefinition(ID, "Big");
    big.description = "x".repeat(70 * 1024);
    await expect(putDraft(ID, big, 8, true)).resolves.toBe(9);
    expect(callsTo(fetchMock, DRAFT)[0]?.[1]?.keepalive).toBeUndefined();
  });

  it("answers the API's error for a refused save", async () => {
    stubApi({ [DRAFT]: () => apiError(412, "PRECONDITION_FAILED", "revision mismatch") });
    await expect(putDraft(ID, blankDefinition(ID, "X"), 1, true)).rejects.toMatchObject({
      status: 412,
      message: "revision mismatch",
    });
  });
});

describe("draftSaved", () => {
  it("waits for every save in flight and never rejects", async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
        .mockImplementation(() => Promise.resolve(Response.json({ draftRevision: 5 }))),
    );
    const { hook, rename } = setup();
    rename("Slow");
    let done = false;
    const save = hook.result.current().catch(() => undefined);
    const waiting = draftSaved(ID).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    release(apiError(500, "INTERNAL", "boom"));
    await waiting;
    await save;
    expect(done).toBe(true);
  });
});
