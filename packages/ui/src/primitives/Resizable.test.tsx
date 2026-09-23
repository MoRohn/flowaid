import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resizable";
import { installDomStubs } from "./testStubs";

afterEach(cleanup);

beforeAll(() => installDomStubs());

describe("Resizable", () => {
  it("renders a horizontal group with panels and a separator", () => {
    render(
      <ResizablePanelGroup orientation="horizontal" style={{ width: 800, height: 400 }}>
        <ResizablePanel defaultSize={30} minSize={10} id="left">
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle id="handle" />
        <ResizablePanel id="right">
          <div>Right</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(screen.getByText("Left")).toBeInTheDocument();
    expect(screen.getByText("Right")).toBeInTheDocument();
    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator.className).toContain("bg-border");
    expect(separator.querySelector("span")).not.toBeNull();
  });

  it("renders a vertical group and hides the grip when asked", () => {
    render(
      <ResizablePanelGroup orientation="vertical" style={{ width: 400, height: 600 }}>
        <ResizablePanel id="top">Top</ResizablePanel>
        <ResizableHandle id="h" withGrip={false} />
        <ResizablePanel id="bottom">Bottom</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-orientation", "horizontal");
    expect(separator.querySelector("span")).toBeNull();
  });
});
