import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { HANDLE_ID_PATTERN } from "@/node";
import { captureConsole, installLayoutStubs } from "@/node/flowTestStubs";
import { installDomStubs } from "@/primitives/testStubs";
import CanvasGallery from "./gallery";

installDomStubs();
let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = installLayoutStubs();
});
afterAll(() => restoreLayout());
afterEach(cleanup);

describe("canvas gallery", () => {
  it("renders without React Flow warnings or console errors, with prefixed handles and typed edges", async () => {
    const console = captureConsole();
    try {
      const { container } = render(<CanvasGallery />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const handles = Array.from(container.querySelectorAll("[data-handleid]"));
      expect(handles.length).toBeGreaterThan(50);
      for (const h of handles) expect(h.getAttribute("data-handleid")).toMatch(HANDLE_ID_PATTERN);
      expect(container.querySelectorAll(".react-flow__edge-control").length).toBeGreaterThan(0);
      expect(container.querySelectorAll(".react-flow__edge-data").length).toBeGreaterThan(0);
      expect(container.querySelectorAll(".react-flow__edge-weighted").length).toBe(0);
      // Containers: the research agent's loop and foreach bodies nested in their frames on FlowCanvas.
      const section = container.querySelector("#containers");
      expect(section?.querySelectorAll(".react-flow__node-container .fa-frame").length).toBe(2);
      for (const id of [
        "planner",
        "search_all",
        "web",
        "judge",
        "store",
        "synthesis",
        "completeness",
      ]) {
        expect(section?.querySelector(`.react-flow__node[data-id="${id}"]`), id).not.toBeNull();
      }
      const badges = Array.from(section?.querySelectorAll("[data-iteration-badge]") ?? []).map(
        (b) => b.textContent,
      );
      expect(badges.sort()).toEqual(["3/4", "3/5"]);
      expect(section?.querySelector("[data-layout-readout]")?.textContent).toMatch(
        /layout\.nodes\.research = \d+, \d+ · \d+ × \d+/,
      );
      expect(console.messages().filter((m) => m.includes("React Flow"))).toEqual([]);
      expect(console.messages()).toEqual([]);
    } finally {
      console.restore();
    }
  });
});
