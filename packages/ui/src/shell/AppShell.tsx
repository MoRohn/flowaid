import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import { cn } from "@/lib/cn";
import { useLatestRef } from "@/lib/useLatestRef";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/primitives";
import { AppShellContext, type AppShellContextValue, type AppShellLayout } from "./AppShellContext";
import {
  KeyboardShortcutsDialog,
  type KeyboardShortcutsDialogProps,
} from "./KeyboardShortcutsDialog";
import { ShortcutProvider, useShortcut, type ShortcutProviderProps } from "./ShortcutProvider";
import { useContainerWidth } from "./useContainerWidth";
import { usePersistedState } from "./usePersistedState";

export const DEFAULT_SHELL_LAYOUT: AppShellLayout = {
  navCollapsed: false,
  inspectorOpen: true,
  inspectorWidth: 320,
  bottomOpen: true,
  bottomHeight: 280,
};

export interface AppShellProps {
  /** The TopBar (44px). */
  topbar?: ReactNode;
  /** The SideNav; becomes a left drawer under the compact breakpoint. */
  nav?: ReactNode;
  /** Right inspector; becomes a Sheet under the compact breakpoint. */
  inspector?: ReactNode;
  /** The BottomPanel. */
  bottomPanel?: ReactNode;
  /** A CommandMenu; it binds to the shell's mod+K state automatically. */
  commandMenu?: ReactNode;
  /** The main content (canvas, list page). */
  children: ReactNode;
  /** Initial layout when nothing is persisted yet. */
  defaultLayout?: Partial<AppShellLayout>;
  /** localStorage key for the layout; null disables persistence. */
  storageKey?: string | null;
  onLayoutChange?: (layout: AppShellLayout) => void;
  /** Width in px under which the shell switches to the compact layout (default 900). */
  compactBreakpoint?: number;
  /** Force compact regardless of width (galleries, tests). */
  forceCompact?: boolean;
  inspectorMinWidth?: number;
  inspectorMaxWidth?: number;
  bottomMinHeight?: number;
  bottomMaxHeight?: number;
  /** Register mod+B / mod+J / mod+I / mod+K / ? (default true). */
  shortcuts?: boolean;
  /** Render the "?" shortcuts dialog (default true). */
  shortcutsDialog?: boolean;
  /** Extra shortcuts to list in the dialog. */
  shortcutsExtra?: KeyboardShortcutsDialogProps["extra"];
  platform?: ShortcutProviderProps["platform"];
  className?: string;
}

function validateLayout(raw: unknown): AppShellLayout | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Partial<Record<keyof AppShellLayout, unknown>>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    navCollapsed: bool(r.navCollapsed, DEFAULT_SHELL_LAYOUT.navCollapsed),
    inspectorOpen: bool(r.inspectorOpen, DEFAULT_SHELL_LAYOUT.inspectorOpen),
    inspectorWidth: num(r.inspectorWidth, DEFAULT_SHELL_LAYOUT.inspectorWidth),
    bottomOpen: bool(r.bottomOpen, DEFAULT_SHELL_LAYOUT.bottomOpen),
    bottomHeight: num(r.bottomHeight, DEFAULT_SHELL_LAYOUT.bottomHeight),
  };
}

/**
 * The builder chrome: top bar, collapsible side nav (208px or a 48px rail),
 * main content, resizable inspector on the right and resizable bottom panel.
 * Layout is persisted in localStorage; mod+B / mod+J / mod+I toggle the
 * panels, mod+K opens the command menu and "?" the shortcuts list. Under
 * 900px the nav becomes a drawer and the inspector a sheet.
 */
export function AppShell(props: AppShellProps) {
  return (
    <ShortcutProvider platform={props.platform}>
      <AppShellInner {...props} />
    </ShortcutProvider>
  );
}

