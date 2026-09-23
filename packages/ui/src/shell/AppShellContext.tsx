import { createContext, useContext } from "react";

/** Layout state the shell persists: which panels are open and their sizes. */
export interface AppShellLayout {
  navCollapsed: boolean;
  inspectorOpen: boolean;
  /** Inspector width in px (desktop). */
  inspectorWidth: number;
  bottomOpen: boolean;
  /** Bottom panel height in px. */
  bottomHeight: number;
}

export interface AppShellContextValue {
  layout: AppShellLayout;
  /** True under the compact breakpoint: nav is a drawer, inspector a sheet. */
  compact: boolean;
  /** Compact-mode drawer state for the nav. */
  navDrawerOpen: boolean;
  setNavDrawerOpen: (open: boolean) => void;
  toggleNav: () => void;
  setNavCollapsed: (collapsed: boolean) => void;
  toggleInspector: () => void;
  setInspectorOpen: (open: boolean) => void;
  toggleBottom: () => void;
  setBottomOpen: (open: boolean) => void;
  /** Bottom panel expanded to fill the content area. */
  bottomExpanded: boolean;
  setBottomExpanded: (expanded: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

export const AppShellContext = createContext<AppShellContextValue | null>(null);

/** Shell state for slot content (TopBar, SideNav, BottomPanel wire themselves through it). Throws outside AppShell. */
export function useAppShell(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used inside <AppShell>");
  return ctx;
}

/** Like `useAppShell` but returns null when no shell is mounted (standalone use in galleries and tests). */
export function useAppShellOptional(): AppShellContextValue | null {
  return useContext(AppShellContext);
}
