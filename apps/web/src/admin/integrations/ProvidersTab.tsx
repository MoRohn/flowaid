"use client";
/** Providers (configured on the server or through workspace credentials) and the model catalogue. */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, SearchInput, ToggleGroup, ToggleGroupItem } from "@flowaid/ui/primitives";
import { DataTable, createDataTableColumns, type DataTableColumns } from "@flowaid/ui/data";
import { formatCompactNumber } from "@flowaid/ui/lib";
import { get, getAll } from "~/api/client";
import { useSession } from "~/session";
import type { Credential, ModelInfo, Provider } from "../types";
import { QueryView, Section } from "../ui";
import { PROVIDER_NAME } from "../providerNames";
import { providerCredentialType } from "../credentials/logic";

const KIND_LABEL: Record<ModelInfo["kind"], string> = {
  decision: "Decision",
  chat: "Chat",
  embedding: "Embedding",
  rerank: "Rerank",
};

const price = (v: number | undefined) =>
  v === undefined ? "—" : v === 0 ? "free" : `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;

export function ProvidersTab() {
  const s = useSession();
  const [kind, setKind] = useState<ModelInfo["kind"] | "all">("all");
  const [q, setQ] = useState("");
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<Provider[]>("/v1/providers"),
    staleTime: 60_000,
  });
  const models = useQuery({
    queryKey: ["models", s.ws],
    queryFn: () => get<ModelInfo[]>("/v1/models"),
    staleTime: 60_000,
  });
  const creds = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    enabled: s.can("credentials:read"),
  });
  const credCount = (provider: string) =>
    (creds.data ?? []).filter((c) => c.type.startsWith(`${provider}.`)).length;

  const col = createDataTableColumns<ModelInfo>();
  const columns = useMemo<DataTableColumns<ModelInfo>>(
    () =>
      col.columns([
        col.accessor("model", {
          header: "Model",
          size: 240,
          meta: { grow: true, mono: true },
          cell: ({ row }) => (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-ink">{row.original.model}</span>
              {row.original.deprecated ? <Badge tone="warn">Deprecated</Badge> : null}
              {row.original.aliases?.map((a) => (
                <Badge key={a} tone="outline" mono size="sm">
                  {a}
                </Badge>
              ))}
            </span>
          ),
        }),
        col.accessor("provider", {
          header: "Provider",
          size: 130,
          cell: ({ getValue }) => PROVIDER_NAME[getValue()] ?? getValue(),
        }),
        col.accessor("kind", {
          header: "Kind",
          size: 100,
          cell: ({ getValue }) => (
            <Badge tone={getValue() === "decision" ? "accent" : "neutral"}>
              {KIND_LABEL[getValue()]}
            </Badge>
          ),
        }),
        col.accessor((m) => m.contextTokens ?? 0, {
          id: "context",
          header: "Context",
          size: 104,
          meta: { numeric: true, mono: true },
          cell: ({ getValue }) => (getValue() ? formatCompactNumber(getValue()) : "—"),
        }),
        col.accessor((m) => m.pricing?.inputPerMTok ?? -1, {
          id: "input",
          header: "In / 1M",
          size: 104,
          meta: { numeric: true, mono: true },
          cell: ({ row }) => price(row.original.pricing?.inputPerMTok),
        }),
        col.accessor((m) => m.pricing?.outputPerMTok ?? -1, {
          id: "output",
          header: "Out / 1M",
          size: 104,
          meta: { numeric: true, mono: true },
          cell: ({ row }) => price(row.original.pricing?.outputPerMTok),
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const needle = q.trim().toLowerCase();
  const visible = (models.data ?? []).filter(
    (m) =>
      (kind === "all" || m.kind === kind) &&
      (!needle || m.model.toLowerCase().includes(needle) || m.provider.includes(needle)),
  );

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Providers"
        description="A provider is ready when it has a key: set on the server in FlowAId's environment, or stored as a credential under Credentials. Steps and agents can only use models of a ready provider."
      >
        <QueryView query={providers} rows={2}>
          {(rows) => (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((p) => {
                const n = credCount(p.id);
                return (
                  <Card key={p.id} className="flex flex-col gap-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{PROVIDER_NAME[p.id] ?? p.id}</span>
                      <span className="font-mono text-2xs text-ink-3">{p.models} models</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={p.configuredOnServer ? "ok" : "neutral"} dot>
                        {p.configuredOnServer ? "Server key set" : "No server key"}
                      </Badge>
                      {creds.data ? (
                        <Badge tone={n > 0 ? "ok" : "neutral"} dot>
                          {n} credential{n === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    {!p.configuredOnServer && n === 0 && s.features.credentials ? (
                      <Link
                        className="text-xs text-accent-text hover:underline"
                        // opens New credential on this provider's key
                        href={`/${s.ws}/credentials?new=1&type=${encodeURIComponent(providerCredentialType(p.id))}`}
                      >
                        Add {/^[aeiou]/i.test(PROVIDER_NAME[p.id] ?? p.id) ? "an" : "a"}{" "}
                        {PROVIDER_NAME[p.id] ?? p.id} credential
                      </Link>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </QueryView>
      </Section>
      <Section
        title="Models"
        description="Every model the provider registry knows, with the providers' list prices per million tokens. What a run actually costs shows in its trace."
      >
        <QueryView query={models}>
          {() => (
            <DataTable
              columns={columns}
              data={visible}
              getRowId={(m) => `${m.provider}/${m.model}`}
              itemLabel={["model", "models"]}
              aria-label="Models"
              defaultSorting={[{ id: "provider", desc: false }]}
              toolbar={
                <div className="flex flex-wrap items-center gap-2">
                  <SearchInput
                    value={q}
                    onValueChange={setQ}
                    placeholder="Search models"
                    aria-label="Search models"
                    className="w-56"
                  />
                  <ToggleGroup
                    type="single"
                    size="sm"
                    value={kind}
                    onValueChange={(v) => v && setKind(v as typeof kind)}
                    aria-label="Model kind"
                  >
                    <ToggleGroupItem value="all">All</ToggleGroupItem>
                    {(Object.keys(KIND_LABEL) as ModelInfo["kind"][]).map((k) => (
                      <ToggleGroupItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              }
            />
          )}
        </QueryView>
      </Section>
    </div>
  );
}
