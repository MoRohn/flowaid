"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { Button, EmptyState, SearchInput } from "@flowaid/ui/primitives";
import { CredentialsTable, type CredentialListItemView } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { ApiError, del, get } from "~/api/client";
import {
  CreateCredentialDialog,
  CredentialSheet,
  RotateCredentialDialog,
} from "~/admin/credentials/CredentialDialogs";
import type { Credential, CredentialType } from "~/admin/types";
import { QueryView, useMutate, useOpenFromQuery } from "~/admin/ui";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

export default function CredentialsPage() {
  const s = useSession();
  const canWrite = s.can("credentials:write");
  const [creating, setCreating] = useOpenFromQuery();
  const [openId, setOpenId] = useState<string | null>(null);
  const [rotating, setRotating] = useState<Credential | null>(null);
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => get<Credential[]>("/v1/credentials"),
  });
  const types = useQuery({
    queryKey: ["credential-types", s.ws],
    queryFn: () => get<CredentialType[]>("/v1/credential-types"),
    staleTime: 5 * 60_000,
  });
  const typeOf = (id: string | undefined) => types.data?.find((t) => t.id === id);
  const remove = useMutate((id: string) => del(`/v1/credentials/${id}`), {
    success: "Credential deleted",
    invalidate: [["credentials", s.ws]],
    errorTitle: "Could not delete the credential",
  });
  const envName = (id: string | null) =>
    id ? (s.environments.find((e) => e.id === id)?.name ?? undefined) : undefined;

  const rows = useMemo<CredentialListItemView[]>(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? [])
      .filter(
        (c) =>
          !needle || c.name.toLowerCase().includes(needle) || c.type.toLowerCase().includes(needle),
      )
      .map((c) => {
        const env = envName(c.environmentId);
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          scopes: c.scopes,
          ...(env ? { environment: env } : {}),
          ...(c.lastUsedAt ? { lastUsedAt: c.lastUsedAt } : {}),
          createdAt: c.createdAt,
          ...(c.rotatedAt ? { rotatedAt: c.rotatedAt } : {}),
          status: "active" as const,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, q, s.environments]);

  const byId = (id: string) => list.data?.find((c) => c.id === id) ?? null;
  const newButton = canWrite ? (
    <Button
      variant="primary"
      leadingIcon={<Plus strokeWidth={1.75} />}
      onClick={() => setCreating(true)}
      disabled={!types.data}
    >
      New credential
    </Button>
  ) : null;

  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Credentials" }]}>
      <PageBody>
        <PageHeader
          title="Credentials"
          description="Provider keys and connection secrets. Workflows reference them by secret name per environment."
          actions={newButton}
        />
        <div className="mt-4">
          <QueryView query={list}>
            {(data) =>
              data.length === 0 ? (
                <EmptyState
                  icon={<KeyRound strokeWidth={1.5} />}
                  title="No credentials yet"
                  description="Add a provider key (TypeSafe, OpenAI, Anthropic…) or an HTTP secret, then bind it to a workflow's declared secrets."
                  primaryAction={newButton}
                />
              ) : (
                <CredentialsTable
                  credentials={rows}
                  aria-label="Credentials"
                  onOpen={(c) => setOpenId(c.id)}
                  onRowActivate={(c) => setOpenId(c.id)}
                  onRowClick={(c, e) => {
                    if (!(e.target as HTMLElement).closest("button,a,[role=menuitem]"))
                      setOpenId(c.id);
                  }}
                  {...(canWrite
                    ? {
                        onRotate: (c: CredentialListItemView) => setRotating(byId(c.id)),
                        onDelete: async (c: CredentialListItemView) => {
                          await remove.mutateAsync(c.id).catch((e: unknown) => {
                            if (!(e instanceof ApiError)) throw e;
                          });
                        },
                      }
                    : {})}
                  toolbar={
                    <SearchInput
                      value={q}
                      onValueChange={setQ}
                      placeholder="Search by name or type"
                      aria-label="Search credentials"
                      className="w-64"
                    />
                  }
                />
              )
            }
          </QueryView>
        </div>
      </PageBody>
      {types.data && creating ? (
        <CreateCredentialDialog
          open={creating}
          onOpenChange={setCreating}
          types={types.data}
          environments={s.environments}
        />
      ) : null}
      <RotateCredentialDialog
        credential={rotating}
        type={typeOf(rotating?.type)}
        onClose={() => setRotating(null)}
      />
      <CredentialSheet
        credential={openId ? byId(openId) : null}
        type={typeOf(openId ? byId(openId)?.type : undefined)}
        environments={s.environments}
        onClose={() => setOpenId(null)}
        onRotate={(c) => {
          setOpenId(null);
          setRotating(c);
        }}
      />
    </AppFrame>
  );
}
