import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Play } from "lucide-react";
import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("renders the secondary variant by default with a button type", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn.className).toContain("bg-surface");
    expect(btn.className).toContain("h-7");
  });

  it.each([
    ["primary", "bg-accent"],
    ["ghost", "bg-transparent"],
    ["danger", "text-danger-text"],
    ["link", "underline-offset"],
  ] as const)("applies the %s variant classes", (variant, expected) => {
    render(<Button variant={variant}>Label</Button>);
    expect(screen.getByRole("button").className).toContain(expected);
  });

  it.each([
    ["sm", "h-6"],
    ["md", "h-7"],
    ["lg", "h-8"],
  ] as const)("applies the %s size", (size, expected) => {
    render(<Button size={size}>Label</Button>);
    expect(screen.getByRole("button").className).toContain(expected);
  });

  it("shows a spinner, sets aria-busy and blocks clicks while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} leadingIcon={<Play data-testid="icon" />}>
        Publishing
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /Publishing/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders leading and trailing icons around the label", () => {
    render(
      <Button leadingIcon={<span data-testid="lead" />} trailingIcon={<span data-testid="trail" />}>
        Run
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Run" });
    const children = Array.from(btn.children);
    expect(children[0]).toHaveAttribute("data-testid", "lead");
    expect(children[children.length - 1]).toHaveAttribute("data-testid", "trail");
  });

  it("is disabled and does not fire onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders the child element with asChild", () => {
    render(
      <Button asChild variant="link">
        <a href="/runs">Runs</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Runs" });
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("type");
    expect(link.className).toContain("text-accent-text");
  });

  it("supports keyboard activation", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    screen.getByRole("button").focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
