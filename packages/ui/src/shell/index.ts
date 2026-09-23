// shell components. Every export here is re-exported from @flowaid/ui.
export {
  ShortcutProvider,
  useShortcut,
  useShortcuts,
  useShortcutPlatform,
  parseShortcutCombo,
  parseShortcutSequence,
  comboFromKeyboardEvent,
  shortcutComboMatches,
  isEditableTarget,
  type ShortcutCombo,
  type ShortcutOptions,
  type RegisteredShortcut,
  type ShortcutProviderProps,
} from "./ShortcutProvider";
export {
  KeyboardShortcutsDialog,
  type KeyboardShortcutsDialogProps,
} from "./KeyboardShortcutsDialog";
export {
  AppShellContext,
  useAppShell,
  useAppShellOptional,
  type AppShellLayout,
  type AppShellContextValue,
} from "./AppShellContext";
export { AppShell, DEFAULT_SHELL_LAYOUT, type AppShellProps } from "./AppShell";
export { TopBar, type TopBarProps } from "./TopBar";
export { SideNav, type SideNavProps, type SideNavItem } from "./SideNav";
/** @deprecated `BottomPanel` moved to `@flowaid/ui/builder`; this shell wrapper stays for one release. */
export { BottomPanel, type BottomPanelProps, type BottomPanelTab } from "./BottomPanel";
export {
  CommandMenu,
  type CommandMenuProps,
  type CommandMenuPage,
  type CommandMenuAction,
  type CommandMenuRecent,
} from "./CommandMenu";
export {
  EnvironmentSwitcher,
  environmentLabel,
  environmentShortLabel,
  type EnvironmentSwitcherProps,
} from "./EnvironmentSwitcher";
export { VersionSwitcher, versionLabel, type VersionSwitcherProps } from "./VersionSwitcher";
export { PageHeader, type PageHeaderProps, type PageHeaderTab } from "./PageHeader";
export { Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem } from "./Breadcrumbs";
export { SaveIndicator, type SaveIndicatorProps, type SaveState } from "./SaveIndicator";
export {
  WorkspaceSwitcher,
  type WorkspaceSwitcherProps,
  type WorkspaceView,
} from "./WorkspaceSwitcher";
export { UserMenu, type UserMenuProps, type UserView } from "./UserMenu";
export { ReviewLayout, type ReviewLayoutProps } from "./ReviewLayout";
export { usePersistedState } from "./usePersistedState";
