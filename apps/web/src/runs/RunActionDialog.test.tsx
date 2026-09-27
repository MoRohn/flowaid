import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import type { NodeRunView } from "@flowaid/ui";
import { NodeRunPanel } from "./NodeRunPanel";
import {
  RunActionDialog,
  parseObject,
  type RunAction,
  type RunActionRequest,
} from "./RunActionDialog";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const RUN = "run-1";
const open = (action: RunAction, onSubmit = vi.fn((_: RunActionRequest) => Promise.resolve())) => {
  const onOpenChange = vi.fn();
  render(
    <RunActionDialog runId={RUN} action={action} onOpenChange={onOpenChange} onSubmit={onSubmit} />,
  );
  return { onSubmit, onOpenChange };
};
const click = (name: string | RegExp) =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

describe("run action dialogs", () => {
  it("replay asks for the mode and sends it", async () => {
    const { onSubmit, onOpenChange } = open({ kind: "replay" });
    act(() => {
      fireEvent.click(screen.getByLabelText(/Reuse recorded results/));
    });
    click("Replay");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledWith({
      path: `/v1/runs/${RUN}/replay`,
      body: { mode: "recorded" },
    });
  });

  it("fork targets the run's version or the draft with the edited input", async () => {
    const { onSubmit } = open({ kind: "fork", versionId: "v-1", input: { message: "hi" } });
    const input = await screen.findByDisplayValue(/"message": "hi"/);
    act(() => {
      fireEvent.change(input, { target: { value: "[1]" } });
    });
    expect(screen.getByText("Enter a JSON object")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Fork" }).disabled).toBe(true);
    act(() => {
      fireEvent.change(input, { target: { value: '{"message":"forked"}' } });
      fireEvent.click(screen.getByLabelText(/The current draft/));
    });
    click("Fork");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        path: `/v1/runs/${RUN}/fork`,
        body: { draft: true, input: { message: "forked" } },
      }),
    );
  });

  it("fork of a draft run offers only the draft", async () => {
    const { onSubmit } = open({ kind: "fork", versionId: null, input: null });
    expect(screen.queryByLabelText(/This run's version/)).toBeNull();
    click("Fork");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        path: `/v1/runs/${RUN}/fork`,
        body: { draft: true },
      }),
    );
  });

  it("restart sends the node, its scope and the optional input override", async () => {
    const { onSubmit } = open({ kind: "restart", nodeId: "draft", nodeName: "Draft", scope: "0" });
    expect(screen.getByText("Restart from Draft")).toBeTruthy();
    act(() => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: '{"prompt":"x"}' } });
    });
    click("Restart");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        path: `/v1/runs/${RUN}/restart`,
        body: { nodeId: "draft", scope: "0", input: { prompt: "x" } },
      }),
    );
  });

  it("retry posts to the node run and stays open when the request fails", async () => {
    const onSubmit = vi.fn((_: RunActionRequest) => Promise.reject(new Error("conflict")));
    const { onOpenChange } = open(
      { kind: "retry", nodeRunId: "nr-1", nodeName: "Fetch" },
      onSubmit,
    );
    click("Retry node");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ path: `/v1/runs/${RUN}/node-runs/nr-1/retry` }),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText("Retry Fetch")).toBeTruthy();
  });

  it("parses optional JSON objects", () => {
    expect(parseObject("  ")).toEqual({});
    expect(parseObject('{"a":1}')).toEqual({ value: { a: 1 } });
    expect(parseObject("{")).toEqual({ error: "Not valid JSON" });
  });
});

describe("node run detail actions", () => {
  const nodeRun: NodeRunView = {
    id: "nr1",
    nodeId: "fetch",
    nodeName: "Fetch order",
    nodeType: "flowaid.tools.http",
    category: "tool",
    status: "failed",
    attempt: 1,
  };

  it("offers retry and restart only when handlers are given", () => {
    const onRetry = vi.fn();
    const onRestart = vi.fn();
    const { rerender } = render(<NodeRunPanel nodeRun={nodeRun} attempts={[nodeRun]} />);
    expect(screen.queryByRole("button", { name: /Retry node/ })).toBeNull();
    rerender(
      <NodeRunPanel
        nodeRun={nodeRun}
        attempts={[nodeRun]}
        onRetry={onRetry}
        onRestart={onRestart}
      />,
    );
    click(/Retry node/);
    click(/Restart from here/);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRestart).toHaveBeenCalledOnce();
  });
});
