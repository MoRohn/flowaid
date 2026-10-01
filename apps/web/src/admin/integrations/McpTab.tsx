"use client";
/**
 * MCP servers (connect, test, discover, tool policy, delete), workflows exposed as MCP tools and
 * MCP tokens (service-account keys with `mcp:serve`, shown once).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { CheckCircle2, Plus, Radar, Server, ShieldCheck, Trash2, Zap } from "lucide-react";
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
  Switch,
  Textarea,
  toast,
} from "@flowaid/ui/primitives";
import {
  DataTable,
  RelativeTime,
  createDataTableColumns,
  type DataTableColumns,
} from "@flowaid/ui/data";
import { del, get, getAll, patch, post } from "~/api/client";
import { errorMessage } from "~/shell/states";
import type { Page, WorkflowDetail, WorkflowSummary } from "~/api/types";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import { TOOL_NAME } from "../logic";
import type { CreatedKey, McpDiscovery, McpExposure, McpServer } from "../types";
import { Notice, OneTimeSecretDialog, QueryView, Section, useConfirm, useMutate } from "../ui";
import { inputFields } from "../triggers/guide";
import { ListHelp } from "../triggers/ListHelp";
import { toolNamesFrom } from "../triggers/logic";
import { McpPolicyDialog } from "./McpPolicyDialog";
import { McpServerDialog } from "./McpServerDialog";

const TRANSPORT_LABEL: Record<McpServer["transport"], string> = {
  streamable_http: "Streamable HTTP",
  sse: "SSE",
  stdio: "stdio",
};

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

/** The workspace's MCP servers; shared with the Integrations page's checks. */
export function useMcpServers() {
  const s = useSession();
  return useQuery({
    queryKey: ["mcp-servers", s.ws],
    queryFn: () => getAll<McpServer>("/v1/mcp/servers"),
  });
}

// ── servers ─────────────────────────────────────────────────────────────────────────────────

