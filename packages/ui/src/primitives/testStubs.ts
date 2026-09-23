/**
 * DOM APIs that happy-dom does not implement but Radix, cmdk and
 * react-resizable-panels call. Import once per test file that needs them.
 */
export function installDomStubs(): void {
  if (typeof window === "undefined") return;
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(window, "ResizeObserver", {
      value: ResizeObserverStub,
      configurable: true,
      writable: true,
    });
  }
  const proto = window.Element.prototype;
  if (typeof proto.scrollIntoView !== "function") {
    Object.defineProperty(proto, "scrollIntoView", {
      value: () => undefined,
      configurable: true,
      writable: true,
    });
  }
  if (typeof proto.hasPointerCapture !== "function") {
    Object.defineProperty(proto, "hasPointerCapture", {
      value: () => false,
      configurable: true,
      writable: true,
    });
  }
  if (typeof proto.setPointerCapture !== "function") {
    Object.defineProperty(proto, "setPointerCapture", {
      value: () => undefined,
      configurable: true,
      writable: true,
    });
  }
  if (typeof proto.releasePointerCapture !== "function") {
    Object.defineProperty(proto, "releasePointerCapture", {
      value: () => undefined,
      configurable: true,
      writable: true,
    });
  }
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
}
