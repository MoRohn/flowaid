import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { JsonView, buildJsonPath } from "./JsonView";

installDomStubs();
afterEach(cleanup);

const VALUE = {
  run: { id: "run_1", status: "completed", cost: 0.0031 },
  nodes: [
    { id: "n_intent", output: { intent: "billing", confidence: 0.81 } },
    { id: "n_gate", output: { outcome: "review", confidence: 0.81 } },
  ],
  ok: true,
  nothing: null,
};

function rows() {
  return screen.getAllByRole("treeitem");
}

function rowByPath(path: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  if (!el) throw new Error(`row ${path} not found`);
  return el;
}

describe("buildJsonPath", () => {
  it("formats identifiers, indices and quoted keys", () => {
    expect(buildJsonPath([])).toBe("$");
    expect(buildJsonPath(["nodes", 2, "output", "confidence"])).toBe(
      "$.nodes[2].output.confidence",
    );
    expect(buildJsonPath(["first name", "x-y"])).toBe('$["first name"]["x-y"]');
    expect(buildJsonPath(["a"], "root")).toBe("root.a");
  });
});

describe("JsonView", () => {
  it("expands to expandDepth by default and shows collapsed counts", () => {
    render(<JsonView value={VALUE} expandDepth={1} toolbar={false} />);
    const paths = rows().map((r) => r.getAttribute("data-path"));
    expect(paths).toEqual(["$", "$.run", "$.nodes", "$.ok", "$.nothing"]);
    expect(rowByPath("$.run").textContent).toContain("3 keys");
    expect(rowByPath("$.nodes").textContent).toContain("2 items");
    expect(rowByPath("$.nodes")).toHaveAttribute("aria-expanded", "false");
  });

  it("colours values by kind", () => {
    render(<JsonView value={VALUE} expandDepth={2} toolbar={false} />);
    expect(within(rowByPath("$.run.status")).getByText('"completed"').className).toContain(
      "text-cat-data",
    );
    expect(within(rowByPath("$.run.cost")).getByText("0.0031").className).toContain(
      "text-accent-text",
    );
    expect(within(rowByPath("$.ok")).getByText("true").className).toContain("text-cat-human");
    expect(within(rowByPath("$.nothing")).getByText("null").className).toContain("text-ink-3");
  });

  it("toggles a container on click and via Enter", async () => {
    const user = userEvent.setup();
    render(<JsonView value={VALUE} expandDepth={1} toolbar={false} />);
    await user.click(rowByPath("$.run"));
    expect(rowByPath("$.run")).toHaveAttribute("aria-expanded", "true");
    expect(rowByPath("$.run.id")).toBeInTheDocument();
    fireEvent.keyDown(rowByPath("$.run"), { key: "Enter" });
    expect(document.querySelector('[data-path="$.run.id"]')).toBeNull();
  });

  it("expand all / collapse all", async () => {
    const user = userEvent.setup();
    render(<JsonView value={VALUE} expandDepth={0} />);
    expect(rows()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(rowByPath("$.nodes[1].output.confidence")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    // Collapse all keeps the root open so the top-level keys stay reachable.
    expect(rows()).toHaveLength(5);
    expect(rowByPath("$")).toHaveAttribute("aria-expanded", "true");
    expect(rowByPath("$.nodes")).toHaveAttribute("aria-expanded", "false");
  });

  it("search auto-expands to matches, highlights them and counts them", async () => {
    const user = userEvent.setup();
    render(<JsonView value={VALUE} expandDepth={0} />);
    await user.type(screen.getByRole("searchbox"), "confidence");
    expect(screen.getByText("2 matches")).toBeInTheDocument();
    const match = rowByPath("$.nodes[0].output.confidence");
    expect(match).toHaveAttribute("data-matched", "true");
    expect(within(match).getByText("confidence").tagName).toBe("MARK");
    // Non-matching siblings stay collapsed when they have no matches
    expect(document.querySelector('[data-path="$.run.id"]')).toBeNull();
  });

  it("reports no matches in the search count", async () => {
    const user = userEvent.setup();
    render(<JsonView value={VALUE} />);
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("0 matches")).toBeInTheDocument();
  });

  it("supports arrow-key navigation and expansion", () => {
    render(<JsonView value={VALUE} expandDepth={1} toolbar={false} />);
    const root = rowByPath("$");
    root.focus();
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowByPath("$.run"));
    fireEvent.keyDown(rowByPath("$.run"), { key: "ArrowRight" });
    expect(rowByPath("$.run")).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(rowByPath("$.run"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(rowByPath("$.run.id"));
    fireEvent.keyDown(rowByPath("$.run.id"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(rowByPath("$.run"));
    fireEvent.keyDown(rowByPath("$.run"), { key: "ArrowLeft" });
    expect(rowByPath("$.run")).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(rowByPath("$.run"), { key: "End" });
    expect(document.activeElement).toBe(rowByPath("$.nothing"));
    fireEvent.keyDown(rowByPath("$.nothing"), { key: "Home" });
    expect(document.activeElement).toBe(rowByPath("$"));
  });

  it("truncates long strings with a show-all control", async () => {
    const user = userEvent.setup();
    const long = "x".repeat(500);
    render(<JsonView value={{ text: long }} maxStringLength={100} toolbar={false} />);
    const row = rowByPath("$.text");
    expect(row.textContent).not.toContain("x".repeat(101));
    await user.click(within(row).getByRole("button", { name: /show all/ }));
    expect(row.textContent).toContain(long);
  });

  it("stays responsive with ~5k nodes collapsed by depth", () => {
    const big = {
      items: Array.from({ length: 500 }, (_, i) => ({
        id: i,
        tags: ["a", "b", "c"],
        meta: { x: i, y: i * 2, z: { deep: true } },
      })),
    };
    let visible = 0;
    const start = performance.now();
    render(
      <JsonView value={big} expandDepth={1} toolbar={false} onRowsChange={(n) => (visible = n)} />,
    );
    expect(performance.now() - start).toBeLessThan(2000);
    expect(visible).toBe(2);
  });
});
