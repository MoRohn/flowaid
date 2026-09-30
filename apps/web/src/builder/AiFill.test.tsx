import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonSchema } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { ApiError } from "~/api/client";
import { apiError, bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";
import { enteredFields, fillProblem, previewRows, sampleRequest } from "./aiFill";

vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features: {}, can: () => true }),
}));

const { RunTab } = await import("./RunTab");

const INPUTS = {
  type: "object",
  required: ["reason", "order_total"],
  properties: {
    reason: { type: "string", title: "Customer's reason" },
    order_total: { type: "number", title: "Order total (USD)" },
    order_id: { type: "string", title: "Order number" },
  },
} as unknown as JsonSchema;

const ROUTE = "POST /v1/workflows/wf-1/ai/sample-inputs";
const SAMPLES = {
  samples: [
    {
      title: "Cracked mug",
      why: "Eligible and under the limit, so it is refunded automatically.",
      input: { reason: "The mug arrived cracked.", order_total: 18.5, order_id: "10482" },
    },
    {
      title: "Just over the limit",
      why: "Eligible but over the refund limit, so an agent reviews it.",
      input: { reason: "Wrong size.", order_total: 50.01, order_id: "10483" },
    },
  ],
  rejected: 1,
  model: { provider: "openai", model: "gpt-test" },
  usage: { inputTokens: 900, outputTokens: 200 },
  costUsd: 0.0012,
};

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

