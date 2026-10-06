import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ThemeProvider } from "@/theme";
import { CommandMenu } from "./CommandMenu";
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

describe("CommandMenu search", () => {
  function Menu({ onGo }: { onGo: (id: string) => void }) {
    const [search, setSearch] = useState("");
    // a group built from what is typed, as the workspace menu does for run ids
    const goto: CommandGroupView[] = /^[0-9a-f]{8}$/.test(search)
      ? [
          {
            id: "goto",
            heading: "Go to",
            items: [
              {
                id: "goto-run",
                label: `Go to run ${search}`,
                keywords: [search],
                onSelect: () => onGo(search),
              },
            ],
          },
        ]
      : [];
    return (
      <ThemeProvider defaultSetting="light">
        <CommandMenu open leadingGroups={goto} search={search} onSearchChange={setSearch} />
      </ThemeProvider>
    );
  }

  it("hands the typed text to the parent and runs a query-built item from the keyboard", async () => {
    const user = userEvent.setup();
    const onGo = vi.fn();
    render(<Menu onGo={onGo} />);
    await user.type(screen.getByRole("combobox"), "01a0e530");
    expect(screen.getByRole("option", { name: /Go to run 01a0e530/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onGo).toHaveBeenCalledWith("01a0e530");
  });

  // F-10: cmdk sorts inside a group only, so "runs" picked "New knowledge source" (a loose match
  // in the first group) over the Runs page
  it("puts the group with the best match first, so Enter takes the best match", async () => {
    const user = userEvent.setup();
    const onRuns = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={() => undefined}
        groups={[
          {
            id: "create",
            heading: "Create",
            items: [
              { id: "knowledge", label: "New knowledge source", keywords: ["retrieval", "search"] },
            ],
          },
          {
            id: "runs",
            heading: "Recent runs",
            items: [{ id: "run-1", label: "Policy Q&A", description: "completed · 01a0e9ad" }],
          },
          {
            id: "navigate",
            heading: "Navigate",
            items: [{ id: "runs", label: "Runs", keywords: ["go to"], onSelect: onRuns }],
          },
        ]}
      />,
    );
    await user.type(screen.getByRole("combobox"), "runs");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Runs");
    await user.keyboard("{Enter}");
    expect(onRuns).toHaveBeenCalledTimes(1);
  });

  // F-10 / R12: "Ask" carried the typed text in its keywords, ranked first, and Enter on any
  // text sent a paid question
  it("lists a fallback group last and lets Enter pick it only when nothing else matches", async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    const onRuns = vi.fn();
    function Menu() {
      const [query, setQuery] = useState("");
      const ask: CommandGroupView = {
        id: "ask",
        heading: "Ask",
        fallback: true,
        items: [{ id: "ask", label: `Ask: “${query}”`, keywords: [query], onSelect: onAsk }],
      };
      const pages: CommandGroupView = {
        id: "navigate",
        heading: "Navigate",
        items: [{ id: "runs", label: "Runs", keywords: ["go to"], onSelect: onRuns }],
      };
      return (
        <CommandPalette
          open
          onOpenChange={() => undefined}
          groups={[ask, pages]}
          search={query}
          onSearchChange={setQuery}
        />
      );
    }
    render(<Menu />);
    const labels = () => screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels().at(-1)).toMatch(/^Ask/);
    await user.type(screen.getByRole("combobox"), "runs");
    expect(labels()).toEqual(["Runs", "Ask: “runs”"]);
    await user.keyboard("{Enter}");
    expect(onRuns).toHaveBeenCalledTimes(1);
    expect(onAsk).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "why did it fail");
    expect(labels()).toEqual(["Ask: “why did it fail”"]);
    await user.keyboard("{Enter}");
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
