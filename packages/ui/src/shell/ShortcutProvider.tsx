// The shortcut registry lives in primitives (so canvas and editors, which sit below shell in
// the group layering, can register scoped shortcuts); shell re-exports it as its public home.
export {
  ShortcutProvider,
  comboFromKeyboardEvent,
  isEditableTarget,
  parseShortcutCombo,
  parseShortcutSequence,
  shortcutComboMatches,
  useShortcut,
  useShortcutPlatform,
  useShortcuts,
  type RegisteredShortcut,
  type ShortcutCombo,
  type ShortcutOptions,
  type ShortcutProviderProps,
} from "@/primitives/shortcuts";
