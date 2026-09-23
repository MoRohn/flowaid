import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import {
  CHOICE_MAX_OPTIONS,
  CriteriaEditor,
  emptyCriteria,
  toSnakeCase,
  validateCriteria,
} from "./CriteriaEditor";

installDomStubs();
afterEach(cleanup);

describe("validateCriteria", () => {
  it("requires choice options and at least two of them", () => {
    expect(validateCriteria({ kind: "choice", options: [] })[0]?.message).toMatch(/required/);
    expect(
      validateCriteria({ kind: "choice", options: [{ key: "billing", description: "" }] })[0]
        ?.message,
    ).toMatch(/at least 2/);
  });

  it("checks snake_case, uniqueness and the 255 cap", () => {
    const issues = validateCriteria({
      kind: "choice",
      options: [
        { key: "Billing", description: "" },
        { key: "technical", description: "" },
        { key: "technical", description: "" },
        { key: "", description: "" },
      ],
    });
    expect(issues.map((i) => i.path)).toEqual([
      "options[0].key",
      "options[2].key",
      "options[3].key",
    ]);
    expect(issues[0]?.message).toMatch(/snake_case/);
    expect(issues[1]?.message).toMatch(/Duplicate/);
    const many = Array.from({ length: CHOICE_MAX_OPTIONS + 1 }, (_, i) => ({
      key: `opt_${i}`,
      description: "",
    }));
    expect(validateCriteria({ kind: "choice", options: many })[0]?.message).toMatch(/At most 255/);
  });

  it("accepts a valid choice", () => {
    expect(
      validateCriteria({
        kind: "choice",
        options: [
          { key: "billing", description: "Money" },
          { key: "technical_issue", description: "Bugs" },
        ],
      }),
    ).toEqual([]);
  });

  it("needs 2 to 10 score levels, each described", () => {
    expect(validateCriteria({ kind: "score", levels: ["only"] })[0]?.message).toMatch(
      /between 2 and 10/,
    );
    expect(
      validateCriteria({ kind: "score", levels: Array.from({ length: 11 }, () => "x") })[0]
        ?.message,
    ).toMatch(/between 2 and 10/);
    expect(validateCriteria({ kind: "score", levels: ["low", ""] })).toEqual([
      { path: "levels[1]", message: "Describe this level." },
    ]);
    expect(validateCriteria({ kind: "score", levels: ["low", "high"] })).toEqual([]);
  });

  it("never flags boolean criteria", () => {
    expect(validateCriteria({ kind: "boolean" })).toEqual([]);
  });

  it("normalises keys to snake_case", () => {
    expect(toSnakeCase("Needs Refund")).toBe("needs_refund");
    expect(toSnakeCase("technicalIssue")).toBe("technical_issue");
    expect(toSnakeCase("  --Other-- ")).toBe("other");
  });

  it("seeds empty criteria per kind", () => {
    expect(emptyCriteria("score")).toEqual({ kind: "score", levels: ["", ""] });
    expect(emptyCriteria("choice").kind).toBe("choice");
  });
});

describe("CriteriaEditor", () => {
  it("adds an option, normalises the key on blur and shows the API message", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CriteriaEditor
        kind="choice"
        defaultValue={{ kind: "choice", options: [] }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add option" }));
    const key = screen.getByRole("textbox", { name: "Option 1 key" });
    await user.type(key, "Needs Refund");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "choice",
      options: [{ key: "needs_refund", description: "" }],
    });
    expect(screen.getByRole("alert")).toHaveTextContent("at least 2 options");
  });

  it("switches kinds and locks the remove button at the score minimum", async () => {
    const user = userEvent.setup();
    render(<CriteriaEditor />);
    await user.click(screen.getByRole("radio", { name: "Score" }));
    expect(screen.getAllByRole("textbox", { name: /Level \d description/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove level 0" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add level" }));
    expect(screen.getAllByRole("textbox", { name: /Level \d description/ })).toHaveLength(3);
  });

  it("renders the uniform preview", () => {
    render(
      <CriteriaEditor
        kind="choice"
        value={{
          kind: "choice",
          options: [
            { key: "billing", description: "" },
            { key: "technical", description: "" },
            { key: "account", description: "" },
            { key: "other", description: "" },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Uniform distribution over 4 outcomes" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("0.25")).toHaveLength(4);
  });

  it("moves levels with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CriteriaEditor
        kind="score"
        defaultValue={{ kind: "score", levels: ["low", "mid", "high"] }}
        onChange={onChange}
      />,
    );
    const grips = screen.getAllByRole("button", { name: /Reorder item 3 of 3/ });
    (grips[0] as HTMLElement).focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "score", levels: ["low", "high", "mid"] });
  });
});
