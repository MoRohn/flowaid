import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { LogViewer, filterLogLines, highlightMatches, logLinesToText } from "./LogViewer";
import { SAMPLE_NODE_NAMES, buildLongLogs, buildSampleLogs } from "./sampleRun";

beforeAll(() => installDomStubs());
afterEach(() => cleanup());

describe("highlightMatches", () => {
  it("returns the whole text unmarked for an empty query", () => {
    expect(highlightMatches("hello", "")).toEqual([{ text: "hello", match: false }]);
    expect(highlightMatches("hello", "   ")).toEqual([{ text: "hello", match: false }]);
  });
  it("marks every case-insensitive occurrence", () => {
    expect(highlightMatches("Retry after 503, then 503 again", "503")).toEqual([
      { text: "Retry after ", match: false },
      { text: "503", match: true },
      { text: ", then ", match: false },
      { text: "503", match: true },
      { text: " again", match: false },
    ]);
    expect(highlightMatches("Upstream error", "UPSTREAM")).toEqual([
      { text: "Upstream", match: true },
      { text: " error", match: false },
    ]);
  });
  it("handles matches at the edges and no match at all", () => {
    expect(highlightMatches("abc", "abc")).toEqual([{ text: "abc", match: true }]);
    expect(highlightMatches("abc", "zzz")).toEqual([{ text: "abc", match: false }]);
  });
});

describe("filterLogLines", () => {
  const lines = buildSampleLogs();
  it("filters by level, node and query", () => {
    expect(filterLogLines(lines, { levels: ["error"] })).toHaveLength(1);
    expect(filterLogLines(lines, { levels: ["warn", "error"] })).toHaveLength(4);
    expect(filterLogLines(lines, { nodeId: "lookup_account" })).toHaveLength(5);
    expect(filterLogLines(lines, { query: "503" })).toHaveLength(2);
    expect(filterLogLines(lines, { query: "slack" })).toHaveLength(1);
    expect(
      filterLogLines(lines, { levels: ["debug"], nodeId: "lookup_account", query: "attempt 2" }),
    ).toHaveLength(1);
  });
  it("searches structured data too", () => {
    expect(filterLogLines(lines, { query: "deliveryFailures" })).toHaveLength(1);
  });
});

describe("logLinesToText", () => {
  it("renders copyable plain text with node names", () => {
    const text = logLinesToText(buildSampleLogs().slice(6, 7), SAMPLE_NODE_NAMES);
    expect(text).toMatch(/^\d\d:\d\d:\d\d\.\d{3} INFO  \[Intent\] intent=security p=0\.81/);
  });
});

describe("LogViewer", () => {
  it("colours levels and highlights search matches", async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={buildSampleLogs()} nodeNames={SAMPLE_NODE_NAMES} />);
    const log = screen.getByRole("log");
    expect(log.querySelectorAll("[data-level]")).toHaveLength(30);
    expect(log.querySelector("[data-level=error] .text-danger-text")).not.toBeNull();
    expect(log.querySelector("[data-level=warn] .text-warn-text")).not.toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "Search logs" }), "accounts-api");
    const marks = log.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]).toHaveTextContent("accounts-api");
    expect(log.querySelectorAll("[data-level]")).toHaveLength(1);
  });

  it("filters by level chips", async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={buildSampleLogs()} />);
    await user.click(screen.getByRole("button", { name: "error lines" }));
    expect(screen.getByRole("log").querySelectorAll("[data-level]")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "warn lines" }));
    expect(screen.getByRole("log").querySelectorAll("[data-level]")).toHaveLength(4);
  });

  it("toggles wrapping", async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={buildSampleLogs()} />);
    const first = () => screen.getByRole("log").querySelector("[data-level] > span:last-child");
    expect(first()?.className).toContain("whitespace-pre-wrap");
    await user.click(screen.getByRole("radio", { name: "Wrap long lines" }));
    expect(first()?.className).toContain("whitespace-pre");
    expect(first()?.className).not.toContain("whitespace-pre-wrap");
  });

  it("expands a line's structured data from the keyboard", async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={buildSampleLogs()} />);
    const row = screen
      .getAllByRole("button", { expanded: false })
      .find((b) => b.hasAttribute("data-level"));
    expect(row).toBeDefined();
    if (!row) return;
    row.focus();
    await user.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(row).toHaveAttribute("aria-expanded", "false");
  });
});

