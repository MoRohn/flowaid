import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import NodeGallery from "./gallery";
import { captureConsole, installLayoutStubs } from "./flowTestStubs";
import { HANDLE_ID_PATTERN } from "./nodeUtils";

installDomStubs();
let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = installLayoutStubs();
});
afterAll(() => restoreLayout());
afterEach(cleanup);

describe("node gallery", () => {
  it("renders without React Flow warnings or console errors, and every handle id has the UI.md §4.2 form", async () => {
    const console = captureConsole();
    try {
      const { container } = render(<NodeGallery />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const handles = Array.from(container.querySelectorAll("[data-handleid]"));
      expect(handles.length).toBeGreaterThan(100);
      for (const h of handles) expect(h.getAttribute("data-handleid")).toMatch(HANDLE_ID_PATTERN);
      // The live canvas section mounts real xyflow handles; standalone cards render static ones.
      expect(
        container.querySelectorAll(".react-flow__node [data-handleid]").length,
      ).toBeGreaterThan(20);
      expect(container.querySelectorAll(".react-flow__node-note").length).toBe(1);
      // The research-agent section: loop and foreach frames with their bodies nested inside.
      const research = container.querySelector("#containers");
      expect(research).not.toBeNull();
      expect(research?.querySelectorAll(".react-flow__node-container .fa-frame").length).toBe(2);
      for (const id of [
        "planner",
        "search_all",
        "web",
        "judge",
        "store",
        "synthesis",
        "completeness",
      ]) {
        expect(research?.querySelector(`.react-flow__node[data-id="${id}"]`), id).not.toBeNull();
      }
      const badges = Array.from(
        research?.querySelectorAll(".react-flow [data-iteration-badge]") ?? [],
      ).map((b) => b.textContent);
      expect(badges.sort()).toEqual(["3/4", "3/5"]);
      expect(console.messages().filter((m) => m.includes("React Flow"))).toEqual([]);
      expect(console.messages()).toEqual([]);
    } finally {
      console.restore();
    }
  });
});
