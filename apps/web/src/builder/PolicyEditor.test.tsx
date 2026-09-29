import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { NodePolicy } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { PolicyEditor, patchPolicy } from "./PolicyEditor";
import { policySummary } from "./NodeInspector";

beforeAll(() => installDomStubs());
afterEach(cleanup);

describe("patchPolicy", () => {
  it("sets and clears each field, keeping the ones it does not edit", () => {
    const privacy = { sensitive: true } as NodePolicy["privacy"];
    const p = patchPolicy({ privacy }, { maxAttempts: 3, timeoutSeconds: 45 });
    expect(p).toEqual({ privacy, retry: { maxAttempts: 3 }, timeoutMs: 45_000 });
    expect(patchPolicy(p, { maxAttempts: null, timeoutSeconds: null })).toEqual({ privacy });
  });

  it("keeps the backoff when only the attempts change", () => {
    const retry = { maxAttempts: 2, backoff: { type: "fixed", initialMs: 100 } } as never;
    expect(patchPolicy({ retry }, { maxAttempts: 5 })?.retry).toEqual({
      maxAttempts: 5,
      backoff: { type: "fixed", initialMs: 100 },
    });
  });

  it("returns undefined once nothing but the default onError is left", () => {
    const parsed = { onError: "fail", timeoutMs: 1000 } as Partial<NodePolicy>;
    expect(patchPolicy(parsed, { timeoutSeconds: null })).toBeUndefined();
    expect(patchPolicy({ onError: "route" }, { onError: "fail" })).toBeUndefined();
    expect(patchPolicy(undefined, { onError: "ignore" })).toEqual({ onError: "ignore" });
  });
});

describe("policySummary", () => {
  it("lists only what the node overrides", () => {
    expect(policySummary(undefined)).toBe("");
    expect(
      policySummary({ onError: "route", retry: { maxAttempts: 3 }, timeoutMs: 45_000 } as never),
    ).toBe("failed path · 3 attempts · 45 s");
  });
});

function Harness({ initial }: { initial?: Partial<NodePolicy> }) {
  const [policy, setPolicy] = useState<Partial<NodePolicy> | undefined>(initial);
  return (
    <>
      <PolicyEditor
        nodeId="n"
        policy={policy}
        defaultTimeoutMs={120_000}
        defaultAttempts={1}
        onChange={setPolicy}
      />
      <output data-testid="policy">{JSON.stringify(policy ?? null)}</output>
    </>
  );
}

const stored = () => JSON.parse(screen.getByTestId("policy").textContent ?? "null") as unknown;

describe("PolicyEditor", () => {
  it("writes a number on blur, not while typing, and clearing it restores the default", () => {
    render(<Harness />);
    const attempts = screen.getByRole("spinbutton", { name: "Attempts" });
    expect(attempts.getAttribute("placeholder")).toBe("Default: 1");
    fireEvent.change(attempts, { target: { value: "3" } });
    expect(stored()).toBeNull();
    fireEvent.blur(attempts);
    expect(stored()).toEqual({ retry: { maxAttempts: 3 } });

    fireEvent.change(attempts, { target: { value: "" } });
    fireEvent.blur(attempts);
    expect(stored()).toBeNull();
  });

  it("explains each on-error choice and stores it", () => {
    render(<Harness />);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Stop the run/ }).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Take the failed path/ }));
    expect(stored()).toEqual({ onError: "route" });
    expect(screen.getByText(/gets a “failed” connection/)).toBeTruthy();
  });

  it("shows the time limit in seconds and stores milliseconds", () => {
    render(<Harness initial={{ timeoutMs: 30_000 }} />);
    const timeout = screen.getByRole("spinbutton", { name: "Time limit" });
    expect((timeout as HTMLInputElement).value).toBe("30.000");
    fireEvent.change(timeout, { target: { value: "90" } });
    fireEvent.keyDown(timeout, { key: "Enter" });
    expect(stored()).toEqual({ timeoutMs: 90_000 });
  });
});
