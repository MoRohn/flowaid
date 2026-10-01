"use client";
/**
 * Connect an MCP server, step by step (or all at once): where it runs, how FlowAId signs in, then
 * a review. The review can test the settings before anything is saved (`POST /v1/mcp/servers/test`
 * stores nothing; the worker starts a stdio program for it). Saving ends on explicit Test and
 * Discover buttons rather than calling the server on its own. The unsent draft is kept in this
 * browser tab (it holds a credential's id, never its value).
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Radar, Zap } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Input,
  RadioGroup,
  RadioItem,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { getAll, post } from "~/api/client";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import type { Credential, McpDiscovery, McpServer } from "../types";
import { Notice, useMutate } from "../ui";
import {
  emptyServer,
  isPrivateUrl,
  serverBody,
  serverNotes,
  serverProblems,
  type McpServerDraft,
} from "./guide";

const TRANSPORTS: readonly { id: McpServerDraft["transport"]; label: string; detail: string }[] = [
  {
    id: "streamable_http",
    label: "Streamable HTTP",
    detail: "The current MCP transport: the server has an https address, usually ending in /mcp.",
  },
  {
    id: "sse",
    label: "SSE",
    detail:
      "The older HTTP transport with server-sent events. Only for servers that offer nothing newer.",
  },
  {
    id: "stdio",
    label: "stdio (a local program)",
    detail:
      "The worker starts a program on this computer. Admins only, and the server must allow it.",
  },
];

const AUTH: readonly {
  id: McpServerDraft["authKind"];
  label: string;
  detail: string;
  types: readonly string[];
}[] = [
  {
    id: "none",
    label: "No sign-in",
    detail: "For public servers and servers on your own computer.",
    types: [],
  },
  {
    id: "headers",
    label: "A key or headers from a credential",
    detail:
      "Store the key as a “Bearer token” or “MCP server headers” credential; FlowAId sends it with every request.",
    types: ["http.bearer", "mcp.headers"],
  },
  {
    id: "oauth2",
    label: "OAuth tokens from a credential",
    detail:
      "For servers that issue OAuth 2.1 tokens: store them as an “MCP OAuth token” credential; the worker refreshes them.",
    types: ["mcp.oauth"],
  },
];

type Outcome =
  { kind: "test"; ok: boolean; message?: string } | { kind: "discover"; result: McpDiscovery };

interface TestAnswer {
  ok: boolean;
  message?: string;
  server?: { name: string; version: string } | null;
  toolCount?: number;
}

/** What to try when a server did not answer. */
function testFix(transport: McpServerDraft["transport"], url: string): string {
  if (transport === "stdio")
    return "Check the command and its arguments against FLOWAID_MCP_STDIO_ALLOWED_COMMANDS, and that the worker is running: it starts the program.";
  return isPrivateUrl(url)
    ? "If it runs on this computer, the api needs FLOWAID_ALLOW_PRIVATE_NETWORK=true."
    : "Check the address and the credential, then test again.";
}

