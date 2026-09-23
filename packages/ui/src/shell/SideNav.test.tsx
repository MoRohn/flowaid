import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bot, Play, Settings, Workflow } from "lucide-react";
import { ThemeProvider } from "@/theme";
import { installDomStubs } from "@/primitives/testStubs";
import { SideNav, type SideNavItem } from "./SideNav";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const items: SideNavItem[] = [
  { id: "workflows", label: "Workflows", icon: <Workflow />, count: 12, shortcut: "g w" },
  { id: "agents", label: "Agents", icon: <Bot />, disabled: true },
  { id: "runs", label: "Runs", icon: <Play />, count: 4, countTone: "warn" },
];
const secondary: SideNavItem[] = [{ id: "settings", label: "Settings", icon: <Settings /> }];

function renderNav(props: Partial<React.ComponentProps<typeof SideNav>> = {}) {
  return render(
    <ThemeProvider defaultSetting="light">
      <SideNav items={items} secondaryItems={secondary} activeId="runs" {...props} />
    </ThemeProvider>,
  );
}

describe("SideNav", () => {
  it("marks the active item and shows counts", () => {
    renderNav();
    const runs = screen.getByRole("button", { name: /Runs/ });
    expect(runs).toHaveAttribute("aria-current", "page");
    expect(runs.className).toContain("bg-surface-3");
    expect(runs).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: /Workflows/ })).not.toHaveAttribute("aria-current");
  });

  it("calls onNavigate and renders links for items with an href", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderNav({
      onNavigate,
      items: [...items, { id: "docs", label: "Docs", icon: <Workflow />, href: "/docs" }],
    });
    await user.click(screen.getByRole("button", { name: /Workflows/ }));
    expect(onNavigate).toHaveBeenCalledWith(
      "workflows",
      expect.objectContaining({ id: "workflows" }),
    );
    const link = screen.getByRole("link", { name: /Docs/ });
    expect(link).toHaveAttribute("href", "/docs");
    await user.click(link);
    expect(onNavigate).toHaveBeenLastCalledWith("docs", expect.objectContaining({ href: "/docs" }));
  });

  it("moves focus with arrow keys, skipping disabled items, and Home/End", async () => {
    const user = userEvent.setup();
    renderNav();
    const workflows = screen.getByRole("button", { name: /Workflows/ });
    const runs = screen.getByRole("button", { name: /Runs/ });
    const settings = screen.getByRole("button", { name: /Settings/ });
    runs.focus();
    await user.keyboard("{ArrowUp}");
    expect(workflows).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(runs).toHaveFocus();
    await user.keyboard("{End}");
    expect(settings).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(workflows).toHaveFocus();
    await user.keyboard("{Home}");
    expect(workflows).toHaveFocus();
  });

  it("collapses to a rail with tooltips carrying the label and shortcut", async () => {
    const user = userEvent.setup();
    renderNav({ collapsed: true });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveAttribute("data-collapsed", "true");
    expect(nav.className).toContain("w-12");
    const workflows = screen.getByRole("button", { name: /Workflows/ });
    await user.hover(workflows);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Workflows");
    expect(tooltip).toHaveTextContent("G");
  });

  it("reports collapse changes and offers the theme toggle", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    renderNav({ collapsed: false, onCollapsedChange });
    await user.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    const dark = screen.getByRole("radio", { name: "Dark" });
    await user.click(dark);
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
