import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { ProposedOutputEditor, diffWords, estimateTokens } from "./ProposedOutputEditor";

beforeAll(installDomStubs);
afterEach(cleanup);

const ORIGINAL = "Thanks for flagging this. The refund should appear within 5 to 7 business days.";

describe("estimateTokens", () => {
  it("approximates four characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hi")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("a".repeat(401))).toBe(101);
  });
});

describe("diffWords", () => {
  it("marks changed words and keeps the rest equal", () => {
    const spans = diffWords("refund within 5 to 7 days", "refund within 3 to 5 days");
    expect(spans.map((s) => s.type)).toEqual([
      "equal",
      "remove",
      "add",
      "equal",
      "remove",
      "add",
      "equal",
    ]);
    expect(spans.filter((s) => s.type === "add").map((s) => s.text)).toEqual(["3", "5"]);
    expect(spans.filter((s) => s.type === "remove").map((s) => s.text)).toEqual(["5", "7"]);
  });

  it("returns one equal run for identical text", () => {
    expect(diffWords("same", "same")).toEqual([{ type: "equal", text: "same" }]);
  });
});

describe("ProposedOutputEditor", () => {
  it("shows the proposed text read-only with a character and token estimate", () => {
    render(<ProposedOutputEditor original={ORIGINAL} />);
    expect(screen.getByText(ORIGINAL)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByText(`${ORIGINAL.length} chars · ~${estimateTokens(ORIGINAL)} tokens`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("edits, shows the diff and resets to the original", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ProposedOutputEditor original="within 5 to 7 days" onChange={onChange} diffMode="words" />,
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "within 3 to 5 days");
    expect(onChange).toHaveBeenLastCalledWith("within 3 to 5 days");

    const region = screen.getByRole("region", { name: "Changes from the proposed output" });
    expect(region.querySelectorAll("ins")).toHaveLength(2);
    expect(region.querySelectorAll("del")).toHaveLength(2);
    expect(screen.getByText("edited")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith("within 5 to 7 days");
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("works controlled and toggles Done back to the read view", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProposedOutputEditor original={ORIGINAL} value={ORIGINAL} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveValue(ORIGINAL);
    rerender(<ProposedOutputEditor original={ORIGINAL} value="Changed." />);
    expect(screen.getByRole("textbox")).toHaveValue("Changed.");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByText("Changed.").length).toBeGreaterThan(0);
  });
});
