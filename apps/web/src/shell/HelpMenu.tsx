"use client";
/**
 * The top bar's help menu: the getting-started checklist, the guides, keyboard shortcuts, where to
 * report a problem and the running version. Rendered inside `AppShell`, whose "?" dialog it opens.
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BookOpen, Bug, CircleHelp, Keyboard, ListChecks } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@flowaid/ui/primitives";
import { useAppShellOptional } from "@flowaid/ui/shell";
import { get } from "~/api/client";
// the release script versions the app with the rest of the platform
import pkg from "../../package.json";
import { HELP } from "./help";

const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

export function HelpMenu({ ws, dashboard }: { ws: string; dashboard: boolean }) {
  const router = useRouter();
  const shell = useAppShellOptional();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => get<{ version: string }>("/v1/health"),
    staleTime: Infinity,
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Help" variant="ghost">
          <CircleHelp strokeWidth={1.75} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel>Help</DropdownMenuLabel>
        {dashboard ? (
          <DropdownMenuItem
            icon={<ListChecks strokeWidth={1.75} />}
            onSelect={() => router.push(`/${ws}?getting-started`)}
          >
            Getting started checklist
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          icon={<BookOpen strokeWidth={1.75} />}
          onSelect={() => openExternal(HELP.gettingStarted)}
        >
          Guides and documentation
        </DropdownMenuItem>
        {shell ? (
          <DropdownMenuItem
            icon={<Keyboard strokeWidth={1.75} />}
            shortcut="?"
            onSelect={() => shell.setShortcutsOpen(true)}
          >
            Keyboard shortcuts
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          icon={<Bug strokeWidth={1.75} />}
          onSelect={() => openExternal(HELP.issues)}
        >
          Report a problem
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 pb-1.5 pt-1 font-mono text-2xs text-ink-3">
          FlowAId {pkg.version}
          {health.data?.version ? ` · API ${health.data.version}` : ""} · Apache-2.0
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