const SERVER_TERMS: readonly { term: string; text: string }[] = [
  {
    term: "Status",
    text: "Pending: saved but not discovered yet. Connected: the last discovery worked. Error: the last test or discovery failed; the red line says why.",
  },
  {
    term: "Tools",
    text: "How many tools the last discovery found. Only discovered tools can be used by MCP steps and agents; discover again after the server adds tools.",
  },
  {
    term: "Test connection",
    text: "Connects and pings the server. It calls no tool.",
  },
  {
    term: "Tool policy",
    text: "Which tools may be called, which never, and which are marked as needing approval.",
  },
  {
    term: "Local servers",
    text: "Addresses on this computer or your network (localhost, 192.168.…) work only when the api and worker run with FLOWAID_ALLOW_PRIVATE_NETWORK=true.",
  },
];

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
            before any model sees them. MCP steps and agents can use them now.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-auto">
          {(result?.warnings?.length ?? 0) > 0 ? (
            <Notice>
              {result?.warnings?.length} warning(s) during discovery: tools with suspicious
              descriptions are marked as needing approval.
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
            {result?.excluded?.length ?? 0} excluded by the tool policy
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
  const [policy, setPolicy] = useState<McpServer | null>(null);
  const confirm = useConfirm<McpServer>();
  const servers = useMcpServers();
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
      // the tool catalog agents and the builder read (["catalog", "tools", ws] and friends)
      invalidate: [
        ["mcp-servers", s.ws],
        ["catalog", "tools"],
        ["mcp-server-tools", s.ws],
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
          size: 150,
          cell: ({ row }) =>
            canWrite ? (
              <span className="flex justify-end gap-1">
                {/* stdio servers are started by the worker for these */}
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Test connection to ${row.original.name}`}
                  onClick={() => test.mutate(row.original)}
                >
                  <Zap strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Discover tools of ${row.original.name}`}
                  onClick={() => discover.mutate(row.original)}
                >
                  <Radar strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Tool policy of ${row.original.name}`}
                  onClick={() => setPolicy(row.original)}
                >
                  <ShieldCheck strokeWidth={1.75} />
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
      description="Tool servers this workspace connects to. Connect one, test it, then discover its tools."
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
              description="Connect a server to call its tools from MCP steps and agents. You need its address, and a key stored under Credentials if it asks for one."
              primaryAction={
                canWrite ? (
                  <Button
                    variant="primary"
                    leadingIcon={<Plus strokeWidth={1.75} />}
                    onClick={() => setCreating(true)}
                  >
                    Connect server
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ListHelp terms={SERVER_TERMS} />
              <DataTable
                columns={columns}
                data={rows}
                getRowId={(r) => r.id}
                itemLabel={["server", "servers"]}
                aria-label="MCP servers"
              />
            </>
          )
        }
      </QueryView>
      {creating ? (
        <McpServerDialog
          open={creating}
          onOpenChange={setCreating}
          onDiscovered={(server, result) => setDiscovery({ server, result })}
        />
      ) : null}
      {policy ? (
        <McpPolicyDialog
          server={policy}
          onClose={() => setPolicy(null)}
          onRediscover={(m) => {
            setPolicy(null);
            discover.mutate(m);
          }}
        />
      ) : null}
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

interface ExposeDraft {
  workflowId: string;
  environmentId: string;
  toolName: string;
  description: string;
}

/**
 * Expose a workflow as an MCP tool, step by step: which deployed version clients run, how the tool
 * presents itself to their model, then a review. It takes effect at once; nothing is deployed.
 */
function ExposeDialog({
  open,
  onOpenChange,
  workflows,
  exposures,
  onExposed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workflows: WorkflowSummary[];
  exposures: readonly McpExposure[];
  /** the next step: a token for it */
  onExposed: (e: { workflowId: string; environmentId: string }) => void;
}) {
  const s = useSession();
  const kept = useKeptDraft<ExposeDraft>(`flowaid:draft:${s.ws}:mcp-exposure`, () => ({
    workflowId: "",
    environmentId: s.environments[0]?.id ?? "",
    toolName: "",
    description: "",
  }));
  const { draft, setDraft } = kept;
  const set = <K extends keyof ExposeDraft>(k: K, v: ExposeDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const [created, setCreated] = useState<ExposeDraft | null>(null);
  const [createdLive, setCreatedLive] = useState(false);
  const detail = useQuery({
    queryKey: ["workflow", s.ws, draft.workflowId],
    queryFn: () => get<WorkflowDetail>(`/v1/workflows/${draft.workflowId}`),
    enabled: open && Boolean(draft.workflowId),
  });
  const create = useMutate((body: ExposeDraft) => post("/v1/mcp/exposures", body), {
    success: "Workflow exposed as an MCP tool",
    invalidate: [["mcp-exposures", s.ws]],
    errorTitle: "Could not expose the workflow",
    onSuccess: (_, body) => {
      kept.discard();
      setCreatedLive(Boolean(deployed));
      setCreated(body);
    },
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setCreated(null);
  };
  const env = s.environments.find((e) => e.id === draft.environmentId);
  const deployed = detail.data?.deployments.find((d) => d.environmentId === draft.environmentId);
  const nameOk = TOOL_NAME.test(draft.toolName);
  const taken = exposures.some((e) => e.toolName === draft.toolName);
  const fields = inputFields(detail.data?.draft.inputs);

  if (created)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {created.toolName} is exposed
            </DialogTitle>
            <DialogDescription>
              Clients holding a token for this workflow in{" "}
              {s.environments.find((e) => e.id === created.environmentId)?.name ??
                "the environment"}{" "}
              {createdLive
                ? "can list and call it now."
                : "can list and call it once a version is deployed there."}{" "}
              Later deployments keep it on. Next, give your client a token.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>Mint a token pinned to this workflow and environment. It is shown once.</li>
              <li>
                In the client, add an MCP server with the endpoint shown on this page and the token
                as a Bearer authorization header.
              </li>
              <li>Ask the client something that needs the tool, then open the run under Runs.</li>
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Done
            </Button>
            {s.can("api_keys:manage") ? (
              <Button
                variant="primary"
                onClick={() => {
                  close(false);
                  onExposed(created);
                }}
              >
                Mint a token for it
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  const deployChecks: Check[] = !draft.workflowId
    ? []
    : detail.isPending
      ? [{ id: "deployed", label: "Checking where it is deployed", state: "checking" }]
      : detail.isError
        ? [{ id: "deployed", label: "Could not read the workflow", state: "warning" }]
        : [
            deployed
              ? {
                  id: "deployed",
                  label: `Version ${deployed.version ?? "?"} is deployed to ${env?.name ?? "it"}`,
                  state: "ok",
                  detail: "Clients run that version; a later deployment changes what they run.",
                }
              : {
                  id: "deployed",
                  label: `Nothing is deployed to ${env?.name ?? "this environment"} yet`,
                  state: "warning",
                  detail:
                    "You can expose it now: the tool waits, and clients see it as soon as a version is deployed there.",
                  fix: (
                    <a
                      className="text-accent-text hover:underline"
                      href={`/${s.ws}/workflows/${draft.workflowId}/deployments`}
                    >
                      Open its deployments
                    </a>
                  ),
                },
          ];
  const reviewChecks: Check[] = [
    ...(!draft.workflowId
      ? [{ id: "wf", label: "Choose a workflow", state: "blocker" } satisfies Check]
      : []),
    ...(!nameOk
      ? [
          {
            id: "name",
            label: "Tool name: letters, digits, _ and - only (64 at most)",
            state: "blocker",
          } satisfies Check,
        ]
      : taken
        ? [
            {
              id: "name",
              label: `The tool name ${draft.toolName} is taken`,
              state: "blocker",
            } satisfies Check,
          ]
        : []),
    ...(!draft.description.trim()
      ? [{ id: "desc", label: "Describe what the tool does", state: "blocker" } satisfies Check]
      : []),
    ...deployChecks,
    ...(draft.workflowId
      ? [
          {
            id: "redeploy",
            label: `The tool follows the workflow's deployment to ${env?.name ?? "this environment"}: later deployments and rollbacks keep it on with this name and description, and clients run whichever version is deployed. Switch it off in the list to hide it.`,
            state: "info",
          } satisfies Check,
        ]
      : []),
  ];
  const ready =
    Boolean(draft.workflowId && draft.environmentId) &&
    nameOk &&
    !taken &&
    draft.description.trim().length > 0;

  const steps: FlowStep[] = [
    {
      id: "source",
      title: "Choose the workflow and environment",
      why: "Clients run the version deployed to this environment. Pick the one whose version they should use.",
      done: Boolean(draft.workflowId && draft.environmentId),
      requirement: "choose a workflow",
      children: (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Workflow" htmlFor="exp-wf" required>
              <Select
                id="exp-wf"
                value={draft.workflowId}
                placeholder="Choose a workflow"
                onValueChange={(v) => {
                  const w = workflows.find((x) => x.id === v);
                  setDraft((d) => ({
                    ...d,
                    workflowId: v,
                    toolName:
                      d.toolName || (w ? w.slug.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) : ""),
                    description:
                      d.description || (w ? w.description || `Runs the ${w.name} workflow` : ""),
                  }));
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
              <Select
                id="exp-env"
                value={draft.environmentId}
                onValueChange={(v) => set("environmentId", v)}
              >
                {s.environments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
          </div>
          {deployChecks.length ? (
            <CheckList checks={deployChecks} aria-label="Where it is deployed" />
          ) : null}
        </>
      ),
    },
    {
      id: "describe",
      title: "Name and describe the tool",
      why: "The client's model reads only the name, the description and the arguments when deciding whether to call the tool, so say what it does, when to use it and what it returns.",
      done: nameOk && !taken && draft.description.trim().length > 0,
      requirement: "fill in a free tool name and a description",
      example: (
        <>
          <code className="font-mono">refund_triage</code>: “Decides whether a refund request is
          approved, refused or needs a person. Give it the order id and the customer&apos;s message;
          it returns the decision and a one-line reason.”
        </>
      ),
      children: (
        <>
          <FieldRow
            label="Tool name"
            htmlFor="exp-name"
            required
            error={
              draft.toolName && !nameOk
                ? "Letters, digits, _ and - only (64 max)"
                : taken
                  ? "Another tool already has this name"
                  : undefined
            }
          >
            <Input
              id="exp-name"
              className="font-mono"
              value={draft.toolName}
              onChange={(e) => set("toolName", e.target.value)}
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
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </FieldRow>
          {fields.length ? (
            <div className="text-xs text-ink-2">
              <p className="m-0 mb-1">
                Its arguments are the workflow&apos;s input fields (as in the draft; clients get the
                deployed version&apos;s):
              </p>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {fields.map((f) => (
                  <li key={f.name}>
                    <code className="font-mono text-ink">{f.name}</code>{" "}
                    <span className="text-ink-3">
                      {f.type}
                      {f.required ? ", required" : ""}
                      {f.description ? ` · ${f.description}` : " · no description"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: "review",
      doneLabel: "Ready to expose",
      title: "Review and expose",
      why: "Exposing takes effect at once for clients that hold a token for this workflow and environment. It does not publish or deploy anything.",
      done: ready,
      requirement: "fix the items marked as needed",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Workflow</dt>
            <dd className="m-0 text-ink">
              {workflows.find((w) => w.id === draft.workflowId)?.name ?? "—"}
            </dd>
            <dt className="text-ink-3">Environment</dt>
            <dd className="m-0 text-ink">{env?.name ?? "—"}</dd>
            <dt className="text-ink-3">Tool</dt>
            <dd className="m-0 font-mono text-ink">{draft.toolName || "—"}</dd>
          </dl>
          <CheckList checks={reviewChecks} aria-label="Before you expose it" />
          {create.isError ? (
            <Notice tone="danger">
              Not exposed: {create.error.message} Your settings are kept.
            </Notice>
          ) : null}
          <QualityNote>
            These checks confirm the tool can be listed. Whether a client&apos;s model calls it at
            the right moments depends on the description: try a few requests from the client.
          </QualityNote>
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Expose a workflow as an MCP tool</DialogTitle>
          <DialogDescription>
            MCP clients holding a token for this workflow can call the deployed version in the
            chosen environment.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <GuidedFlow
            steps={steps}
            status={
              <DraftStatus
                dirty={kept.dirty}
                restored={kept.restored}
                onDiscard={() => {
                  kept.discard();
                  create.reset();
                }}
                what="the tool"
              />
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={create.isPending}
            disabled={!ready}
            onClick={() => create.mutate(draft)}
          >
            Expose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenDialog({
  open,
  onOpenChange,
  workflows,
  exposures,
  preset,
  onMinted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workflows: WorkflowSummary[];
  exposures: readonly McpExposure[];
  /** the workflow and environment just exposed */
  preset: { workflowId: string; environmentId: string } | null;
  onMinted: (key: CreatedKey) => void;
}) {
  const s = useSession();
  const [name, setName] = useState("");
  const [environmentId, setEnvironmentId] = useState(
    preset?.environmentId ?? s.environments[0]?.id ?? "",
  );
  const [picked, setPicked] = useState<string[]>(preset ? [preset.workflowId] : []);
  const mint = useMutate(
    (body: Record<string, unknown>) => post<CreatedKey>("/v1/mcp/tokens", body),
    {
      invalidate: [["api-keys", s.ws]],
      errorTitle: "Could not mint the token",
      onSuccess: (k) => {
        onOpenChange(false);
        setName("");
        setPicked([]);
        onMinted(k);
      },
    },
  );
  const env = s.environments.find((e) => e.id === environmentId);
  const toolless = picked.filter(
    (id) =>
      !exposures.some((e) => e.workflowId === id && e.environmentId === environmentId && e.enabled),
  );
  const checks: Check[] = [
    picked.length === 0
      ? { id: "picked", label: "Pick the workflows this client may call", state: "blocker" }
      : toolless.length
        ? {
            id: "picked",
            label: `No tool in ${env?.name ?? "this environment"} for ${toolless
              .map((id) => workflows.find((w) => w.id === id)?.name ?? id.slice(0, 8))
              .join(", ")}`,
            state: "warning",
            detail:
              "The client sees nothing from a workflow until it is exposed in this environment.",
          }
        : {
            id: "picked",
            label: `Every picked workflow has a tool in ${env?.name ?? "it"}`,
            state: "ok",
          },
    {
      id: "once",
      label: "The token is shown once and expires in a year",
      state: "info",
      detail: "It is listed under Settings, API keys, where you can revoke it.",
    },
  ];
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
              A key for one client that can only list and call the exposed tools of the workflows
              you pick, in one environment (scope <code className="font-mono">mcp:serve</code>).
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow
              label="Name"
              htmlFor="tok-name"
              required
              hint="The client that will hold it, e.g. claude-desktop. One token per client lets you revoke one alone."
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
            <CheckList checks={checks} aria-label="Before you mint it" />
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

/**
 * An exposure's On/Off switch. Deployments leave it as set (switching makes the exposure the
 * person's, even one a version declared), so this is how a switched-off tool comes back. The row
 * changes at once and goes back if the server refuses.
 */
function ExposureSwitch({ exposure, disabled }: { exposure: McpExposure; disabled: boolean }) {
  const s = useSession();
  const qc = useQueryClient();
  const id = useId();
  const listKey = ["mcp-exposures", s.ws];
  const change = useMutation({
    mutationFn: (next: boolean) =>
      patch<McpExposure>(`/v1/mcp/exposures/${exposure.id}`, { enabled: next }),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: listKey, exact: true });
      const before = qc.getQueryData<McpExposure[]>(listKey);
      qc.setQueryData<McpExposure[]>(listKey, (rows) =>
        rows?.map((e) => (e.id === exposure.id ? { ...e, enabled: next } : e)),
      );
      return { before };
    },
    onError: (e, next, saved) => {
      qc.setQueryData(listKey, saved?.before);
      toast.error(`Could not switch ${exposure.toolName} ${next ? "on" : "off"}`, {
        description: errorMessage(e),
      });
    },
    onSuccess: (e) =>
      toast.success(
        e.enabled
          ? e.deployed === false
            ? `${e.toolName} is on: clients see it once a version is deployed`
            : `${e.toolName} is on: clients can list and call it`
          : `${e.toolName} is off: clients no longer see it`,
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: listKey }),
  });
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch
        id={id}
        size="sm"
        checked={exposure.enabled}
        disabled={disabled || change.isPending}
        onCheckedChange={(v) => change.mutate(v)}
        aria-label={`Expose ${exposure.toolName}`}
      />
      <label htmlFor={id} className="cursor-pointer text-xs text-ink-2">
        {exposure.enabled ? "On" : "Off"}
      </label>
    </div>
  );
}

export function ExposuresSection() {
  const s = useSession();
  const canWrite = s.can("mcp:write");
  const canMint = s.can("api_keys:manage");
  const [exposing, setExposing] = useState(false);
  const [minting, setMinting] = useState<{
    preset: { workflowId: string; environmentId: string } | null;
  } | null>(null);
  const [minted, setMinted] = useState<CreatedKey | null>(null);
  const confirm = useConfirm<McpExposure>();
  const exposures = useQuery({
    queryKey: ["mcp-exposures", s.ws],
    queryFn: () => getAll<McpExposure>("/v1/mcp/exposures"),
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
            <Button onClick={() => setMinting({ preset: null })} disabled={!workflows.data}>
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
            <div className="flex flex-col gap-2 text-xs text-ink-2">
              <p className="text-ink-3">
                No workflow is exposed yet. MCP clients (desktop assistants, IDE agents) can call a
                deployed workflow as a tool, with its input schema as the tool&apos;s arguments.
              </p>
              <ol className="flex list-decimal flex-col gap-1 pl-4">
                <li>
                  <span className="font-medium text-ink">Expose workflow</span>: pick a deployed
                  workflow, its environment and a tool name.
                </li>
                <li>
                  <span className="font-medium text-ink">Mint token</span>: a key limited to the
                  tools you choose, shown once.
                </li>
                <li>
                  Give your MCP client the endpoint above, with the token as a{" "}
                  <code className="font-mono">Bearer</code> authorization header.
                </li>
              </ol>
            </div>
          ) : (
            <ul
              className="flex flex-col divide-y divide-border rounded-md border border-border"
              role="list"
            >
              {rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink">{e.toolName}</span>
                      {e.enabled && e.deployed === false ? (
                        <Badge tone="neutral">Waiting for a deployment</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-2xs text-ink-3">{e.description}</p>
                    {!e.enabled ? (
                      <p className="text-2xs text-warn-text">
                        Clients do not see it.{" "}
                        {e.source === "trigger"
                          ? "The deployed version no longer declares it; switch it on to keep it whatever later versions declare."
                          : "Switch it on to expose it again; deployments leave the switch as you set it."}
                      </p>
                    ) : e.deployed === false ? (
                      <p className="text-2xs text-ink-3">
                        Clients see it once a version is deployed to {envName(e.environmentId)}.
                      </p>
                    ) : null}
                  </div>
                  <ExposureSwitch exposure={e} disabled={!canWrite} />
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
      {workflows.data && exposing ? (
        <ExposeDialog
          open={exposing}
          onOpenChange={setExposing}
          workflows={workflows.data}
          exposures={exposures.data ?? []}
          onExposed={(preset) => setMinting({ preset })}
        />
      ) : null}
      {workflows.data && minting ? (
        <TokenDialog
          open
          onOpenChange={(o) => (o ? undefined : setMinting(null))}
          workflows={workflows.data}
          exposures={exposures.data ?? []}
          preset={minting.preset}
          onMinted={setMinted}
        />
      ) : null}
      <OneTimeSecretDialog
        secret={minted?.key ?? null}
        title="MCP token created"
        description="Copy it into your client now: it cannot be shown again. If it is lost, mint a new one and revoke this one under Settings, API keys."
        onClose={() => setMinted(null)}
        extra={
          minted ? (
            <div className="flex flex-col gap-1.5">
              <TryToken endpoint={endpoint} token={minted.key} />
              <p className="text-xs text-ink-2">
                Client configuration (Streamable HTTP). Put the token in place of{" "}
                <code className="font-mono">&lt;token&gt;</code>:
              </p>
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
