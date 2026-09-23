import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Tooltip, type TooltipProps } from "./Tooltip";

export interface HintProps extends Omit<HTMLAttributes<HTMLSpanElement>, "title"> {
  /** The hint: shown in the `Tooltip` on hover. */
  hint: string;
  /**
   * Also render the hint as visually hidden text inside the span, so assistive tech reads
   * it (default). Turn it off when the element already carries the same text: a truncated
   * value whose hint is the full value, or an element with its own `aria-label`.
   */
  announce?: boolean;
  side?: TooltipProps["side"];
  children?: ReactNode;
}

/**
 * A hint on non-interactive text, in place of a native `title` attribute: `title` never
 * shows on keyboard focus, is read inconsistently by screen readers and cannot be styled.
 * The hint is shown in the `Tooltip` primitive on hover and, with `announce`, is part of
 * the element's text for assistive tech (`sr-only`). Interactive elements (buttons, toggles)
 * use `Tooltip` directly, which also opens on keyboard focus.
 */
export const Hint = forwardRef<HTMLSpanElement, HintProps>(function Hint(
  { hint, announce = true, side, children, ...rest },
  ref,
) {
  return (
    <Tooltip content={hint} side={side}>
      <span ref={ref} {...rest}>
        {children}
        {announce ? <span className="sr-only"> {hint}</span> : null}
      </span>
    </Tooltip>
  );
});
