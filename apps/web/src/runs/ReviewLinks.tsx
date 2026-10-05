"use client";
/**
 * External review links for one task (API.md §3.5): single-use, revocable, and bound by the task's
 * expiry. The token lives only in the URL fragment, so a link's URL is shown once, right after it
 * is created; every link of the task is listed with its state and can be revoked while active.
 * A link opens FlowAId's web address: when that is this computer or a private network, the panel
 * says who can open it before anyone sends one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Link2, MonitorSmartphone } from "lucide-react";
import { Badge, Button, CopyButton, Input, toast } from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { del, get, post } from "~/api/client";
import { errorMessage } from "~/shell/states";
import type { ReviewLink, ReviewLinkInfo } from "./types";

export const LINK_STATUS: Record<
  ReviewLinkInfo["status"],
  { label: string; tone: "ok" | "neutral" | "warn" | "danger" }
> = {
  active: { label: "Active", tone: "ok" },
  used: { label: "Answered", tone: "neutral" },
  revoked: { label: "Revoked", tone: "danger" },
  expired: { label: "Expired", tone: "warn" },
};

/** Who can open an address: only this computer, only the local network, or anyone. */
export type LinkReach = "computer" | "network" | "anyone";

/** Loopback (this computer) or a private network address, from a URL's host name. */
export function linkReach(address: string): LinkReach {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "anyone";
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127\./.test(host)
  )
    return "computer";
  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(fc|fd|fe80)[0-9a-f]*:/.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    !host.includes(".")
  )
    return "network";
  return "anyone";
}

const noSubscribe = () => () => undefined;

export function ReviewLinks({ taskId, local = false }: { taskId: string; local?: boolean }) {
  const qc = useQueryClient();
  // URLs of the links created in this session: the server never returns a token again
  const [urls, setUrls] = useState<Record<string, string>>({});
  // where a link points: the last created link's address, else this page's (the same app)
  const [created, setCreated] = useState<string>();
  const here = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => null,
  );
  const address = created ?? here;
  // on your own computer (local mode) FlowAId's web address is always a loopback one
  const reach: LinkReach = local ? "computer" : address ? linkReach(address) : "anyone";
  const key = ["review-links", taskId];
  const links = useQuery({
    queryKey: key,
    queryFn: () => get<ReviewLinkInfo[]>(`/v1/human-tasks/${taskId}/review-links`),
  });
  const create = useMutation({
    mutationFn: () => post<ReviewLink>(`/v1/human-tasks/${taskId}/review-link`, {}),
    onSuccess: (l) => {
      setUrls((u) => ({ ...u, [l.id]: l.url }));
      setCreated(new URL(l.url).origin);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/v1/human-tasks/${taskId}/review-link/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      toast.success("Link revoked");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1">
      <div className="flex items-start gap-3">
        <Link2
          className="mt-0.5 size-4 shrink-0 text-ink-3"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Ask someone outside the workspace</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            A link answers this task once, shows only its title and context, and expires with it (at
            most 7 days).
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Create link
        </Button>
      </div>
      {reach !== "anyone" ? (
        <p
          role="note"
          className="m-0 flex items-start gap-2 rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-ink"
        >
          <MonitorSmartphone
            className="mt-px size-3.5 shrink-0 text-warn-text"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span>
            {reach === "computer"
              ? "Only this computer can open these links: "
              : "Only people on your network can open these links: "}
            FlowAId&apos;s web address
            {address ? <span className="font-mono"> {address}</span> : null} is{" "}
            {reach === "computer" ? "on this computer" : "a private network address"}. To ask
            someone else, run FlowAId where they can reach it and set its web address
            (FLOWAID_WEB_URL) to that address.
          </span>
        </p>
      ) : null}
      {links.data?.length ? (
        <ul className="flex flex-col gap-2" role="list" aria-label="Review links">
          {links.data.map((l) => {
            const url = urls[l.id];
            const s = LINK_STATUS[l.status];
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                {url && l.status === "active" ? (
                  <>
                    <Input
                      readOnly
                      value={url}
                      aria-label="Review link"
                      className="min-w-48 flex-1 font-mono text-xs"
                    />
                    <CopyButton value={url} label="Copy link" />
                  </>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                    <Badge tone={s.tone} size="sm">
                      {s.label}
                    </Badge>
                    <span className="truncate text-ink-3">
                      created <RelativeTime date={l.createdAt} />
                    </span>
                  </span>
                )}
                {l.status === "active" ? (
                  <>
                    <span className="shrink-0 text-2xs text-ink-3">
                      expires <RelativeTime date={l.expiresAt} />
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={revoke.isPending && revoke.variables === l.id}
                      onClick={() => revoke.mutate(l.id)}
                    >
                      Revoke
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
