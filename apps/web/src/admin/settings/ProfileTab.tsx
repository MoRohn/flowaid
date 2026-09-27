"use client";
/** Your account: change the password, see and end sessions, sign out everywhere. */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LogOut, Monitor } from "lucide-react";
import { Badge, Button, ConfirmDialog, FieldRow, IconButton, Input } from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { del, get, post } from "~/api/client";
import { useSession } from "~/session";
import { describeUserAgent, passwordProblem } from "../logic";
import type { SessionRow } from "../types";
import { QueryView, Section, useMutate } from "../ui";

export function ProfileTab() {
  const s = useSession();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  const sessions = useQuery({
    queryKey: ["sessions", s.ws],
    queryFn: () => get<SessionRow[]>("/v1/me/sessions"),
  });
  const change = useMutate(
    () => post("/v1/me/password", { currentPassword: current, newPassword: next }),
    {
      success: "Password changed; your other sessions were signed out",
      invalidate: [["sessions", s.ws]],
      onSuccess: () => {
        setCurrent("");
        setNext("");
        setConfirm("");
      },
      errorTitle: "Password not changed",
    },
  );
  const end = useMutate((id: string) => del(`/v1/me/sessions/${id}`), {
    success: "Session ended",
    invalidate: [["sessions", s.ws]],
  });
  const all = useMutate(() => post("/v1/auth/logout-all", {}, { noRefresh: true }), {
    onSuccess: () => router.replace("/login"),
  });
  const mismatch = confirm.length > 0 && confirm !== next;
  const weak = next.length > 0 ? passwordProblem(next) : null;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Account"
        description={s.me.user ? `${s.me.user.name} · ${s.me.user.email}` : undefined}
      >
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            change.mutate(undefined);
          }}
        >
          <input
            type="text"
            autoComplete="username"
            value={s.me.user?.email ?? ""}
            readOnly
            hidden
          />
          <FieldRow label="Current password" htmlFor="pw-current" required>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </FieldRow>
          <FieldRow
            label="New password"
            htmlFor="pw-new"
            required
            hint="At least 12 characters mixing two kinds; a passphrase is best"
            error={weak ?? undefined}
          >
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </FieldRow>
          <FieldRow
            label="Repeat the new password"
            htmlFor="pw-confirm"
            required
            error={mismatch ? "The passwords differ" : undefined}
          >
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FieldRow>
          <div>
            <Button
              type="submit"
              variant="primary"
              loading={change.isPending}
              disabled={!current || !next || next !== confirm || weak !== null}
            >
              Change password
            </Button>
          </div>
        </form>
      </Section>
      <Section
        title="Sessions"
        description="Browsers signed in to your account."
        actions={
          <Button
            variant="danger"
            leadingIcon={<LogOut strokeWidth={1.75} />}
            onClick={() => setEverywhere(true)}
          >
            Sign out everywhere
          </Button>
        }
      >
        <QueryView query={sessions}>
          {(rows) => (
            <ul
              className="flex flex-col divide-y divide-border rounded-md border border-border"
              role="list"
            >
              {rows.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-3 py-2">
                  <Monitor
                    strokeWidth={1.75}
                    className="size-4 shrink-0 text-ink-3"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm text-ink">
                      {describeUserAgent(x.userAgent)}
                      {x.current ? (
                        <Badge tone="ok" dot>
                          This browser
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-2xs text-ink-3">
                      <span className="font-mono">{x.ip ?? "unknown IP"}</span> · signed in{" "}
                      <RelativeTime date={x.createdAt} />
                    </p>
                  </div>
                  {!x.current ? (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label="End this session"
                      onClick={() => end.mutate(x.id)}
                    >
                      <LogOut strokeWidth={1.75} />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Section>
      <ConfirmDialog
        open={everywhere}
        onOpenChange={setEverywhere}
        title="Sign out everywhere?"
        description="Every session ends, including this one. You will sign in again."
        variant="danger"
        confirmLabel="Sign out everywhere"
        loading={all.isPending}
        onConfirm={() => all.mutate(undefined)}
      />
    </div>
  );
}
