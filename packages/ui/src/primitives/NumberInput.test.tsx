import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberInput, clampNumber, inferPrecision, stepNumber } from "./NumberInput";

afterEach(cleanup);

describe("number helpers", () => {
  it("clamps and rounds", () => {
    expect(clampNumber(1.234, { min: 0, max: 1, precision: 2 })).toBe(1);
    expect(clampNumber(-3, { min: 0 })).toBe(0);
    expect(clampNumber(0.1 + 0.2, { precision: 2 })).toBe(0.3);
  });

  it("steps with multiplier and floating-point safety", () => {
    expect(stepNumber(0.85, 1, { step: 0.05, precision: 2, max: 1 })).toBe(0.9);
    expect(stepNumber(0.95, 1, { step: 0.05, precision: 2, max: 1 })).toBe(1);
    expect(stepNumber(5, -1, { step: 1, multiplier: 10, min: 0 })).toBe(0);
    expect(stepNumber(null, 1, { step: 2 })).toBe(2);
  });

  it("infers precision from the step", () => {
    expect(inferPrecision(1)).toBe(0);
    expect(inferPrecision(0.05)).toBe(2);
    expect(inferPrecision(0.001)).toBe(3);
    expect(inferPrecision(undefined)).toBe(0);
  });
});

describe("NumberInput", () => {
  it("steps with arrow keys and Shift, clamping to the range", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <NumberInput
        defaultValue={0.8}
        min={0}
        max={1}
        step={0.05}
        onValueChange={onValueChange}
        aria-label="Threshold"
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Threshold" });
    expect(input).toHaveValue("0.80");
    input.focus();
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveValue("0.85");
    expect(onValueChange).toHaveBeenLastCalledWith(0.85);
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(input).toHaveValue("1.00");
    expect(onValueChange).toHaveBeenLastCalledWith(1);
    await user.keyboard("{Home}");
    expect(input).toHaveValue("0.00");
  });

  it("lets the user type freely and clamps on blur", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <NumberInput
        defaultValue={3}
        min={0}
        max={10}
        onValueChange={onValueChange}
        aria-label="Retries"
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Retries" });
    await user.clear(input);
    await user.type(input, "42");
    expect(input).toHaveValue("42");
    await user.tab();
    expect(input).toHaveValue("10");
    expect(onValueChange).toHaveBeenLastCalledWith(10);
  });

  it("emits null when cleared and steps from the stepper buttons", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = render(
      <NumberInput
        defaultValue={2}
        min={0}
        max={3}
        onValueChange={onValueChange}
        aria-label="Count"
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Count" });
    await user.clear(input);
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    const up = buttons.item(0);
    if (!up) throw new Error("stepper missing");
    await user.click(up);
    expect(input).toHaveValue("1");
  });

  it("follows controlled value changes", () => {
    const { rerender } = render(<NumberInput value={1} aria-label="V" />);
    expect(screen.getByRole("spinbutton")).toHaveValue("1");
    rerender(<NumberInput value={7} aria-label="V" />);
    expect(screen.getByRole("spinbutton")).toHaveValue("7");
  });
});
