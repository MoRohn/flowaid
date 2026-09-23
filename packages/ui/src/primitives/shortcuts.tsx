import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useLatestRef } from "@/lib/useLatestRef";
import { detectPlatform, type ShortcutPlatform } from "./Kbd";

/** One key press: modifiers plus a normalised key name ("b", "enter", "?", "up"). */
export interface ShortcutCombo {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export interface ShortcutOptions {
  /** Shown in the shortcuts dialog. Omit to keep the shortcut out of the list. */
  description?: string;
  /** Heading the shortcut is listed under (default "General"). */
  group?: string;
  /** Fire even when an input, textarea, select or contenteditable has focus. */
  global?: boolean;
  /** Temporarily disable without unregistering. */
  enabled?: boolean;
  /** Call `preventDefault()` on the matched event (default true). */
  preventDefault?: boolean;
  /**
   * Only fire for key presses whose target is inside this element (a canvas, an editor).
   * While focus is inside its scope, a scoped shortcut wins over an unscoped one bound to
   * the same keys, so a component can reuse an app-wide binding (⌘K) for a local action.
   */
  scope?: RefObject<HTMLElement | null>;
  /**
   * Extra guard, checked before the shortcut matches (so a rejected key keeps its default
   * action): e.g. only when the target is the canvas surface, not a button inside it.
   */
  when?: (event: KeyboardEvent) => boolean;
}

export interface RegisteredShortcut {
  id: string;
  /** The first binding (for display); `bindings` has every alias. */
  keys: string;
  bindings: string[];
  description?: string;
  group: string;
  global: boolean;
}

interface Registration extends RegisteredShortcut {
  sequences: ShortcutCombo[][];
  enabled: boolean;
  preventDefault: boolean;
  scope: RefObject<HTMLElement | null> | undefined;
  when: ((event: KeyboardEvent) => boolean) | undefined;
  handler: (event: KeyboardEvent) => void;
}

/** Whether the event target sits inside the registration's scope (always true when unscoped). */
function inScope(entry: Registration, target: EventTarget | null): boolean {
  if (!entry.scope) return true;
  const el = entry.scope.current;
  return el !== null && target instanceof Node && el.contains(target);
}

interface ShortcutRegistryValue {
  platform: ShortcutPlatform;
  register: (entry: Registration) => () => void;
}

// Two contexts so registering a shortcut (which updates the list) never re-runs the
// registration effects of every consumer.
const ShortcutRegistryContext = createContext<ShortcutRegistryValue | null>(null);
const ShortcutListContext = createContext<RegisteredShortcut[]>([]);

const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  spacebar: "space",
  escape: "esc",
  return: "enter",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  del: "delete",
  cmd: "mod",
  meta: "mod",
  command: "mod",
  control: "ctrl",
  option: "alt",
  "⌘": "mod",
  // "+" separates keys in a binding, so the plus key is written "plus".
  plus: "+",
};

function normaliseKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Parses one step such as "mod+shift+k" into a combo. On non-mac platforms
 * "ctrl" is folded into "mod" so "ctrl+k" and "mod+k" are the same binding.
 */
export function parseShortcutCombo(step: string, platform: ShortcutPlatform): ShortcutCombo {
  const combo: ShortcutCombo = { mod: false, ctrl: false, alt: false, shift: false, key: "" };
  const parts = step
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const raw of parts) {
    const part = normaliseKey(raw);
    if (part === "mod") combo.mod = true;
    else if (part === "ctrl") {
      if (platform === "mac") combo.ctrl = true;
      else combo.mod = true;
    } else if (part === "alt") combo.alt = true;
    else if (part === "shift") combo.shift = true;
    else combo.key = part;
  }
  return combo;
}

/** Parses "g w" into a two-step sequence and "mod+k" into a single-step one. */
export function parseShortcutSequence(keys: string, platform: ShortcutPlatform): ShortcutCombo[] {
  return keys
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map((step) => parseShortcutCombo(step, platform));
}

/** Builds a combo from a keyboard event; returns null for a bare modifier press. */
export function comboFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: ShortcutPlatform,
): ShortcutCombo | null {
  const key = normaliseKey(event.key);
  if (key === "mod" || key === "ctrl" || key === "alt" || key === "shift" || key === "os")
    return null;
  if (platform === "mac") {
    return {
      mod: event.metaKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      key,
    };
  }
  return {
    mod: event.ctrlKey || event.metaKey,
    ctrl: false,
    alt: event.altKey,
    shift: event.shiftKey,
    key,
  };
}

function isSymbolKey(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/i.test(key);
}

/** True when the pressed combo satisfies the binding. Shift is ignored for symbol keys such as "?". */
export function shortcutComboMatches(binding: ShortcutCombo, pressed: ShortcutCombo): boolean {
  if (binding.key !== pressed.key) return false;
  if (binding.mod !== pressed.mod || binding.ctrl !== pressed.ctrl || binding.alt !== pressed.alt)
    return false;
  if (isSymbolKey(binding.key)) return true;
  return binding.shift === pressed.shift;
}

