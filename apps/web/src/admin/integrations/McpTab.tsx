"use client";
/**
 * MCP servers (connect, test, discover, delete), workflows exposed as MCP tools and MCP tokens
 * (service-account keys with `mcp:serve`, shown once).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Plus, Radar, Server, Trash2, Zap } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  IconButton,
  Input,
  Select,
  SelectItem,
  Textarea,
  toast,
} from "@flowaid/ui/primitives";
import {
  DataTable,
  RelativeTime,
  createDataTableColumns,
  type DataTableColumns,
} from "@flowaid/ui/data";
import { del, get, post } from "~/api/client";
import type { Page, WorkflowSummary } from "~/api/types";
import { useSession } from "~/session";
import { TOOL_NAME } from "../logic";
import type { CreatedKey, Credential, McpDiscovery, McpExposure, McpServer } from "../types";
import { Notice, OneTimeSecretDialog, QueryView, Section, useConfirm, useMutate } from "../ui";
import { toolNamesFrom } from "../triggers/logic";

const TRANSPORT_LABEL: Record<McpServer["transport"], string> = {
  streamable_http: "Streamable HTTP",
  sse: "SSE",
  stdio: "stdio",
};
const NO_CREDENTIAL = "__none";

function statusTone(status: string): "ok" | "danger" | "warn" | "neutral" {
  if (status === "ok" || status === "connected" || status === "healthy") return "ok";
  if (status === "error" || status === "failed") return "danger";
  if (status === "degraded") return "warn";
  return "neutral";
}

export function useWorkflowNames() {
  const s = useSession();
  return useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=200"),
    select: (p) => p.items,
  });
}

// ── servers ─────────────────────────────────────────────────────────────────────────────────

function NewServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const s = useSession();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpServer["transport"]>("streamable_http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [authKind, setAuthKind] = useState<McpServer["authKind"]>("none");
  const [credentialId, setCredentialId] = useState(NO_CREDENTIAL);
  const creds = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => get<Credential[]>("/v1/credentials"),
    enabled: open && s.can("credentials:read"),
  });
  const create = useMutate(
    (body: Record<string, unknown>) => post<McpServer>("/v1/mcp/servers", body),
    {
      success: (m) => `Connected ${m.name}`,
      invalidate: [["mcp-servers", s.ws]],
      onSuccess: () => {
        onOpenChange(false);
        setName("");
        setUrl("");
        setCommand("");
        setArgs("");
      },
    },
  );
  const remote = transport !== "stdio";
  const ready = name.trim() && (remote ? /^https?:\/\//.test(url.trim()) : command.trim());
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({
      name: name.trim(),
      transport,
      ...(remote
        ? { url: url.trim() }
        : {
            command: command.trim(),
            args: args
              .split("\n")
              .map((a) => a.trim())
              .filter(Boolean),
          }),
      authKind,
      credentialId: credentialId === NO_CREDENTIAL ? null : credentialId,
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Connect an MCP server</DialogTitle>
            <DialogDescription>
              Its tools become available to MCP nodes and agents once discovered.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow label="Name" htmlFor="mcp-name" required>
              <Input
                id="mcp-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                placeholder="github"
              />
            </FieldRow>
            <FieldRow label="Transport" htmlFor="mcp-transport">
              <Select
                id="mcp-transport"
                value={transport}
                onValueChange={(v) => setTransport(v as McpServer["transport"])}
              >
                <SelectItem value="streamable_http" description="The current MCP HTTP transport">
                  Streamable HTTP
                </SelectItem>
                <SelectItem value="sse" description="Legacy HTTP + server-sent events">
                  SSE
                </SelectItem>
                <SelectItem
                  value="stdio"
                  description="A local process; needs the stdio feature on the server"
                >
                  stdio
                </SelectItem>
              </Select>
            </FieldRow>
            {remote ? (
              <FieldRow label="URL" htmlFor="mcp-url" required>
                <Input
                  id="mcp-url"
                  type="url"
                  className="font-mono"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                />
              </FieldRow>
            ) : (
              <>
                <FieldRow
                  label="Command"
                  htmlFor="mcp-command"
                  required
                  hint="Must be on the server's allow-list"
                >
                  <Input
                    id="mcp-command"
                    className="font-mono"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx"
                  />
                </FieldRow>
                <FieldRow label="Arguments" htmlFor="mcp-args" hint="One per line">
                  <Textarea
                    id="mcp-args"
                    className="font-mono"
                    rows={3}
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </FieldRow>
              </>
            )}
            <FieldRow label="Authentication" htmlFor="mcp-auth">
              <Select
                id="mcp-auth"
                value={authKind}
                onValueChange={(v) => setAuthKind(v as McpServer["authKind"])}
              >
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="headers" description="Static headers from a credential">
                  Headers
                </SelectItem>
                <SelectItem value="oauth2" description="OAuth 2.1 with PKCE">
                  OAuth 2
                </SelectItem>
              </Select>
            </FieldRow>
            {authKind !== "none" ? (
              <FieldRow label="Credential" htmlFor="mcp-cred">
                <Select id="mcp-cred" value={credentialId} onValueChange={setCredentialId}>
                  <SelectItem value={NO_CREDENTIAL}>Choose a credential</SelectItem>
                  {(creds.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id} meta={c.type}>
                      {c.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!ready}>
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DiscoveryDialog({
  result,
  server,
  onClose,
}: {
  result: McpDiscovery | null;
  server: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={result !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {server}: {result?.tools.length ?? 0} tools
          </DialogTitle>
          <DialogDescription>
            Discovered tools, after the server's allow and deny policy. Descriptions are sanitised
            before any model sees them.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-auto">
          {(result?.warnings?.length ?? 0) > 0 ? (
            <Notice>
              {result?.warnings?.length} warning(s) during discovery; tools with unsafe descriptions
              were excluded.
            </Notice>
          ) : null}
          <ul
            className="flex flex-col divide-y divide-border rounded-md border border-border"
            role="list"
          >
            {(result?.tools ?? []).map((t) => (
              <li key={t.name} className="px-3 py-2">
                <p className="font-mono text-xs text-ink">{t.name}</p>
                {t.description ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{t.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-2xs text-ink-3">
            {result?.resources?.length ?? 0} resources · {result?.prompts?.length ?? 0} prompts ·{" "}
            {result?.excluded?.length ?? 0} excluded
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServersSection() {
  const s = useSession();
  const canWrite = s.can("mcp:write");
  const [creating, setCreating] = useState(false);
  const [discovery, setDiscovery] = useState<{ server: string; result: McpDiscovery } | null>(null);
  const confirm = useConfirm<McpServer>();
  const servers = useQuery({
    queryKey: ["mcp-servers", s.ws],
    queryFn: () => get<McpServer[]>("/v1/mcp/servers"),
  });
  const test = useMutate(
    (m: McpServer) => post<{ ok: boolean; message?: string }>(`/v1/mcp/servers/${m.id}/test`),
    {
      success: (r, m) => (r.ok ? `${m.name} answered the ping` : null),
      onSuccess: (r, m) => {
        if (!r.ok) toast.error(`${m.name} is not reachable`, { description: r.message });
      },
      invalidate: [["mcp-servers", s.ws]],
    },
  );
  const discover = useMutate(
    (m: McpServer) => post<McpDiscovery>(`/v1/mcp/servers/${m.id}/discover`),
    {
      onSuccess: (r, m) => setDiscovery({ server: m.name, result: r }),
      invalidate: [
        ["mcp-servers", s.ws],
        ["tools-catalog", s.ws],
      ],
      errorTitle: "Discovery failed",
    },
  );
  const remove = useMutate((m: McpServer) => del(`/v1/mcp/servers/${m.id}`), {
    success: (_, m) => `Removed ${m.name}`,
    invalidate: [["mcp-servers", s.ws]],
    onSuccess: confirm.close,
  });

  const col = createDataTableColumns<McpServer>();
  const columns = useMemo<DataTableColumns<McpServer>>(
    () =>
      col.columns([
        col.accessor("name", {
          header: "Server",
          size: 240,
          meta: { grow: true },
          cell: ({ row }) => (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-medium text-ink">{row.original.name}</span>
              <span className="truncate font-mono text-2xs text-ink-3">
                {row.original.url ?? [row.original.command, ...(row.original.args ?? [])].join(" ")}
              </span>
            </span>
          ),
        }),
        col.accessor("transport", {
          header: "Transport",
          size: 140,
          cell: ({ getValue }) => <span className="text-ink-2">{TRANSPORT_LABEL[getValue()]}</span>,
        }),
        col.accessor("status", {
          header: "Status",
          size: 150,
          cell: ({ row }) => (
            <span className="flex min-w-0 flex-col">
              <Badge tone={statusTone(row.original.status)} dot className="self-start capitalize">
                {row.original.status}
              </Badge>
              {row.original.lastError ? (
                <span className="truncate text-2xs text-danger-text">{row.original.lastError}</span>
              ) : null}
            </span>
          ),
        }),
        col.accessor("toolCount", { header: "Tools", size: 80, meta: { numeric: true } }),
        col.accessor((m) => m.lastCheckedAt ?? "", {
          id: "checked",
          header: "Checked",
          size: 110,
          cell: ({ row }) =>
            row.original.lastCheckedAt ? (
              <RelativeTime date={row.original.lastCheckedAt} />
            ) : (
              <span className="text-ink-3">Never</span>
            ),
        }),
        col.display({
          id: "actions",
          header: "",
          size: 120,
          cell: ({ row }) =>
            canWrite ? (
              <span className="flex justify-end gap-1">
                <IconButton
                  size="sm"
                  variant="ghost"
                  label="Test connection"
                  onClick={() => test.mutate(row.original)}
                >
                  <Zap strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label="Discover tools"
                  onClick={() => discover.mutate(row.original)}
                >
                  <Radar strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label="Remove server"
                  onClick={() => confirm.ask(row.original)}
                >
                  <Trash2 strokeWidth={1.75} />
                </IconButton>
              </span>
            ) : null,
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite],
  );

  return (
    <Section
      title="MCP servers"
      description="Remote tool servers this workspace connects to."
      actions={
        canWrite ? (
          <Button
            variant="primary"
            leadingIcon={<Plus strokeWidth={1.75} />}
            onClick={() => setCreating(true)}
          >
            Connect server
          </Button>
        ) : null
      }
    >
      <QueryView query={servers}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Server strokeWidth={1.5} />}
              title="No MCP servers"
              description="Connect a server to call its tools from workflows."
            />
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              getRowId={(r) => r.id}
              itemLabel={["server", "servers"]}
              aria-label="MCP servers"
            />
          )
        }
      </QueryView>
      <NewServerDialog open={creating} onOpenChange={setCreating} />
      <DiscoveryDialog
        result={discovery?.result ?? null}
        server={discovery?.server ?? ""}
        onClose={() => setDiscovery(null)}
      />
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Remove ${confirm.target?.name ?? "server"}?`}
        description="Workflows that call its tools fail validation until another server provides them."
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

// ── exposures and tokens ────────────────────────────────────────────────────────────────────

function ExposeDialog({
  open,
  onOpenChange,
  workflows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workflows: WorkflowSummary[];
}) {
  const s = useSession();
  const [workflowId, setWorkflowId] = useState("");
  const [environmentId, setEnvironmentId] = useState(s.environments[0]?.id ?? "");
  const [toolName, setToolName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutate((body: Record<string, string>) => post("/v1/mcp/exposures", body), {
    success: "Workflow exposed as an MCP tool",
    invalidate: [["mcp-exposures", s.ws]],
    onSuccess: () => {
      onOpenChange(false);
      setToolName("");
      setDescription("");
    },
  });
  const nameOk = TOOL_NAME.test(toolName);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ workflowId, environmentId, toolName, description: description.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>Expose a workflow as an MCP tool</DialogTitle>
            <DialogDescription>
              MCP clients holding a token for this workflow can call the deployed version in the
              chosen environment.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow label="Workflow" htmlFor="exp-wf" required>
              <Select
                id="exp-wf"
                value={workflowId}
                placeholder="Choose a workflow"
                onValueChange={(v) => {
                  setWorkflowId(v);
                  const w = workflows.find((x) => x.id === v);
                  if (w && !toolName)
                    setToolName(w.slug.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64));
                  if (w && !description)
                    setDescription(w.description || `Runs the ${w.name} workflow`);
                }}
              >
                {workflows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            <FieldRow label="Environment" htmlFor="exp-env" required>
              <Select id="exp-env" value={environmentId} onValueChange={setEnvironmentId}>
                {s.environments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            <FieldRow
              label="Tool name"
              htmlFor="exp-name"
              required
              error={toolName && !nameOk ? "Letters, digits, _ and - only (64 max)" : undefined}
            >
              <Input
                id="exp-name"
                className="font-mono"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Description"
              htmlFor="exp-desc"
              required
              hint="What the tool does; clients show it to their model"
            >
              <Textarea
                id="exp-desc"
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FieldRow>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!workflowId || !environmentId || !nameOk || !description.trim()}
            >
              Expose
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TokenDialog({
  open,
  onOpenChange,
  workflows,
  onMinted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workflows: WorkflowSummary[];
  onMinted: (key: CreatedKey) => void;
}) {
  const s = useSession();
  const [name, setName] = useState("");
  const [environmentId, setEnvironmentId] = useState(s.environments[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const mint = useMutate(
    (body: Record<string, unknown>) => post<CreatedKey>("/v1/mcp/tokens", body),
    {
      invalidate: [["api-keys", s.ws]],
      onSuccess: (k) => {
        onOpenChange(false);
        setName("");
        setPicked([]);
        onMinted(k);
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mint.mutate({ name: name.trim(), environmentId, workflowIds: picked });
          }}
        >
          <DialogHeader>
            <DialogTitle>Mint an MCP token</DialogTitle>
            <DialogDescription>
              A service-account key with only <code className="font-mono">mcp:serve</code>, pinned
              to the workflows you pick.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow
              label="Name"
              htmlFor="tok-name"
              required
              hint="The client that will hold it, e.g. claude-desktop"
            >
              <Input
                id="tok-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Environment" htmlFor="tok-env" required>
              <Select id="tok-env" value={environmentId} onValueChange={setEnvironmentId}>
                {s.environments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-medium text-ink">Workflows</legend>
              <div className="flex max-h-56 flex-col gap-1 overflow-auto rounded-md border border-border p-2">
                {workflows.length === 0 ? (
                  <p className="text-xs text-ink-3">No workflows yet.</p>
                ) : (
                  workflows.map((w) => (
                    <Checkbox
                      key={w.id}
                      label={w.name}
                      checked={picked.includes(w.id)}
                      onCheckedChange={(c) =>
                        setPicked((p) => (c === true ? [...p, w.id] : p.filter((x) => x !== w.id)))
                      }
                    />
                  ))
                )}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={mint.isPending}
              disabled={!name.trim() || !environmentId || picked.length === 0}
            >
              Mint token
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExposuresSection() {
  const s = useSession();
  const canWrite = s.can("mcp:write");
  const canMint = s.can("api_keys:manage");
  const [exposing, setExposing] = useState(false);
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<CreatedKey | null>(null);
  const confirm = useConfirm<McpExposure>();
  const exposures = useQuery({
    queryKey: ["mcp-exposures", s.ws],
    queryFn: () => get<McpExposure[]>("/v1/mcp/exposures"),
  });
  const workflows = useWorkflowNames();
  const wfName = (id: string) => workflows.data?.find((w) => w.id === id)?.name ?? id.slice(0, 8);
  const envName = (id: string) => s.environments.find((e) => e.id === id)?.name ?? id.slice(0, 8);
  const remove = useMutate((e: McpExposure) => del(`/v1/mcp/exposures/${e.id}`), {
    success: (_, e) => `Stopped exposing ${e.toolName}`,
    invalidate: [["mcp-exposures", s.ws]],
    onSuccess: confirm.close,
  });
  const endpoint =
    typeof window === "undefined" ? `/mcp/${s.ws}` : `${window.location.origin}/mcp/${s.ws}`;

  return (
    <Section
      title="Workflows as MCP tools"
      description={
        <span className="flex flex-wrap items-center gap-1">
          Endpoint <code className="font-mono text-ink-2">{endpoint}</code>
          <CopyButton value={endpoint} label="Copy endpoint" size="sm" />
        </span>
      }
      actions={
        <>
          {canMint ? (
            <Button onClick={() => setMinting(true)} disabled={!workflows.data}>
              Mint token
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              variant="primary"
              leadingIcon={<Plus strokeWidth={1.75} />}
              onClick={() => setExposing(true)}
              disabled={!workflows.data}
            >
              Expose workflow
            </Button>
          ) : null}
        </>
      }
    >
      <QueryView query={exposures}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-xs text-ink-3">
              No workflow is exposed yet. Exposed workflows appear to MCP clients as tools with the
              deployed version's input schema.
            </p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-border rounded-md border border-border"
              role="list"
            >
              {rows.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink">{e.toolName}</span>
                      {!e.enabled ? <Badge tone="warn">Disabled</Badge> : null}
                    </p>
                    <p className="truncate text-2xs text-ink-3">{e.description}</p>
                  </div>
                  <a
                    className="shrink-0 text-xs text-accent-text hover:underline"
                    href={`/${s.ws}/workflows/${e.workflowId}`}
                  >
                    {wfName(e.workflowId)}
                  </a>
                  <Badge>{envName(e.environmentId)}</Badge>
                  {canWrite ? (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Stop exposing ${e.toolName}`}
                      onClick={() => confirm.ask(e)}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      {workflows.data ? (
        <>
          <ExposeDialog open={exposing} onOpenChange={setExposing} workflows={workflows.data} />
          <TokenDialog
            open={minting}
            onOpenChange={setMinting}
            workflows={workflows.data}
            onMinted={setMinted}
          />
        </>
      ) : null}
      <OneTimeSecretDialog
        secret={minted?.key ?? null}
        title="MCP token created"
        onClose={() => setMinted(null)}
        extra={
          minted ? (
            <div className="flex flex-col gap-1.5">
              <TryToken endpoint={endpoint} token={minted.key} />
              <p className="text-xs text-ink-2">Client configuration (Streamable HTTP):</p>
              <pre className="overflow-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-2xs text-ink">
                {JSON.stringify(
                  { url: endpoint, headers: { Authorization: "Bearer <token>" } },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null
        }
      />
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Stop exposing ${confirm.target?.toolName ?? "tool"}?`}
        description="MCP clients will no longer see this tool."
        variant="danger"
        confirmLabel="Stop exposing"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </Section>
  );
}

/**
 * Calls `tools/list` on the workspace's MCP endpoint with a just-minted token, so the person sees
 * exactly what an MCP client will see before copying the configuration.
 */
