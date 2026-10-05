import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

beforeAll(() => installDomStubs());
afterEach(cleanup);

describe("WorkspaceSwitcher", () => {
  it("opens the settings directly when there is only one workspace", async () => {
    const onSettings = vi.fn();
    const onChange = vi.fn();
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: "default", name: "Default" }]}
        currentId="default"
        onChange={onChange}
        onSettings={onSettings}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Workspace settings: Default" }));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Workspaces")).not.toBeInTheDocument();
  });

  it("lists the workspaces to switch between when there are several", async () => {
    const onChange = vi.fn();
    render(
      <WorkspaceSwitcher
        workspaces={[
          { id: "default", name: "Default" },
          { id: "lab", name: "Lab" },
        ]}
        currentId="default"
        onChange={onChange}
        onSettings={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Default/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Lab/ }));
    expect(onChange).toHaveBeenCalledWith("lab");
  });

  // F-02: in the icon rail the Tooltip around the button swallowed the menu trigger's handlers
  it("opens the menu from the collapsed rail by click, Enter and Space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <WorkspaceSwitcher
        collapsed
        workspaces={[
          { id: "default", name: "Default" },
          { id: "lab", name: "Lab" },
        ]}
        currentId="default"
        onChange={onChange}
        onSettings={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Workspace: Default" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.click(await screen.findByRole("menuitem", { name: /Lab/ }));
    expect(onChange).toHaveBeenCalledWith("lab");

    for (const key of ["{Enter}", " "]) {
      button.focus();
      await user.keyboard(key);
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-expanded", "true");
      await user.keyboard("{Escape}");
      expect(button).toHaveAttribute("aria-expanded", "false");
    }
  });
});
