import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ModelView } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import {
  filterModelsByKind,
  formatModelPrice,
  groupModelsByProvider,
  isDecisionModel,
} from "./ModelPicker";
import { DEFAULT_RETRY_POLICY, RetryPolicyEditor, retrySchedule } from "./RetryPolicyEditor";
import { ThresholdField } from "./ThresholdField";
import { filterCredentials } from "./CredentialPicker";
import { formatJson } from "./CodeEditor";

installDomStubs();
afterEach(cleanup);

describe("retrySchedule", () => {
  it("doubles exponential delays up to the cap", () => {
    expect(
      retrySchedule({
        ...DEFAULT_RETRY_POLICY,
        maxAttempts: 5,
        initialDelayMs: 500,
        maxDelayMs: 3000,
      }),
    ).toEqual([500, 1000, 2000, 3000]);
  });
  it("repeats fixed delays and yields nothing for a single attempt", () => {
    expect(
      retrySchedule({
        ...DEFAULT_RETRY_POLICY,
        backoff: "fixed",
        maxAttempts: 3,
        initialDelayMs: 250,
      }),
    ).toEqual([250, 250]);
    expect(retrySchedule({ ...DEFAULT_RETRY_POLICY, maxAttempts: 1 })).toEqual([]);
  });
});

describe("RetryPolicyEditor", () => {
  it("shows the schedule and toggles error codes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RetryPolicyEditor onChange={onChange} />);
    expect(screen.getByText("try → wait 500 ms → wait 1.00 s")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Any HTTP 5xx/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        retryableErrorCodes: [...DEFAULT_RETRY_POLICY.retryableErrorCodes, "HTTP_5XX"],
      }),
    );
  });
  it("explains that irreversible nodes are never retried and disables the controls", () => {
    render(<RetryPolicyEditor irreversible />);
    expect(screen.getByText(/Never retried/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Max attempts" })).toBeDisabled();
    expect(screen.getByText("fail on first error")).toBeInTheDocument();
  });
});

describe("ThresholdField", () => {
  it("wraps the gate editor and forwards edits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThresholdField onChange={onChange} label="Confidence gate" />);
    expect(screen.getByRole("slider", { name: "Review floor" })).toHaveAttribute(
      "aria-valuenow",
      "0.7",
    );
    const auto = screen.getByRole("spinbutton", { name: /pass at or above/i });
    await user.clear(auto);
    await user.type(auto, "0.95");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ review: 0.7, auto: 0.95 });
  });
  it("is disabled through the field context", () => {
    render(<ThresholdField disabled />);
    expect(screen.getByRole("slider", { name: "Pass threshold" })).toHaveAttribute("data-disabled");
  });
});

describe("models", () => {
  const models: ModelView[] = [
    {
      id: "jev-latest",
      provider: "TypeSafe",
      name: "jev-latest",
      kind: "decision",
      contextTokens: 32000,
      inputCostPerMTok: 0.5,
      outputCostPerMTok: 0,
    },
    {
      id: "gpt-5-mini",
      provider: "OpenAI",
      name: "gpt-5-mini",
      kind: "decision",
      contextTokens: 400000,
    },
    { id: "rule-adapter", provider: "rule", name: "Rule adapter", kind: "decision" },
    {
      id: "claude-sonnet-4-5",
      provider: "Anthropic",
      name: "claude-sonnet-4-5",
      kind: "generation",
      inputCostPerMTok: 3,
      outputCostPerMTok: 15,
    },
    { id: "llama3.1:8b", provider: "Ollama", name: "llama3.1:8b", kind: "generation", local: true },
  ];
  it("limits decision models to jev-* and the rule/LLM adapters", () => {
    expect(isDecisionModel(models[1] as ModelView)).toBe(false);
    expect(filterModelsByKind(models, "decision").map((m) => m.id)).toEqual([
      "jev-latest",
      "rule-adapter",
    ]);
    expect(filterModelsByKind(models, "generation").map((m) => m.id)).toEqual([
      "claude-sonnet-4-5",
      "llama3.1:8b",
    ]);
    expect(filterModelsByKind(models)).toHaveLength(5);
  });
  it("formats prices and groups by provider", () => {
    expect(formatModelPrice(models[0] as ModelView)).toBe("$0.50 / $0");
    expect(formatModelPrice(models[3] as ModelView)).toBe("$3.00 / $15.00");
    expect(formatModelPrice(models[4] as ModelView)).toBe("free");
    expect(formatModelPrice(models[1] as ModelView)).toBe("—");
    expect(groupModelsByProvider(models).map((g) => g.provider)).toEqual([
      "TypeSafe",
      "OpenAI",
      "rule",
      "Anthropic",
      "Ollama",
    ]);
  });
});

describe("credentials and JSON", () => {
  it("filters by type and sorts by last use", () => {
    const list = filterCredentials(
      [
        { id: "a", name: "Old", type: "http_bearer", lastUsedAt: "2026-09-01T00:00:00Z" },
        { id: "b", name: "Fresh", type: "http_bearer", lastUsedAt: "2026-09-20T00:00:00Z" },
        { id: "c", name: "Other", type: "openai" },
      ],
      "http_bearer",
    );
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
  });
  it("formats JSON or reports the parse error", () => {
    expect(formatJson('{"a":1}')).toEqual({ ok: true, text: '{\n  "a": 1\n}' });
    expect(formatJson("{a:1}").ok).toBe(false);
  });
});
