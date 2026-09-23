import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { inputVariants } from "./Input";
import { Shortcut } from "./Kbd";
import { Spinner } from "./Spinner";
import { useControllableState } from "./useControllableState";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "value" | "defaultValue" | "onChange" | "type"
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Also fired by the clear button and Escape. */
  onClear?: () => void;
  /** Shortcut hint ("mod+k") shown while the field is empty and unfocused. */
  shortcut?: string;
  /** Any node to show at the end instead of the shortcut, e.g. a filter count. */
  hint?: ReactNode;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

/**
 * Search field: leading magnifier, clear button once there is text, and a
 * shortcut hint while empty. Escape clears; the parent decides what "search"
 * means through `onValueChange`.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    defaultValue = "",
    onValueChange,
    onClear,
    shortcut,
    hint,
    loading = false,
    size = "md",
    className,
    placeholder = "Search",
    onKeyDown,
    onFocus,
    onBlur,
    disabled,
    ...rest
  },
  ref,
) {
  const [text, setText] = useControllableState(value, defaultValue, onValueChange);
  const [focused, setFocused] = useState(false);
  const inner = useRef<HTMLInputElement | null>(null);

  const setRef = useCallback(
    (node: HTMLInputElement | null) => {
      inner.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const clear = () => {
    setText("");
    onClear?.();
    inner.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Escape" && text.length > 0) {
      e.preventDefault();
      clear();
    }
  };

  const showHint = !focused && text.length === 0 && (hint !== undefined || shortcut !== undefined);
  const iconSize = size === "sm" ? "size-3.5" : "size-4";

  return (
    <div className={cn("group relative flex w-full min-w-0 items-center", className)}>
      <span
        className={cn(
          "pointer-events-none absolute left-0 flex h-full items-center justify-center text-ink-3",
          size === "sm" ? "w-6" : "w-7",
        )}
      >
        {loading ? (
          <Spinner size="xs" label="Searching" />
        ) : (
          <Search className={iconSize} strokeWidth={1.75} aria-hidden="true" />
        )}
      </span>
      <input
        ref={setRef}
        {...rest}
        type="search"
        role="searchbox"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={cn(
          inputVariants({ size }),
          "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
          size === "sm" ? "pl-6" : "pl-7",
          text.length > 0 ? "pr-7" : showHint ? "pr-12" : undefined,
        )}
      />
      {text.length > 0 && !disabled ? (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          className="absolute right-1 flex size-5 items-center justify-center rounded-xs text-ink-3 hover:bg-surface-3 hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      ) : showHint ? (
        <span className="pointer-events-none absolute right-1.5 flex items-center text-2xs text-ink-3">
          {hint ?? (shortcut ? <Shortcut shortcut={shortcut} /> : null)}
        </span>
      ) : null}
    </div>
  );
});
