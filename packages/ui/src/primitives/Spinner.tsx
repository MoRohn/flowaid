import { forwardRef, type SVGAttributes } from "react";
import { cn } from "@/lib/cn";

export type SpinnerSize = "xs" | "sm" | "md" | "lg";

export interface SpinnerProps extends Omit<SVGAttributes<SVGSVGElement>, "children"> {
  size?: SpinnerSize;
  /** Accessible label announced by screen readers. */
  label?: string;
}

const SIZE_PX: Record<SpinnerSize, number> = { xs: 12, sm: 14, md: 16, lg: 20 };

/**
 * Indeterminate activity indicator. A short arc rotates around a faint track;
 * the rotation keeps running under reduced motion (it is the only cue that
 * something is in progress) but slows down so it never draws the eye.
 */
export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(function Spinner(
  { size = "md", label = "Loading", className, ...rest },
  ref,
) {
  const px = SIZE_PX[size];
  return (
    <svg
      ref={ref}
      role="status"
      aria-label={label}
      width={px}
      height={px}
      viewBox="0 0 16 16"
      fill="none"
      className={cn("shrink-0 animate-spin motion-reduce:[animation-duration:2.4s]", className)}
      {...rest}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.75" opacity="0.2" />
      <path
        d="M14.25 8a6.25 6.25 0 0 0-6.25-6.25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
});
