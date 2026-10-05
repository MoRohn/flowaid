"use client";
/**
 * OpenAPI toolsets: read a document (URL or pasted), pick operations, point at the server and
 * credential, review, import (step by step or all at once); list, inspect (operations, source),
 * rename, change the credential, and delete.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, FileCode2, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
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
  ToggleGroup,
  ToggleGroupItem,
} from "@flowaid/ui/primitives";
import { CodeEditor } from "@flowaid/ui/forms";
import { RelativeTime } from "@flowaid/ui/data";
import { del, getAll, patch, post } from "~/api/client";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import type { Credential, OpenApiPreview, Tool } from "../types";
import { Notice, QueryView, Section, useConfirm, useMutate } from "../ui";
import { importNotes, isPrivateUrl, toolsetName } from "./guide";

const NO_CREDENTIAL = "__none";

const METHOD_TONE: Record<string, "ok" | "accent" | "warn" | "danger" | "neutral"> = {
  get: "ok",
  post: "accent",
  put: "warn",
  patch: "warn",
  delete: "danger",
};

interface ImportDraft {
  source: "url" | "paste";
  url: string;
  text: string;
  name: string;
  serverUrl: string;
  credentialId: string;
  /** chosen operations; null until a preview picks all of them */
  include: string[] | null;
}

const emptyImport = (): ImportDraft => ({
  source: "url",
  url: "",
  text: "",
  name: "",
  serverUrl: "",
  credentialId: NO_CREDENTIAL,
  include: null,
});

/** Pasted documents stay out of the tab's storage when they are large. */
const keepable = (d: ImportDraft) => (d.text.length > 200_000 ? { ...d, text: "" } : d);

/**
 * Import an OpenAPI document step by step: read (preview) it, choose operations, point at the
 * server and credential, review, import. Nothing is saved until Import; the preview only reads
 * the document.
 */
