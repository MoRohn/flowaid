import { describe, expect, it } from "vitest";
import {
  alignNodes,
  boundsOf,
  distributeNodes,
  probabilityToStroke,
  type BoxedNode,
} from "./geometry";

const nodes: BoxedNode[] = [
  { id: "a", x: 0, y: 0, width: 232, height: 100 },
  { id: "b", x: 300, y: 50, width: 232, height: 60 },
  { id: "c", x: 900, y: 200, width: 232, height: 80 },
];

describe("boundsOf", () => {
  it("wraps every box", () => {
    expect(boundsOf(nodes)).toEqual({ x: 0, y: 0, width: 1132, height: 280 });
    expect(boundsOf([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("alignNodes", () => {
  it("aligns left, right and horizontal centre", () => {
    expect([...alignNodes(nodes, "left").values()].map((p) => p.x)).toEqual([0, 0, 0]);
    expect([...alignNodes(nodes, "right").values()].map((p) => p.x)).toEqual([900, 900, 900]);
    expect([...alignNodes(nodes, "center").values()].map((p) => p.x)).toEqual([450, 450, 450]);
  });
  it("aligns top, bottom and vertical middle and keeps x", () => {
    const top = alignNodes(nodes, "top");
    expect([...top.values()].map((p) => p.y)).toEqual([0, 0, 0]);
    expect(top.get("c")?.x).toBe(900);
    expect([...alignNodes(nodes, "bottom").values()].map((p) => p.y)).toEqual([180, 220, 200]);
    expect([...alignNodes(nodes, "middle").values()].map((p) => p.y)).toEqual([90, 110, 100]);
  });
});

describe("distributeNodes", () => {
  it("equalises horizontal gaps keeping the first and last in place", () => {
    const out = distributeNodes(nodes, "horizontal");
    expect(out.get("a")).toEqual({ x: 0, y: 0 });
    expect(out.get("c")).toEqual({ x: 900, y: 200 });
    // span 1132, widths 696 → two gaps of 218
    expect(out.get("b")).toEqual({ x: 450, y: 50 });
  });
  it("equalises vertical gaps", () => {
    const out = distributeNodes(nodes, "vertical");
    expect(out.get("a")?.y).toBe(0);
    expect(out.get("c")?.y).toBe(200);
    // span 280, heights 240 → two gaps of 20 → b at 120
    expect(out.get("b")?.y).toBe(120);
  });
  it("leaves fewer than three nodes alone", () => {
    const two = nodes.slice(0, 2);
    const out = distributeNodes(two, "horizontal");
    expect(out.get("b")).toEqual({ x: 300, y: 50 });
  });
});

describe("probabilityToStroke", () => {
  it("maps 1.0 to full opacity and the low end to 0.18", () => {
    expect(probabilityToStroke(1)).toEqual({ opacity: 1, width: 2.5 });
    expect(probabilityToStroke(0)).toEqual({ opacity: 0.18, width: 1 });
  });
  it("hits the mark's mid weight near 0.3", () => {
    expect(probabilityToStroke(0.3).opacity).toBeCloseTo(0.43, 2);
    expect(probabilityToStroke(0.81).opacity).toBeCloseTo(0.84, 2);
  });
  it("clamps and falls back", () => {
    expect(probabilityToStroke(4)).toEqual({ opacity: 1, width: 2.5 });
    expect(probabilityToStroke(-1)).toEqual({ opacity: 0.18, width: 1 });
    expect(probabilityToStroke(undefined)).toEqual({ opacity: 1, width: 1.5 });
    expect(probabilityToStroke(Number.NaN)).toEqual({ opacity: 1, width: 1.5 });
  });
});
