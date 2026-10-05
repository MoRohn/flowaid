"use client";
/**
 * Building blocks shared by the management surfaces: query-state rendering, mutations with
 * toasts and cache invalidation, `?tab=` syncing, the one-time secret dialog, JSON fields,
 * section cards, downloads and the unsaved-changes guard.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import {
  Button,
  CopyButton,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Skeleton,
  toast,
} from "@flowaid/ui/primitives";
import { CodeEditor } from "@flowaid/ui/forms";
import { api, getAll } from "~/api/client";
import { useSession } from "~/session";
import { ErrorPanel, errorMessage } from "~/shell/states";
import type { MemberRow } from "./types";

// ── data ────────────────────────────────────────────────────────────────────────────────────

/**
 * While a form has unsaved edits: the browser asks before a reload or closing the window, and
 * following an in-app link asks first (the draft lives only in the form).
 */
export function useLeaveGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      if (new URL(link.href, window.location.href).origin !== window.location.origin) return;
      if (!window.confirm("You have unsaved changes. Leave this page and discard them?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
}

/** Renders loading skeletons, an error panel with retry, or the data. */
export function QueryView<T>({
  query,
  children,
  rows = 4,
  skeleton,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  rows?: number;
  skeleton?: ReactNode;
}) {
  if (query.isPending)
    return (
      skeleton ?? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )
    );
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

/**
 * A mutation that toasts its outcome and invalidates the given query keys on success (and on
 * failure with `refreshOnError`, for actions whose failure the server records, such as a failed
 * discovery marking a row as errored). The error toast carries the API's message; `onSuccess` runs
 * before invalidation.
 */
export function useMutate<TVars, TData = unknown>(
  fn: (vars: TVars) => Promise<TData>,
  o: {
    success?: string | ((data: TData, vars: TVars) => string | null);
    invalidate?: QueryKey[];
    onSuccess?: (data: TData, vars: TVars) => void;
    errorTitle?: string;
    refreshOnError?: boolean;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      o.onSuccess?.(data, vars);
      const msg = typeof o.success === "function" ? o.success(data, vars) : o.success;
      if (msg) toast.success(msg);
      await Promise.all((o.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
    onError: async (error) => {
      toast.error(o.errorTitle ?? "That did not work", { description: errorMessage(error) });
      if (o.refreshOnError)
        await Promise.all(
          (o.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })),
        );
    },
  });
}

/** userId → display name for the workspace's members (empty until loaded). */
export function useMembers(): Map<string, string> {
  const s = useSession();
  const wsId = s.me.workspaces.find((w) => w.slug === s.ws)?.id ?? "";
  const q = useQuery({
    queryKey: ["members", s.ws],
    queryFn: () => getAll<MemberRow>(`/v1/workspaces/${wsId}/members`),
    staleTime: 60_000,
  });
  return useMemo(() => new Map((q.data ?? []).map((m) => [m.userId, m.name || m.email])), [q.data]);
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────

/** A tab kept in `?tab=` (replace, not push), falling back to the first allowed tab. */
export function useQueryTab<T extends string>(allowed: readonly T[]): [T, (tab: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("tab");
  const tab = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : (allowed[0] as T);
  const set = useCallback(
    (next: T) => {
      const u = new URLSearchParams(params.toString());
      u.set("tab", next);
      router.replace(`${pathname}?${u.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return [tab, set];
}

/**
 * A page's create form, opened by `?new=1` too (the command menu's "Create …" items). Closing it
 * drops the parameter so a reload does not reopen it.
 */
export function useOpenFromQuery(): [boolean, (open: boolean) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("new") === "1";
  const [open, setOpenState] = useState(requested);
  // the menu used again while already on this page
  const [seen, setSeen] = useState(requested);
  if (requested !== seen) {
    setSeen(requested);
    if (requested) setOpenState(true);
  }
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next && params.has("new")) {
        const u = new URLSearchParams(params.toString());
        u.delete("new");
        const q = u.toString();
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
      }
    },
    [params, pathname, router],
  );
  return [open, setOpen];
}

// ── layout ──────────────────────────────────────────────────────────────────────────────────

export function Section({
  title,
  description,
  actions,
  children,
  danger,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={"rounded-lg border bg-surface " + (danger ? "border-danger/40" : "border-border")}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children !== undefined ? <div className="p-4">{children}</div> : null}
    </section>
  );
}

/** A small notice line (warnings and hints inside dialogs and sections). */
export function Notice({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "danger" | "info";
  children: ReactNode;
}) {
  const cls =
    tone === "danger"
      ? "border-danger/40 bg-danger-soft text-danger-text"
      : tone === "info"
        ? "border-info/40 bg-info-soft text-info-text"
        : "border-warn/40 bg-warn-soft text-warn-text";
  return (
    <div
      role={tone === "danger" ? "alert" : "note"}
      className={`flex gap-2 rounded-md border px-3 py-2 text-xs ${cls}`}
    >
      <AlertTriangle strokeWidth={1.75} className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Shown once after a key or token is minted: the only time its value is visible. Only its own
 * button closes it: a stray click outside or Escape would lose a value that cannot be shown again.
 */
export function OneTimeSecretDialog({
  secret,
  title,
  description,
  onClose,
  extra,
}: {
  secret: string | null;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  extra?: ReactNode;
}) {
  return (
    <Dialog open={secret !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        size="md"
        hideClose
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? "Copy it now. It is stored hashed and cannot be shown again."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
            <ShieldAlert
              strokeWidth={1.75}
              className="size-4 shrink-0 text-warn-text"
              aria-hidden="true"
            />
            <code
              className="min-w-0 flex-1 break-all font-mono text-xs text-ink"
              data-testid="one-time-secret"
            >
              {secret}
            </code>
            <CopyButton value={secret ?? ""} label="Copy" />
          </div>
          {extra}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            I have copied it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A JSON editor with a label and the parse error under it. */
export function JsonField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  minRows = 4,
  maxRows = 16,
  readOnly,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange?: (v: string) => void;
  error?: string | null;
  minRows?: number;
  maxRows?: number;
  readOnly?: boolean;
}) {
  return (
    <FieldRow label={label} htmlFor={id} hint={hint} error={error ?? undefined}>
      <CodeEditor
        id={id}
        language="json"
        value={value}
        {...(onChange ? { onChange } : {})}
        invalid={Boolean(error)}
        minRows={minRows}
        maxRows={maxRows}
        readOnly={readOnly ?? false}
        aria-label={typeof label === "string" ? label : id}
      />
    </FieldRow>
  );
}

/** Controlled confirm state for destructive row actions. */
export function useConfirm<T>(): {
  target: T | null;
  ask: (t: T) => void;
  close: () => void;
} {
  const [target, setTarget] = useState<T | null>(null);
  return { target, ask: setTarget, close: () => setTarget(null) };
}

// ── downloads ───────────────────────────────────────────────────────────────────────────────

/** Downloads an API response as a file (same-origin, with the session). */
export async function downloadFrom(path: string, filename: string): Promise<void> {
  const res = await api<Response>("GET", path, { raw: true });
  const blob = await res.blob();
  saveBlob(blob, filename);
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