function TryToken({ endpoint, token }: { endpoint: string; token: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "ok"; tools: string[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const run = async () => {
    setState({ kind: "busy" });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      if (!res.ok) throw new Error(`the endpoint answered HTTP ${res.status}`);
      setState({ kind: "ok", tools: toolNamesFrom(await res.json()) });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => void run()} loading={state.kind === "busy"}>
        Try it: list tools
      </Button>
      {state.kind === "ok" ? (
        <span className="text-xs text-ink-2" role="status">
          {state.tools.length === 0
            ? "No tool yet: expose a deployed workflow this token is pinned to."
            : `${state.tools.length} tool${state.tools.length === 1 ? "" : "s"}: `}
          {state.tools.map((t) => (
            <code key={t} className="mr-1 font-mono">
              {t}
            </code>
          ))}
        </span>
      ) : state.kind === "error" ? (
        <span className="text-xs text-danger-text" role="alert">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

export function McpTab() {
  const s = useSession();
  return (
    <div className="flex flex-col gap-5">
      <ServersSection />
      {s.features.mcp_exposures ? (
        <Section
          title="Workflows as MCP tools"
          description="Exposing workflows to MCP clients, and minting their tokens, live under Triggers."
          actions={
            <Button asChild>
              <a href={`/${s.ws}/triggers?tab=mcp`}>Open Triggers</a>
            </Button>
          }
        />
      ) : (
        <ExposuresSection />
      )}
    </div>
  );
}
