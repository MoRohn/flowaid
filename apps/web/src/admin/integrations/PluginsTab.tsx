"use client";
/**
 * Node packages: installed and bundled plugins, installing from the registry (allow-listed and
 * integrity-checked by the server), enabling, disabling and removing. Bundled rows are read-only.
 */
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { Package, Plus } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  FieldError,
  FieldHint,
  FieldRow,
  Input,
  Label,
  SearchInput,
  Switch,
} from "@flowaid/ui/primitives";
import { DataTable, createDataTableColumns, type DataTableColumns } from "@flowaid/ui/data";
import { del, get, patch, post, qs } from "~/api/client";
import { useSession } from "~/session";
import { Notice, QueryView, Section, useConfirm, useMutate } from "../ui";
import {
  isReadOnly,
  parseSpec,
  searchAction,
  type PluginRow,
  type PluginSearchRow,
} from "./plugins";

export function PluginsTab() {
  const s = useSession();
  const admin = s.can("admin");
  const list = useQuery({
    queryKey: ["plugins", s.ws],
    queryFn: () => get<PluginRow[]>("/v1/plugins"),
  });
  const [spec, setSpec] = useState("");
  const [integrity, setIntegrity] = useState("");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const search = useQuery({
    queryKey: ["plugin-search", s.ws, query],
    queryFn: () => get<PluginSearchRow[]>(`/v1/plugins/search${qs({ q: query })}`),
    enabled: query.length > 1,
    staleTime: 60_000,
  });
  const invalidate = [
    ["plugins", s.ws],
    ["plugin-search", s.ws],
    ["catalog", "nodes"],
  ];
  const restartNote = "Restart the workers to load it";
  const install = useMutate(
    (body: { packageName: string; version: string; integrity?: string }) =>
      post<{ plugin: PluginRow }>("/v1/plugins", body),
    {
      success: (d) => `Installed ${d.plugin.packageName}@${d.plugin.version}. ${restartNote}.`,
      invalidate,
      errorTitle: "Install refused",
      onSuccess: () => {
        setSpec("");
        setIntegrity("");
      },
    },
  );
  const toggle = useMutate(
    (p: { id: string; status: "enabled" | "disabled" }) =>
      patch<{ plugin: PluginRow }>(`/v1/plugins/${p.id}`, { status: p.status }),
    {
      success: (d) => `${d.plugin.packageName} is ${d.plugin.status}. ${restartNote}.`,
      invalidate,
    },
  );
  const confirm = useConfirm<PluginRow>();
  const remove = useMutate((p: PluginRow) => del(`/v1/plugins/${p.id}`), {
    success: (_d, p) => `Removed ${p.packageName}`,
    invalidate,
    onSuccess: confirm.close,
  });
  const parsed = parseSpec(spec);
  const specError = spec.trim() && typeof parsed === "string" ? parsed : null;

  const col = createDataTableColumns<PluginRow>();
  const columns = useMemo<DataTableColumns<PluginRow>>(
    () =>
      col.columns([
        col.accessor("packageName", {
          header: "Package",
          size: 260,
          meta: { grow: true, mono: true },
          cell: ({ row }) => (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-ink">{row.original.packageName}</span>
              {row.original.source === "bundled" ? (
                <Badge tone="outline" size="sm">
                  Bundled
                </Badge>
              ) : null}
              {row.original.source === "local" ? (
                <Badge tone="warn" size="sm">
                  Local
                </Badge>
              ) : null}
            </span>
          ),
        }),
        col.accessor("version", { header: "Version", size: 96, meta: { mono: true } }),
        col.accessor((p) => p.nodes.length, {
          id: "nodes",
          header: "Nodes",
          size: 80,
          meta: { numeric: true, mono: true },
        }),
        col.accessor("status", {
          header: "Status",
          size: 150,
          cell: ({ row }) => {
            const p = row.original;
            if (p.status === "error")
              return (
                <Badge tone="danger" dot>
                  {p.error ?? "Error"}
                </Badge>
              );
            if (!admin || isReadOnly(p))
              return (
                <Badge tone={p.status === "enabled" ? "ok" : "neutral"} dot>
                  {p.status === "enabled" ? "Enabled" : "Disabled"}
                </Badge>
              );
            return (
              <Switch
                checked={p.status === "enabled"}
                aria-label={`${p.status === "enabled" ? "Disable" : "Enable"} ${p.packageName}`}
                disabled={toggle.isPending}
                onCheckedChange={(on) =>
                  toggle.mutate({ id: p.id, status: on ? "enabled" : "disabled" })
                }
              />
            );
          },
        }),
        col.display({
          id: "actions",
          header: "",
          size: 96,
          cell: ({ row }) =>
            admin && !isReadOnly(row.original) ? (
              <Button size="sm" variant="ghost" onClick={() => confirm.ask(row.original)}>
                Remove
              </Button>
            ) : null,
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [admin, toggle.isPending],
  );

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Node packages"
        description="Plugins add node types to the palette. Bundled packages ship with the platform; installed ones come from the npm registry, checked against their published integrity."
      >
        <QueryView query={list}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Package strokeWidth={1.5} />}
                title="No plugins"
                description="Search the registry below for packages with the flowaid-node keyword."
              />
            ) : (
              <DataTable
                columns={columns}
                data={rows}
                getRowId={(p) => p.id}
                itemLabel={["package", "packages"]}
                aria-label="Node packages"
              />
            )
          }
        </QueryView>
      </Section>

      {admin ? (
        <Section
          title="Install a package"
          description="Only packages on the server's allow-list (FLOWAID_PLUGIN_ALLOWED_SCOPES) can be installed. The server checks the package against its published integrity; restart the workers afterwards so its steps appear in the palette."
        >
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (typeof parsed !== "string")
                install.mutate({
                  ...parsed,
                  ...(integrity.trim() ? { integrity: integrity.trim() } : {}),
                });
            }}
          >
            <FieldRow>
              <Label htmlFor="plugin-spec">Package</Label>
              <Input
                id="plugin-spec"
                className="font-mono"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="@acme/nodes-crm@^1.2.0"
                invalid={specError !== null}
              />
              {specError ? <FieldError>{specError}</FieldError> : null}
            </FieldRow>
            <FieldRow>
              <Label htmlFor="plugin-integrity">Pinned integrity (optional)</Label>
              <Input
                id="plugin-integrity"
                className="font-mono"
                value={integrity}
                onChange={(e) => setIntegrity(e.target.value)}
                placeholder="sha512-…"
              />
              <FieldHint>Refuse the install unless the tarball matches exactly.</FieldHint>
            </FieldRow>
            <Button
              type="submit"
              leadingIcon={<Plus strokeWidth={1.75} />}
              loading={install.isPending}
              disabled={typeof parsed === "string"}
            >
              Install
            </Button>
          </form>
        </Section>
      ) : (
        <Notice tone="info">Only workspace admins can install, enable or remove plugins.</Notice>
      )}

      <Section
        title="Discover"
        description="Packages on the registry that declare the flowaid-node keyword."
      >
        <div className="flex flex-col gap-3">
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search node packages"
            aria-label="Search node packages"
            className="w-72"
          />
          {query.length > 1 ? (
            <QueryView query={search} rows={3}>
              {(rows) =>
                rows.length === 0 ? (
                  <p className="text-sm text-ink-3">No node packages match “{query}”.</p>
                ) : (
                  <ul
                    className="flex flex-col divide-y divide-border rounded-md border border-border"
                    role="list"
                  >
                    {rows.map((r) => {
                      const action = searchAction(r);
                      return (
                        <li key={r.name} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-sm text-ink">
                              {r.name} <span className="text-ink-3">{r.version}</span>
                            </p>
                            <p className="truncate text-xs text-ink-3">
                              {r.description || "No description"}
                            </p>
                            {action.reason ? (
                              <p className="text-xs text-warn-text">{action.reason}</p>
                            ) : null}
                          </div>
                          {admin ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={action.disabled || install.isPending}
                              onClick={() =>
                                install.mutate({ packageName: r.name, version: r.version })
                              }
                            >
                              {action.label}
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )
              }
            </QueryView>
          ) : null}
        </div>
      </Section>

      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Remove ${confirm.target?.packageName ?? "plugin"}?`}
        description="Workflows that use its nodes stop compiling until it is installed again."
        confirmLabel="Remove"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </div>
  );
}
