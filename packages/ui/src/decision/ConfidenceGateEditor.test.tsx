import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { ConfidenceGateEditor } from "./ConfidenceGateEditor";
import { histogramBins, validateThresholds } from "./gate";

installDomStubs();
afterEach(cleanup);

describe("validateThresholds", () => {
  it("requires the review floor below the pass threshold and values within [0, 1]", () => {
    expect(validateThresholds({ review: 0.6, auto: 0.9 })).toBeNull();
    expect(validateThresholds({ review: 0, auto: 0.9 })).toBeNull();
    expect(validateThresholds({ review: 0.9, auto: 0.9 })).toMatch(/below the pass/);
    expect(validateThresholds({ review: 0.95, auto: 0.9 })).toMatch(/below the pass/);
    expect(validateThresholds({ review: 0, auto: 0 })).toMatch(/above 0/);
    expect(validateThresholds({ review: -0.1, auto: 0.9 })).toMatch(/between 0 and 1/);
    expect(validateThresholds({ review: Number.NaN, auto: 0.9 })).toMatch(/required/);
  });
});

describe("histogramBins", () => {
  it("bins confidences over [0, 1] and closes the last bin at 1", () => {
    expect(histogramBins([0, 0.1, 0.19, 0.5, 1, 1, Number.NaN], 10)).toEqual([
      1, 2, 0, 0, 0, 1, 0, 0, 0, 2,
    ]);
  });
});

describe("ConfidenceGateEditor", () => {
  it("shows a validation error when the review floor is not below the pass threshold", () => {
    render(<ConfidenceGateEditor defaultValue={{ review: 0.9, auto: 0.7 }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The review floor must be below the pass threshold.",
    );
    expect(screen.getByRole("spinbutton", { name: /review floor/i })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("emits changes from the numeric inputs and reports validation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onValidate = vi.fn();
    render(
      <ConfidenceGateEditor
        defaultValue={{ review: 0.6, auto: 0.9 }}
        onChange={onChange}
        onValidate={onValidate}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();

    const auto = screen.getByRole("spinbutton", { name: /pass at or above/i });
    await user.clear(auto);
    await user.type(auto, "0.55");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ review: 0.6, auto: 0.55 });
    expect(onValidate).toHaveBeenLastCalledWith(
      "The review floor must be below the pass threshold.",
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.clear(auto);
    await user.type(auto, "0.95");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ review: 0.6, auto: 0.95 });
    expect(onValidate).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("steps thresholds from the slider thumbs with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConfidenceGateEditor defaultValue={{ review: 0.6, auto: 0.9 }} onChange={onChange} />);
    const review = screen.getByRole("slider", { name: "Review floor" });
    review.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ review: 0.61, auto: 0.9 });
  });

  it("clamps typed values to [0, 1] on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConfidenceGateEditor defaultValue={{ review: 0.6, auto: 0.9 }} onChange={onChange} />);
    const auto = screen.getByRole("spinbutton", { name: /pass at or above/i });
    await user.clear(auto);
    await user.type(auto, "1.7");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ review: 0.6, auto: 1 });
  });

  it("shows outcome shares for a histogram", () => {
    const values = [0.1, 0.2, 0.65, 0.7, 0.75, 0.92, 0.95, 0.97, 0.99, 0.995];
    const { container } = render(
      <ConfidenceGateEditor
        defaultValue={{ review: 0.6, auto: 0.9 }}
        histogram={values}
        binCount={10}
      />,
    );
    expect(container.querySelector("[data-share=pass]")).toHaveTextContent("pass 50%");
    expect(container.querySelector("[data-share=review]")).toHaveTextContent("review 30%");
    expect(container.querySelector("[data-share=fail]")).toHaveTextContent("fail 20%");
    expect(container.querySelectorAll("[data-bin]")).toHaveLength(10);
  });

  it("reads and writes the runtime gate config (two-way until a floor is set)", async () => {
    const user = userEvent.setup();
    const onGateChange = vi.fn();
    const { container } = render(
      <ConfidenceGateEditor
        defaultGate={{ threshold: 0.9, requireValue: true }}
        onGateChange={onGateChange}
      />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-gate-model", "two-way");
    expect(screen.getByText("two-way · pass / review")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /review floor/i })).toHaveValue("0.00");

    const review = screen.getByRole("spinbutton", { name: /review floor/i });
    await user.clear(review);
    await user.type(review, "0.7");
    await user.tab();
    expect(onGateChange).toHaveBeenLastCalledWith({
      threshold: 0.9,
      reviewBand: 0.2,
      requireValue: true,
    });
    expect(container.firstElementChild).toHaveAttribute("data-gate-model", "three-way");
  });

  it("maps a controlled three-way gate onto the two thresholds", () => {
    render(<ConfidenceGateEditor gate={{ threshold: 0.8, reviewBand: 0.3 }} />);
    expect(screen.getByRole("spinbutton", { name: /review floor/i })).toHaveValue("0.50");
    expect(screen.getByRole("spinbutton", { name: /pass at or above/i })).toHaveValue("0.80");
    expect(screen.getByText("three-way · pass / review / fail")).toBeInTheDocument();
  });

  it("hides the inputs when asked", () => {
    render(<ConfidenceGateEditor hideInputs />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });
});