/**
 * happy-dom has no layout: give the log's scroll element a 400px viewport and every line a
 * measured 18px height, so the virtualizer computes a real window.
 */
function installLogLayout(): () => void {
  const proto = window.HTMLElement.prototype;
  const h = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const w = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-index") ? 18 : 400;
    },
  });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 800 });
  const ep = window.Element.prototype;
  const sh = Object.getOwnPropertyDescriptor(ep, "scrollHeight");
  const ch = Object.getOwnPropertyDescriptor(ep, "clientHeight");
  Object.defineProperty(ep, "scrollHeight", { configurable: true, get: () => 100_000 });
  Object.defineProperty(ep, "clientHeight", { configurable: true, get: () => 400 });
  return () => {
    if (h) Object.defineProperty(proto, "offsetHeight", h);
    if (w) Object.defineProperty(proto, "offsetWidth", w);
    if (sh) Object.defineProperty(ep, "scrollHeight", sh);
    if (ch) Object.defineProperty(ep, "clientHeight", ch);
  };
}

describe("LogViewer virtualization", () => {
  it("renders 10 000 lines with a bounded DOM", async () => {
    const restore = installLogLayout();
    try {
      const lines = buildLongLogs(10_000);
      render(<LogViewer lines={lines} />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const log = screen.getByRole("log");
      const rendered = log.querySelectorAll("[data-level]").length;
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(100);
      // The spacer carries the height of every line, so the scrollbar spans the whole log.
      const spacer = log.firstElementChild;
      expect(
        spacer instanceof HTMLElement ? Number.parseFloat(spacer.style.height) : 0,
      ).toBeGreaterThanOrEqual(10_000 * 18);
      // Search runs over every line, not just the mounted window.
      expect(screen.getByText("10000/10000")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("keeps the plain list below the threshold (same default as EventLog)", () => {
    render(<LogViewer lines={buildLongLogs(200)} />);
    const log = screen.getByRole("log");
    expect(log.querySelectorAll("[data-level]")).toHaveLength(200);
    expect(log.firstElementChild?.getAttribute("style") ?? "").not.toContain("height");
  });

  it("tails to the last line of a virtualized live log as lines arrive, until the user scrolls up", async () => {
    const restore = installLogLayout();
    try {
      const all = buildLongLogs(1_200);
      const onTailChange = vi.fn();
      const { rerender } = render(
        <LogViewer lines={all.slice(0, 1_000)} live onTailChange={onTailChange} />,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const log = screen.getByRole("log");
      // happy-dom applies scrollTo without dispatching `scroll`; a browser would, and the
      // virtualizer re-windows on it.
      const settle = async () => {
        fireEvent.scroll(log);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      };
      await settle();
      const lastIndex = () =>
        Math.max(
          ...Array.from(log.querySelectorAll("[data-index]"), (el) =>
            Number(el.getAttribute("data-index")),
          ),
        );
      expect(lastIndex()).toBe(999);
      expect(screen.getByRole("switch", { name: "Tail new lines" })).toBeChecked();

      rerender(<LogViewer lines={all} live onTailChange={onTailChange} />);
      await settle();
      expect(lastIndex()).toBe(1_199);
      expect(onTailChange).not.toHaveBeenCalled();

      // A user scroll far from the bottom turns tailing off.
      log.scrollTop = 0;
      fireEvent.scroll(log);
      expect(onTailChange).toHaveBeenLastCalledWith(false);
    } finally {
      restore();
    }
  });

  it("does not show the tail switch for a finished run", () => {
    render(<LogViewer lines={buildSampleLogs()} />);
    expect(screen.queryByRole("switch", { name: "Tail new lines" })).not.toBeInTheDocument();
  });
});
