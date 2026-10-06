"use client";
/**
 * A path under a workspace that no page answers (see `[...rest]/page.tsx`): the usual frame with
 * the navigation, a heading that says what happened, the path that was asked for, and links to
 * the workspace's home and its other pages.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPinOff } from "lucide-react";
import { EmptyState, buttonVariants } from "@flowaid/ui/primitives";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { NAV, NAV_SECONDARY, visibleNav } from "~/shell/nav";

export default function WorkspaceNotFound() {
  const s = useSession();
  const pathname = usePathname();
  const pages = visibleNav([...NAV, ...NAV_SECONDARY], s.features).filter((e) => e.path);
  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Page not found" }]}>
      <PageBody>
        <EmptyState
          className="py-16"
          icon={<MapPinOff strokeWidth={1.5} />}
          title="This page does not exist"
          titleAs="h1"
          description={
            <>
              Nothing in {s.workspaceName} lives at{" "}
              <code className="break-all font-mono text-xs text-ink-2">{pathname}</code>. The link
              may be mistyped, or the page has moved.
            </>
          }
          primaryAction={
            <Link href={`/${s.ws}`} className={buttonVariants({ variant: "primary" })}>
              Go to {s.workspaceName}
            </Link>
          }
        />
        {pages.length ? (
          <nav aria-label="Pages in this workspace" className="mx-auto max-w-lg">
            <ul className="m-0 flex list-none flex-wrap justify-center gap-x-4 gap-y-2 p-0 text-sm">
              {pages.map((e) => (
                <li key={e.id}>
                  <Link className="text-accent-text hover:underline" href={`/${s.ws}/${e.path}`}>
                    {e.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </PageBody>
    </AppFrame>
  );
}
