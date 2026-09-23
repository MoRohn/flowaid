import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Shortcut, parseShortcut } from "./Kbd";

afterEach(cleanup);

describe("parseShortcut", () => {
  it("renders mac glyphs in the platform order", () => {
    expect(parseShortcut("mod+k", "mac")).toEqual(["⌘", "K"]);
    expect(parseShortcut("shift+mod+p", "mac")).toEqual(["⇧", "⌘", "P"]);
    expect(parseShortcut("ctrl+alt+delete", "mac")).toEqual(["⌃", "⌥", "⌦"]);
    expect(parseShortcut("enter", "mac")).toEqual(["↵"]);
  });

  it("renders text keys elsewhere", () => {
    expect(parseShortcut("mod+k", "other")).toEqual(["Ctrl", "K"]);
    expect(parseShortcut("mod+shift+p", "other")).toEqual(["Ctrl", "Shift", "P"]);
    expect(parseShortcut("esc", "other")).toEqual(["Esc"]);
    expect(parseShortcut("f5", "other")).toEqual(["F5"]);
  });

  it("ignores whitespace and case", () => {
    expect(parseShortcut(" MOD + K ", "mac")).toEqual(["⌘", "K"]);
  });
});

describe("Shortcut", () => {
  it("joins mac glyphs without a separator", () => {
    render(<Shortcut shortcut="mod+k" platform="mac" />);
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("joins other platforms with +", () => {
    render(<Shortcut shortcut="mod+k" platform="other" />);
    expect(screen.getByText("Ctrl+K")).toBeInTheDocument();
  });

  it("renders separate decorative caps with the joined label as visually hidden text", () => {
    render(<Shortcut shortcut="mod+shift+p" platform="mac" separate />);
    expect(screen.getByText("⇧⌘P")).toHaveClass("sr-only");
    const caps = screen.getAllByText(/^(⇧|⌘|P)$/);
    expect(caps).toHaveLength(3);
    for (const cap of caps) expect(cap).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("⇧⌘P").parentElement).not.toHaveAttribute("aria-label");
  });

  it("names the plus key", () => {
    expect(parseShortcut("mod+plus", "mac")).toEqual(["⌘", "+"]);
    expect(parseShortcut("mod+plus", "other")).toEqual(["Ctrl", "+"]);
  });
});
