"use client";
/**
 * The session: `GET /v1/me` for the workspace in the URL. Unauthenticated visitors go to the login
 * page (with `next`), unknown workspaces to the first one the user belongs to.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { ApiError, get, post, setWorkspace } from "~/api/client";
import type { Environment, Me } from "~/api/types";

export interface Session {
  me: Me;
  ws: string;
  workspaceName: string;
  environments: Environment[];
  features: Record<string, boolean>;
  can(scope: string): boolean;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function SessionProvider({ ws, children }: { ws: string; children: ReactNode }) {
  setWorkspace(ws);
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me", ws],
    queryFn: () => get<Me>("/v1/me"),
    retry: false,
  });
  const envs = useQuery({
    queryKey: ["environments", ws],
    queryFn: () => get<Environment[]>("/v1/environments"),
    enabled: me.isSuccess && me.data.principal.workspaceSlug === ws,
  });

  useEffect(() => {
    if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) {
      if (me.error.status === 403) {
        router.replace("/");
        return;
      }
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [me.error, pathname, router]);

  if (me.isPending || (me.isSuccess && envs.isPending)) return <FullPageSpinner />;
  if (me.isError || !me.data) {
    if (me.error instanceof ApiError && me.error.status < 500) return <FullPageSpinner />;
    return (
      <FullPageError
        message={me.error instanceof Error ? me.error.message : "The API is unreachable."}
      />
    );
  }
  const workspace = me.data.workspaces.find((w) => w.slug === ws);
  if (!workspace)
    return <FullPageError message={`You are not a member of the workspace “${ws}”.`} home />;

  const scopes = new Set(me.data.principal.scopes);
  const session: Session = {
    me: me.data,
    ws,
    workspaceName: workspace.name,
    environments: envs.data ?? [],
    features: me.data.features,
    can: (scope) => scopes.has(scope) || scopes.has("*"),
    signOut: async () => {
      await post("/v1/auth/logout", {}, { noRefresh: true }).catch(() => undefined);
      qc.clear();
      router.replace("/login");
    },
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function FullPageSpinner() {
  return (
    <div className="grid h-dvh place-items-center" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <span className="size-5 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}

export function FullPageError({ message, home }: { message: string; home?: boolean }) {
  return (
    <div className="grid h-dvh place-items-center p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-ink">Something went wrong</p>
        <p className="mt-2 text-sm text-ink-3">{message}</p>
        {home ? (
          <a className="mt-4 inline-block text-sm text-accent underline" href="/">
            Go to your workspace
          </a>
        ) : null}
      </div>
    </div>
  );
}
