import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { JsonSchema } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { RunTab, missingRequired, type RunTabProps } from "./RunTab";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const INPUTS = {
  type: "object",
  required: ["message"],
  properties: { message: { type: "string", title: "Message" } },
} as unknown as JsonSchema;

const props = (over: Partial<RunTabProps> = {}): RunTabProps => ({
  inputs: INPUTS,
  environments: [],
  environmentId: null,
  onEnvironmentChange: () => undefined,
  value: null,
  onValueChange: () => undefined,
  onRun: vi.fn(),
  running: false,
  status: null,
  ...over,
});

describe("missingRequired", () => {
  it("treats blank strings as missing", () => {
    expect(missingRequired(INPUTS, {})).toEqual(["message"]);
    expect(missingRequired(INPUTS, { message: "  " })).toEqual(["message"]);
    expect(missingRequired(INPUTS, { message: "hi" })).toEqual([]);
  });
});

describe("RunTab", () => {
  it("does not send a run while a required field is empty, and names it", () => {
    const p = props();
    render(<RunTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Run draft" }));
    expect(p.onRun).not.toHaveBeenCalled();
    expect(screen.getByText("Fill in Message to run.")).toBeTruthy();
  });

  it("runs with the typed input", async () => {
    const p = props({ value: { message: "Where is my order?" } });
    render(<RunTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Run draft" }));
    await waitFor(() => expect(p.onRun).toHaveBeenCalledWith({ message: "Where is my order?" }));
  });

  it("lists what blocks the run with a way to reach each problem", () => {
    const show = vi.fn();
    render(
      <RunTab
        {...props({
          disabledReason: "Fix 1 problem in the draft before it can run.",
          problems: [{ key: "a", text: "Generate text: This step needs a key.", onShow: show }],
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Run draft" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Generate text: This step needs a key.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(show).toHaveBeenCalled();
  });

  it("shows why the server refused the last run, with its request id", () => {
    render(
      <RunTab
        {...props({
          error: {
            kind: "secrets",
            title: "A key this workflow needs is not connected for this environment.",
            action: "Bind a saved credential to it.",
            items: ["secret OPENAI_API_KEY is not bound in this environment"],
            code: "WORKFLOW_VALIDATION_ERROR",
            requestId: "req-9",
          },
          secretsHref: "/ws/workflows/w/settings?tab=secrets",
        })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("not bound in this environment");
    expect(screen.getByRole("alert").textContent).toContain("request req-9");
    expect(screen.getByRole("link", { name: "Open Secrets settings" }).getAttribute("href")).toBe(
      "/ws/workflows/w/settings?tab=secrets",
    );
  });
});
