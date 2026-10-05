import {
  Children,
  Fragment,
  isValidElement,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * One filled (primary) button per screen (IDENTITY.md). List pages put their create button in the
 * PageHeader and repeat it in the empty state below; PageHeader announces that it holds the
 * screen's primary action, and EmptyState then shows the same button as secondary.
 */

let headerPrimaries = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the node is, or directly contains, a primary button (`variant="primary"`). */
export function hasPrimaryButton(node: ReactNode): boolean {
  return Children.toArray(node).some(
    (child) =>
      isValidElement<{ variant?: unknown; children?: ReactNode }>(child) &&
      (child.props.variant === "primary" ||
        (child.type === Fragment && hasPrimaryButton(child.props.children))),
  );
}

/** Marks the screen's primary action as shown by a page header while `active`. */
export function useHeaderPrimaryAction(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    headerPrimaries += 1;
    emit();
    return () => {
      headerPrimaries -= 1;
      emit();
    };
  }, [active]);
}

/** True while a page header on screen shows a primary action. */
export function useHeaderHasPrimaryAction(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => headerPrimaries > 0,
    () => false,
  );
}
