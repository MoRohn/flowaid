import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { DistributionList } from "./DistributionList";
import { normalizeDistribution } from "./distribution";

installDomStubs();
afterEach(cleanup);

const WIDE = {
  auth: 0.44,
  billing: 0.21,
  api: 0.13,
  dashboard: 0.09,
  mobile: 0.06,
  integrations: 0.04,
  docs: 0.02,
  other: 0.01,
};

function rowKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("li[data-key]")).map(
    (li) => li.getAttribute("data-key") ?? "",
  );
}

describe("DistributionList", () => {
  it("sorts rows by probability descending regardless of input order", () => {
    const { container } = render(
      <DistributionList
        distribution={{ sales: 0.03, security: 0.81, billing: 0.04, technical: 0.12 }}
      />,
    );
    expect(rowKeys(container)).toEqual(["security", "technical", "billing", "sales"]);
    expect(container.querySelector("li[data-winner]")).toHaveAttribute("data-key", "security");
  });

  it("highlights an explicit chosen option even when it is not the argmax", () => {
    const { container } = render(<DistributionList distribution={{ a: 0.6, b: 0.4 }} chosen="b" />);
    expect(container.querySelector("li[data-winner]")).toHaveAttribute("data-key", "b");
  });

  it("truncates to maxRows and folds the tail into a disclosure", async () => {
    const user = userEvent.setup();
    const { container } = render(<DistributionList distribution={WIDE} maxRows={3} />);
    const trigger = screen.getByRole("button", { name: /\+5 more/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.textContent).toContain("0.22");
    expect(rowKeys(container).slice(0, 3)).toEqual(["auth", "billing", "api"]);

    await user.click(trigger);
    expect(screen.getByRole("button", { name: /Show fewer/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(rowKeys(container)).toHaveLength(8);
  });

  it("renders no disclosure when every row fits", () => {
    render(<DistributionList distribution={WIDE} maxRows={8} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses labels and formats probabilities to two decimals", () => {
    render(
      <DistributionList
        distribution={{ "3": 0.42, "4": 0.46, "2": 0.12 }}
        labels={{ "2": "Moderate", "3": "High", "4": "Critical" }}
        showKeys
      />,
    );
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("0.46")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

describe("normalizeDistribution", () => {
  it("scales probabilities that do not sum to 1", () => {
    const out = normalizeDistribution({ a: 2, b: 1, c: 1 });
    expect(out.map((e) => e.probability)).toEqual([0.5, 0.25, 0.25]);
  });

  it("treats negative and non-finite values as zero and handles all-zero input", () => {
    const out = normalizeDistribution({ a: -1, b: Number.NaN, c: 3 });
    expect(out[0]).toMatchObject({ key: "c", probability: 1 });
    expect(out.slice(1).every((e) => e.probability === 0)).toBe(true);
    const uniform = normalizeDistribution({ a: 0, b: 0 });
    expect(uniform.map((e) => e.probability)).toEqual([0.5, 0.5]);
    expect(normalizeDistribution({})).toEqual([]);
  });

  it("keeps input order when sort is off", () => {
    const out = normalizeDistribution(
      [
        { key: "low", probability: 0.1 },
        { key: "high", probability: 0.9 },
      ],
      { sort: false },
    );
    expect(out.map((e) => e.key)).toEqual(["low", "high"]);
  });
});
