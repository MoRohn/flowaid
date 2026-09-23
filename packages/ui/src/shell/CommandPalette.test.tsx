import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette, type CommandGroupView } from "./CommandPalette";
import { installDomStubs } from "@/primitives/testStubs";

afterEach(cleanup);

beforeAll(() => installDomStubs());

const runGroup: CommandGroupView = {
  id: "run",
  heading: "Run",
  items: [
    { id: "run-test", label: "Run with test input", shortcut: "mod+enter" },
    { id: "replay", label: "Replay last run", description: "run_01j8x2", keywords: ["again"] },
  ],
};
const addGroup: CommandGroupView = {
  id: "add",
  heading: "Add node",
  items: [
    { id: "add-choice", label: "Intent choice", keywords: ["decision"] },
    { id: "add-http", label: "HTTP request", disabled: true },
  ],
};
const groups: CommandGroupView[] = [runGroup, addGroup];

describe("CommandPalette", () => {
  it("renders groups and items when open and nothing when closed", () => {
    const { rerender } = render(
      <CommandPalette open={false} onOpenChange={() => undefined} groups={groups} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<CommandPalette open onOpenChange={() => undefined} groups={groups} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Run")).toBeInTheDocument();
    expect(within(dialog).getByText("Add node")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("option")).toHaveLength(4);
    expect(within(dialog).getByText("4 commands")).toBeInTheDocument();
  });

  it("filters items as the user types, including keywords, and shows the empty state", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={() => undefined}
        groups={groups}
        emptyText="Nothing here"
      />,
    );
    const input = screen.getByRole("combobox");
    await user.type(input, "decision");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Intent choice/ })).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("moves selection with arrow keys and selects with Enter, then closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const itemSelect = vi.fn();
    const withHandler: CommandGroupView[] = [
      {
        ...runGroup,
        items: runGroup.items.map((i) => (i.id === "replay" ? { ...i, onSelect: itemSelect } : i)),
      },
      addGroup,
    ];
    render(
      <CommandPalette open onOpenChange={onOpenChange} groups={withHandler} onSelect={onSelect} />,
    );
    const first = screen.getByRole("option", { name: /Run with test input/ });
    expect(first).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Replay last run/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Enter}");
    expect(itemSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "replay" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("skips disabled items when navigating", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onOpenChange={() => undefined} groups={groups} />);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    // Loops past the disabled HTTP item back to the first.
    expect(screen.getByRole("option", { name: /Run with test input/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: /HTTP request/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("keeps the palette open with keepOpen", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} groups={groups} keepOpen />);
    await user.keyboard("{Enter}");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} groups={groups} />);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the loading state", () => {
    render(<CommandPalette open onOpenChange={() => undefined} groups={[]} loading />);
    expect(screen.getByText("Loading commands")).toBeInTheDocument();
  });
});
