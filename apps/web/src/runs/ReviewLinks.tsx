"use client";
/**
 * External review links for one task (API.md §3.5): single-use, revocable, and bound by the task's
 * expiry. The token lives only in the URL fragment, so the link is shown once, right after it is
 * created; revoking works for the links created in this session.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button, CopyButton, Input, toast } from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { del, post } from "~/api/client";
import { errorMessage } from "~/shell/states";
import type { ReviewLink } from "./types";

export function ReviewLinks({ taskId }: { taskId: string }) {
  const [links, setLinks] = useState<(ReviewLink & { revoked?: boolean })[]>([]);
  const create = useMutation({
    mutationFn: () => post<ReviewLink>(`/v1/human-tasks/${taskId}/review-link`, {}),
    onSuccess: (l) => setLinks((ls) => [l, ...ls]),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/v1/human-tasks/${taskId}/review-link/${id}`),
    onSuccess: (_r, id) => {
      setLinks((ls) => ls.map((l) => (l.id === id ? { ...l, revoked: true } : l)));
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
      {links.length ? (
        <ul className="flex flex-col gap-2" role="list">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <Input
                readOnly
                value={l.revoked ? "Revoked" : l.url}
                aria-label="Review link"
                className="font-mono text-xs"
                disabled={l.revoked}
              />
              {!l.revoked ? (
                <>
                  <CopyButton value={l.url} label="Copy link" />
                  <span className="shrink-0 text-2xs text-ink-3">
                    expires <RelativeTime date={l.expiresAt} />
                  </span>
                  <Button size="sm" variant="danger" onClick={() => revoke.mutate(l.id)}>
                    Revoke
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
