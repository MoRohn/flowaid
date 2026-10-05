"use client";
/**
 * The session: `GET /v1/me` for the workspace in the URL. Unauthenticated visitors go to the login
 * page (with `next`). A workspace the user is not in says so and offers the same page in theirs;
 * an API that cannot be reached says how to start FlowAId and keeps trying until it answers.
 * `/v1/me` and the environments load in parallel; `/` seeds `meQueryKey(ws)` so the redirect does
 * not ask again.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useEffectEvent, type ReactNode } from "react";
import { Button, LogoMark } from "@flowaid/ui/primitives";
import { ApiError, get, post, setWorkspace } from "~/api/client";
import type { Environment, Me } from "~/api/types";
import { errorMessage } from "~/shell/states";

export interface Session {
  me: Me;
  ws: string;
  workspaceName: string;
  environments: Environment[];
  features: Record<string, boolean>;
  /** FlowAId on this computer for one person: no sign-in, sign-out or member management */
  local: boolean;
  can(scope: string): boolean;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** The cache key of `GET /v1/me` as seen from workspace `ws` (null: no workspace yet, at `/`). */
export const meQueryKey = (ws: string | null) => ["me", ws] as const;

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
    queryKey: meQueryKey(ws),
    queryFn: () => get<Me>("/v1/me"),
    retry: false,
  });
  // in parallel with /v1/me: both carry the workspace header, and a refused one (401, or 403 for
  // a workspace the user is not in) is not retried, so the session below decides what shows
  const envs = useQuery({
    queryKey: ["environments", ws],
    queryFn: () => get<Environment[]>("/v1/environments"),
  });

  // 403: no such workspace, or not this user's. Their own workspaces (an empty workspace header
  // answers for their first one) are offered instead of a silent redirect.
  const refused = me.error instanceof ApiError && me.error.status === 403;
  const mine = useQuery({
    queryKey: meQueryKey(null),
    queryFn: () => get<Me>("/v1/me", { headers: { "x-workspace": "" } }),
    enabled: refused,
    retry: false,
  });

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, pathname, router]);

  const member = me.data?.workspaces.some((w) => w.slug === ws) ?? false;
  if (me.isPending || (member && envs.isPending)) return <FullPageSpinner />;
  if (me.isError || !me.data) {
    if (refused)
      return mine.isPending ? (
        <FullPageSpinner />
      ) : (
        <UnknownWorkspace ws={ws} pathname={pathname} workspaces={mine.data?.workspaces ?? []} />
      );
    // 401: on the way to the login page
    if (me.error instanceof ApiError && me.error.status === 401) return <FullPageSpinner />;
    return (
      <FullPageError
        error={me.error}
        // the environments failed with it; both come back together
        onRetry={() => void Promise.all([me.refetch(), envs.refetch()])}
        retrying={me.isFetching}
        attempt={me.errorUpdateCount}
      />
    );
  }
  const workspace = me.data.workspaces.find((w) => w.slug === ws);
  if (!workspace)
    return <UnknownWorkspace ws={ws} pathname={pathname} workspaces={me.data.workspaces} />;

  const scopes = new Set(me.data.principal.scopes);
  const session: Session = {
    me: me.data,
    ws,
    workspaceName: workspace.name,
    environments: envs.data ?? [],
    features: me.data.features,
    local: me.data.authMode === "local",
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

/** fetch failed outright, or the web app's proxy found no API behind it */
function unreachable(error: unknown): boolean {
  return (
    (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) ||
    (error instanceof ApiError && [502, 503, 504].includes(error.status))
  );
}

/** Seconds before the next automatic try: 2, 4, 8, 16, then every 30. */
export const retryDelayMs = (attempt: number) =>
  Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);

/**
 * A whole page that could not load. An API that cannot be reached says how to start FlowAId
 * again and, with `onRetry`, tries again on its own (2, 4, 8 … 30 s apart) so the page comes
 * back by itself once the API answers.
 */
export function FullPageError({
  message,
  error,
  home,
  onRetry,
  retrying = false,
  attempt = 1,
}: {
  message?: string;
  /** the failure; its message is put in plain words */
  error?: unknown;
  home?: boolean;
  onRetry?: () => void;
  /** a try is in flight */
  retrying?: boolean;
  /** how many tries have failed so far (paces the automatic retries) */
  attempt?: number;
}) {
  const down = unreachable(error);
  const canRetry = onRetry !== undefined;
  const retry = useEffectEvent(() => onRetry?.());
  useEffect(() => {
    if (!down || !canRetry || retrying) return;
    const timer = setTimeout(retry, retryDelayMs(attempt));
    return () => clearTimeout(timer);
  }, [down, canRetry, retrying, attempt]);

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <LogoMark size={32} />
        <h1 className="m-0 text-base font-semibold text-ink">
          {down ? "FlowAId is not answering" : "Something went wrong"}
        </h1>
        <p className="m-0 text-sm text-ink-2" role="alert">
          {message ?? errorMessage(error)}
        </p>
        {down ? (
          <p className="m-0 text-sm text-ink-3">
            If you quit it, start it again with{" "}
            <code className="font-mono text-ink">./flowaid</code> in its folder. This page tries
            again on its own and opens as soon as FlowAId answers.
          </p>
        ) : null}
        {onRetry ? (
          <Button variant="secondary" loading={retrying} onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {home ? (
          <a className="text-sm text-accent-text underline" href="/">
            Go to your workspace
          </a>
        ) : null}
      </div>
    </main>
  );
}

/**
 * A workspace in the URL that does not exist or is not this user's: says so, and offers the same
 * page in each of their workspaces (`/nope/workflows` → `/acme/workflows`).
 */
export function UnknownWorkspace({
  ws,
  pathname,
  workspaces,
}: {
  ws: string;
  pathname: string;
  workspaces: readonly { slug: string; name: string }[];
}) {
  const rest = pathname.split("/").slice(2).join("/");
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <LogoMark size={32} />
        <h1 className="m-0 text-base font-semibold text-ink">No workspace called “{ws}”</h1>
        <p className="m-0 text-sm text-ink-2">
          There is no workspace with that name, or you are not a member of it. The link may have a
          typo, or the workspace was renamed.
        </p>
        {workspaces.length ? (
          <>
            <p className="m-0 text-sm text-ink-2">
              {rest ? "Open the same page in one of your workspaces:" : "Your workspaces:"}
            </p>
            <ul className="m-0 flex w-full list-none flex-col gap-1.5 p-0">
              {workspaces.map((w) => (
                <li key={w.slug}>
                  <Link
                    href={`/${w.slug}${rest ? `/${rest}` : ""}`}
                    className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface px-3 py-2 text-left text-sm text-ink hover:bg-surface-3 focus-visible:shadow-(--focus) focus-visible:outline-none"
                  >
                    <span className="truncate font-medium">{w.name}</span>
                    <span className="shrink-0 font-mono text-2xs text-ink-3">
                      /{w.slug}
                      {rest ? `/${rest}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <a className="text-sm text-accent-text underline" href="/">
            Go to your workspace
          </a>
        )}
      </div>
    </main>
  );
}
