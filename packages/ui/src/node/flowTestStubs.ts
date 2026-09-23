/**
 * Test helpers for rendering React Flow in happy-dom, which has no layout:
 * elements report a fixed size so xyflow can measure the pane and the nodes
 * (and draw edges) instead of warning that the container has no size, and
 * console output is captured so tests can assert that nothing warned.
 */
import { vi } from "vitest";

/** A `ResizeObserver` that reports every observed element once, right after `observe`, like a first layout. */
class ReportingResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly observed = new Set<Element>();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    this.observed.add(target);
    queueMicrotask(() => {
      if (!this.observed.has(target)) return;
      const rect = target.getBoundingClientRect();
      const size = { inlineSize: rect.width, blockSize: rect.height };
      const entry: ResizeObserverEntry = {
        target,
        contentRect: rect,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
      };
      this.callback([entry], this);
    });
  }
  unobserve(target: Element): void {
    this.observed.delete(target);
  }
  disconnect(): void {
    this.observed.clear();
  }
}

/**
 * Gives every element a layout size (`offsetWidth` / `offsetHeight`) and installs a
 * `ResizeObserver` that reports observed elements once, so xyflow measures nodes and draws
 * edges. Returns a function that restores the originals.
 */
export function installLayoutStubs(width = 800, height = 600): () => void {
  const proto = window.HTMLElement.prototype;
  const w = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  const h = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const ro = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => width });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => height });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ReportingResizeObserver,
  });
  return () => {
    if (w) Object.defineProperty(proto, "offsetWidth", w);
    if (h) Object.defineProperty(proto, "offsetHeight", h);
    if (ro) Object.defineProperty(window, "ResizeObserver", ro);
  };
}

/** Captures `console.warn` / `console.error`; `messages()` returns every call joined into one string per call. */
export function captureConsole(): { messages: () => string[]; restore: () => void } {
  const calls: string[] = [];
  const record = (...args: unknown[]) => {
    calls.push(
      args
        .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : String(a)))
        .join(" "),
    );
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(record);
  const error = vi.spyOn(console, "error").mockImplementation(record);
  return {
    messages: () => [...calls],
    restore: () => {
      warn.mockRestore();
      error.mockRestore();
    },
  };
}

function pxOf(value: string): number | undefined {
  return value.endsWith("px") ? Number.parseFloat(value) : undefined;
}

/**
 * Like `installLayoutStubs`, but sizes elements the way the canvas lays them out, so xyflow's
 * parent extents, resizers and drop targets can be exercised: an element with an inline px
 * `width`/`height` (a container frame's xyflow node) reports that size, other xyflow nodes a
 * 232 × 96 card, and everything else (the pane) `width` × `height`. Every element's client rect
 * is the pane at the origin, so pointer coordinates equal flow coordinates at zoom 1 and
 * xyflow's auto-pan stays off while the pointer is inside the pane.
 */
export function installSizedLayoutStubs(width = 800, height = 600): () => void {
  const restoreBase = installLayoutStubs(width, height);
  const proto = window.HTMLElement.prototype;
  const w = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  const h = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const rect = Object.getOwnPropertyDescriptor(window.Element.prototype, "getBoundingClientRect");
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return pxOf(this.style.width) ?? (this.classList.contains("react-flow__node") ? 232 : width);
    },
  });
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return pxOf(this.style.height) ?? (this.classList.contains("react-flow__node") ? 96 : height);
    },
  });
  Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => new DOMRect(0, 0, width, height),
  });
  return () => {
    if (w) Object.defineProperty(proto, "offsetWidth", w);
    if (h) Object.defineProperty(proto, "offsetHeight", h);
    if (rect) Object.defineProperty(window.Element.prototype, "getBoundingClientRect", rect);
    restoreBase();
  };
}

/**
 * Drags `element` with the mouse (d3-drag, which xyflow's node drag and `NodeResizer` use):
 * mousedown at `from`, a 4px nudge that crosses xyflow's drag threshold (the drag starts
 * there), then `steps` moves to `to` and mouseup at `to`.
 */
export function dragMouse(
  element: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 4,
): void {
  const init = (p: { x: number; y: number }): MouseEventInit => ({
    clientX: p.x,
    clientY: p.y,
    bubbles: true,
    cancelable: true,
    view: window,
    button: 0,
  });
  element.dispatchEvent(new MouseEvent("mousedown", init(from)));
  window.dispatchEvent(new MouseEvent("mousemove", init({ x: from.x + 4, y: from.y })));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    window.dispatchEvent(
      new MouseEvent(
        "mousemove",
        init({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }),
      ),
    );
  }
  window.dispatchEvent(new MouseEvent("mouseup", init(to)));
}
