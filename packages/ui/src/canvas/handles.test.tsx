/**
 * TypedHandle ids and states, and the connection line's validity drawing (P0-20).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Position } from "@xyflow/react";
import { installDomStubs } from "@/primitives/testStubs";
import { TypedHandle } from "@/node/TypedHandle";
import { ConnectionLinePath } from "./ConnectionLine";

afterEach(cleanup);
beforeAll(() => installDomStubs());

describe("TypedHandle outside a React Flow node", () => {
  it("derives its id from kind and port name and names itself by direction", () => {
    const { container } = render(
      <>
        <TypedHandle kind="in" name="message" port={{ label: "Message", type: "string" }} />
        <TypedHandle kind="out" name="decision" port={{ label: "Decision", type: "decision" }} />
        <TypedHandle kind="ctl" name="approved" label="Approved" />
        <TypedHandle kind="ctl-in" />
      </>,
    );
    const ids = [...container.querySelectorAll("[data-handleid]")].map((el) =>
      el.getAttribute("data-handleid"),
    );
    expect(ids).toEqual(["in:message", "out:decision", "ctl:approved", "ctl-in"]);
    expect(screen.getByRole("img", { name: "Message (input)" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Decision (output)" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Approved (control output)" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "control in (control input)" })).toBeInTheDocument();
  });

  it("states why a dragged connection is refused", () => {
    render(
      <TypedHandle
        kind="in"
        name="count"
        port={{ label: "Count", type: "integer" }}
        compatible={false}
        reason="string is not assignable to integer"
      />,
    );
    const handle = screen.getByRole("img", { name: /Count \(input\): string is not assignable/ });
    expect(handle).toHaveAttribute("data-compatible", "false");
    expect(handle).toHaveAttribute("data-reason", "string is not assignable to integer");
  });
});

describe("ConnectionLinePath", () => {
  const at = {
    fromX: 0,
    fromY: 0,
    toX: 120,
    toY: 40,
    fromPosition: Position.Right,
    toPosition: Position.Left,
  };

  it("draws a pending line in the accent, a valid one in ok and an invalid one crossed out", () => {
    const { container, rerender } = render(
      <svg>
        <ConnectionLinePath {...at} status={null} />
      </svg>,
    );
    const g = () => container.querySelector("g.fa-connection-line") as SVGGElement;
    expect(g()).toHaveAttribute("data-status", "pending");
    expect(g().querySelector("path")).toHaveAttribute("stroke", "var(--accent)");

    rerender(
      <svg>
        <ConnectionLinePath {...at} status="valid" />
      </svg>,
    );
    expect(g()).toHaveAttribute("data-status", "valid");
    expect(g().querySelector("path")).toHaveAttribute("stroke", "var(--ok)");
    expect(g().querySelectorAll("line")).toHaveLength(0);

    rerender(
      <svg>
        <ConnectionLinePath {...at} status="invalid" />
      </svg>,
    );
    expect(g().querySelector("path")).toHaveAttribute("stroke", "var(--danger)");
    expect(g().querySelector("path")).toHaveAttribute("stroke-dasharray", "2 3");
    expect(g().querySelectorAll("line")).toHaveLength(2);
    // the line ends at the pointer
    const dot = g().querySelector("circle");
    expect(dot).toHaveAttribute("cx", "120");
    expect(dot).toHaveAttribute("cy", "40");
  });
});
