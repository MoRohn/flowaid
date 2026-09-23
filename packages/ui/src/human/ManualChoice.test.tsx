import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ManualChoice,
  defaultModelPick,
  isEditableTarget,
  type ManualChoiceOption,
} from "./ManualChoice";

afterEach(cleanup);

const TEAMS: ManualChoiceOption[] = [
  { id: "security", label: "Security", probability: 0.71 },
  { id: "billing", label: "Billing", probability: 0.18 },
  { id: "technical", label: "Technical", probability: 0.08 },
  { id: "sales", label: "Sales", probability: 0.03 },
];

describe("defaultModelPick", () => {
  it("returns the highest-probability option", () => {
    expect(defaultModelPick(TEAMS)).toBe("security");
    expect(
      defaultModelPick([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ]),
    ).toBe("a");
    expect(defaultModelPick([])).toBeUndefined();
  });
});

describe("isEditableTarget", () => {
  it("recognises typing fields", () => {
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("ManualChoice", () => {
  it("highlights the model pick without selecting it", () => {
    render(<ManualChoice options={TEAMS} aria-label="Team" />);
    const security = screen.getByRole("radio", { name: /Security/ });
    expect(security).toHaveAttribute("data-model-pick", "true");
    expect(security).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    expect(security).toHaveTextContent("0.71");
  });

  it("selects on click and reports the option id", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ManualChoice options={TEAMS} onValueChange={onValueChange} aria-label="Team" />);
    await user.click(screen.getByRole("radio", { name: /Billing/ }));
    expect(onValueChange).toHaveBeenCalledWith("billing");
    expect(screen.getByRole("radio", { name: /Billing/ })).toHaveAttribute("aria-checked", "true");
  });

  it("selects the nth option with digit keys while focused", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ManualChoice options={TEAMS} onValueChange={onValueChange} aria-label="Team" />);
    screen.getByRole("radio", { name: /Security/ }).focus();
    await user.keyboard("3");
    expect(onValueChange).toHaveBeenLastCalledWith("technical");
    expect(screen.getByRole("radio", { name: /Technical/ })).toHaveFocus();
    await user.keyboard("9");
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("moves with arrow keys and wraps", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ManualChoice
        options={TEAMS}
        defaultValue="sales"
        onValueChange={onValueChange}
        aria-label="Team"
      />,
    );
    screen.getByRole("radio", { name: /Sales/ }).focus();
    await user.keyboard("{ArrowDown}");
    expect(onValueChange).toHaveBeenLastCalledWith("security");
    await user.keyboard("{ArrowUp}");
    expect(onValueChange).toHaveBeenLastCalledWith("sales");
  });

  it("listens on the document in document mode but ignores typing fields", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <>
        <textarea aria-label="Comment" />
        <ManualChoice
          options={TEAMS}
          hotkeys="document"
          onValueChange={onValueChange}
          aria-label="Team"
        />
      </>,
    );
    await user.keyboard("2");
    expect(onValueChange).toHaveBeenLastCalledWith("billing");
    screen.getByRole("textbox", { name: "Comment" }).focus();
    await user.keyboard("4");
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("skips disabled options", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const options = TEAMS.map((t) => (t.id === "billing" ? { ...t, disabled: true } : t));
    render(<ManualChoice options={options} onValueChange={onValueChange} aria-label="Team" />);
    screen.getByRole("radio", { name: /Security/ }).focus();
    await user.keyboard("2");
    expect(onValueChange).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}");
    expect(onValueChange).toHaveBeenLastCalledWith("technical");
  });
});
