import { forwardRef, type SVGAttributes } from "react";
import { cn } from "@/lib/cn";

export interface LogoMarkProps extends Omit<SVGAttributes<SVGSVGElement>, "children"> {
  /** Rendered size in px (the mark is a 32-unit grid; minimum 16). */
  size?: number;
  /** Fill the chosen-branch dot with the accent; false renders it in currentColor. */
  accent?: boolean;
  /** Accessible title; omit for decorative use. */
  title?: string;
}

/**
 * The FlowAId mark: one path in, three weighted branches out (opacity
 * 1.0 / 0.42 / 0.18) with the chosen branch marked by a dot. Strokes use
 * currentColor so it takes the surrounding ink.
 */
export const LogoMark = forwardRef<SVGSVGElement, LogoMarkProps>(function LogoMark(
  { size = 32, accent = true, title, className, ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d="M4 16h8" />
      <path d="M12 16c6 0 6-9 12-9" />
      <path d="M12 16h12" opacity="0.42" />
      <path d="M12 16c6 0 6 9 12 9" opacity="0.18" />
      <circle
        cx="26"
        cy="7"
        r="2.6"
        fill={accent ? "var(--accent)" : "currentColor"}
        stroke="none"
      />
    </svg>
  );
});

export interface LogoWordmarkProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "children" | "height"
> {
  /** Rendered height in px (minimum 14). Width follows the 348.2:77 aspect. */
  height?: number;
  /** Colour the "AI" glyphs with the accent; false renders the whole word in currentColor. */
  accent?: boolean;
  title?: string;
}

const WORDMARK_VIEWBOX = "4.20 -74.00 348.20 77.00";
const WORDMARK_ASPECT = 348.2 / 77;

/**
 * The FlowAId wordmark as paths (Instrument Sans SemiBold, tracked −0.035em):
 * "Flow" and "d" in currentColor, "AI" in the accent.
 */
export const LogoWordmark = forwardRef<SVGSVGElement, LogoWordmarkProps>(function LogoWordmark(
  { height = 16, accent = true, title, className, ...rest },
  ref,
) {
  const accentFill = accent ? "var(--accent)" : "currentColor";
  return (
    <svg
      ref={ref}
      viewBox={WORDMARK_VIEWBOX}
      height={height}
      width={Math.round(height * WORDMARK_ASPECT * 100) / 100}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path
        fill="currentColor"
        d="M6.2 0.0V-72.0H19.200000000000003V0.0ZM12.4 -28.900000000000002V-39.2H52.900000000000006V-28.900000000000002ZM12.4 -61.7V-72.0H55.300000000000004V-61.7Z"
      />
      <path fill="currentColor" d="M62.60000000000001 0.0V-72.0H75.2V0.0Z" />
      <path
        fill="currentColor"
        d="M108.30000000000001 1.0Q100.2 1.0 94.05000000000001 -2.4000000000000004Q87.9 -5.800000000000001 84.5 -11.850000000000001Q81.10000000000001 -17.900000000000002 81.10000000000001 -25.700000000000003Q81.10000000000001 -33.5 84.5 -39.400000000000006Q87.9 -45.300000000000004 94.05000000000001 -48.650000000000006Q100.2 -52.0 108.30000000000001 -52.0Q116.5 -52.0 122.60000000000001 -48.650000000000006Q128.70000000000002 -45.300000000000004 132.10000000000002 -39.400000000000006Q135.5 -33.5 135.5 -25.700000000000003Q135.5 -17.900000000000002 132.05 -11.850000000000001Q128.60000000000002 -5.800000000000001 122.50000000000001 -2.4000000000000004Q116.4 1.0 108.30000000000001 1.0ZM108.30000000000001 -9.1Q112.30000000000001 -9.1 115.50000000000001 -11.15Q118.70000000000002 -13.200000000000001 120.50000000000001 -16.950000000000003Q122.30000000000001 -20.700000000000003 122.30000000000001 -25.8Q122.30000000000001 -33.300000000000004 118.35000000000001 -37.60000000000001Q114.4 -41.900000000000006 108.30000000000001 -41.900000000000006Q102.2 -41.900000000000006 98.2 -37.60000000000001Q94.2 -33.300000000000004 94.2 -25.8Q94.2 -20.700000000000003 96.05000000000001 -16.950000000000003Q97.9 -13.200000000000001 101.05000000000001 -11.15Q104.2 -9.1 108.30000000000001 -9.1Z"
      />
      <path
        fill="currentColor"
        d="M150.5 0.0 134.9 -51.0H148.10000000000002L157.3 -12.700000000000001H156.4L167.70000000000002 -51.0H179.20000000000002L190.70000000000002 -12.700000000000001H189.70000000000002L198.8 -51.0H211.70000000000002L196.10000000000002 0.0H184.3L172.8 -37.9H173.8L162.3 0.0Z"
      />
      <path
        fill={accentFill}
        d="M206.10000000000002 0.0 232.60000000000002 -72.0H243.8L218.9 0.0ZM260.40000000000003 0.0 235.60000000000002 -72.0H247.4L273.8 0.0ZM219.8 -28.3H259.20000000000005V-17.900000000000002H219.8Z"
      />
      <path fill={accentFill} d="M279.3 0.0V-72.0H292.3V0.0Z" />
      <path
        fill="currentColor"
        d="M338.1 0.0V-11.5L339.1 -11.3Q337.8 -5.7 332.8 -2.35Q327.8 1.0 320.9 1.0Q313.9 1.0 308.75 -2.25Q303.6 -5.5 300.8 -11.4Q298.0 -17.3 298.0 -25.3Q298.0 -33.4 300.9 -39.400000000000006Q303.8 -45.400000000000006 309.05 -48.7Q314.3 -52.0 321.3 -52.0Q328.5 -52.0 333.2 -48.55Q337.9 -45.1 339.0 -39.0L337.7 -38.900000000000006V-72.0H350.4V0.0ZM324.6 -9.3Q330.7 -9.3 334.35 -13.55Q338.0 -17.8 338.0 -25.5Q338.0 -33.2 334.3 -37.400000000000006Q330.6 -41.6 324.5 -41.6Q318.5 -41.6 314.8 -37.35Q311.1 -33.1 311.1 -25.400000000000002Q311.1 -17.7 314.8 -13.5Q318.5 -9.3 324.6 -9.3Z"
      />
    </svg>
  );
});
