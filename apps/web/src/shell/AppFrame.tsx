"use client";
/**
 * The workspace frame every page renders: `AppShell` with the feature-keyed `SideNav`, a `TopBar`
 * (breadcrumbs plus page actions), the workspace command menu, Ask FlowAId, the help menu,
 * Close window and Quit FlowAId when `./flowaid` runs it (desktop.tsx) and, where people sign in,
 * the user menu. Pages pass their own inspector and bottom panel (the builder does).
 */
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Compass, MessageSquareText, Plus } from "lucide-react";
import { AppShell, SideNav, TopBar, UserMenu, type TopBarProps } from "@flowaid/ui/shell";
import { Button, IconButton } from "@flowaid/ui/primitives";
import { useAssistant } from "~/assistant/AssistantProvider";
import { useGuide } from "~/guide/GuideProvider";
import { useSession } from "~/session";
import { useDesktop } from "./desktop";
import { documentTitle, useDocumentTitle, usePendingTasks } from "./frame";
import { HelpMenu } from "./HelpMenu";
import { NAV, NAV_SECONDARY, visibleNav } from "./nav";
import { WorkspaceCommandMenu } from "./WorkspaceCommandMenu";

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
  // "/<ws>/<section>/…": the section picks the active nav entry
  const section = usePathname().split("/")[2] ?? "";
  const go = (path: string) => router.push(path ? `/${s.ws}/${path}` : `/${s.ws}`);
  const items = visibleNav(NAV, s.features);
  const secondary = visibleNav(NAV_SECONDARY, s.features);
  const active = [...items, ...secondary].find((e) => section === e.path)?.id ?? section;
  const assistant = useAssistant();
  const guide = useGuide();
  const desktop = useDesktop(s);
  const pending = usePendingTasks(s);
  const pendingCount = pending.data?.items.length ?? 0;
  const toItem = (e: (typeof items)[number]) => ({
    id: e.id,
    label: e.label,
    icon: e.icon,
    href: e.path ? `/${s.ws}/${e.path}` : `/${s.ws}`,
    shortcut: e.shortcut,
    ...(e.id === "human-tasks" && pendingCount > 0
      ? { count: pendingCount, countTone: "warn" as const, countLabel: "pending" }
      : {}),
  });
  useDocumentTitle(documentTitle(crumbs, s.workspaceName));
  // the workspace crumb leads home; every crumb with a path is a real link that routes client-side
  const links = crumbs.map((c, i) =>
    !c.href && i === 0 && i < crumbs.length - 1 && c.label === s.workspaceName
      ? { ...c, href: `/${s.ws}` }
      : c,
  );

  return (
    <AppShell
      storageKey={storageKey}
      // where there is room the open Guide sits beside the page instead of over it; narrower
      // screens keep the page's full width and the Guide floats as a card (GuidePanel)
      {...(guide?.open ? { className: "min-[1680px]:[&>[data-shell-body]]:pr-[380px]" } : {})}
      topbar={
        <TopBar
          breadcrumbs={links.map((c, i) => ({
            id: String(i),
            label: c.label,
            ...(c.href ? { href: c.href, onClick: () => router.push(c.href as string) } : {}),
          }))}
          onLogoClick={() => go("")}
          layoutToggles={Boolean(inspector || bottomPanel)}
          trailing={
            <span className="flex items-center gap-1">
              {guide ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={guide.open}
                  className={guide.open ? "bg-accent-soft text-accent-text" : undefined}
                  leadingIcon={<Compass strokeWidth={1.75} />}
                  onClick={() => guide.setOpen(!guide.open)}
                >
                  Guide
                </Button>
              ) : null}
              {assistant?.available ? (
                <IconButton label="Ask FlowAId" onClick={() => assistant.setOpen(true)}>
                  <MessageSquareText strokeWidth={1.75} />
                </IconButton>
              ) : null}
              <HelpMenu ws={s.ws} dashboard={s.features.dashboard === true} />
              {desktop.menu}
              {/* one person on this computer has no account to show, sign out of or switch */}
              {s.me.user && !s.local ? (
                <UserMenu
                  user={{ name: s.me.user.name || s.me.user.email, email: s.me.user.email }}
                  onProfile={() => go("settings?tab=profile")}
                  onSignOut={() => void s.signOut()}
                />
              ) : null}
            </span>
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
            // the role only means something where other people share the workspace
            workspaces: s.me.workspaces.map((w) => ({
              id: w.slug,
              name: w.name,
              ...(s.local ? {} : { plan: w.role }),
            })),
            currentId: s.ws,
            onChange: (slug) => router.push(`/${slug}`),
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
        <WorkspaceCommandMenu
          pages={[...items, ...secondary].map((e) => ({
            id: e.id,
            label: e.label,
            icon: e.icon,
            shortcut: e.shortcut,
            onSelect: () => go(e.path),
          }))}
          actions={[
            ...commands,
            ...(guide
              ? [
                  {
                    id: "guide",
                    label: guide.open ? "Close the Guide" : "Explain this page (Guide)",
                    icon: <Compass strokeWidth={1.75} />,
                    onSelect: () => guide.setOpen(!guide.open),
                  },
                ]
              : []),
            ...desktop.commands,
          ]}
          pending={pending.data?.items ?? []}
          {...(assistant?.available ? { onAsk: assistant.ask } : {})}
        />
      }
    >
      {children}
      {desktop.overlay}
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
