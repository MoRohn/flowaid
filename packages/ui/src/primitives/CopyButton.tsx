import { forwardRef, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "./Button";
import { IconButton, type IconButtonProps } from "./IconButton";

/**
 * Writes text to the clipboard. Uses the async Clipboard API and falls back
 * to a hidden textarea + execCommand for insecure contexts. Resolves to
 * whether the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

interface CopyState {
  copied: boolean;
  copy: (e?: MouseEvent<HTMLButtonElement>) => void;
}

function useCopy(
  value: string | (() => string),
  timeout: number,
  onCopied?: (ok: boolean) => void,
): CopyState {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(() => {
    const text = typeof value === "function" ? value() : value;
    void copyToClipboard(text).then((ok) => {
      onCopied?.(ok);
      if (!ok) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeout);
    });
  }, [value, timeout, onCopied]);
  return { copied, copy };
}

function CopyIcon({ copied }: { copied: boolean }) {
  const reduced = useReducedMotion();
  const anim = reduced
    ? {}
    : {
        initial: { scale: 0.6, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        exit: { scale: 0.6, opacity: 0 },
      };
  return (
    <span className="relative flex size-4 items-center justify-center">
      <AnimatePresence initial={false} mode="popLayout">
        {copied ? (
          <motion.span
            key="check"
            className="absolute inset-0 flex items-center justify-center text-ok-text"
            transition={{ duration: 0.15 }}
            {...anim}
          >
            <Check className="size-4" strokeWidth={2.25} aria-hidden="true" />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            className="absolute inset-0 flex items-center justify-center"
            transition={{ duration: 0.15 }}
            {...anim}
          >
            <Copy className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export interface CopyButtonProps extends Omit<
  IconButtonProps,
  "children" | "label" | "onClick" | "value"
> {
  /** Text to copy, or a function producing it at click time. */
  value: string | (() => string);
  /** Tooltip / accessible label before copying. */
  label?: string;
  copiedLabel?: string;
  /** How long the "Copied" state lasts, in ms. */
  timeout?: number;
  onCopied?: (ok: boolean) => void;
  /** Render as a labelled Button instead of a square icon button. */
  variantStyle?: "icon" | "button";
  buttonProps?: Omit<ButtonProps, "onClick" | "children">;
}

/**
 * Copies `value` and shows a check + "Copied" for 1.2s. Falls back to the
 * legacy execCommand path when the Clipboard API is unavailable.
 */
export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(function CopyButton(
  {
    value,
    label = "Copy",
    copiedLabel = "Copied",
    timeout = 1200,
    onCopied,
    variantStyle = "icon",
    buttonProps,
    className,
    ...rest
  },
  ref,
) {
  const { copied, copy } = useCopy(value, timeout, onCopied);
  const current = copied ? copiedLabel : label;

  if (variantStyle === "button") {
    return (
      <Button
        ref={ref}
        variant="secondary"
        size="sm"
        {...buttonProps}
        onClick={copy}
        data-copied={copied || undefined}
        aria-live="polite"
        leadingIcon={<CopyIcon copied={copied} />}
        className={cn(copied && "text-ok-text", className, buttonProps?.className)}
      >
        {current}
      </Button>
    );
  }
  return (
    <IconButton
      ref={ref}
      label={current}
      onClick={copy}
      data-copied={copied || undefined}
      className={className}
      {...rest}
    >
      <CopyIcon copied={copied} />
    </IconButton>
  );
});
