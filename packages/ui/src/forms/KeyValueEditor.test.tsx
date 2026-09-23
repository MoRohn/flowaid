import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import {
  KeyValueEditor,
  defaultKeyValueRowIssue,
  mergeKeyValueRows,
  parseKeyValueText,
} from "./KeyValueEditor";

installDomStubs();
afterEach(cleanup);

describe("parseKeyValueText", () => {
  it("parses colon and equals lines, trimming and unquoting", () => {
    const rows = parseKeyValueText(
      'Content-Type: application/json\nAuthorization = "Bearer abc"\n# comment\n\nX-Trace=1',
    );
    expect(rows).toEqual([
      { key: "Content-Type", value: "application/json" },
      { key: "Authorization", value: "Bearer abc" },
      { key: "X-Trace", value: "1" },
    ]);
  });

  it("keeps a separator-less line as a key with an empty value", () => {
    expect(parseKeyValueText("ORPHAN")).toEqual([{ key: "ORPHAN", value: "" }]);
  });

  it("keeps colons inside values", () => {
    expect(parseKeyValueText("Referer: https://flowaid.dev/docs")).toEqual([
      { key: "Referer", value: "https://flowaid.dev/docs" },
    ]);
  });

  it("merges by key, case-insensitively", () => {
    const merged = mergeKeyValueRows(
      [{ key: "Accept", value: "*/*" }],
      [
        { key: "accept", value: "text/html" },
        { key: "X-Id", value: "1" },
      ],
    );
    expect(merged).toEqual([
      { key: "Accept", value: "text/html" },
      { key: "X-Id", value: "1" },
    ]);
  });

  it("flags missing and duplicate keys", () => {
    const rows = [
      { key: "A", value: "1" },
      { key: "a", value: "2" },
      { key: "", value: "x" },
    ];
    expect(
      defaultKeyValueRowIssue(rows[0] as { key: string; value: string }, 0, rows),
    ).toBeUndefined();
    expect(defaultKeyValueRowIssue(rows[1] as { key: string; value: string }, 1, rows)).toBe(
      "Duplicate of row 1",
    );
    expect(defaultKeyValueRowIssue(rows[2] as { key: string; value: string }, 2, rows)).toBe(
      "Key is required",
    );
  });
});

describe("KeyValueEditor", () => {
  it("adds rows, edits and removes them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<KeyValueEditor onChange={onChange} />);
    expect(screen.getByText("No entries yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.type(screen.getByRole("textbox", { name: "Key 1" }), "Accept");
    await user.type(screen.getByRole("textbox", { name: "Value 1" }), "*/*");
    expect(onChange).toHaveBeenLastCalledWith([{ key: "Accept", value: "*/*" }]);
    await user.click(screen.getByRole("button", { name: "Remove row" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("expands pasted Key: Value lines into rows", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<KeyValueEditor defaultValue={[{ key: "", value: "" }]} onChange={onChange} />);
    const key = screen.getByRole("textbox", { name: "Key 1" });
    await user.click(key);
    fireEvent.paste(key, {
      clipboardData: { getData: () => "Accept: application/json\nX-Api-Key: sk_live_1" },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      { key: "Accept", value: "application/json" },
      { key: "X-Api-Key", value: "sk_live_1" },
    ]);
  });

  it("masks secret values and can reveal them", async () => {
    const user = userEvent.setup();
    render(<KeyValueEditor defaultValue={[{ key: "TOKEN", value: "abc", secret: true }]} />);
    const value = screen.getByLabelText("Value 1");
    expect(value).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Reveal value" }));
    expect(value).toHaveAttribute("type", "text");
  });
});
