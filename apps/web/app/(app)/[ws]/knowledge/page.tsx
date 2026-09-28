"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
  RadioGroup,
  RadioItem,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { get, post } from "~/api/client";
import type { Credential, ModelInfo, Provider } from "~/admin/types";
import { providerName } from "~/admin/providerNames";
import { Notice, QueryView, useMutate } from "~/admin/ui";
import {
  EMPTY_SOURCE,
  KIND_LABEL,
  embeddingOptions,
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
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

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
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<Provider[]>("/v1/providers"),
    enabled: open,
  });
  const models = useQuery({
    queryKey: ["models", s.ws],
    queryFn: () => get<ModelInfo[]>("/v1/models"),
    enabled: open,
  });
  const options = useMemo(
    () =>
      embeddingOptions(
        models.data ?? [],
        providers.data ?? [],
        credentialTypes.data ?? new Set<string>(),
      ),
    [models.data, providers.data, credentialTypes.data],
  );
  // "provider/model", "keyword", or null while the person has not chosen: then the first model
  // this workspace can call, else keyword search (a model without a key fails every document)
  const [choice, setChoice] = useState<string | null>(null);
  const firstReady = options.find((o) => o.ready);
  const embedding =
    choice ?? (firstReady ? `${firstReady.provider}/${firstReady.model}` : "keyword");
  const keywordOnly = embedding === "keyword";
  const chosen = keywordOnly
    ? undefined
    : options.find((o) => `${o.provider}/${o.model}` === embedding);
  const [chosenProvider = "", chosenModel = ""] = keywordOnly ? [] : embedding.split(/\/(.*)/s);
  const form: SourceForm = { ...f, embeddingProvider: chosenProvider, embeddingModel: chosenModel };
  const create = useMutate(() => post<KnowledgeSource>("/v1/knowledge/sources", sourceBody(form)), {
    success: (x) => `Created ${x.name}`,
    invalidate: [["knowledge-sources", s.ws]],
    onSuccess: (x) => router.push(`/${s.ws}/knowledge/${x.id}`),
  });
  const error = sourceFormError(form);
  const missingKey = !keywordOnly && chosen !== undefined && !chosen.ready;
  const loadingModels = models.isPending || providers.isPending;

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
              <FieldRow label="Search by">
                <RadioGroup
                  value={keywordOnly ? "keyword" : "meaning"}
                  onValueChange={(v) => {
                    const pick = firstReady ?? options[0];
                    setChoice(
                      v === "keyword" || !pick ? "keyword" : `${pick.provider}/${pick.model}`,
                    );
                  }}
                  aria-label="Search by"
                >
                  <RadioItem
                    value="meaning"
                    label="Meaning and keywords"
                    description="Chunks are embedded, so a search finds passages that say the same thing in other words."
                    disabled={options.length === 0}
                  />
                  <RadioItem
                    value="keyword"
                    label="Keywords only"
                    description="No embedding model or key needed; matches the words a search uses."
                  />
                </RadioGroup>
              </FieldRow>
              {!keywordOnly ? (
                <FieldRow label="Embedding model" htmlFor="ks-model">
                  <Select
                    id="ks-model"
                    value={embedding}
                    onValueChange={setChoice}
                    placeholder={loadingModels ? "Loading…" : "Choose a model"}
                  >
                    {options.map((o) => (
                      <SelectItem
                        key={`${o.provider}/${o.model}`}
                        value={`${o.provider}/${o.model}`}
                        description={o.ready ? "Ready" : "Needs a key"}
                      >
                        {providerName(o.provider)} · {o.model}
                      </SelectItem>
                    ))}
                  </Select>
                </FieldRow>
              ) : !loadingModels && !firstReady ? (
                <p className="text-xs text-ink-3">
                  No embedding provider has a key in this workspace yet.{" "}
                  <a className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
                    Add an OpenAI or Gemini key
                  </a>{" "}
                  to search by meaning.
                </p>
              ) : null}
              {missingKey && chosen ? (
                <p role="status" className="text-xs text-warn-text">
                  {providerName(chosen.provider)} has no API key in this workspace, so documents
                  will fail to index.{" "}
                  <a className="underline" href={`/${s.ws}/credentials`}>
                    Add a credential
                  </a>
                  , pick a ready model, or search by keywords only.
                </p>
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
          description={
            <>
              Document collections that retrieval nodes search: uploads, web pages, sitemaps and
              repositories. <LearnMore href={HELP.knowledge} />
            </>
          }
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
