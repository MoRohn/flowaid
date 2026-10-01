"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { Button, EmptyState, SearchInput } from "@flowaid/ui/primitives";
import { CredentialsTable, type CredentialListItemView } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { ApiError, del, get, getAll } from "~/api/client";
import {
  CreateCredentialDialog,
  CredentialSheet,
  RotateCredentialDialog,
} from "~/admin/credentials/CredentialDialogs";
import { providerName } from "~/admin/providerNames";
import type { Credential, CredentialType, Provider } from "~/admin/types";
import { QueryView, useMutate, useOpenFromQuery } from "~/admin/ui";
import { CREDENTIALS } from "~/guide/capabilities/credentials";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { generationCheck, typesafeCheck, useConnections } from "~/guide/useConnections";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

export default function CredentialsPage() {
  const s = useSession();
  const canWrite = s.can("credentials:write");
  const [creating, setCreating] = useOpenFromQuery();
  // a "What you need" line opens the form on the service it names
  const [createType, setCreateType] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rotating, setRotating] = useState<Credential | null>(null);
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
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
  const connections = useConnections();
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<Provider[]>("/v1/providers"),
    staleTime: 60_000,
  });
  const serverKeys = (providers.data ?? []).filter((p) => p.configuredOnServer).map((p) => p.id);
  const addFix = (typeId: string, label: string) =>
    canWrite && types.data?.some((t) => t.id === typeId) ? (
      <button
        type="button"
        className="rounded-xs text-accent-text hover:underline focus-visible:shadow-(--focus) focus-visible:outline-none"
        onClick={() => {
          setCreateType(typeId);
          setCreating(true);
        }}
      >
        {label}
      </button>
    ) : undefined;
  const checks: Check[] = [
    { ...typesafeCheck(connections, s.ws), fix: addFix("typesafe.api_key", "Add a TypeSafe key") },
    {
      ...generationCheck(connections, s.ws, { need: "Generate, Agent and other writing steps" }),
      fix: addFix("openai.api_key", "Add an OpenAI key"),
    },
    ...(providers.data
      ? [
          {
            id: "server",
            label: serverKeys.length
              ? `Keys set on the server: ${serverKeys.map(providerName).join(", ")}`
              : "No keys set on the server",
            state: "info",
            detail:
              "Keys in the server's environment (.env.local) answer any secret of their type that is not bound in the run's environment. A credential here takes their place wherever a workflow binds it.",
          } satisfies Check,
        ]
      : []),
    ...(canWrite
      ? []
      : [
          {
            id: "role",
            label: "Your role can see credentials but not add or change them",
            state: "info",
          } satisfies Check,
        ]),
  ];
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
      onClick={() => {
        setCreateType(undefined);
        setCreating(true);
      }}
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
        <PageIntro
          guide={CREDENTIALS}
          checks={checks}
          defaultCollapsed={(list.data?.length ?? 0) > 0}
        />
        <div className="mt-4">
          <QueryView query={list}>
            {(data) =>
              data.length === 0 ? (
                <EmptyState
                  icon={<KeyRound strokeWidth={1.5} />}
                  title="No credentials yet"
                  description="Add a provider key (TypeSafe, OpenAI, Anthropic…) or an HTTP secret, then bind it to a workflow's secrets. New credential walks through the service, the secret and where it may be used."
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
          {...(createType ? { defaultType: createType } : {})}
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
