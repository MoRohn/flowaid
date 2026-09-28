import { describe, expect, it } from "vitest";
import { CANVAS_READABLE_ZOOM, openingViewport } from "./FlowCanvas";

describe("openingViewport", () => {
  const pane = { width: 900, height: 500 };

  it("keeps the fitted view when it is readable", () => {
    expect(openingViewport({ x: 0, y: 0, width: 800, height: 300 }, pane, 0.9)).toBeNull();
  });

  it("opens a wide graph at a readable zoom on its start, centred vertically", () => {
    const v = openingViewport({ x: 100, y: 50, width: 4000, height: 300 }, pane, 0.27);
    expect(v?.zoom).toBe(CANVAS_READABLE_ZOOM);
    // the left edge of the graph sits at the margin
    expect((v?.x ?? 0) + 100 * CANVAS_READABLE_ZOOM).toBeCloseTo(48);
    // its middle sits in the middle of the pane
    expect((v?.y ?? 0) + (50 + 150) * CANVAS_READABLE_ZOOM).toBeCloseTo(250);
  });

  it("shows the top of a graph taller than the pane", () => {
    const v = openingViewport({ x: 0, y: 20, width: 4000, height: 2000 }, pane, 0.2);
    expect((v?.y ?? 0) + 20 * CANVAS_READABLE_ZOOM).toBeCloseTo(48);
  });
});