function ImportDialog({
  open,
  onOpenChange,
  taken,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** toolset names already in the workspace */
  taken: readonly string[];
}) {
  const s = useSession();
  const kept = useKeptDraft<ImportDraft>(`flowaid:draft:${s.ws}:openapi`, emptyImport, keepable);
  const { draft, setDraft } = kept;
  const set = <K extends keyof ImportDraft>(k: K, v: ImportDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const [preview, setPreview] = useState<{ of: string; doc: OpenApiPreview } | null>(null);
  const [imported, setImported] = useState<(Tool & { skipped?: unknown[] }) | null>(null);
  const canReadCreds = s.can("credentials:read");
  const creds = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    enabled: open && canReadCreds,
  });
  const body = () =>
    draft.source === "url"
      ? { url: draft.url.trim() }
      : {
          document: draft.text,
          format: draft.text.trim().startsWith("{") ? ("json" as const) : ("yaml" as const),
        };
  const sourceKey = JSON.stringify(body());
  const doc = preview && preview.of === sourceKey ? preview.doc : null;
  const stale = preview !== null && doc === null;
  const include = doc ? (draft.include ?? doc.operations.map((o) => o.name)) : [];
  const runPreview = useMutate(() => post<OpenApiPreview>("/v1/tools/openapi/preview", body()), {
    errorTitle: "Could not read the document",
    onSuccess: (p) => {
      setPreview({ of: sourceKey, doc: p });
      const names = new Set(p.operations.map((o) => o.name));
      setDraft((d) => ({
        ...d,
        // a restored choice survives when it still fits the document
        include: d.include && d.include.every((n) => names.has(n)) ? d.include : null,
        name: d.name || toolsetName(p.title),
        serverUrl:
          d.serverUrl && (p.servers.length === 0 || p.servers.includes(d.serverUrl))
            ? d.serverUrl
            : (p.servers[0] ?? d.serverUrl),
      }));
    },
  });
  const runImport = useMutate(
    () =>
      post<Tool & { skipped?: unknown[] }>("/v1/tools/openapi/import", {
        ...body(),
        name: draft.name.trim(),
        ...(draft.serverUrl.trim() ? { serverUrl: draft.serverUrl.trim() } : {}),
        ...(doc && include.length !== doc.operations.length ? { include } : {}),
        ...(draft.credentialId !== NO_CREDENTIAL ? { credentialId: draft.credentialId } : {}),
      }),
    {
      success: (t) => `Imported ${t.definitions.length} operations as ${t.name}`,
      invalidate: [
        ["tools", s.ws],
        ["catalog", "tools"],
      ],
      errorTitle: "Could not import the document",
      onSuccess: (t) => {
        kept.discard();
        setPreview(null);
        setImported(t);
      },
    },
  );
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setImported(null);
  };
  const sourceReady =
    draft.source === "url"
      ? /^https?:\/\/\S+$/.test(draft.url.trim())
      : draft.text.trim().length > 0;
  const notes = doc
    ? importNotes({
        authSchemes: doc.authSchemes,
        credentialId: draft.credentialId === NO_CREDENTIAL ? "" : draft.credentialId,
        serverUrl: draft.serverUrl,
        operations: doc.operations,
        include,
        taken,
        name: draft.name,
      })
    : [];
  const blocked = !doc || notes.some((n) => n.state === "blocker");
  const allOn = doc !== null && include.length === doc.operations.length;

  if (imported)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {imported.name}: {imported.definitions.length} operations imported
            </DialogTitle>
            <DialogDescription>
              Each operation is now a typed tool. Nothing has called the API yet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>
                In a workflow, add an OpenAPI step, choose {imported.name} as its toolset and the
                operation to call.
              </li>
              <li>
                Or give the operations to an agent under Agents, with approval for any that change
                data.
              </li>
              <li>Run the draft once and read the call in the trace before relying on it.</li>
            </ol>
            {imported.skipped?.length ? (
              <p className="mt-2 text-xs text-ink-3">
                {imported.skipped.length} operation(s) were noted while importing (for example
                deprecated ones).
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Done
            </Button>
            <Button asChild variant="primary">
              <Link href={`/${s.ws}/agents`}>Open Agents</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  const steps: FlowStep[] = [
    {
      id: "document",
      title: "Read the document",
      why: "An OpenAPI 3 document describes the API's operations. Give its address or paste it, then read it: nothing is saved, and the list of operations comes next.",
      done: doc !== null,
      requirement: "read a document",
      example: (
        <>
          Many APIs publish it at an address such as{" "}
          <code className="font-mono">https://api.example.com/openapi.json</code>; look for
          “OpenAPI” or “Swagger” in the API&apos;s documentation.
        </>
      ),
      children: (
        <>
          <ToggleGroup
            type="single"
            value={draft.source}
            onValueChange={(v) => v && set("source", v as ImportDraft["source"])}
            aria-label="Source"
          >
            <ToggleGroupItem value="url">From URL</ToggleGroupItem>
            <ToggleGroupItem value="paste">Paste JSON or YAML</ToggleGroupItem>
          </ToggleGroup>
          {draft.source === "url" ? (
            <FieldRow label="Document URL" htmlFor="oa-url" required>
              <Input
                id="oa-url"
                type="url"
                className="font-mono"
                placeholder="https://api.example.com/openapi.json"
                value={draft.url}
                onChange={(e) => set("url", e.target.value)}
              />
            </FieldRow>
          ) : (
            <FieldRow label="Document" htmlFor="oa-doc" required>
              <CodeEditor
                id="oa-doc"
                language={draft.text.trim().startsWith("{") ? "json" : "yaml"}
                value={draft.text}
                onChange={(v) => set("text", v)}
                minRows={10}
                maxRows={20}
                aria-label="OpenAPI document"
              />
            </FieldRow>
          )}
          {draft.source === "url" && isPrivateUrl(draft.url) ? (
            <Notice tone="info">
              This address is on this computer or your network. The api reads it only with
              FLOWAID_ALLOW_PRIVATE_NETWORK=true; otherwise paste the document instead.
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={doc ? "secondary" : "primary"}
              loading={runPreview.isPending}
              disabled={!sourceReady}
              onClick={() => runPreview.mutate(undefined)}
            >
              {doc ? "Read it again" : "Read the document"}
            </Button>
            {doc ? (
              <span className="text-xs text-ink-2" role="status">
                {doc.title} <span className="font-mono text-ink-3">OpenAPI {doc.version}</span>:{" "}
                {doc.operations.length} operations
              </span>
            ) : stale ? (
              <span className="text-xs text-warn-text" role="status">
                The document changed since it was read: read it again.
              </span>
            ) : null}
          </div>
          {runPreview.isError ? <Notice tone="danger">{runPreview.error.message}</Notice> : null}
          {doc && doc.warnings.length > 0 ? (
            <Notice>
              {doc.warnings.length} warning(s) while reading; unsupported operations are skipped.
            </Notice>
          ) : null}
        </>
      ),
    },
    {
      id: "operations",
      title: "Choose the operations",
      why: "Each chosen operation becomes a tool. Import only what workflows and agents need: fewer tools are easier for an agent to choose between, and read-only ones are safer.",
      done: doc !== null && include.length > 0,
      requirement: doc ? "choose at least one operation" : "read the document first",
      children: doc ? (
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-ink">
            <span>
              Operations ({include.length} of {doc.operations.length})
            </span>
            <Button
              variant="link"
              size="sm"
              type="button"
              onClick={() => set("include", allOn ? [] : doc.operations.map((o) => o.name))}
            >
              {allOn ? "Select none" : "Select all"}
            </Button>
          </legend>
          <ul
            className="flex max-h-[45vh] flex-col divide-y divide-border overflow-auto rounded-md border border-border"
            role="list"
          >
            {doc.operations.map((o) => (
              <li key={o.name} className="flex items-center gap-2 px-3 py-1.5">
                <Checkbox
                  aria-label={o.name}
                  checked={include.includes(o.name)}
                  onCheckedChange={(c) =>
                    set(
                      "include",
                      c === true ? [...include, o.name] : include.filter((x) => x !== o.name),
                    )
                  }
                />
                <Badge
                  tone={METHOD_TONE[(o.method ?? "").toLowerCase()] ?? "neutral"}
                  mono
                  className="w-14 justify-center uppercase"
                >
                  {o.method ?? "?"}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-ink">{o.path}</span>
                  {o.summary ? (
                    <span className="block truncate text-2xs text-ink-3">{o.summary}</span>
                  ) : null}
                </span>
                <span className="hidden shrink-0 font-mono text-2xs text-ink-3 sm:inline">
                  {o.name}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="m-0 text-sm text-ink-3">Read the document first; its operations show here.</p>
      ),
    },
    {
      id: "connect",
      title: "Name it and point at the API",
      why: "The toolset name is what steps show when you pick an operation. The server is the address calls go to, and the credential is how they sign in; keys live encrypted under Credentials.",
      done: doc !== null && !notes.some((n) => n.state === "blocker" && n.id === "name"),
      requirement: doc ? "give the toolset a free name" : "read the document first",
      example: doc
        ? Object.keys(doc.authSchemes).length > 0
          ? `The API declares ${Object.keys(doc.authSchemes).join(", ")} authentication. Store its key as a Bearer token, API key, header, basic or OAuth client-credentials credential.`
          : "The API declares no authentication; a public API works without a credential."
        : undefined,
      children: doc ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Toolset name" htmlFor="oa-name" required>
              <Input
                id="oa-name"
                value={draft.name}
                maxLength={100}
                onChange={(e) => set("name", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Server" htmlFor="oa-server">
              {doc.servers.length > 0 ? (
                <Select
                  id="oa-server"
                  value={draft.serverUrl}
                  onValueChange={(v) => set("serverUrl", v)}
                  mono
                >
                  {doc.servers.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </Select>
              ) : (
                <Input
                  id="oa-server"
                  type="url"
                  className="font-mono"
                  value={draft.serverUrl}
                  onChange={(e) => set("serverUrl", e.target.value)}
                  placeholder="https://api.example.com"
                />
              )}
            </FieldRow>
          </div>
          <FieldRow
            label="Credential"
            htmlFor="oa-cred"
            hint={
              canReadCreds
                ? undefined
                : "Your role cannot list credentials; import without one or ask someone who can."
            }
          >
            <Select
              id="oa-cred"
              value={draft.credentialId}
              onValueChange={(v) => set("credentialId", v)}
            >
              <SelectItem value={NO_CREDENTIAL}>No credential</SelectItem>
              {(creds.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id} meta={c.type}>
                  {c.name}
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
          {canReadCreds && creds.data?.length === 0 && Object.keys(doc.authSchemes).length ? (
            <p className="m-0 text-xs text-ink-3">
              No credentials yet.{" "}
              <Link className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
                Add the API&apos;s key under Credentials
              </Link>
              ; this draft is kept in this tab.
            </p>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-sm text-ink-3">Read the document first.</p>
      ),
    },
    {
      id: "review",
      doneLabel: "Ready to import",
      title: "Review and import",
      why: "Importing saves the chosen operations as tools. It does not call the API.",
      done: !blocked,
      requirement: "fix the items marked as needed",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Document</dt>
            <dd className="m-0 text-ink">
              {doc ? `${doc.title} (OpenAPI ${doc.version})` : "Not read yet"}
            </dd>
            <dt className="text-ink-3">Toolset</dt>
            <dd className="m-0 text-ink">{draft.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Operations</dt>
            <dd className="m-0 text-ink">
              {doc ? `${include.length} of ${doc.operations.length}` : "—"}
            </dd>
            <dt className="text-ink-3">Server</dt>
            <dd className="m-0 truncate font-mono text-xs text-ink">{draft.serverUrl || "—"}</dd>
            <dt className="text-ink-3">Credential</dt>
            <dd className="m-0 text-ink">
              {draft.credentialId === NO_CREDENTIAL
                ? "None"
                : (creds.data?.find((c) => c.id === draft.credentialId)?.name ?? "Chosen")}
            </dd>
          </dl>
          <CheckList
            aria-label="Before you import"
            checks={[
              ...(doc
                ? []
                : [
                    {
                      id: "doc",
                      label: "Read the document first",
                      state: "blocker",
                    } satisfies Check,
                  ]),
              ...notes.map((n): Check => ({ id: n.id, label: n.message, state: n.state })),
              ...(doc && !blocked
                ? [{ id: "ready", label: "Ready to import", state: "ok" } satisfies Check]
                : []),
            ]}
          />
          {runImport.isError ? (
            <Notice tone="danger">
              Not imported: {runImport.error.message} Your choices are kept.
            </Notice>
          ) : null}
          <QualityNote>
            These checks confirm the document can be imported. Whether each call works (the right
            server, a key with enough access) shows only when a workflow calls it.
          </QualityNote>
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import an OpenAPI document</DialogTitle>
          <DialogDescription>
            Each operation becomes a typed tool for OpenAPI steps and agents. Mutating operations
            keep their idempotency class.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[75vh] overflow-auto">
          <GuidedFlow
            steps={steps}
            status={
              <DraftStatus
                dirty={kept.dirty}
                restored={kept.restored}
                onDiscard={() => {
                  kept.discard();
                  setPreview(null);
                  runImport.reset();
                }}
                what="the toolset"
              />
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            Close
          </Button>
          <Button
            variant="primary"
            loading={runImport.isPending}
            disabled={blocked}
            onClick={() => runImport.mutate(undefined)}
          >
            {doc ? `Import ${include.length} operations` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What an imported toolset keeps about where it came from (`tools.source`). */
interface ToolsetSource {
  url?: string;
  serverUrl?: string | null;
  title?: string;
  operations?: Record<string, { method?: string; path?: string }>;
}

/**
 * One toolset: its operations (method, path, what each does), where it came from, and the two
 * things that can change after import, its name and its credential.
 */
function ToolsetDialog({ tool, onClose }: { tool: Tool | null; onClose: () => void }) {
  const s = useSession();
  const canWrite = s.can("tools:write");
  const [name, setName] = useState(tool?.name ?? "");
  const [credentialId, setCredentialId] = useState(tool?.credentialId ?? NO_CREDENTIAL);
  // another toolset opened: start from its saved values
  const [forId, setForId] = useState(tool?.id ?? null);
  if ((tool?.id ?? null) !== forId) {
    setForId(tool?.id ?? null);
    setName(tool?.name ?? "");
    setCredentialId(tool?.credentialId ?? NO_CREDENTIAL);
  }
  const creds = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    enabled: tool !== null && canWrite && s.can("credentials:read"),
  });
  const save = useMutate(
    (v: { id: string; body: Record<string, unknown> }) => patch<Tool>(`/v1/tools/${v.id}`, v.body),
    {
      success: (t) => `Saved ${t.name}`,
      invalidate: [
        ["tools", s.ws],
        ["catalog", "tools"],
      ],
      onSuccess: onClose,
      errorTitle: "Could not save the toolset",
    },
  );
  if (!tool) return null;
  const source = (tool.source ?? {}) as ToolsetSource;
  const body: Record<string, unknown> = {
    ...(name.trim() && name.trim() !== tool.name ? { name: name.trim() } : {}),
    ...((credentialId === NO_CREDENTIAL ? null : credentialId) !== tool.credentialId
      ? { credentialId: credentialId === NO_CREDENTIAL ? null : credentialId }
      : {}),
  };
  const changed = Object.keys(body).length > 0;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !save.isPending) onClose();
      }}
    >
      <DialogContent size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (changed && name.trim()) save.mutate({ id: tool.id, body });
          }}
        >
          <DialogHeader>
            <DialogTitle>{tool.name}</DialogTitle>
            <DialogDescription>
              {tool.definitions.length} operation{tool.definitions.length === 1 ? "" : "s"} imported
              {source.title ? ` from ${source.title}` : ""}, version {tool.version}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {canWrite ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldRow
                  label="Name"
                  htmlFor="toolset-name"
                  required
                  hint="Its operations keep their tool names, so workflows and agents keep working."
                  error={name.trim() ? undefined : "Give the toolset a name"}
                >
                  <Input
                    id="toolset-name"
                    value={name}
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FieldRow>
                <FieldRow
                  label="Credential"
                  htmlFor="toolset-cred"
                  hint="Sent with every call to the API; runs use the new one from now on."
                >
                  <Select id="toolset-cred" value={credentialId} onValueChange={setCredentialId}>
                    <SelectItem value={NO_CREDENTIAL}>No credential</SelectItem>
                    {(creds.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id} meta={c.type}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </Select>
                </FieldRow>
              </div>
            ) : null}
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-xs">
              <dt className="text-ink-3">Document</dt>
              <dd className="m-0 truncate font-mono text-ink">{source.url ?? "pasted text"}</dd>
              <dt className="text-ink-3">Server</dt>
              <dd className="m-0 truncate font-mono text-ink">{source.serverUrl ?? "—"}</dd>
            </dl>
            <ul
              className="m-0 flex max-h-80 list-none flex-col divide-y divide-border overflow-auto rounded-md border border-border p-0"
              aria-label="Operations"
            >
              {tool.definitions.map((d) => {
                const op = source.operations?.[d.name];
                return (
                  <li key={d.name} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {op?.method ? (
                        <Badge
                          mono
                          size="sm"
                          tone={METHOD_TONE[op.method.toLowerCase()] ?? "neutral"}
                        >
                          {op.method.toUpperCase()}
                        </Badge>
                      ) : null}
                      <span className="truncate font-mono text-xs text-ink">{d.name}</span>
                      {op?.path ? (
                        <span className="truncate font-mono text-2xs text-ink-3">{op.path}</span>
                      ) : null}
                    </span>
                    {d.description ? (
                      <span className="line-clamp-2 text-xs text-ink-3">{d.description}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              {canWrite ? "Cancel" : "Close"}
            </Button>
            {canWrite ? (
              <Button
                type="submit"
                variant="primary"
                loading={save.isPending}
                disabled={!changed || !name.trim()}
              >
                Save changes
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpenApiTab() {
  const s = useSession();
  const canWrite = s.can("tools:write");
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<Tool | null>(null);
  const confirm = useConfirm<Tool>();
  const tools = useQuery({ queryKey: ["tools", s.ws], queryFn: () => getAll<Tool>("/v1/tools") });
  const remove = useMutate((t: Tool) => del(`/v1/tools/${t.id}`), {
    success: (_, t) => `Deleted ${t.name}`,
    invalidate: [
      ["tools", s.ws],
      ["catalog", "tools"],
    ],
    onSuccess: confirm.close,
  });
  const button = canWrite ? (
    <Button
      variant="primary"
      leadingIcon={<Plus strokeWidth={1.75} />}
      onClick={() => setImporting(true)}
    >
      Import OpenAPI
    </Button>
  ) : null;
  return (
    <Section
      title="OpenAPI tools"
      description="REST APIs imported as typed tools: each operation can be called from an OpenAPI step or by an agent."
      actions={button}
    >
      <QueryView query={tools}>
        {(rows) => {
          const openapi = rows.filter((t) => t.kind === "openapi");
          return openapi.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<FileCode2 strokeWidth={1.5} />}
              title="No OpenAPI tools"
              description="Import an OpenAPI 3 document to call its operations from workflows. You need the document's address (or its text) and, if the API needs one, its key stored under Credentials."
              primaryAction={button ?? undefined}
            />
          ) : (
            <ul
              className="flex flex-col divide-y divide-border rounded-md border border-border"
              role="list"
            >
              {openapi.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{t.name}</p>
                    <p className="truncate text-2xs text-ink-3">
                      {t.definitions
                        .slice(0, 6)
                        .map((d) => d.name)
                        .join(" · ")}
                      {t.definitions.length > 6 ? ` · +${t.definitions.length - 6}` : ""}
                    </p>
                  </div>
                  <Badge mono>{t.definitions.length} ops</Badge>
                  <span className="text-2xs text-ink-3">
                    v{t.version} · <RelativeTime date={t.updatedAt} />
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Details of ${t.name}`}
                    onClick={() => setOpen(t)}
                  >
                    Details
                  </Button>
                  {canWrite ? (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Delete ${t.name}`}
                      onClick={() => confirm.ask(t)}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          );
        }}
      </QueryView>
      {importing ? (
        <ImportDialog
          open={importing}
          onOpenChange={setImporting}
          taken={(tools.data ?? []).map((t) => t.name)}
        />
      ) : null}
      <ToolsetDialog tool={open} onClose={() => setOpen(null)} />
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Delete ${confirm.target?.name ?? "toolset"}?`}
        description="Workflows and agents that call its operations fail validation until the document is imported again under the same name."
        variant="danger"
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </Section>
  );
}
