import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CopyButton, Hint } from "@/primitives";

export interface KeyValueItem {
  /** Row key; falls back to the label when it is a string. */
  id?: string;
  label: ReactNode;
  value: ReactNode;
  /** Text copied by the hover action; defaults to `value` when it is a string. */
  copyValue?: string;
  /** Render this value in the mono face (overrides the list default). */
  mono?: boolean;
  /** Muted value (unset, default, inherited). */
  muted?: boolean;
  /** Hint on the value: a tooltip on hover, also read by assistive tech when it adds to the value. */
  title?: string;
}

export interface KeyValueListProps extends Omit<HTMLAttributes<HTMLDListElement>, "children"> {
  items: readonly KeyValueItem[];
  /** Render every value in the mono face. Default false. */
  mono?: boolean;
  /** Label column width in px. Default 104. */
  labelWidth?: number;
  /** Stack label above value (for narrow containers). */
  stacked?: boolean;
  /** Show the copy action on hover when a row has copyable text. Default true. */
  copyable?: boolean;
  /** 1px dividers between rows. */
  divided?: boolean;
  /** Tighter 22px rows. */
  dense?: boolean;
}

/**
 * Compact label/value rows for identifiers, timings and provider details.
 * Labels sit in ink-3, values in ink; `mono` switches values to the mono
 * face. Rows with copyable text reveal a copy button on hover.
 */
export const KeyValueList = forwardRef<HTMLDListElement, KeyValueListProps>(function KeyValueList(
  {
    items,
    mono = false,
    labelWidth = 104,
    stacked = false,
    copyable = true,
    divided = false,
    dense = false,
    className,
    style,
    ...rest
  },
  ref,
) {
  return (
    <dl
      ref={ref}
      className={cn("flex min-w-0 flex-col", divided && "divide-y divide-border", className)}
      style={{ "--kv-label-w": `${labelWidth}px`, ...style }}
      {...rest}
    >
      {items.map((item, i) => {
        const key = item.id ?? (typeof item.label === "string" ? item.label : String(i));
        const copyText =
          item.copyValue ?? (typeof item.value === "string" ? item.value : undefined);
        const isMono = item.mono ?? mono;
        return (
          <div
            key={key}
            className={cn(
              "group/kv flex min-w-0 gap-x-3 gap-y-0.5",
              stacked ? "flex-col py-1.5" : "items-start",
              !stacked && (dense ? "min-h-[22px] py-0.5" : "min-h-6 py-1"),
              divided && !stacked && "py-1.5",
            )}
          >
            <dt
              className={cn(
                "shrink-0 text-xs leading-5 text-ink-3",
                !stacked && "w-(--kv-label-w) truncate",
              )}
            >
              {item.label}
            </dt>
            <dd
              className={cn(
                "flex min-w-0 flex-1 items-start gap-1 text-xs leading-5",
                isMono ? "font-mono tabular" : "",
                item.muted ? "text-ink-3" : "text-ink",
              )}
            >
              {item.title !== undefined ? (
                <Hint
                  hint={item.title}
                  announce={typeof item.value !== "string" || item.value !== item.title}
                  className="min-w-0 flex-1 break-words"
                >
                  {item.value}
                </Hint>
              ) : (
                <span className="min-w-0 flex-1 break-words">{item.value}</span>
              )}
              {copyable && copyText !== undefined ? (
                <CopyButton
                  value={copyText}
                  label="Copy"
                  size="xs"
                  tooltipSide="left"
                  className={cn(
                    "-my-px shrink-0 text-ink-3 opacity-0 transition-opacity duration-(--dur-fast)",
                    "group-hover/kv:opacity-100 focus-visible:opacity-100 data-[copied]:opacity-100",
                  )}
                />
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
});
