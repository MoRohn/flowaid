import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import { NodeRunAside } from "./NodeRunAside";

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A matchMedia whose answer is `narrow` for the below-lg query. */
function viewport(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: narrow && query.includes("max-width"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

describe("node run detail placement", () => {
  it("is a column beside the tab at desktop widths", () => {
    viewport(false);
    render(
      <NodeRunAside label="Node run Classify" onClose={() => undefined}>
        <p>panel body</p>
      </NodeRunAside>,
    );
    expect(screen.getByText("panel body")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a sheet below lg that closes back to the trace", () => {
    viewport(true);
    const onClose = vi.fn();
    render(
      <NodeRunAside label="Node run Classify" onClose={onClose}>
        <p>panel body</p>
      </NodeRunAside>,
    );
    const dialog = screen.getByRole("dialog", { name: "Node run Classify" });
    expect(dialog.textContent).toContain("panel body");
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
