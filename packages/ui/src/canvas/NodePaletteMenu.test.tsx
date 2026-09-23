import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { NodePaletteMenu } from "./NodePaletteMenu";
import { SAMPLE_CATALOG } from "./sampleWorkflow";

installDomStubs();
afterEach(cleanup);

function setup(props: Partial<Parameters<typeof NodePaletteMenu>[0]> = {}) {
  const onPick = vi.fn();
  const onAskBuilder = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <NodePaletteMenu
      open
      onOpenChange={onOpenChange}
      anchor={{ x: 100, y: 100 }}
      catalog={SAMPLE_CATALOG}
      onPick={onPick}
      onAskBuilder={onAskBuilder}
      {...props}
    />,
  );
  return { onPick, onAskBuilder, onOpenChange };
}

describe("NodePaletteMenu", () => {
  it("groups the catalog by category with Recent first", () => {
    setup({ recent: ["flowaid.tools.http", "flowaid.decision.choice"] });
    const headings = Array.from(document.querySelectorAll("[cmdk-group-heading]")).map(
      (el) => el.textContent,
    );
    expect(headings[0]).toBe("Recent");
    expect(headings).toContain("Decision");
    expect(headings).toContain("Tool");
    const recent = screen.getByText("Recent").closest("[cmdk-group]");
    expect(recent).toBeInstanceOf(HTMLElement);
    if (!(recent instanceof HTMLElement)) return;
    const items = within(recent).getAllByRole("option");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("HTTP request"),
      expect.stringContaining("Choice"),
    ]);
  });

  it("filters fuzzily across name, description and kind and keeps the builder row", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("guard");
    const options = screen.getAllByRole("option");
    expect(options.some((o) => o.textContent?.includes("Guard"))).toBe(true);
    expect(options.some((o) => o.textContent?.includes("HTTP request"))).toBe(false);
    expect(screen.getByText("Ask the AI builder")).toBeInTheDocument();
    await user.clear(screen.getByRole("combobox"));
    await user.keyboard("mcp");
    expect(screen.getAllByRole("option").some((o) => o.textContent?.includes("MCP tool"))).toBe(
      true,
    );
  });

  it("picks a definition with the keyboard and closes", async () => {
    const user = userEvent.setup();
    const { onPick, onOpenChange } = setup();
    await user.keyboard("yes / no");
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ kind: "flowaid.decision.boolean" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hands an unmatched query to the AI builder", async () => {
    const user = userEvent.setup();
    const { onAskBuilder, onPick } = setup();
    await user.keyboard("translate to french");
    expect(
      screen.queryAllByRole("option").some((o) => o.textContent?.includes("HTTP request")),
    ).toBe(false);
    expect(screen.getByText("Ask the AI builder")).toBeInTheDocument();
    await user.click(screen.getByText("Ask the AI builder"));
    expect(onAskBuilder).toHaveBeenCalledWith("translate to french");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows the empty message without a builder", async () => {
    const user = userEvent.setup();
    setup({ onAskBuilder: undefined });
    await user.keyboard("zzzz");
    expect(screen.getByText("No node matches.")).toBeInTheDocument();
  });
});
