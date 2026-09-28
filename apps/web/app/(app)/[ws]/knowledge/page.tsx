"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  Input,
  NumberInput,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { get, post } from "~/api/client";
import type { Credential } from "~/admin/types";
import { Notice, QueryView, useMutate } from "~/admin/ui";
import {
  EMPTY_SOURCE,
  KIND_LABEL,
  countsLine,
  sourceBody,
  sourceFormError,
  sourceTone,
  type KnowledgeSource,
  type SourceForm,
  type SourceKind,
} from "~/knowledge/model";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

const NONE = "__none";
const KINDS = Object.keys(KIND_LABEL) as SourceKind[];

function NewSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const s = useSession();
  const router = useRouter();
  const [f, setF] = useState<SourceForm>(EMPTY_SOURCE);
  const set = <K extends keyof SourceForm>(k: K, v: SourceForm[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const tokens = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => get<Credential[]>("/v1/credentials"),
    select: (rows) => rows.filter((c) => c.type === "http.bearer"),
    enabled: open && f.kind === "github",
  });
  const credentialTypes = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => get<Credential[]>("/v1/credentials"),
    select: (rows) => new Set(rows.map((c) => c.type)),
    enabled: open,
  });
  const create = useMutate(() => post<KnowledgeSource>("/v1/knowledge/sources", sourceBody(f)), {
    success: (x) => `Created ${x.name}`,
    invalidate: [["knowledge-sources", s.ws]],
    onSuccess: (x) => router.push(`/${s.ws}/knowledge/${x.id}`),
  });
  const error = sourceFormError(f);
  const keywordOnly = !f.embeddingProvider;
  // indexing embeds with a workspace credential of the provider (Ollama needs none)
  const provider = f.embeddingProvider.trim().toLowerCase();
  const missingKey =
    !keywordOnly &&
    provider !== "ollama" &&
    credentialTypes.data !== undefined &&
    !credentialTypes.data.has(`${provider}.api_key`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!error) create.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>New knowledge source</DialogTitle>
            <DialogDescription>
              Documents are split into chunks, embedded and indexed so retrieval nodes can search
              them by meaning and by keyword.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Name" htmlFor="ks-name" required>
                <Input
                  id="ks-name"
                  value={f.name}
                  maxLength={200}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Help center"
                />
              </FieldRow>
              <FieldRow label="Documents come from" htmlFor="ks-kind">
                <Select
                  id="ks-kind"
                  value={f.kind}
                  onValueChange={(v) => set("kind", v as SourceKind)}
                >
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
            </div>
            {f.kind === "url" ? (
              <FieldRow label="Pages" htmlFor="ks-urls" hint="One URL per line" required>
                <Textarea
                  id="ks-urls"
                  rows={3}
                  value={f.urls}
                  onChange={(e) => set("urls", e.target.value)}
                  placeholder="https://docs.example.com/getting-started"
                />
              </FieldRow>
            ) : null}
            {f.kind === "sitemap" ? (
              <>
                <FieldRow label="Sitemap URL" htmlFor="ks-sitemap" required>
                  <Input
                    id="ks-sitemap"
                    value={f.urls}
                    onChange={(e) => set("urls", e.target.value)}
                    placeholder="https://docs.example.com/sitemap.xml"
                  />
                </FieldRow>
                <FieldRow
                  label="Only pages under"
                  htmlFor="ks-include"
                  hint="URL prefixes, one per line (empty: every page)"
                >
                  <Textarea
                    id="ks-include"
                    rows={2}
                    value={f.include}
                    onChange={(e) => set("include", e.target.value)}
                  />
                </FieldRow>
              </>
            ) : null}
            {f.kind === "github" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <FieldRow label="Repository" htmlFor="ks-repo" required>
                  <Input
                    id="ks-repo"
                    value={f.repo}
                    onChange={(e) => set("repo", e.target.value)}
                    placeholder="owner/name"
                  />
                </FieldRow>
                <FieldRow label="Branch or tag" htmlFor="ks-ref">
                  <Input
                    id="ks-ref"
                    value={f.ref}
                    onChange={(e) => set("ref", e.target.value)}
                    placeholder="default branch"
                  />
                </FieldRow>
                <FieldRow label="Folder" htmlFor="ks-path">
                  <Input
                    id="ks-path"
                    value={f.path}
                    onChange={(e) => set("path", e.target.value)}
                    placeholder="docs"
                  />
                </FieldRow>
                <FieldRow
                  label="Token"
                  htmlFor="ks-token"
                  hint="A bearer-token credential, for private repositories"
                  className="sm:col-span-3"
                >
                  <Select
                    id="ks-token"
                    value={f.credentialId ?? NONE}
                    onValueChange={(v) => set("credentialId", v === NONE ? null : v)}
                  >
                    <SelectItem value={NONE}>Public repository</SelectItem>
                    {(tokens.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </Select>
                </FieldRow>
              </div>
            ) : null}
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <Switch
                  size="sm"
                  checked={!keywordOnly}
                  onCheckedChange={(on) =>
                    setF((prev) => ({
                      ...prev,
                      embeddingProvider: on ? EMPTY_SOURCE.embeddingProvider : "",
                      embeddingModel: on ? EMPTY_SOURCE.embeddingModel : "",
                    }))
                  }
                />
                Embed chunks for semantic search (off: keyword search only)
              </label>
              {!keywordOnly ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label="Embedding provider" htmlFor="ks-provider">
                    <Input
                      id="ks-provider"
                      value={f.embeddingProvider}
                      onChange={(e) => set("embeddingProvider", e.target.value)}
                    />
                  </FieldRow>
                  <FieldRow label="Embedding model" htmlFor="ks-model">
                    <Input
                      id="ks-model"
                      value={f.embeddingModel}
                      onChange={(e) => set("embeddingModel", e.target.value)}
                    />
                  </FieldRow>
                  {missingKey ? (
                    <p role="status" className="text-xs text-warn-text sm:col-span-2">
                      This workspace has no {f.embeddingProvider} API key, so documents will fail to
                      index.{" "}
                      <a className="underline" href={`/${s.ws}/credentials`}>
                        Add a credential
                      </a>
                      , or turn embeddings off for keyword search.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-3">
                <FieldRow label="Chunking" htmlFor="ks-strategy">
                  <Select
                    id="ks-strategy"
                    value={f.strategy}
                    onValueChange={(v) => set("strategy", v as SourceForm["strategy"])}
                  >
                    <SelectItem value="recursive">By paragraph</SelectItem>
                    <SelectItem value="markdown">By Markdown heading</SelectItem>
                    <SelectItem value="fixed">Fixed windows</SelectItem>
                  </Select>
                </FieldRow>
                <FieldRow label="Chunk tokens" htmlFor="ks-tokens">
                  <NumberInput
                    id="ks-tokens"
                    value={f.chunkTokens}
                    min={20}
                    max={4000}
                    onValueChange={(v) => set("chunkTokens", v ?? EMPTY_SOURCE.chunkTokens)}
                  />
                </FieldRow>
                <FieldRow label="Overlap tokens" htmlFor="ks-overlap">
                  <NumberInput
                    id="ks-overlap"
                    value={f.overlapTokens}
                    min={0}
                    max={1000}
                    onValueChange={(v) => set("overlapTokens", v ?? 0)}
                  />
                </FieldRow>
              </div>
            </div>
            {error && f.name ? <Notice tone="info">{error}</Notice> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={error !== null}
            >
              Create source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgePage() {
  const s = useSession();
  const [creating, setCreating] = useState(false);
  const canWrite = s.can("knowledge:write");
  const sources = useQuery({
    queryKey: ["knowledge-sources", s.ws],
    queryFn: () => get<KnowledgeSource[]>("/v1/knowledge/sources"),
    refetchInterval: (q) =>
      q.state.data?.some((x) => x.status === "syncing" || x.status === "new") ? 3000 : false,
  });
  const newButton = canWrite ? (
    <Button
      variant="primary"
      leadingIcon={<Plus strokeWidth={1.75} />}
      onClick={() => setCreating(true)}
    >
      New source
    </Button>
  ) : null;

  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Knowledge" }]}>
      <PageBody>
        <PageHeader
          title="Knowledge"
          description="Document collections that retrieval nodes search: uploads, web pages, sitemaps and repositories."
          actions={newButton}
        />
        <div className="mt-4">
          <QueryView query={sources}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<BookOpen strokeWidth={1.5} />}
                  title="No knowledge sources"
                  description="Create a source, add documents or point it at a site, then search it with the Knowledge base or Hybrid search nodes."
                  primaryAction={newButton}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((x) => (
                    <Card key={x.id} interactive className="relative flex flex-col gap-2 p-4">
                      <Link
                        href={`/${s.ws}/knowledge/${x.id}`}
                        className="font-medium text-ink after:absolute after:inset-0 hover:underline"
                      >
                        {x.name}
                      </Link>
                      <p className="text-xs text-ink-3">{countsLine(x)}</p>
                      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-2xs text-ink-3">
                        <Badge tone={sourceTone(x.status)} dot className="capitalize">
                          {x.status}
                        </Badge>
                        <Badge tone="outline">{KIND_LABEL[x.kind]}</Badge>
                        {x.pipeline.embedding ? null : <Badge tone="outline">Keyword only</Badge>}
                        {x.lastSyncAt ? (
                          <span>
                            · synced <RelativeTime date={x.lastSyncAt} />
                          </span>
                        ) : null}
                      </div>
                    </Card>
                  ))}
                </div>
              )
            }
          </QueryView>
        </div>
      </PageBody>
      <NewSourceDialog open={creating} onOpenChange={setCreating} />
    </AppFrame>
  );
}