beforeAll(() => {
  installDomStubs();
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
});
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The Run tab with its value held the way the builder holds it. */
function Harness({
  initial = {},
  available = true,
  onRun = vi.fn(),
}: {
  initial?: Record<string, unknown>;
  available?: boolean;
  onRun?: (v: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState<Record<string, unknown> | null>(initial);
  return (
    <RunTab
      inputs={INPUTS}
      environments={[]}
      environmentId={null}
      onEnvironmentChange={() => undefined}
      value={value}
      onValueChange={setValue}
      onRun={onRun}
      running={false}
      status={null}
      aiFill={{
        workflowId: "wf-1",
        getDefinition: () => ({ name: "Refunds", inputs: INPUTS }),
        available,
      }}
    />
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Fill with AI" }));
const write = () => fireEvent.click(screen.getByRole("button", { name: "Write 3 examples" }));

describe("Fill with AI in the Run tab", () => {
  it("writes examples, shows what each tests, fills the form on request and undoes it", async () => {
    const fetchMock = stubApi({ [ROUTE]: () => SAMPLES });
    const onRun = vi.fn();
    render(withClient(<Harness onRun={onRun} />));
    open();
    fireEvent.click(screen.getByRole("radio", { name: "Edge cases" }));
    expect(screen.getByText(/at and just past the limits/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Describe the case/), {
      target: { value: "  a refund right at the limit " },
    });
    write();
    expect(screen.getByRole("button", { name: /Writing 3 examples/ })).toBeTruthy();
    await screen.findByText("Cracked mug");
    expect(bodyOf(callsTo(fetchMock, ROUTE)[0]?.[1])).toEqual({
      definition: { name: "Refunds", inputs: INPUTS },
      scenario: "edge",
      count: 3,
      instructions: "a refund right at the limit",
    });
    // what it exercises, the model and cost, and why one was left out
    expect(screen.getByText(/refunded automatically/)).toBeTruthy();
    expect(screen.getByText(/openai\/gpt-test · \$0\.0012\d* · 1 left out/)).toBeTruthy();
    // nothing changes until one is chosen, and choosing one never runs
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use “Just over the limit”" }));
    expect(screen.getByDisplayValue("Wrong size.")).toBeTruthy();
    expect(screen.getByText(/Filled with the example/)).toBeTruthy();
    expect(screen.getByText("In the form")).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();

    // the JSON view holds the same input
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    expect(screen.getByLabelText("Run input JSON").textContent).toContain("50.01");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText(/Filled with the example/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Form" }));
    expect(screen.queryByDisplayValue("Wrong size.")).toBeNull();
  });

  it("keeps the fields already entered unless asked not to, and marks what would change", async () => {
    const fetchMock = stubApi({ [ROUTE]: () => SAMPLES });
    render(withClient(<Harness initial={{ order_id: "999" }} />));
    open();
    expect(
      screen.getByRole("checkbox", { name: /Keep what you entered \(Order number\)/ }),
    ).toBeTruthy();
    write();
    await screen.findByText("Cracked mug");
    expect(bodyOf(callsTo(fetchMock, ROUTE)[0]?.[1])).toMatchObject({
      current: { order_id: "999" },
      keep: ["order_id"],
    });
    // the examples replace 999, and say so in words
    expect(screen.getAllByText(/Replaces \d of 3 values in the form/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("checkbox", { name: /Keep what you entered/ }));
    fireEvent.click(screen.getByRole("button", { name: "Write 3 new examples" }));
    await waitFor(() => expect(callsTo(fetchMock, ROUTE)).toHaveLength(2));
    const second = bodyOf(callsTo(fetchMock, ROUTE)[1]?.[1]) as Record<string, unknown>;
    expect(second.keep).toBeUndefined();
    expect(second.current).toBeUndefined();
  });

  it("does not keep a full form by default, and will not keep every field", async () => {
    const fetchMock = stubApi({ [ROUTE]: () => SAMPLES });
    render(withClient(<Harness initial={{ reason: "Late", order_total: 12, order_id: "7" }} />));
    open();
    const keep = screen.getByRole("checkbox", { name: /Keep what you entered/ });
    expect(keep.getAttribute("aria-checked") ?? String((keep as HTMLInputElement).checked)).toMatch(
      /false/,
    );
    fireEvent.click(keep);
    expect(screen.getByText(/each example would be the same as the form/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write 3 examples" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.click(keep);
    write();
    await screen.findByText("Cracked mug");
    expect(bodyOf(callsTo(fetchMock, ROUTE)[0]?.[1])).not.toHaveProperty("keep");
  });

  it("says how to set up a model instead of offering a button that cannot work", () => {
    const fetchMock = stubApi({});
    render(withClient(<Harness available={false} />));
    open();
    expect(screen.getByText(/Filling inputs needs a text model/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Credentials" }).getAttribute("href")).toBe(
      "/acme/credentials",
    );
    expect(screen.queryByRole("button", { name: "Write 3 examples" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a failure with a way forward and keeps the form as it was", async () => {
    stubApi({ [ROUTE]: () => apiError(502, "PROVIDER_ERROR", "upstream timed out") });
    render(withClient(<Harness initial={{ reason: "mine" }} />));
    open();
    write();
    await screen.findByText("No examples this time");
    expect(screen.getByText(/could not write inputs this time/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText(/upstream timed out · PROVIDER_ERROR/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByDisplayValue("mine")).toBeTruthy();
  });

  it("shows nothing rather than an input the run would refuse", async () => {
    stubApi({ [ROUTE]: () => ({ ...SAMPLES, samples: [], rejected: 3 }) });
    render(withClient(<Harness />));
    open();
    write();
    await screen.findByText("No example fitted this workflow's input rules");
    expect(screen.getByText(/3 left out/)).toBeTruthy();
  });

  it("cancels a request on its way with Escape and closes with a second Escape", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    stubApi({ [ROUTE]: () => new Promise((r) => (resolve = r)) });
    render(withClient(<Harness />));
    open();
    write();
    const describe = screen.getByLabelText(/Describe the case/);
    act(() => {
      fireEvent.keyDown(describe, { key: "Escape" });
    });
    expect(screen.queryByRole("button", { name: /Writing/ })).toBeNull();
    resolve(Response.json(SAMPLES));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("Cracked mug")).toBeNull();
    act(() => {
      fireEvent.keyDown(screen.getByLabelText(/Describe the case/), { key: "Escape" });
    });
    expect(screen.queryByRole("region", { name: "Fill with AI" })).toBeNull();
  });

  it("keeps an unsent description when the panel is closed and reopened", () => {
    stubApi({});
    render(withClient(<Harness />));
    open();
    fireEvent.change(screen.getByLabelText(/Describe the case/), {
      target: { value: "a damaged item" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close Fill with AI" }));
    open();
    expect(screen.getByDisplayValue("a damaged item")).toBeTruthy();
  });
});

describe("fill logic", () => {
  it("counts only fields with something in them as entered", () => {
    expect(enteredFields(INPUTS, { reason: " ", order_total: 0, order_id: null })).toEqual([
      "order_total",
    ]);
  });

  it("compares each field of an example with the form", () => {
    expect(
      previewRows(INPUTS, { reason: "Late", order_total: 5, extra: true }, { order_total: 7 }),
    ).toEqual([
      { key: "reason", label: "Customer's reason", value: "Late", change: "new" },
      { key: "order_total", label: "Order total (USD)", value: "5", change: "changed" },
      { key: "extra", label: "Extra", value: "Yes", change: "new" },
    ]);
  });

  it("only sends entered values when they are kept", () => {
    const base = {
      definition: {},
      scenario: "typical" as const,
      instructions: "",
      current: { order_id: "1", reason: "" },
      schema: INPUTS,
      count: 3,
    };
    expect(sampleRequest({ ...base, keepEntered: true })).toMatchObject({
      keep: ["order_id"],
      current: { order_id: "1", reason: "" },
    });
    expect(sampleRequest({ ...base, keepEntered: false })).not.toHaveProperty("current");
  });

  it("turns failures into what to do next", () => {
    expect(fillProblem(new ApiError(409, "CONFLICT", "No text model")).kind).toBe("no-model");
    expect(fillProblem(new ApiError(429, "RATE_LIMITED", "slow down")).kind).toBe("rate-limited");
    expect(fillProblem(new TypeError("Failed to fetch")).message).toMatch(/Could not reach/);
  });
});
