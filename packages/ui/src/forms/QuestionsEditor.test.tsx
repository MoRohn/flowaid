import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { QuestionsEditor, type BatchQuestions } from "./QuestionsEditor";
import { SchemaJsonWidget } from "./widgets";

installDomStubs();
afterEach(cleanup);

function Harness({
  initial,
  onValue,
}: {
  initial: BatchQuestions;
  onValue: (v: BatchQuestions) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QuestionsEditor
      aria-label="Questions"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

describe("QuestionsEditor", () => {
  it("explains the empty state and adds a yes/no question", async () => {
    let last: BatchQuestions = {};
    render(<Harness initial={{}} onValue={(v) => (last = v)} />);
    expect(screen.getByText(/No questions yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(last).toEqual({ question_1: { kind: "boolean", instructions: "" } });
  });

  it("renames a question in place and keeps the others in order", async () => {
    let last: BatchQuestions = {};
    render(
      <Harness
        initial={{
          intent: {
            kind: "choice",
            instructions: "Which team?",
            options: { billing: "Money", general: "Else" },
          },
          urgent: { kind: "boolean", instructions: "Urgent?" },
        }}
        onValue={(v) => (last = v)}
      />,
    );
    const [first] = screen.getAllByLabelText("Question id");
    if (!first) throw new Error("no id field");
    await userEvent.clear(first);
    await userEvent.type(first, "team");
    expect(Object.keys(last)).toEqual(["team", "urgent"]);
    expect(last.team).toEqual({
      kind: "choice",
      instructions: "Which team?",
      options: { billing: "Money", general: "Else" },
    });
  });

  it("flags ids that are not snake_case or are taken", async () => {
    render(
      <Harness
        initial={{
          a: { kind: "boolean", instructions: "x" },
          b: { kind: "boolean", instructions: "y" },
        }}
        onValue={() => {}}
      />,
    );
    const [, second] = screen.getAllByLabelText("Question id");
    if (!second) throw new Error("no id field");
    await userEvent.clear(second);
    await userEvent.type(second, "a");
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(
      "Another question already uses this id.",
    );
    await userEvent.type(second, "-");
    expect(
      screen
        .getAllByRole("alert")
        .map((a) => a.textContent)
        .join(" "),
    ).toMatch(/snake_case/);
  });

  it("removes a question", async () => {
    let last: BatchQuestions = {};
    render(
      <Harness
        initial={{
          a: { kind: "boolean", instructions: "x" },
          b: { kind: "score", instructions: "y", levels: ["Low", "High"] },
        }}
        onValue={(v) => (last = v)}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove question a" }));
    expect(last).toEqual({ b: { kind: "score", instructions: "y", levels: ["Low", "High"] } });
  });
});

describe("SchemaJsonWidget", () => {
  const props = {
    name: "schema",
    schema: { type: "object" as const },
    hints: {},
    label: "Schema",
    onChange: () => {},
    onBlur: () => {},
  };

  it("accepts an object and flags any other JSON value", () => {
    const { rerender } = render(<SchemaJsonWidget {...props} value={{ type: "string" }} />);
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<SchemaJsonWidget {...props} value={[1, 2]} />);
    expect(screen.getByRole("alert").textContent).toMatch(/must be an object/);
    rerender(<SchemaJsonWidget {...props} value="{ nope" />);
    expect(screen.getByRole("alert").textContent).toMatch(/not valid JSON/);
  });
});
