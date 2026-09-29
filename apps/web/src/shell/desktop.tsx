"use client";
/**
 * FlowAId as a desktop application (`features.desktop`: `./flowaid` started it on this computer).
 * The top bar's power menu and the command menu offer:
 *
 * - **Close window.** FlowAId keeps running; its menu bar (tray) icon opens the window again. In
 *   FlowAId's own app window (appWindow.ts) the launcher closes it; any other tab is closed by the
 *   page when the browser allows it, and otherwise says so and how to come back.
 * - **Quit FlowAId.** After a confirmation, the launcher stops the web app, the worker and the API
 *   (and closes FlowAId's window). A browser tab that stays open says FlowAId has stopped and how
 *   to start it again.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AppWindow, Power } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@flowaid/ui/primitives";
import { get, post } from "~/api/client";
import type { Session } from "~/session";
import { isAppWindow } from "./appWindow";

interface LauncherStatus {
  window: "app" | "browser" | "none";
  tray: boolean;
  platform: "macos" | "windows" | "linux" | "other";
  /** what runs in the background, across workspaces */
  activity?: { runs: number; approvals: number };
}

/** What quitting would interrupt, in a sentence or two; empty when nothing runs. */
export function activitySentence(a: LauncherStatus["activity"]): string {
  if (!a) return "";
  const runs =
    a.runs === 0
      ? ""
      : a.runs === 1
        ? "1 run is in progress. "
        : `${a.runs} runs are in progress. `;
  const approvals =
    a.approvals === 0
      ? ""
      : `${a.approvals === 1 ? "1 approval is" : `${a.approvals} approvals are`} waiting; ${
          a.approvals === 1 ? "it stays" : "they stay"
        } until you are back. `;
  return runs + approvals;
}

type Ended = null | "still-running" | "stopped";

/** Where the icon that reopens FlowAId lives, in the platform's words. */
export function trayPlace(status: LauncherStatus | undefined): string | null {
  if (!status?.tray) return null;
  return status.platform === "macos" ? "the menu bar" : "the notification area";
}

/** Closes this page's window when the browser lets a page do that; reports whether it went. */
function closeThisWindow(): Promise<boolean> {
  window.close();
  // a window the page may not close stays; give the browser a moment to act
  return new Promise((resolve) => setTimeout(() => resolve(window.closed), 300));
}

export interface DesktopControls {
  available: boolean;
  /** the top bar's power menu, or null when FlowAId runs without a launcher */
  menu: ReactNode;
  /** the confirmation and the end screens */
  overlay: ReactNode;
  /** command-menu actions */
  commands: { id: string; label: string; icon: ReactNode; onSelect: () => void }[];
}

export function useDesktop(s: Pick<Session, "features" | "can">): DesktopControls {
  const available = s.features.desktop === true;
  const admin = s.can("admin");
  const [confirmQuit, setConfirmQuitState] = useState(false);
  const [ended, setEnded] = useState<Ended>(null);
  const status = useQuery({
    queryKey: ["desktop"],
    queryFn: () => get<LauncherStatus>("/v1/desktop"),
    enabled: available && admin,
    staleTime: Infinity,
    retry: false,
  });
  const place = trayPlace(status.data);
  // the activity is current when the confirmation opens
  const setConfirmQuit = (open: boolean) => {
    setConfirmQuitState(open);
    if (open && available && admin) void status.refetch();
  };

  const close = useMutation({
    mutationFn: async () => {
      // the launcher closes FlowAId's own window; any other tab tries to close itself
      const viaLauncher =
        admin &&
        isAppWindow() &&
        (await post<{ closed: boolean }>("/v1/desktop/window/close")).closed;
      if (!viaLauncher && !(await closeThisWindow())) setEnded("still-running");
    },
  });
  const quit = useMutation({
    mutationFn: async () => {
      await post("/v1/desktop/quit");
      setConfirmQuit(false);
      setEnded("stopped");
    },
  });

  if (!available) return { available, menu: null, overlay: null, commands: [] };

  const closeLabel = "Close window";
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Close or quit FlowAId" variant="ghost">
          <Power strokeWidth={1.75} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>FlowAId on this computer</DropdownMenuLabel>
        <DropdownMenuItem
          icon={<AppWindow strokeWidth={1.75} />}
          description={place ? `Keeps running; reopen it from ${place}` : "FlowAId keeps running"}
          onSelect={() => close.mutate()}
        >
          {closeLabel}
        </DropdownMenuItem>
        {admin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Power strokeWidth={1.75} />}
              description="Stop the web app, worker and API"
              destructive
              onSelect={() => setConfirmQuit(true)}
            >
              Quit FlowAId…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const overlay = (
    <>
      <ConfirmDialog
        open={confirmQuit}
        onOpenChange={setConfirmQuit}
        title="Quit FlowAId?"
        description={`${activitySentence(status.data?.activity)}This stops FlowAId's web app, worker and API on this computer${
          isAppWindow()
            ? " and closes this window"
            : status.data?.window === "app"
              ? " and closes FlowAId's own window"
              : ""
        }. Steps that are running get up to 30 seconds to finish; queued work waits in the database until you start FlowAId again.`}
        confirmLabel="Quit FlowAId"
        variant="danger"
        icon={<Power strokeWidth={1.75} />}
        onConfirm={() => quit.mutateAsync()}
      >
        {quit.error ? (
          <p role="alert" className="text-sm text-danger-text">
            {quit.error.message}
          </p>
        ) : null}
      </ConfirmDialog>
      {ended ? <EndScreen ended={ended} place={place} onBack={() => setEnded(null)} /> : null}
    </>
  );

  const commands = [
    {
      id: "desktop-close-window",
      label: closeLabel,
      icon: <AppWindow strokeWidth={1.75} />,
      onSelect: () => close.mutate(),
    },
    ...(admin
      ? [
          {
            id: "desktop-quit",
            label: "Quit FlowAId…",
            icon: <Power strokeWidth={1.75} />,
            onSelect: () => setConfirmQuit(true),
          },
        ]
      : []),
  ];

  return { available, menu, overlay, commands };
}

/** What a window that is still open says after Close window or Quit FlowAId. */
export function EndScreen({
  ended,
  place,
  onBack,
}: {
  ended: Exclude<Ended, null>;
  place: string | null;
  onBack: () => void;
}) {
  const stopped = ended === "stopped";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-end-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-canvas p-4"
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <img src="/favicon.svg" alt="" width={40} height={40} />
        <h1 id="desktop-end-title" className="text-lg font-semibold text-ink">
          {stopped ? "FlowAId has stopped" : "FlowAId is still running"}
        </h1>
        {stopped ? (
          <p className="text-sm text-ink-2">
            Its web app, worker and API on this computer are stopped. Start it again with{" "}
            <code className="font-mono text-ink">./flowaid</code> in its folder. You can close this
            tab.
          </p>
        ) : (
          <p className="text-sm text-ink-2">
            Browsers don&apos;t let a page close a tab you opened, so close it yourself (
            <kbd className="font-mono">⌘W</kbd> or <kbd className="font-mono">Ctrl+W</kbd>).{" "}
            {place
              ? `Reopen FlowAId any time from its icon in ${place}, or at ${window.location.origin}.`
              : `Reopen FlowAId any time at ${window.location.origin}.`}
          </p>
        )}
        {stopped ? (
          <Button variant="secondary" onClick={() => void closeThisWindow()}>
            Close this tab
          </Button>
        ) : (
          <Button variant="secondary" onClick={onBack}>
            Back to FlowAId
          </Button>
        )}
      </div>
    </div>
  );
}
