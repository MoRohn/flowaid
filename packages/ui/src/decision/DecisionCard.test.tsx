import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import type { DecisionResult } from "@/types";
import {
  failoverAttempts,
  makeBooleanDecision,
  makeChoiceDecision,
  makeScoreDecision,
} from "@/lib/decisionBuilders";
import { CalibrationChart, expectedCalibrationError } from "./CalibrationChart";
import { DecisionBadge, decisionTooltipRows } from "./DecisionBadge";
import { DecisionBundle, bundleCost } from "./DecisionBundle";
import { DecisionCard } from "./DecisionCard";
import { FailoverNotice, failoverFromAttempts, failoverSentence } from "./FailoverNotice";
import { NoulGauge, noulIsUndecided } from "./NoulGauge";
import { decisionSummary, noulProbability, noulReadout } from "./distribution";

beforeAll(installDomStubs);
afterEach(cleanup);

const CHOICE_QUESTION = "Which team should handle this ticket?";
const CHOICE: DecisionResult = makeChoiceDecision({
  probabilities: { security: 0.81, technical: 0.12, billing: 0.04, sales: 0.03 },
  model: "jev-latest",
  latencyMs: 84,
  usage: { inputTokens: 412, outputTokens: 6 },
  costUsd: 0.00021,
});

const BOOL: DecisionResult = makeBooleanDecision({
  pYes: 0.96,
  model: "jev-latest",
  latencyMs: 52,
});

const SCORE: DecisionResult = makeScoreDecision({
  levels: ["Minimal", "Low", "Moderate", "High", "Critical"],
  value: 3.72,
  confidence: 0.77,
  probabilities: [0.01, 0.03, 0.08, 0.42, 0.46],
  provider: "openai",
  model: "gpt-5-mini",
  latencyMs: 1240,
  attempts: failoverAttempts([
    { provider: "typesafe", model: "jev-latest", latencyMs: 2000, errorCode: "TIMEOUT_ERROR" },
    { provider: "openai", model: "gpt-5-mini", latencyMs: 1240 },
  ]),
});

describe("decisionSummary", () => {
  it("formats each kind", () => {
    expect(decisionSummary(CHOICE)).toEqual({ value: "security", number: "0.81" });
    expect(decisionSummary(BOOL)).toEqual({ value: "yes", number: "0.96" });
    expect(decisionSummary(SCORE)).toEqual({ value: "Critical", number: "3.7" });
    expect(decisionSummary(makeBooleanDecision({ pYes: 0.09 }))).toEqual({
      value: "no",
      number: "0.91",
    });
  });

  it("reads P(yes) from pYes and clamps it", () => {
    expect(noulProbability({ pYes: 0.96 })).toBe(0.96);
    expect(noulProbability({ pYes: 0.09 })).toBe(0.09);
    expect(noulProbability({ pYes: Number.NaN })).toBe(0.5);
    expect(makeBooleanDecision({ pYes: 0.09 })).toMatchObject({ value: false, confidence: 0.91 });
    expect(noulReadout(0.3)).toEqual({ answer: "no", probability: 0.7 });
    expect(noulIsUndecided(0.55)).toBe(true);
    expect(noulIsUndecided(0.61)).toBe(false);
  });
});

describe("DecisionBadge", () => {
  it("renders the kind-specific text and full tooltip rows", () => {
    render(<DecisionBadge result={CHOICE} distribution={false} />);
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("0.81")).toBeInTheDocument();
    expect(decisionTooltipRows(CHOICE).map((r) => r.key)).toEqual([
      "security",
      "technical",
      "billing",
      "sales",
    ]);
    expect(decisionTooltipRows(BOOL).map((r) => r.key)).toEqual(["yes", "no"]);
    expect(decisionTooltipRows(SCORE)[0]).toMatchObject({ key: "4", label: "Critical" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is a focusable button that opens the distribution from the keyboard", async () => {
    const user = userEvent.setup();
    render(<DecisionBadge result={CHOICE} question={CHOICE_QUESTION} />);
    const badge = screen.getByRole("button", { name: "security 0.81" });
    expect(badge).toHaveAttribute("aria-haspopup", "dialog");
    await user.tab();
    expect(badge).toHaveFocus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: /Decision distribution/ });
    expect(within(dialog).getByText(CHOICE_QUESTION)).toBeInTheDocument();
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("data-key"));
    expect(rows.slice(0, 4)).toEqual(["security", "technical", "billing", "sales"]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(badge).toHaveFocus();
  });
});

