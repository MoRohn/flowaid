import { useCallback, useState } from "react";
import { useLatestRef } from "@/lib/useLatestRef";

/**
 * Controlled/uncontrolled state helper shared by the primitives.
 * When `value` is provided the component is controlled and `onChange` is the
 * only way state moves; otherwise `defaultValue` seeds internal state.
 */
export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const onChangeRef = useLatestRef(onChange);
  const currentRef = useLatestRef(current);

  const set = useCallback(
    (next: T) => {
      if (Object.is(next, currentRef.current)) return;
      if (!controlled) setInternal(next);
      onChangeRef.current?.(next);
    },
    [controlled, currentRef, onChangeRef],
  );
  return [current, set];
}
