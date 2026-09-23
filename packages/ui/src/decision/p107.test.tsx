import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DecisionResult } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { JsonView, redactionOf } from "@/data/JsonView";
import { ConfusionMatrix, confusionModel } from "./ConfusionMatrix";
import { DecisionBadge } from "./DecisionBadge";

installDomStubs();
afterEach(cleanup);

/** `packages/workflow-core/fixtures/events/`, resolved from this test file (jsdom has no file URLs). */
function eventsDir(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not report the test path");
  return join(dirname(testPath), "../../../workflow-core/fixtures/events/");
}

const fixture = JSON.parse(readFileSync(join(eventsDir(), "DECISION_COMPLETED.json"), "utf8")) as {
  question: string;
  decision: DecisionResult;
};

describe("DistributionPopover (through DecisionBadge)", () => {
  it("opens the real fixture's distribution with provider, latency, cost and request id", async () => {
    render(<DecisionBadge result={fixture.decision} question={fixture.question} />);
    await userEvent.click(screen.getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(fixture.question)).toBeTruthy();
    expect(within(dialog).getByText(/typesafe:jev-1\.13\.0/).textContent).toContain(
      "ts_req_01J8Z0X1",
    );
  });

  it("lists failover hops that did not answer", async () => {
    const result = {
      ...fixture.decision,
      attempts: [
        {
          provider: "typesafe",
          model: "jev-1.13.0",
          outcome: "error",
          errorCode: "PROVIDER_OVERLOADED",
          latencyMs: 40,
        },
        { provider: "llm", model: "gpt-4.1-mini", outcome: "ok", latencyMs: 700 },
      ],
    } as DecisionResult;
    render(<DecisionBadge result={result} />);
    await userEvent.click(screen.getByRole("button"));
    const hops = await screen.findByRole("list", { name: "Failover" });
    expect(hops.textContent).toContain("typesafe:jev-1.13.0 PROVIDER_OVERLOADED");
  });
});

describe("ConfusionMatrix", () => {
  const pairs = [
    { expected: "billing", actual: "billing" },
    { expected: "billing", actual: "billing" },
    { expected: "billing", actual: "bug" },
    { expected: "bug", actual: "bug" },
    { expected: "account", actual: "billing" },
  ];

  it("counts pairs and derives accuracy, recall and precision", () => {
    const m = confusionModel(pairs, ["billing", "bug", "account"]);
    expect(m.counts).toEqual([
      [2, 1, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
    expect(m).toMatchObject({ total: 5, correct: 3 });
    expect(m.recall).toEqual([2 / 3, 1, 0]);
    expect(m.precision).toEqual([2 / 3, 0.5, null]);
    expect(confusionModel([{ expected: "x", actual: "y" }]).labels).toEqual(["x", "y"]);
  });

  it("renders an accessible table", () => {
    render(<ConfusionMatrix pairs={pairs} labels={["billing", "bug", "account"]} title="Intent" />);
    const table = screen.getByRole("table", { name: "Intent" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getByRole("rowheader", { name: "account" })).toBeTruthy();
    expect(table.textContent).toContain("accuracy 60%");
    render(<ConfusionMatrix pairs={[]} />);
    expect(screen.getByText("No evaluated decisions yet.")).toBeTruthy();
  });
});

describe("JsonView redaction markers", () => {
  it("recognises masked, hashed and dropped values", () => {
    expect(redactionOf("[REDACTED:pii]")).toEqual({ mode: "mask", dataClass: "pii" });
    expect(redactionOf("[REDACTED]")).toEqual({ mode: "mask" });
    expect(redactionOf("sha256:0123456789abcdef")).toEqual({ mode: "hash" });
    expect(redactionOf({ $redacted: true })).toEqual({ mode: "drop" });
    expect(redactionOf({ $redacted: true, other: 1 })).toBeNull();
    expect(redactionOf("REDACTED")).toBeNull();
  });

  it("renders them as markers instead of values", () => {
    const { container } = render(
      <JsonView
        value={{
          email: "[REDACTED:pii]",
          ssn: { $redacted: true },
          id: "sha256:0123456789abcdef",
          name: "Dana",
        }}
        expandDepth={2}
      />,
    );
    const markers = [...container.querySelectorAll("[data-redaction]")].map((m) => [
      m.getAttribute("data-redaction"),
      m.textContent?.split(":")[0]?.trim(),
    ]);
    expect(markers).toEqual([
      ["mask", "redacted · pii"],
      ["drop", "dropped"],
      ["hash", "hashed 0123456789abcdef"],
    ]);
    expect(container.textContent).toContain("Dana");
  });
});
