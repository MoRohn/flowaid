import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { AskPanel, type AskPanelProps } from "./AskPanel";
import type { AssistantAnswer, Turn } from "./logic";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const ANSWER: AssistantAnswer = {
  statements: [
    { text: "Support triage failed 20 times.", kind: "fact", sources: ["r1"] },
    { text: "Billing costs doubled.", kind: "uncertain", sources: [], unverified: true },
    { text: "Roll back to version 1.", kind: "recommendation", sources: ["w1"] },
  ],
  sources: [
    { id: "r1", kind: "run", label: "Support triage run r1", workflowId: "w1" },
    { id: "w1", kind: "workflow", label: "Support triage", workflowId: "w1" },
  ],
  toolCalls: [{ name: "get_insights", ok: true }],
  rounds: 1,
  stopped: "budget",
  usage: { inputTokens: 900, outputTokens: 100 },
  costUsd: 0.25,
  promptHash: "h",
  model: { provider: "fake", model: "m" },
};

function mount(p: Partial<AskPanelProps> = {}) {
  const props: AskPanelProps = {
    ws: "default",
    open: true,
    onOpenChange: vi.fn(),
    turns: [],
    pending: false,
    onAsk: vi.fn(),
    onClear: vi.fn(),
    ...p,
  };
  render(<AskPanel {...props} />);
  return props;
}

describe("AskPanel", () => {
  it("offers suggested questions and asks on Enter, not on Shift+Enter", () => {
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "What is waiting for my approval?" }));
    expect(p.onAsk).toHaveBeenCalledWith("What is waiting for my approval?");
    const box = screen.getByLabelText("Your question");
    fireEvent.change(box, { target: { value: "Why is billing slow?" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(p.onAsk).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(p.onAsk).toHaveBeenLastCalledWith("Why is billing slow?");
  });

  it("labels each statement's kind, links its sources and says what answered", () => {
    const turns: Turn[] = [{ id: "t1", question: "What broke?", answer: ANSWER }];
    const p = mount({ turns });
    const answer = screen.getByRole("list", { name: "Answer" });
    const items = within(answer).getAllByRole("listitem");
    expect(within(items[0] as HTMLElement).getByText("Fact")).toBeTruthy();
    expect(
      within(items[0] as HTMLElement)
        .getByRole("link", { name: "Support triage run r1" })
        .getAttribute("href"),
    ).toBe("/default/runs/r1");
    expect(within(items[1] as HTMLElement).getByText("Unconfirmed")).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText(/without a record to back it/)).toBeTruthy();
    expect(within(items[2] as HTMLElement).getByText("Suggestion")).toBeTruthy();
    expect(screen.getByText(/fake\/m · 1 lookup · 1,000 tokens · \$0\.25/)).toBeTruthy();
    expect(screen.getByText(/stopped at the spending limit/)).toBeTruthy();
    fireEvent.click(within(items[0] as HTMLElement).getByRole("link"));
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows progress and errors, and can clear the conversation", () => {
    const p = mount({
      turns: [
        { id: "t1", question: "First?" },
        { id: "t2", question: "Second?", error: "Wait a moment and ask again." },
      ],
      pending: true,
    });
    expect(screen.getByText("Looking through your workspace…")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Wait a moment");
    expect(screen.getByRole("button", { name: "Ask" }).disabled).toBe(true);
    const clear = screen.getByRole("button", { name: "Clear conversation" });
    expect(clear.disabled).toBe(true);
    cleanup();
    const q = mount({ turns: [{ id: "t1", question: "Done?", answer: ANSWER }] });
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(q.onClear).toHaveBeenCalled();
    void p;
  });
});
