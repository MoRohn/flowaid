"use client";
/** OpenAPI toolsets: preview a document (URL or pasted), pick operations, import; list and delete. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileCode2, Plus, Trash2 } from "lucide-react";
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
import { del, get, post } from "~/api/client";
import { useSession } from "~/session";
import type { Credential, OpenApiPreview, Tool } from "../types";
import { Notice, QueryView, Section, useConfirm, useMutate } from "../ui";

const NO_CREDENTIAL = "__none";

const METHOD_TONE: Record<string, "ok" | "accent" | "warn" | "danger" | "neutral"> = {
  get: "ok",
  post: "accent",
  put: "warn",
  patch: "warn",
  delete: "danger",
};

function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const s = useSession();
  const [source, setSource] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<OpenApiPreview | null>(null);
  const [include, setInclude] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [credentialId, setCredentialId] = useState(NO_CREDENTIAL);
  const creds = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => get<Credential[]>("/v1/credentials"),
    enabled: open && preview !== null && s.can("credentials:read"),
  });
  const body = () =>
    source === "url"
      ? { url: url.trim() }
      : {
          document: text,
          format: text.trim().startsWith("{") ? ("json" as const) : ("yaml" as const),
        };
  const reset = () => {
    setPreview(null);
    setInclude([]);
    setName("");
    setServerUrl("");
    setCredentialId(NO_CREDENTIAL);
  };
  const runPreview = useMutate(() => post<OpenApiPreview>("/v1/tools/openapi/preview", body()), {
    errorTitle: "Could not read the document",
    onSuccess: (p) => {
      setPreview(p);
      setInclude(p.operations.map((o) => o.name));
      setName(
        p.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60) || "api",
      );
      setServerUrl(p.servers[0] ?? "");
    },
  });
  const runImport = useMutate(
    () =>
      post<Tool>("/v1/tools/openapi/import", {
        ...body(),
        name: name.trim(),
        ...(serverUrl ? { serverUrl } : {}),
        ...(include.length !== preview?.operations.length ? { include } : {}),
        ...(credentialId !== NO_CREDENTIAL ? { credentialId } : {}),
      }),
    {
      success: (t) => `Imported ${t.definitions.length} operations as ${t.name}`,
      invalidate: [
        ["tools", s.ws],
        ["tools-catalog", s.ws],
      ],
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    },
  );
  const allOn = preview !== null && include.length === preview.operations.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import an OpenAPI document</DialogTitle>
          <DialogDescription>
            Each operation becomes a typed tool for HTTP/OpenAPI nodes and agents. Mutating
            operations keep their idempotency class.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
          {preview === null ? (
            <>
              <ToggleGroup
                type="single"
                value={source}
                onValueChange={(v) => v && setSource(v as "url" | "paste")}
                aria-label="Source"
              >
                <ToggleGroupItem value="url">From URL</ToggleGroupItem>
                <ToggleGroupItem value="paste">Paste JSON or YAML</ToggleGroupItem>
              </ToggleGroup>
              {source === "url" ? (
                <FieldRow label="Document URL" htmlFor="oa-url" required>
                  <Input
                    id="oa-url"
                    type="url"
                    className="font-mono"
                    placeholder="https://api.example.com/openapi.json"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </FieldRow>
              ) : (
                <FieldRow label="Document" htmlFor="oa-doc" required>
                  <CodeEditor
                    id="oa-doc"
                    language={text.trim().startsWith("{") ? "json" : "yaml"}
                    value={text}
                    onChange={setText}
                    minRows={10}
                    maxRows={20}
                    aria-label="OpenAPI document"
                  />
                </FieldRow>
              )}
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  {preview.title}{" "}
                  <span className="font-mono text-xs font-normal text-ink-3">
                    v{preview.version}
                  </span>
                </p>
                <Button variant="link" size="sm" onClick={reset}>
                  Choose another document
                </Button>
              </div>
              {preview.warnings.length > 0 ? (
                <Notice>
                  {preview.warnings.length} warning(s) while parsing; unsupported operations are
                  skipped.
                </Notice>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label="Toolset name" htmlFor="oa-name" required>
                  <Input
                    id="oa-name"
                    value={name}
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Server" htmlFor="oa-server">
                  {preview.servers.length > 0 ? (
                    <Select id="oa-server" value={serverUrl} onValueChange={setServerUrl} mono>
                      {preview.servers.map((u) => (
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
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="https://api.example.com"
                    />
                  )}
                </FieldRow>
              </div>
              <FieldRow
                label="Credential"
                htmlFor="oa-cred"
                hint={
                  Object.keys(preview.authSchemes).length > 0
                    ? `The API declares: ${Object.keys(preview.authSchemes).join(", ")}`
                    : "The API declares no authentication"
                }
              >
                <Select id="oa-cred" value={credentialId} onValueChange={setCredentialId}>
                  <SelectItem value={NO_CREDENTIAL}>No credential</SelectItem>
                  {(creds.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id} meta={c.type}>
                      {c.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              <fieldset>
                <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-ink">
                  <span>
                    Operations ({include.length} of {preview.operations.length})
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    onClick={() => setInclude(allOn ? [] : preview.operations.map((o) => o.name))}
                  >
                    {allOn ? "Select none" : "Select all"}
                  </Button>
                </legend>
                <ul
                  className="flex flex-col divide-y divide-border rounded-md border border-border"
                  role="list"
                >
                  {preview.operations.map((o) => (
                    <li key={o.name} className="flex items-center gap-2 px-3 py-1.5">
                      <Checkbox
                        aria-label={o.name}
                        checked={include.includes(o.name)}
                        onCheckedChange={(c) =>
                          setInclude((xs) =>
                            c === true ? [...xs, o.name] : xs.filter((x) => x !== o.name),
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
                      <span className="shrink-0 font-mono text-2xs text-ink-3">{o.name}</span>
                    </li>
                  ))}
                </ul>
              </fieldset>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {preview === null ? (
            <Button
              variant="primary"
              loading={runPreview.isPending}
              disabled={source === "url" ? !/^https?:\/\//.test(url.trim()) : !text.trim()}
              onClick={() => runPreview.mutate(undefined)}
            >
              Preview
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={runImport.isPending}
              disabled={!name.trim() || include.length === 0}
              onClick={() => runImport.mutate(undefined)}
            >
              Import {include.length} operations
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OpenApiTab() {
  const s = useSession();
  const canWrite = s.can("tools:write");
  const [importing, setImporting] = useState(false);
  const confirm = useConfirm<Tool>();
  const tools = useQuery({ queryKey: ["tools", s.ws], queryFn: () => get<Tool[]>("/v1/tools") });
  const remove = useMutate((t: Tool) => del(`/v1/tools/${t.id}`), {
    success: (_, t) => `Deleted ${t.name}`,
    invalidate: [["tools", s.ws]],
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
      description="REST APIs imported as typed tools."
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
              description="Import an OpenAPI 3 document to call its operations from workflows."
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
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Delete ${confirm.target?.name ?? "toolset"}?`}
        description="Workflows that call its operations fail validation until they are re-imported."
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
