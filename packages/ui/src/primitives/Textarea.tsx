import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with content between `minRows` and `maxRows`. */
  autoGrow?: boolean;
  minRows?: number;
  maxRows?: number;
  mono?: boolean;
  invalid?: boolean;
}

const LINE_HEIGHT = 20;
const PADDING_Y = 12;

/**
 * Multi-line input. With `autoGrow` the height follows the content and the
 * resize handle disappears; otherwise the user can drag it vertically.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    className,
    autoGrow = false,
    minRows = 3,
    maxRows = 12,
    mono = false,
    invalid,
    id,
    disabled,
    onChange,
    value,
    defaultValue,
    rows,
    style,
    ...rest
  },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": rest["aria-describedby"],
  });

  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      inner.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const fit = useCallback(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    const min = minRows * LINE_HEIGHT + PADDING_Y;
    const max = maxRows * LINE_HEIGHT + PADDING_Y;
    const next = Math.min(max, Math.max(min, el.scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [autoGrow, minRows, maxRows]);

  useLayoutEffect(() => {
    fit();
  }, [fit, value]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e);
    if (value === undefined) fit();
  };

  return (
    <textarea
      ref={setRef}
      {...rest}
      id={field.id}
      disabled={field.disabled}
      aria-invalid={field["aria-invalid"]}
      aria-describedby={field["aria-describedby"]}
      aria-required={field["aria-required"]}
      value={value}
      defaultValue={defaultValue}
      rows={rows ?? minRows}
      onChange={handleChange}
      style={{ lineHeight: `${LINE_HEIGHT}px`, ...style }}
      className={cn(
        "block w-full min-w-0 rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-3",
        "transition-[border-color,box-shadow] duration-(--dur-fast) ease-(--ease-out)",
        "hover:border-border-strong focus-visible:border-accent",
        "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 read-only:bg-surface-2",
        "aria-invalid:border-danger",
        autoGrow ? "resize-none" : "resize-y",
        mono && "font-mono text-xs",
        className,
      )}
    />
  );
});
