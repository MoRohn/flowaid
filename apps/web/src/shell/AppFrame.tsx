"use client";
/**
 * The workspace frame every signed-in page renders: `AppShell` with the feature-keyed `SideNav`,
 * a `TopBar` (breadcrumbs plus page actions), the command menu and the user menu. Pages pass
 * their own inspector and bottom panel (the builder does).
 */
import { useRouter, useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  AppShell,
  CommandMenu,
  SideNav,
  TopBar,
  UserMenu,
  type TopBarProps,
} from "@flowaid/ui/shell";
import { Button, IconButton } from "@flowaid/ui/primitives";
import { useSession } from "~/session";
import { NAV, NAV_SECONDARY, visibleNav } from "./nav";

export interface AppFrameProps extends Partial<Omit<TopBarProps, "breadcrumbs">> {
  crumbs: { label: string; href?: string }[];
  children: ReactNode;
  inspector?: ReactNode;
  bottomPanel?: ReactNode;
  /** extra command-menu actions */
  commands?: {
    id: string;
    label: string;
    icon?: ReactNode;
    shortcut?: string;
    onSelect: () => void;
  }[];
  storageKey?: string;
}

export function AppFrame({
  crumbs,
  children,
  inspector,
  bottomPanel,
  commands = [],
  storageKey = "flowaid:shell",
  ...topbar
}: AppFrameProps) {
  const s = useSession();
  const router = useRouter();
  const segments = useSelectedLayoutSegments();
  const go = (path: string) => router.push(`/${s.ws}/${path}`);
  const items = visibleNav(NAV, s.features);
  const secondary = visibleNav(NAV_SECONDARY, s.features);
  const active =
    [...items, ...secondary].find((e) => segments[0] === e.path)?.id ?? segments[0] ?? "workflows";
  const toItem = (e: (typeof items)[number]) => ({
    id: e.id,
    label: e.label,
    icon: e.icon,
    href: `/${s.ws}/${e.path}`,
    shortcut: e.shortcut,
  });

  return (
    <AppShell
      storageKey={storageKey}
      topbar={
        <TopBar
          breadcrumbs={crumbs.map((c, i) => ({
            id: String(i),
            label: c.label,
            ...(c.href ? { onClick: () => router.push(c.href as string) } : {}),
          }))}
          onLogoClick={() => go("workflows")}
          layoutToggles={Boolean(inspector || bottomPanel)}
          trailing={
            s.me.user ? (
              <UserMenu
                user={{ name: s.me.user.name || s.me.user.email, email: s.me.user.email }}
                onProfile={() => go("settings?tab=profile")}
                onSignOut={() => void s.signOut()}
              />
            ) : undefined
          }
          {...topbar}
        />
      }
      nav={
        <SideNav
          items={items.map(toItem)}
          secondaryItems={secondary.map(toItem)}
          activeId={active}
          onNavigate={(id) => {
            const e = [...items, ...secondary].find((x) => x.id === id);
            if (e) go(e.path);
          }}
          themeToggle
          workspace={{
            workspaces: s.me.workspaces.map((w) => ({ id: w.slug, name: w.name, plan: w.role })),
            currentId: s.ws,
            onChange: (slug) => router.push(`/${slug}/workflows`),
            onSettings: () => go("settings"),
          }}
          header={(collapsed) =>
            s.features.workflows && s.can("workflows:write") ? (
              collapsed ? (
                <IconButton
                  label="New workflow"
                  variant="secondary"
                  tooltipSide="right"
                  onClick={() => go("workflows/new")}
                >
                  <Plus strokeWidth={1.75} />
                </IconButton>
              ) : (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  leadingIcon={<Plus strokeWidth={1.75} />}
                  onClick={() => go("workflows/new")}
                >
                  New workflow
                </Button>
              )
            ) : null
          }
        />
      }
      {...(inspector ? { inspector } : {})}
      {...(bottomPanel ? { bottomPanel } : {})}
      commandMenu={
        <CommandMenu
          pages={[...items, ...secondary].map((e) => ({
            id: e.id,
            label: e.label,
            icon: e.icon,
            shortcut: e.shortcut,
            onSelect: () => go(e.path),
          }))}
          actions={commands}
        />
      }
    >
      {children}
    </AppShell>
  );
}

/** A padded, scrollable page body with an optional header. */
export function PageBody({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="h-full overflow-auto">
      <div className={wide ? "px-6 py-5" : "mx-auto max-w-6xl px-6 py-5"}>{children}</div>
    </div>
  );
}
