"use client";
/** Members: invite by email with a role, change roles, remove. The owner's role is fixed. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus, UserMinus } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  IconButton,
  Input,
  Select,
  SelectItem,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { del, getAll, patch, post } from "~/api/client";
import type { Role } from "~/api/types";
import { useSession } from "~/session";
import { ROLES, ROLE_DESCRIPTION } from "../logic";
import type { MemberRow } from "../types";
import { QueryView, Section, useConfirm, useMutate } from "../ui";

export function MembersTab() {
  const s = useSession();
  const id = s.me.workspaces.find((w) => w.slug === s.ws)?.id ?? "";
  const canManage = s.can("members:manage");
  const canChangeRoles =
    canManage && (s.me.principal.role === "admin" || s.me.principal.role === "owner");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const confirm = useConfirm<MemberRow>();
  const key = ["members", s.ws];
  const members = useQuery({
    queryKey: key,
    queryFn: () => getAll<MemberRow>(`/v1/workspaces/${id}/members`),
  });
  const invite = useMutate(
    (b: { email: string; role: Role }) => post<MemberRow>(`/v1/workspaces/${id}/members`, b),
    {
      success: (m) => `Added ${m.email} as ${m.role}`,
      invalidate: [key],
      onSuccess: () => {
        setInviting(false);
        setEmail("");
      },
    },
  );
  const changeRole = useMutate(
    (b: { userId: string; role: Role }) =>
      patch(`/v1/workspaces/${id}/members/${b.userId}`, { role: b.role }),
    {
      success: (_, b) => `Role changed to ${b.role}`,
      invalidate: [key],
    },
  );
  const remove = useMutate((m: MemberRow) => del(`/v1/workspaces/${id}/members/${m.userId}`), {
    success: (_, m) => `Removed ${m.email}`,
    invalidate: [key],
    onSuccess: confirm.close,
  });
  const me = s.me.user?.id;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Section
      title="Members"
      description="People with access to this workspace and what their role lets them do."
      actions={
        canManage ? (
          <Button
            variant="primary"
            leadingIcon={<UserPlus strokeWidth={1.75} />}
            onClick={() => setInviting(true)}
          >
            Add member
          </Button>
        ) : null
      }
    >
      <QueryView query={members}>
        {(rows) => (
          <ul
            className="flex flex-col divide-y divide-border rounded-md border border-border"
            role="list"
          >
            {rows.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Avatar name={m.name || m.email} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-ink">
                    <span className="truncate">{m.name || m.email}</span>
                    {m.userId === me ? <Badge tone="outline">You</Badge> : null}
                    {m.status === "invited" ? (
                      <Badge tone="warn">Invited</Badge>
                    ) : m.status === "disabled" ? (
                      <Badge tone="danger">Disabled</Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-2xs text-ink-3">
                    {m.email} · joined <RelativeTime date={m.joinedAt} />
                  </p>
                </div>
                {m.role === "owner" || !canChangeRoles || m.userId === me ? (
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"} className="capitalize">
                    {m.role}
                  </Badge>
                ) : (
                  <Select
                    size="sm"
                    aria-label={`Role of ${m.email}`}
                    value={m.role}
                    className="w-32"
                    onValueChange={(r) => changeRole.mutate({ userId: m.userId, role: r as Role })}
                  >
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} description={ROLE_DESCRIPTION[r]}>
                        <span className="capitalize">{r}</span>
                      </SelectItem>
                    ))}
                  </Select>
                )}
                {canManage && m.role !== "owner" && m.userId !== me ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Remove ${m.email}`}
                    onClick={() => confirm.ask(m)}
                  >
                    <UserMinus strokeWidth={1.75} />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate({ email: email.trim(), role });
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a member</DialogTitle>
              <DialogDescription>
                People without an account are created as invited and set their password on first
                sign-in.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FieldRow label="Email" htmlFor="inv-email" required>
                <Input
                  id="inv-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FieldRow>
              <FieldRow label="Role" htmlFor="inv-role" hint={ROLE_DESCRIPTION[role]}>
                <Select id="inv-role" value={role} onValueChange={(r) => setRole(r as Role)}>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      <span className="capitalize">{r}</span>
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setInviting(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={invite.isPending}
                disabled={!validEmail}
              >
                Add member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Remove ${confirm.target?.email ?? "member"}?`}
        description="They lose access immediately; their sessions for this workspace end."
        variant="danger"
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </Section>
  );
}
