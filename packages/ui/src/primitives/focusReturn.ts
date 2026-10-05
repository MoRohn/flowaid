import { useRef } from "react";

/**
 * Focus return for overlays (WCAG 2.4.3). Radix gives focus back to a dialog's own trigger, but a
 * dialog, sheet or confirmation opened from code (a menu item, a command, a shortcut, a button
 * that sets state) has none, so focus fell to <body> and the next Tab started at the top of the
 * page. Dialog and Sheet remember what had focus when they opened and focus it again when they
 * close. Each remembered element brings the ones that stand in for it when it is gone: a menu item
 * leads to the button that opened its menu, and a control inside another overlay leads to that
 * overlay's own opener.
 */

/** Marks overlay content so a control inside it can find that overlay's opener. */
const OVERLAY_ATTRIBUTE = "data-fa-overlay";

const openers = new WeakMap<Element, readonly HTMLElement[]>();

// The last element that took focus. A menu item that opens a dialog is removed with its menu as
// the dialog opens, so by then `document.activeElement` can already be <body>.
let lastFocused: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target instanceof HTMLElement) lastFocused = event.target;
    },
    true,
  );
}

/** The element to return to, followed by the ones that stand in for it. */
export function openerChain(start: Element | null): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let el: Element | null = start;
  // a few hops at most: item → submenu trigger → menu trigger → the dialog's opener
  for (let hop = 0; el instanceof HTMLElement && el !== document.body && hop < 8; hop++) {
    chain.push(el);
    const menu = el.closest('[role="menu"]');
    if (menu) {
      const trigger = menu.getAttribute("aria-labelledby");
      el = trigger ? document.getElementById(trigger) : null;
      continue;
    }
    const overlay = el.closest(`[${OVERLAY_ATTRIBUTE}]`);
    if (overlay) chain.push(...(openers.get(overlay) ?? []));
    break;
  }
  return chain;
}

/** What had focus just before an overlay opened (read before the overlay moves focus). */
export function captureOpener(): HTMLElement[] {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return openerChain(active);
  // focus fell to <body> because the focused control was removed (its menu closed)
  return lastFocused && !lastFocused.isConnected ? openerChain(lastFocused) : [];
}

/** Focuses the first element of the chain that is still on the page and can take focus. */
export function returnFocus(chain: readonly HTMLElement[]): boolean {
  for (const el of chain) {
    if (!el.isConnected || el.matches(":disabled") || el.closest("[inert]")) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return true;
  }
  return false;
}

/**
 * The `onOpenAutoFocus` / `onCloseAutoFocus` pair for a Radix dialog content: remembers the
 * opener as the overlay opens and returns focus to it as it closes. The caller's own handlers
 * run as before; one that prevents the default on close keeps its own focus target.
 */
export function useReturnFocus(handlers: {
  onOpenAutoFocus?: ((event: Event) => void) | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}) {
  const chain = useRef<readonly HTMLElement[]>([]);
  return {
    onOpenAutoFocus: (event: Event) => {
      chain.current = captureOpener();
      if (event.target instanceof Element) openers.set(event.target, chain.current);
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      handlers.onCloseAutoFocus?.(event);
      if (!event.defaultPrevented && returnFocus(chain.current)) event.preventDefault();
    },
  };
}
