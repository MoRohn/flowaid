import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A ref that always holds the latest `value` for callbacks and effects to read.
 *
 * It is synced in a layout effect rather than during render (the React Compiler rule
 * `react-hooks/refs`): layout effects run in declaration order right after commit, before
 * passive effects and before any event handler can fire, so callers that declare it ahead
 * of their own effects always observe the committed value. Never read it during render.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
