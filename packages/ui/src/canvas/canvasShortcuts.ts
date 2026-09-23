/**
 * The canvas keyboard model (UI.md §9): every binding the canvas registers through the
 * shortcut registry (so `KeyboardShortcutsDialog` lists it under "Canvas"), plus the target
 * guards that keep them off inputs, open overlays and the controls inside the canvas.
 */

/** Heading the canvas shortcuts are listed under in the shortcuts dialog. */
export const CANVAS_SHORTCUT_GROUP = "Canvas";

export interface CanvasShortcut {
  /** Bindings in `useShortcut` syntax; the first is the one shown. */
  keys: readonly string[];
  description: string;
}

export const CANVAS_SHORTCUTS = {
  selectAll: { keys: ["mod+a"], description: "Select every node and edge" },
  nudge: { keys: ["left", "right", "up", "down"], description: "Nudge the selection 8 px" },
  nudgeFar: {
    keys: ["shift+left", "shift+right", "shift+up", "shift+down"],
    description: "Nudge the selection 32 px",
  },
  connect: { keys: ["c"], description: "Connect the focused node to a compatible target" },
  inspect: { keys: ["enter"], description: "Open the focused node in the inspector" },
  remove: { keys: ["delete", "backspace"], description: "Delete the selection" },
  clear: { keys: ["esc"], description: "Clear the selection" },
  palette: { keys: ["mod+k", "/"], description: "Add a node" },
  duplicate: { keys: ["mod+d"], description: "Duplicate the selection" },
  group: { keys: ["mod+g"], description: "Group the selection into a subflow" },
  autoLayout: { keys: ["shift+l"], description: "Auto layout" },
  fit: { keys: ["mod+0"], description: "Fit the workflow in view" },
  zoomIn: { keys: ["mod+=", "mod+plus"], description: "Zoom in" },
  zoomOut: { keys: ["mod+-", "mod+_"], description: "Zoom out" },
} as const satisfies Record<string, CanvasShortcut>;

export type CanvasShortcutId = keyof typeof CANVAS_SHORTCUTS;

/**
 * The sentence the canvas wrapper's `aria-describedby` points at: the core keyboard
 * model in words, so a screen reader user landing on the canvas knows how to drive it.
 */
export function canvasShortcutSummary(available: {
  palette: boolean;
  connect: boolean;
  inspect: boolean;
}): string {
  const parts = [
    "Tab moves between nodes",
    "arrow keys nudge the selection (Shift for 32 px)",
    "Control or Command A selects everything",
  ];
  if (available.connect) parts.push("C connects the focused node to a compatible target");
  if (available.inspect) parts.push("Enter opens the focused node in the inspector");
  parts.push("Delete removes the selection", "Escape clears it");
  if (available.palette) parts.push("Control or Command K, or slash, adds a node");
  parts.push(
    "Control or Command 0 fits the view",
    "Shift L lays the graph out",
    "question mark lists every shortcut",
  );
  return `Workflow canvas. ${parts.join("; ")}.`;
}

/** True for inputs, editors and open dialogs, where canvas shortcuts must not fire. */
export function isCanvasShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  return target.closest("[role=dialog],[cmdk-root]") === null;
}

/** Controls inside the canvas (toolbar buttons, the stepper, menus) keep their own keys. */
const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "[role=button]",
  "[role=menuitem]",
  "[role=option]",
  "[role=slider]",
  "[role=switch]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=tab]",
  "[role=combobox]",
  "[role=spinbutton]",
].join(",");

/**
 * True when the key press is aimed at the canvas surface itself (the wrapper, the pane, a
 * node or an edge) rather than a control inside it; plain keys (arrows, Enter, Delete, C)
 * only act there, so a focused button still activates on Enter and a slider still moves.
 */
export function isCanvasSurfaceTarget(target: EventTarget | null): boolean {
  if (!isCanvasShortcutTarget(target)) return false;
  if (!(target instanceof Element)) return true;
  return target.closest(CONTROL_SELECTOR) === null;
}

/** The xyflow node element the key press targets directly (focus on the node itself), or null. */
export function focusedNodeElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.classList.contains("react-flow__node") && target.dataset.id !== undefined
    ? target
    : null;
}