function AppShellInner({
  topbar,
  nav,
  inspector,
  bottomPanel,
  commandMenu,
  children,
  defaultLayout,
  storageKey = "flowaid:shell:layout",
  onLayoutChange,
  compactBreakpoint = 900,
  forceCompact,
  inspectorMinWidth = 240,
  inspectorMaxWidth = 560,
  bottomMinHeight = 160,
  bottomMaxHeight = 600,
  shortcuts = true,
  shortcutsDialog = true,
  shortcutsExtra,
  className,
}: AppShellProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(rootRef);
  const uid = useId();
  const panelId = (name: string) => `shell${uid}${name}`;
  const compact =
    forceCompact ??
    (width ?? (typeof window === "undefined" ? 1280 : window.innerWidth)) < compactBreakpoint;

  const [persisted, setPersisted] = usePersistedState<AppShellLayout>(
    storageKey,
    { ...DEFAULT_SHELL_LAYOUT, ...defaultLayout },
    validateLayout,
  );
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const [bottomExpanded, setBottomExpanded] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const onLayoutChangeRef = useLatestRef(onLayoutChange);
  const patch = useCallback(
    (next: Partial<AppShellLayout>) => {
      setPersisted((prev) => {
        const merged = { ...prev, ...next };
        onLayoutChangeRef.current?.(merged);
        return merged;
      });
    },
    [setPersisted, onLayoutChangeRef],
  );

  // Close the compact overlays when the layout switches back to desktop (adjusted during
  // render from the previous value, React's pattern for resetting state on a change).
  const [wasCompact, setWasCompact] = useState(compact);
  if (wasCompact !== compact) {
    setWasCompact(compact);
    if (!compact) {
      setNavDrawerOpen(false);
      setInspectorSheetOpen(false);
    }
  }

  const layout = useMemo<AppShellLayout>(
    () => ({ ...persisted, inspectorOpen: compact ? inspectorSheetOpen : persisted.inspectorOpen }),
    [persisted, compact, inspectorSheetOpen],
  );

  const setNavCollapsed = useCallback((v: boolean) => patch({ navCollapsed: v }), [patch]);
  const toggleNav = useCallback(() => {
    if (compact) setNavDrawerOpen((o) => !o);
    else patch({ navCollapsed: !persisted.navCollapsed });
  }, [compact, patch, persisted.navCollapsed]);
  const setInspectorOpen = useCallback(
    (v: boolean) => {
      if (compact) setInspectorSheetOpen(v);
      else patch({ inspectorOpen: v });
    },
    [compact, patch],
  );
  const toggleInspector = useCallback(
    () => setInspectorOpen(!layout.inspectorOpen),
    [setInspectorOpen, layout.inspectorOpen],
  );
  const setBottomOpen = useCallback(
    (v: boolean) => {
      if (!v) setBottomExpanded(false);
      patch({ bottomOpen: v });
    },
    [patch],
  );
  const toggleBottom = useCallback(
    () => setBottomOpen(!persisted.bottomOpen),
    [setBottomOpen, persisted.bottomOpen],
  );

  useShortcut("mod+b", toggleNav, {
    description: "Toggle navigation",
    group: "Panels",
    global: true,
    enabled: shortcuts,
  });
  useShortcut("mod+j", toggleBottom, {
    description: "Toggle bottom panel",
    group: "Panels",
    global: true,
    enabled: shortcuts && bottomPanel !== undefined,
  });
  useShortcut("mod+i", toggleInspector, {
    description: "Toggle inspector",
    group: "Panels",
    global: true,
    enabled: shortcuts && inspector !== undefined,
  });
  useShortcut("mod+k", () => setCommandOpen((o) => !o), {
    description: "Command menu",
    group: "General",
    global: true,
    enabled: shortcuts && commandMenu !== undefined,
  });
  useShortcut("?", () => setShortcutsOpen(true), {
    description: "Keyboard shortcuts",
    group: "General",
    enabled: shortcuts && shortcutsDialog,
  });

  const showInspectorPanel = !compact && inspector !== undefined && persisted.inspectorOpen;
  const showBottom = bottomPanel !== undefined && persisted.bottomOpen;

  // Bottom panel expand: collapse the main panel (collapsible, 0px) so the bottom fills the column,
  // and expand it back to its previous size on restore. Constraints update in the panels' own
  // effects, so the imperative call waits a frame.
  const mainRef = usePanelRef();
  const bottomRef = usePanelRef();
  const inspectorRef = usePanelRef();
  const persistedRef = useLatestRef(persisted);
  const restoreHeight = useRef(persisted.bottomHeight);
  const wasExpanded = useRef(bottomExpanded);
  useEffect(() => {
    if (wasExpanded.current === bottomExpanded) return;
    wasExpanded.current = bottomExpanded;
    if (bottomExpanded) {
      const px = bottomRef.current?.getSize().inPixels ?? 0;
      if (px > 0) restoreHeight.current = px;
    }
    const frame = requestAnimationFrame(() => {
      const main = mainRef.current;
      if (!main) return;
      if (bottomExpanded) {
        main.collapse();
      } else {
        main.expand();
        bottomRef.current?.resize(restoreHeight.current);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [bottomExpanded, mainRef, bottomRef]);

  const persistBottomHeight = useCallback(() => {
    const px = Math.round(bottomRef.current?.getSize().inPixels ?? 0);
    if (px > 0 && px !== persistedRef.current.bottomHeight) patch({ bottomHeight: px });
  }, [bottomRef, patch, persistedRef]);
  const persistInspectorWidth = useCallback(() => {
    const px = Math.round(inspectorRef.current?.getSize().inPixels ?? 0);
    if (px > 0 && px !== persistedRef.current.inspectorWidth) patch({ inspectorWidth: px });
  }, [inspectorRef, patch, persistedRef]);

  const value = useMemo<AppShellContextValue>(
    () => ({
      layout,
      compact,
      navDrawerOpen,
      setNavDrawerOpen,
      toggleNav,
      setNavCollapsed,
      toggleInspector,
      setInspectorOpen,
      toggleBottom,
      setBottomOpen,
      bottomExpanded,
      setBottomExpanded,
      commandOpen,
      setCommandOpen,
      shortcutsOpen,
      setShortcutsOpen,
    }),
    [
      layout,
      compact,
      navDrawerOpen,
      toggleNav,
      setNavCollapsed,
      toggleInspector,
      setInspectorOpen,
      toggleBottom,
      setBottomOpen,
      bottomExpanded,
      commandOpen,
      shortcutsOpen,
    ],
  );

  return (
    <AppShellContext.Provider value={value}>
      <div
        ref={rootRef}
        data-compact={compact || undefined}
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-hidden bg-canvas text-ink",
          className,
        )}
      >
        {topbar}
        <div className="flex min-h-0 min-w-0 flex-1">
          {!compact && nav !== undefined ? nav : null}
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
            onLayoutChanged={(_layout, meta) => {
              if (meta.isUserInteraction) persistInspectorWidth();
            }}
          >
            <ResizablePanel id={panelId("content")} minSize="40%" className="flex flex-col">
              <ResizablePanelGroup
                orientation="vertical"
                onLayoutChanged={(_layout, meta) => {
                  if (meta.isUserInteraction && !bottomExpanded) persistBottomHeight();
                }}
              >
                <ResizablePanel
                  id={panelId("main")}
                  panelRef={mainRef}
                  collapsible={showBottom}
                  collapsedSize={0}
                  minSize={120}
                  className={cn("flex flex-col", bottomExpanded && "invisible")}
                >
                  {children}
                </ResizablePanel>
                {showBottom ? (
                  <>
                    <ResizableHandle
                      id={panelId("bottom-handle")}
                      className={cn(bottomExpanded && "hidden")}
                    />
                    <ResizablePanel
                      id={panelId("bottom")}
                      panelRef={bottomRef}
                      defaultSize={persisted.bottomHeight}
                      minSize={bottomMinHeight}
                      maxSize={bottomExpanded ? undefined : bottomMaxHeight}
                      groupResizeBehavior="preserve-pixel-size"
                      className="flex flex-col border-t border-border"
                    >
                      {bottomPanel}
                    </ResizablePanel>
                  </>
                ) : null}
              </ResizablePanelGroup>
            </ResizablePanel>
            {showInspectorPanel ? (
              <>
                <ResizableHandle id={panelId("inspector-handle")} />
                <ResizablePanel
                  id={panelId("inspector")}
                  panelRef={inspectorRef}
                  defaultSize={persisted.inspectorWidth}
                  minSize={inspectorMinWidth}
                  maxSize={inspectorMaxWidth}
                  groupResizeBehavior="preserve-pixel-size"
                  className="flex flex-col bg-surface"
                >
                  <aside aria-label="Inspector" className="flex h-full min-h-0 flex-col">
                    {inspector}
                  </aside>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </div>

        {compact && nav !== undefined ? (
          <Sheet open={navDrawerOpen} onOpenChange={setNavDrawerOpen}>
            <SheetContent side="left" width={240} hideClose className="w-60 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {nav}
            </SheetContent>
          </Sheet>
        ) : null}
        {compact && inspector !== undefined ? (
          <Sheet open={inspectorSheetOpen} onOpenChange={setInspectorSheetOpen}>
            <SheetContent side="right" width={360} className="p-0">
              <SheetTitle className="sr-only">Inspector</SheetTitle>
              <aside aria-label="Inspector" className="flex h-full min-h-0 flex-col">
                {inspector}
              </aside>
            </SheetContent>
          </Sheet>
        ) : null}
        {commandMenu}
        {shortcutsDialog ? (
          <KeyboardShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            extra={shortcutsExtra}
          />
        ) : null}
      </div>
    </AppShellContext.Provider>
  );
}