/** Whether keystrokes on this element belong to text editing rather than shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return target.closest('[contenteditable=""], [contenteditable="true"]') !== null;
}

export interface ShortcutProviderProps {
  children: ReactNode;
  /** Force a platform for modifier mapping; defaults to detection. */
  platform?: ShortcutPlatform;
  /** How long a sequence such as "g w" waits for its next key. */
  sequenceTimeoutMs?: number;
}

/**
 * Global keyboard shortcut registry. Mount once near the root; nested
 * providers are ignored so composed layouts never double-fire. Listens on
 * `document` in the bubble phase, so a component that handles a key itself
 * (and stops propagation or prevents default) wins.
 */
export function ShortcutProvider({
  children,
  platform: platformProp,
  sequenceTimeoutMs = 1000,
}: ShortcutProviderProps) {
  const parent = useContext(ShortcutRegistryContext);
  const platform = platformProp ?? parent?.platform ?? detectPlatform();
  const entries = useRef(new Map<string, Registration>());
  const [shortcuts, setShortcuts] = useState<RegisteredShortcut[]>([]);
  const pending = useRef<ShortcutCombo[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback(() => {
    setShortcuts(
      Array.from(entries.current.values())
        .filter((e) => e.enabled && e.description !== undefined)
        .map(({ id, keys, bindings, description, group, global }) => ({
          id,
          keys,
          bindings,
          description,
          group,
          global,
        })),
    );
  }, []);

  const register = useCallback(
    (entry: Registration) => {
      entries.current.set(entry.id, entry);
      publish();
      return () => {
        entries.current.delete(entry.id);
        publish();
      };
    },
    [publish],
  );

  useEffect(() => {
    if (parent) return;
    const clearPending = () => {
      pending.current = [];
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const pressed = comboFromKeyboardEvent(event, platform);
      if (!pressed) return;
      const editable = isEditableTarget(event.target);
      // Scoped shortcuts whose scope holds the focus come first, so they win ties.
      const eligible = Array.from(entries.current.values()).filter(
        (e) =>
          e.enabled &&
          (e.global || !editable) &&
          inScope(e, event.target) &&
          (e.when === undefined || e.when(event)),
      );
      const candidates = [
        ...eligible.filter((e) => e.scope !== undefined),
        ...eligible.filter((e) => e.scope === undefined),
      ];
      const attempt = [...pending.current, pressed];

      let exact: Registration | null = null;
      let partial = false;
      for (const entry of candidates) {
        for (const seq of entry.sequences) {
          if (seq.length < attempt.length) continue;
          const prefixMatches = attempt.every((combo, i) => {
            const step = seq[i];
            return step !== undefined && shortcutComboMatches(step, combo);
          });
          if (!prefixMatches) continue;
          if (seq.length === attempt.length) {
            exact ??= entry;
          } else {
            partial = true;
          }
        }
      }

      if (exact) {
        clearPending();
        if (exact.preventDefault) event.preventDefault();
        exact.handler(event);
        return;
      }
      if (partial) {
        pending.current = attempt;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(clearPending, sequenceTimeoutMs);
        return;
      }
      if (pending.current.length > 0) {
        // The sequence broke; retry this key on its own.
        clearPending();
        onKeyDown(event);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, [parent, platform, sequenceTimeoutMs]);

  const registry = useMemo<ShortcutRegistryValue>(
    () => ({ platform, register }),
    [platform, register],
  );

  if (parent) return <>{children}</>;
  return (
    <ShortcutRegistryContext.Provider value={registry}>
      <ShortcutListContext.Provider value={shortcuts}>{children}</ShortcutListContext.Provider>
    </ShortcutRegistryContext.Provider>
  );
}

/**
 * Registers a keyboard shortcut for the lifetime of the component.
 * `keys` accepts "mod+b", a sequence "g w", or an array of aliases.
 */
export function useShortcut(
  keys: string | string[],
  handler: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {},
): void {
  const ctx = useContext(ShortcutRegistryContext);
  const id = useId();
  const handlerRef = useLatestRef(handler);
  const bindings = Array.isArray(keys) ? keys : [keys];
  const bindingKey = bindings.join("|");
  const {
    description,
    group = "General",
    global = false,
    enabled = true,
    preventDefault = true,
    scope,
    when,
  } = options;
  const whenRef = useLatestRef(when);
  const hasWhen = when !== undefined;

  useEffect(() => {
    if (!ctx) return;
    const list = bindingKey.split("|").filter((b) => b.length > 0);
    return ctx.register({
      id,
      keys: list[0] ?? "",
      bindings: list,
      sequences: list.map((b) => parseShortcutSequence(b, ctx.platform)),
      description,
      group,
      global,
      enabled,
      preventDefault,
      scope,
      when: hasWhen ? (event) => whenRef.current?.(event) ?? true : undefined,
      handler: (event) => handlerRef.current(event),
    });
  }, [
    ctx,
    id,
    bindingKey,
    description,
    group,
    global,
    enabled,
    preventDefault,
    scope,
    hasWhen,
    whenRef,
    handlerRef,
  ]);
}

/** Every enabled shortcut that has a description, in registration order. */
export function useShortcuts(): RegisteredShortcut[] {
  return useContext(ShortcutListContext);
}

/** The platform the nearest provider maps "mod" for. */
export function useShortcutPlatform(): ShortcutPlatform {
  return useContext(ShortcutRegistryContext)?.platform ?? detectPlatform();
}
