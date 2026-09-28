"use client";
/**
 * The new knowledge source dialog: where documents come from and how they are indexed. PageIndex
 * (PDF section trees) is offered only when the server has the service configured.
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
  NumberInput,
  RadioGroup,
  RadioItem,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { get, post } from "~/api/client";
import type { Credential, ModelInfo, Provider } from "~/admin/types";
import { providerName } from "~/admin/providerNames";
import { Notice, useMutate } from "~/admin/ui";
import { useSession } from "~/session";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";
import {
  EMPTY_SOURCE,
  KIND_LABEL,
  embeddingOptions,
  sourceBody,
  sourceFormError,
  type KnowledgeSource,
  type SourceForm,
  type SourceKind,
} from "./model";
import { PageIndexSourceFields } from "./pageindex/PageIndexSourceFields";

const NONE = "__none";
const KINDS = Object.keys(KIND_LABEL) as SourceKind[];

export function NewSourceDialog({
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
  const pageindex = s.features.pageindex === true;
  const credentials = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => get<Credential[]>("/v1/credentials"),
    enabled: open && f.kind === "pageindex",
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
  const isPageIndex = f.kind === "pageindex";
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
              {isPageIndex
                ? "PDFs are indexed into a tree of sections with their pages, so retrieval nodes can navigate them and cite the pages they read."
                : "Documents are split into chunks, embedded and indexed so retrieval nodes can search them by meaning and by keyword."}
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
              <FieldRow
                label="Documents come from"
                htmlFor="ks-kind"
                hint={
                  pageindex ? undefined : (
                    <>
                      PDF indexing needs the PageIndex service.{" "}
                      <LearnMore href={HELP.pageindexSetup} label="Setup guide" />
                    </>
                  )
                }
              >
                <Select
                  id="ks-kind"
                  value={f.kind}
                  onValueChange={(v) => {
                    const kind = KINDS.find((k) => k === v);
                    if (kind) set("kind", kind);
                  }}
                >
                  {KINDS.map((k) =>
                    k === "pageindex" && !pageindex ? (
                      <SelectItem
                        key={k}
                        value={k}
                        disabled
                        description="Not configured on this server"
                      >
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ) : (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ),
                  )}
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
            {isPageIndex ? (
              <PageIndexSourceFields
                form={f}
                set={set}
                credentials={credentials.data ?? []}
                models={models.data ?? []}
                providers={providers.data ?? []}
                ws={s.ws}
              />
            ) : (
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
            )}
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
