import { forwardRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Display name; drives the initials fallback and the accessible label. */
  name: string;
  src?: string;
  size?: AvatarSize;
  /** Square with rounded corners, for workspaces and bots. */
  shape?: "circle" | "square";
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "size-4 text-2xs",
  sm: "size-5 text-2xs",
  md: "size-6 text-2xs",
  lg: "size-8 text-xs",
};

/** Up to two initials from a display name ("Ada Lovelace" → "AL", "ops-bot" → "O"). */
export function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 1).toUpperCase();
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
}

/**
 * Image avatar with an initials fallback on a neutral surface. Never coloured: avatars are not
 * categories. Initials never go below the 11px type floor, so the 16px `xs` avatar shows one.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, src, size = "md", shape = "circle", className, ...rest },
  ref,
) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return (
    <Tooltip content={name}>
      <span
        ref={ref}
        role="img"
        aria-label={name}
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center overflow-hidden border border-border bg-surface-3 font-medium leading-none text-ink-2",
          shape === "circle" ? "rounded-full" : "rounded-xs",
          SIZE_CLASS[size],
          className,
        )}
        {...rest}
      >
        {showImage ? (
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <span aria-hidden="true">
            {size === "xs" ? initialsFor(name).slice(0, 1) : initialsFor(name)}
          </span>
        )}
      </span>
    </Tooltip>
  );
});
