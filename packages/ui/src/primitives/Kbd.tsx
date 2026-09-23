import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  size?: "sm" | "md";
}

/** A single key cap: mono, bordered, 11px (`text-2xs`, the type floor). Used for shortcut hints in menus, tooltips and buttons. */
export const Kbd = forwardRef<HTMLElement, KbdProps>(function Kbd(
  { className, size = "md", ...rest },
  ref,
) {
  return (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-xs border border-border bg-surface-2 font-mono font-medium leading-none text-ink-3 tabular",
        size === "sm" ? "h-4 min-w-4 px-0.5 text-2xs" : "h-4.5 min-w-4.5 px-1 text-2xs",
        className,
      )}
      {...rest}
    />
  );
});

export type ShortcutPlatform = "mac" | "other";

const MAC_GLYPHS: Record<string, string> = {
  mod: "⌘",
  cmd: "⌘",
  meta: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  enter: "↵",
  return: "↵",
  esc: "Esc",
  escape: "Esc",
  backspace: "⌫",
  delete: "⌦",
  del: "⌦",
  tab: "⇥",
  space: "␣",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  plus: "+",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

const OTHER_GLYPHS: Record<string, string> = {
  mod: "Ctrl",
  cmd: "Ctrl",
  meta: "Win",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  enter: "Enter",
  return: "Enter",
  esc: "Esc",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Del",
  del: "Del",
  tab: "Tab",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  plus: "+",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

const MODIFIER_ORDER: Record<ShortcutPlatform, string[]> = {
  mac: ["ctrl", "alt", "shift", "mod"],
  other: ["mod", "ctrl", "alt", "shift"],
};

/** Detects the platform for modifier glyphs; safe to call during SSR (falls back to "other"). */
export function detectPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad|iPod/i.test(ua) ? "mac" : "other";
}

/**
 * Parses a shortcut string such as "mod+shift+k" into display glyphs.
 * Modifiers are ordered the way each platform expects (⌃⌥⇧⌘ on macOS,
 * Ctrl Alt Shift elsewhere); the key itself is upper-cased.
 */
export function parseShortcut(
  shortcut: string,
  platform: ShortcutPlatform = detectPlatform(),
): string[] {
  const glyphs = platform === "mac" ? MAC_GLYPHS : OTHER_GLYPHS;
  const parts = shortcut
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const order = MODIFIER_ORDER[platform];
  const modifiers = parts.filter((p) => order.includes(normaliseModifier(p)));
  const keys = parts.filter((p) => !order.includes(normaliseModifier(p)));
  modifiers.sort(
    (a, b) => order.indexOf(normaliseModifier(a)) - order.indexOf(normaliseModifier(b)),
  );
  return [...modifiers, ...keys].map(
    (p) => glyphs[p] ?? (p.length === 1 ? p.toUpperCase() : capitalise(p)),
  );
}

function normaliseModifier(p: string): string {
  if (p === "cmd" || p === "meta") return "mod";
  if (p === "control") return "ctrl";
  if (p === "option") return "alt";
  return p;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface ShortcutProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** e.g. "mod+k", "shift+enter", "esc". */
  shortcut: string;
  /** Force a platform; defaults to detection. */
  platform?: ShortcutPlatform;
  /** Render each key in its own cap instead of one joined cap. */
  separate?: boolean;
  size?: "sm" | "md";
}

/** Renders "⌘K" (macOS) or "Ctrl+K" (elsewhere) from a shortcut string like "mod+k". */
export const Shortcut = forwardRef<HTMLElement, ShortcutProps>(function Shortcut(
  { shortcut, platform, separate = false, size = "md", className, ...rest },
  ref,
) {
  const keys = parseShortcut(shortcut, platform ?? detectPlatform());
  const isMac = (platform ?? detectPlatform()) === "mac";
  const label = keys.join(isMac ? "" : "+");
  if (separate) {
    return (
      // The caps are decorative; the joined label is visually hidden text (a generic span
      // may not carry aria-label).
      <span ref={ref} className={cn("inline-flex items-center gap-0.5", className)} {...rest}>
        <span className="sr-only">{label}</span>
        {keys.map((k, i) => (
          <Kbd key={`${k}-${i}`} size={size} aria-hidden="true">
            {k}
          </Kbd>
        ))}
      </span>
    );
  }
  return (
    <Kbd ref={ref} size={size} className={cn(!isMac && "tracking-tight", className)} {...rest}>
      {label}
    </Kbd>
  );
});
