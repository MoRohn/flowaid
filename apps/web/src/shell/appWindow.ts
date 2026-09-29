/**
 * Whether this page is FlowAId's own app window, the one `./flowaid` opened (and can close). The
 * launcher opens it at `/#flowaid-window`; the first page load records that for this window
 * (sessionStorage is per window and survives navigation) and removes the fragment. Every other
 * tab or window, even on the same address, is not it: Close window there closes only itself.
 */
export const APP_WINDOW_FRAGMENT = "#flowaid-window";
const KEY = "flowaid:app-window";

/** Called once when the app loads, before the first redirect drops the fragment. */
export function recordAppWindow(): void {
  if (typeof window === "undefined" || window.location.hash !== APP_WINDOW_FRAGMENT) return;
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    /* storage blocked: Close window falls back to closing the page */
  }
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
}

export function isAppWindow(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