export function McpServerDialog({
  open,
  onOpenChange,
  onDiscovered,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** shows the discovered tools in the page's dialog */
  onDiscovered: (server: string, result: McpDiscovery) => void;
}) {
  const s = useSession();
  const kept = useKeptDraft<McpServerDraft>(`flowaid:draft:${s.ws}:mcp-server`, emptyServer);
  const { draft, setDraft } = kept;
  const set = <K extends keyof McpServerDraft>(k: K, v: McpServerDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const [shown, setShown] = useState(false);
  const [created, setCreated] = useState<McpServer | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const canReadCreds = s.can("credentials:read");
  const creds = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    enabled: open && canReadCreds,
  });
  const problems = serverProblems(draft);
  const errors = shown ? problems : {};
  const notes = serverNotes(draft, { admin: s.can("admin") });
  const blocked = Object.keys(problems).length > 0 || notes.some((n) => n.state === "blocker");
  const invalidate = [
    ["mcp-servers", s.ws],
    ["catalog", "tools"],
  ];
  const create = useMutate(
    (body: Record<string, unknown>) => post<McpServer>("/v1/mcp/servers", body),
    {
      success: (m) => `Saved ${m.name}`,
      invalidate: [["mcp-servers", s.ws]],
      errorTitle: "Could not save the server",
      onSuccess: (m) => {
        kept.discard();
        setShown(false);
        setCreated(m);
      },
    },
  );
  // Testing the unsaved settings: the answer belongs to the settings it was given.
  const body = serverBody(draft);
  const bodyKey = JSON.stringify(body);
  const [tried, setTried] = useState<{ key: string; answer: TestAnswer } | null>(null);
  const tryIt = useMutate(
    (b: Record<string, unknown>) =>
      post<TestAnswer>("/v1/mcp/servers/test", b.name ? b : { ...b, name: undefined }),
    {
      onSuccess: (answer, b) => setTried({ key: JSON.stringify(b), answer }),
      errorTitle: "The test did not run",
    },
  );
  const triedNow = tried?.key === bodyKey ? tried.answer : null;
  const test = useMutate(
    (m: McpServer) => post<{ ok: boolean; message?: string }>(`/v1/mcp/servers/${m.id}/test`),
    {
      invalidate,
      onSuccess: (r) =>
        setOutcome({ kind: "test", ok: r.ok, ...(r.message ? { message: r.message } : {}) }),
      errorTitle: "The test did not run",
    },
  );
  const discover = useMutate(
    (m: McpServer) => post<McpDiscovery>(`/v1/mcp/servers/${m.id}/discover`),
    {
      invalidate,
      onSuccess: (r) => setOutcome({ kind: "discover", result: r }),
      errorTitle: "Discovery failed",
    },
  );

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCreated(null);
      setOutcome(null);
    }
  };

  if (created) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {created.name} is saved
            </DialogTitle>
            <DialogDescription>
              {created.transport === "stdio"
                ? "Discover its tools now: only discovered tools can be used. The worker starts the program for the test and for discovery, and again when a workflow calls one of its tools."
                : "Test that FlowAId can reach it, then discover its tools: only discovered tools can be used."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                leadingIcon={<Zap strokeWidth={1.75} />}
                loading={test.isPending}
                onClick={() => test.mutate(created)}
              >
                Test connection
              </Button>
              <Button
                variant="primary"
                leadingIcon={<Radar strokeWidth={1.75} />}
                loading={discover.isPending}
                onClick={() => discover.mutate(created)}
              >
                Discover tools
              </Button>
            </div>
            {outcome?.kind === "test" ? (
              outcome.ok ? (
                <CheckList
                  aria-label="Test result"
                  checks={[{ id: "test", label: `${created.name} answered`, state: "ok" }]}
                />
              ) : (
                <CheckList
                  aria-label="Test result"
                  checks={[
                    {
                      id: "test",
                      label: `${created.name} did not answer`,
                      state: "blocker",
                      detail: outcome.message,
                      fix: `${testFix(created.transport, created.url ?? "")} The server stays saved.`,
                    },
                  ]}
                />
              )
            ) : outcome?.kind === "discover" ? (
              <CheckList
                aria-label="Discovery result"
                checks={[
                  {
                    id: "discover",
                    label: `${outcome.result.tools.length} tool${outcome.result.tools.length === 1 ? "" : "s"} found`,
                    state: outcome.result.tools.length ? "ok" : "warning",
                    detail: outcome.result.tools.length
                      ? "They now appear in agents' tool lists and in the MCP tool step's tool choice."
                      : "The server offered none, or the tool policy excluded them all.",
                  },
                ]}
              />
            ) : null}
            {outcome?.kind === "discover" && outcome.result.tools.length ? (
              <Button
                variant="link"
                size="sm"
                className="self-start"
                onClick={() => onDiscovered(created.name, outcome.result)}
              >
                See the tools
              </Button>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Done
            </Button>
            {outcome?.kind === "discover" && outcome.result.tools.length ? (
              <Button asChild variant="primary">
                <Link href={`/${s.ws}/agents`}>Give them to an agent</Link>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const auth = AUTH.find((a) => a.id === draft.authKind) ?? AUTH[0];
  const fitting = (creds.data ?? []).filter((c) => auth?.types.includes(c.type));
  const others = (creds.data ?? []).filter((c) => !auth?.types.includes(c.type));
  const reviewChecks: Check[] = [
    ...Object.values(problems).map((m, i): Check => ({ id: `p${i}`, label: m, state: "blocker" })),
    ...(Object.keys(problems).length
      ? []
      : [
          {
            id: "valid",
            label: "Every required setting is filled in",
            state: "ok",
          } satisfies Check,
        ]),
    ...notes.map((n): Check => ({ id: n.id, label: n.message, state: n.state })),
  ];

  const steps: FlowStep[] = [
    {
      id: "where",
      title: "Say where it runs",
      why: "The name is how steps and agents refer to its tools, so keep it short. The address comes from the server's own instructions.",
      done: !problems.name && !problems.url && !problems.command,
      requirement: "fill in the name and the address",
      example: (
        <>
          <strong className="font-medium text-ink">github</strong> at{" "}
          <code className="font-mono">https://mcp.example.com/mcp</code>. A server on this computer
          looks like <code className="font-mono">http://localhost:8931/mcp</code>.
        </>
      ),
      children: (
        <>
          <FieldRow label="Name" htmlFor="mcp-name" required error={errors.name}>
            <Input
              id="mcp-name"
              value={draft.name}
              maxLength={100}
              onChange={(e) => set("name", e.target.value)}
              placeholder="github"
            />
          </FieldRow>
          <RadioGroup
            aria-label="Transport"
            value={draft.transport}
            onValueChange={(v) => set("transport", v as McpServerDraft["transport"])}
          >
            {TRANSPORTS.map((t) => (
              <RadioItem key={t.id} value={t.id} label={t.label} description={t.detail} />
            ))}
          </RadioGroup>
          {draft.transport !== "stdio" ? (
            <FieldRow label="URL" htmlFor="mcp-url" required error={errors.url}>
              <Input
                id="mcp-url"
                type="url"
                className="font-mono"
                value={draft.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://mcp.example.com/mcp"
              />
            </FieldRow>
          ) : (
            <>
              <FieldRow
                label="Command"
                htmlFor="mcp-command"
                required
                error={errors.command}
                hint="The full path of the program, as listed in FLOWAID_MCP_STDIO_ALLOWED_COMMANDS"
              >
                <Input
                  id="mcp-command"
                  className="font-mono"
                  value={draft.command}
                  onChange={(e) => set("command", e.target.value)}
                  placeholder="/usr/local/bin/mcp-files"
                />
              </FieldRow>
              <FieldRow
                label="Arguments"
                htmlFor="mcp-args"
                hint="One per line. No keys here: they are stored as plain text."
              >
                <Textarea
                  id="mcp-args"
                  className="font-mono"
                  rows={3}
                  value={draft.args}
                  onChange={(e) => set("args", e.target.value)}
                />
              </FieldRow>
            </>
          )}
          {notes
            .filter((n) => n.id === "private" || n.id === "stdio")
            .map((n) => (
              <Notice key={n.id} tone={n.state === "blocker" ? "danger" : "info"}>
                {n.message}
              </Notice>
            ))}
        </>
      ),
    },
    {
      id: "auth",
      title: "Choose how FlowAId signs in",
      why: "Keys are never typed here: they live encrypted under Credentials, and the server entry points at one.",
      done: !problems.credentialId,
      requirement: "choose a credential",
      children: (
        <>
          <RadioGroup
            aria-label="Authentication"
            value={draft.authKind}
            onValueChange={(v) => set("authKind", v as McpServerDraft["authKind"])}
          >
            {AUTH.map((a) => (
              <RadioItem key={a.id} value={a.id} label={a.label} description={a.detail} />
            ))}
          </RadioGroup>
          {draft.authKind !== "none" ? (
            !canReadCreds ? (
              <Notice tone="info">
                Your role cannot list credentials. Ask someone who can to connect this server.
              </Notice>
            ) : (
              <FieldRow label="Credential" htmlFor="mcp-cred" required error={errors.credentialId}>
                <Select
                  id="mcp-cred"
                  value={draft.credentialId}
                  onValueChange={(v) => set("credentialId", v)}
                  placeholder={creds.isPending ? "Loading…" : "Choose a credential"}
                >
                  {[...fitting, ...others].map((c) => (
                    <SelectItem key={c.id} value={c.id} meta={c.type}>
                      {c.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
            )
          ) : null}
          {draft.authKind !== "none" && canReadCreds && creds.data && fitting.length === 0 ? (
            <p className="m-0 text-xs text-ink-3">
              No {auth?.types.join(" or ")} credential yet.{" "}
              <Link className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
                Add one under Credentials
              </Link>
              ; this draft is kept in this tab until you come back.
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: "review",
      doneLabel: "Ready to save",
      title: "Review and save",
      why: "Test the settings first if you like: nothing is stored until you save. Then discover its tools; workflows and agents can use a tool only after discovery.",
      done: !blocked,
      requirement: "fix the items marked as needed",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Name</dt>
            <dd className="m-0 text-ink">{draft.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Runs</dt>
            <dd className="m-0 truncate font-mono text-xs text-ink">
              {draft.transport === "stdio" ? draft.command || "—" : draft.url || "—"}
            </dd>
            <dt className="text-ink-3">Signs in</dt>
            <dd className="m-0 text-ink">
              {auth?.label}
              {draft.credentialId
                ? ` (${creds.data?.find((c) => c.id === draft.credentialId)?.name ?? "credential"})`
                : ""}
            </dd>
          </dl>
          <CheckList checks={reviewChecks} aria-label="Before you save" />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leadingIcon={<Zap strokeWidth={1.75} />}
              loading={tryIt.isPending}
              disabled={blocked}
              onClick={() => tryIt.mutate(body)}
            >
              Test connection
            </Button>
            <span className="text-xs text-ink-3">
              {draft.transport === "stdio"
                ? "Optional. The worker starts the program once to check it answers; nothing is saved."
                : "Optional. Checks the server answers with these settings; nothing is saved."}
            </span>
          </div>
          {triedNow ? (
            <CheckList
              aria-label="Test result"
              checks={[
                triedNow.ok
                  ? {
                      id: "try",
                      label: `${draft.name.trim() || "The server"} answered${
                        triedNow.toolCount !== undefined
                          ? ` and lists ${triedNow.toolCount} tool${triedNow.toolCount === 1 ? "" : "s"}`
                          : ""
                      }`,
                      state: "ok",
                      detail: "Save it, then discover its tools to use them.",
                    }
                  : {
                      id: "try",
                      label: `${draft.name.trim() || "The server"} did not answer`,
                      state: "blocker",
                      detail: triedNow.message,
                      fix: `${testFix(draft.transport, draft.url)} You can still save it and test it later.`,
                    },
              ]}
            />
          ) : null}
          {create.isError ? (
            <Notice tone="danger">
              Not saved: {create.error.message} Your settings are kept; fix them and save again.
            </Notice>
          ) : null}
          <QualityNote>
            These checks confirm the entry can be saved. Test connection shows whether the server
            answers; which tools it offers shows when you discover them after saving.
          </QualityNote>
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Connect an MCP server</DialogTitle>
          <DialogDescription>
            Its tools become available to MCP steps and agents once discovered.
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
                  setShown(false);
                  create.reset();
                }}
                what="the server"
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
            onClick={() => {
              setShown(true);
              if (!blocked) create.mutate(serverBody(draft));
            }}
          >
            Save server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
