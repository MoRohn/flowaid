/**
 * F-03: the Guide is a side panel the page stays usable beside. Tab cycled inside it on every
 * page (it was a Radix dialog, which loops focus even when not modal); now Tab and Shift+Tab leave
 * it, and Escape closes it and puts focus on the Guide button.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";

vi.mock("next/navigation", () => ({
  usePathname: () => "/acme/agents",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("~/session", () => ({ useSession: () => ({ ws: "acme" }) }));
vi.mock("~/assistant/AssistantProvider", () => ({ useAssistant: () => null }));

const { GuidePanel, GUIDE_TOGGLE_ATTRIBUTE } = await import("./GuidePanel");

beforeAll(() => installDomStubs());
afterEach(cleanup);

function Page() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" {...{ [GUIDE_TOGGLE_ATTRIBUTE]: "" }} onClick={() => setOpen(!open)}>
        Guide
      </button>
      <button type="button">Last control on the page</button>
      <GuidePanel open={open} onOpenChange={setOpen} context={null} />
      <a href="#after">After the Guide</a>
    </>
  );
}

describe("GuidePanel", () => {
  it("is a complementary landmark, not a dialog", () => {
    render(<Page />);
    expect(screen.getByRole("complementary", { name: "Guide" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not hold focus: Tab past its last control and Shift+Tab before its first leave it", () => {
    render(<Page />);
    const panel = screen.getByRole("complementary", { name: "Guide" });
    const controls = panel.querySelectorAll<HTMLElement>("button, a[href]");
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) throw new Error("the Guide has no controls");
    // a focus trap (the Radix dialog it was) catches these and wraps to the other end
    act(() => last.focus());
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(last);
    act(() => first.focus());
    expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("closes from its close button or Escape and puts focus on the Guide button", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Close the Guide" }));
    expect(screen.queryByRole("complementary", { name: "Guide" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Guide" }));

    fireEvent.click(screen.getByRole("button", { name: "Guide" }));
    const panel = screen.getByRole("complementary", { name: "Guide" });
    const inside = panel.querySelector<HTMLElement>("button");
    if (!inside) throw new Error("the Guide has no button");
    act(() => inside.focus());
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Guide" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Guide" }));
  });
});
