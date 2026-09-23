import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";

afterEach(cleanup);

const items: BreadcrumbItem[] = [
  { id: "ws", label: "Acme Support" },
  { id: "wf", label: "Workflows", href: "/workflows" },
  { id: "name", label: "Support triage" },
];

describe("Breadcrumbs", () => {
  it("renders ancestors as links or buttons and the current page last", () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByRole("link", { name: "Workflows" })).toHaveAttribute("href", "/workflows");
    expect(screen.getByText("Support triage").closest("[aria-current]")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
  });

  it("renames inline: Enter commits, Escape cancels, empty names are rejected", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<Breadcrumbs items={items} onRename={onRename} />);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Workflow name" });
    expect(input).toHaveValue("Support triage");
    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Name cannot be empty");
    expect(onRename).not.toHaveBeenCalled();
    await user.type(input, "Ticket triage{Enter}");
    expect(onRename).toHaveBeenCalledWith("Ticket triage");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.dblClick(screen.getByText("Support triage"));
    await user.type(screen.getByRole("textbox"), "x{Escape}");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