describe("NoulGauge", () => {
  it("reads yes, no and undecided", () => {
    render(<NoulGauge probability={0.96} />);
    expect(screen.getByText("0.96 yes")).toBeInTheDocument();
    cleanup();
    render(<NoulGauge probability={0.09} inline />);
    expect(screen.getByText("0.91 no")).toBeInTheDocument();
    cleanup();
    render(<NoulGauge probability={0.53} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-answer", "undecided");
  });
});

describe("DecisionCard", () => {
  it("renders the choice visual, the footer and the gate", () => {
    const { container } = render(
      <DecisionCard
        title="Intent"
        result={CHOICE}
        question={CHOICE_QUESTION}
        thresholds={{ review: 0.6, auto: 0.9 }}
      />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-kind", "choice");
    expect(screen.getByText("Which team should handle this ticket?")).toBeInTheDocument();
    expect(screen.getAllByText("security").length).toBeGreaterThan(0);
    expect(screen.getByText("typesafe:jev-latest")).toBeInTheDocument();
    expect(screen.getByText("84 ms")).toBeInTheDocument();
    expect(screen.getByText("412→6")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("data-outcome", "review");
  });

  it("shows the failover notice and the score scale for a failed-over score", () => {
    render(<DecisionCard title="Urgency" result={SCORE} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Answered by openai:gpt-5-mini after typesafe:jev-latest failed (TIMEOUT_ERROR)",
    );
    expect(failoverFromAttempts(CHOICE.attempts)).toBeUndefined();
    expect(
      failoverFromAttempts([
        { provider: "typesafe", model: "jev-latest", outcome: "skipped_unhealthy", latencyMs: 0 },
        { provider: "openai", model: "gpt-5-mini", outcome: "ok", latencyMs: 9 },
      ]),
    ).toEqual({
      from: "typesafe:jev-latest",
      reason: "was skipped (unhealthy)",
    });
    expect(screen.getAllByText("Critical").length).toBeGreaterThan(0);
    expect(
      failoverSentence("openai", "gpt-5-mini", { from: "TypeSafe", reason: "timed out" }),
    ).toBe("Answered by openai:gpt-5-mini after TypeSafe timed out");
  });

  it("renders the noul gauge for booleans and hides the footer on request", () => {
    render(<DecisionCard result={BOOL} hideFooter />);
    expect(screen.getByText("0.96 yes")).toBeInTheDocument();
    expect(screen.queryByText("52 ms")).toBeNull();
  });
});

describe("DecisionBundle", () => {
  it("sums cost, defaults latency to the slowest decision and counts failovers", () => {
    const items = [
      { id: "a", name: "Intent", result: CHOICE },
      { id: "b", name: "Urgency", result: SCORE },
      { id: "c", name: "Escalation", result: BOOL },
    ];
    expect(bundleCost(items)).toBeCloseTo(0.00021);
    expect(bundleCost([])).toBeUndefined();
    render(<DecisionBundle items={items} requestId="req_1" />);
    expect(screen.getByText("3 decisions · 1 request")).toBeInTheDocument();
    expect(screen.getAllByText("1.24 s").length).toBeGreaterThan(1);
    expect(screen.getByText("1 failover")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });
});

describe("FailoverNotice", () => {
  it("names the fallback and the cause", () => {
    render(
      <FailoverNotice
        provider="openai"
        model="gpt-5-mini"
        failover={{ from: "typesafe", reason: "returned 503" }}
      />,
    );
    expect(screen.getByRole("note")).toHaveAttribute("data-failover-from", "typesafe");
  });
});

describe("CalibrationChart", () => {
  const bins = [
    { lower: 0, upper: 0.5, predicted: 0.3, observed: 0.4, count: 10 },
    { lower: 0.5, upper: 1, predicted: 0.9, observed: 0.8, count: 30 },
    { lower: 1, upper: 1, predicted: 1, observed: 1, count: 0 },
  ];

  it("computes a count-weighted ECE", () => {
    expect(expectedCalibrationError(bins)).toBeCloseTo((10 / 40) * 0.1 + (30 / 40) * 0.1);
    expect(expectedCalibrationError([])).toBe(0);
  });

  it("renders bins with accessible labels and a tooltip on focus", () => {
    render(<CalibrationChart bins={bins} width={320} />);
    expect(screen.getByText("ECE 0.100")).toBeInTheDocument();
    const hit = screen.getByRole("img", {
      name: "0.50–1.00: predicted 0.90, observed 0.80, 30 samples",
    });
    fireEvent.focus(hit);
    expect(screen.getByRole("tooltip")).toHaveTextContent("overconfident 10.0%");
  });
});
