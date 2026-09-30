"use client";
/**
 * The new knowledge source dialog: what it holds, where its documents come from, how it is
 * searched and how text is split, then a review. Built step by step (or all at once, "All
 * fields"); the draft is kept in this browser tab until the source is created, and creating it
 * ends on what happens next. PageIndex (PDF section trees) is offered only when the server has
 * the service configured.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
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
import { get, getAll, post } from "~/api/client";
import type { Credential, ModelInfo, Provider } from "~/admin/types";
import { providerName } from "~/admin/providerNames";
import { Notice, useMutate } from "~/admin/ui";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, blockers, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";
import {
  STRATEGY_LABEL,
  chunkingChanged,
  chunkingError,
  originError,
  sourceReviewNotes,
} from "./guidance";
import {
  EMPTY_SOURCE,
  KIND_LABEL,
  embeddingOptions,
  isUploadKind,
  parseUrls,
  urlFieldError,
  sourceBody,
  sourceFormError,
  type KnowledgeSource,
  type SourceForm,
  type SourceKind,
} from "./model";
import { PageIndexSourceFields } from "./pageindex/PageIndexSourceFields";

const NONE = "__none";
const KINDS = Object.keys(KIND_LABEL) as SourceKind[];

/** What each kind of source is for, shown under the choice. */
const KIND_HELP: Record<SourceKind, string> = {
  files:
    "Text, Markdown, HTML or JSON files, up to 100 at a time, added on the source's page once it is created. A file with the same name replaces the earlier one.",
  text: "Documents pasted on the source's page once it is created. Suits a few policies or answers kept somewhere else.",
  url: "The pages are fetched now and on every sync; pages that have not changed are skipped.",
  sitemap:
    "Every page the sitemap lists is fetched now and on every sync. Keep to one part of a large site with Only pages under.",
  github:
    "Markdown, text and reStructuredText files of the repository (or one folder of it), fetched now and on every sync. Private repositories need a bearer-token credential.",
  pageindex:
    "PDFs uploaded on the source's page, indexed into a tree of sections so steps can navigate them and cite the pages they read. Suits long structured documents: contracts, manuals, policies.",
};

/** The form plus the embedding choice: "provider/model", "keyword", or null (not chosen yet). */
type SourceDraft = SourceForm & { embedding: string | null };

export function NewSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const s = useSession();
  // the draft survives closing the dialog (or a trip to Credentials) in this tab
  const kept = useKeptDraft<SourceDraft>(`flowaid:draft:${s.ws}:knowledge-source`, () => ({
    ...EMPTY_SOURCE,
    embedding: null,
  }));
  const { draft: f, setDraft } = kept;
  const [created, setCreated] = useState<KnowledgeSource | null>(null);
  const set = <K extends keyof SourceForm>(k: K, v: SourceForm[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }));
  const tokens = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    select: (rows) => rows.filter((c) => c.type === "http.bearer"),
    enabled: open && f.kind === "github",
  });
  const pageindex = s.features.pageindex === true;
  const credentials = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    enabled: open && f.kind === "pageindex",
  });
  const credentialTypes = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
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
  // not chosen yet: the first model this workspace can call, else keyword search (a model
  // without a key fails every document)
  const firstReady = options.find((o) => o.ready);
  const embedding =
    f.embedding ?? (firstReady ? `${firstReady.provider}/${firstReady.model}` : "keyword");
  const setChoice = (v: string) => setDraft((prev) => ({ ...prev, embedding: v }));
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
    onSuccess: (x) => {
      kept.discard();
      setCreated(x);
    },
    // the draft stays in the form (and in this tab) so nothing typed is lost
    errorTitle: "Could not create the source",
  });
  const error = sourceFormError(form);
  const missingKey = !keywordOnly && chosen !== undefined && !chosen.ready;
  const loadingModels = models.isPending || providers.isPending;
  const indexReady =
    (providers.data ?? []).some((p) => p.id === f.indexProvider && p.configuredOnServer) ||
    f.indexCredentialId !== null ||
    // no provider list (still loading or unreadable): nothing to warn about yet
    !providers.data?.length;

  const notes = sourceReviewNotes(form, {
    embedding: keywordOnly
      ? null
      : { provider: chosenProvider, model: chosenModel, ready: chosen?.ready ?? false },
    indexReady,
  });
  const reviewChecks: Check[] = [
    ...(error === null
      ? [{ id: "valid", label: "Every required setting is filled in", state: "ok" } as Check]
      : []),
    ...notes.map((n): Check => ({ id: n.id, label: n.message, state: n.state })),
  ];
  const origin = originError(form);
  const chunking = chunkingError(form);

  const steps: FlowStep[] = [
    {
      id: "purpose",
      title: "Name what it holds",
      why: "The name is how you pick this source in a workflow's Knowledge base or Hybrid search step, so name it after the material in it. One source per body of material keeps a step searching only what is relevant.",
      done: f.name.trim().length > 0,
      requirement: "give the source a name",
      example: (
        <>
          <strong className="font-medium text-ink">Help center</strong> for the public help
          articles, <strong className="font-medium text-ink">Refund policies</strong> for the
          internal rules. Examples: use the names of your own material.
        </>
      ),
      children: (
        <FieldRow label="Name" htmlFor="ks-name" required>
          <Input
            id="ks-name"
            value={f.name}
            maxLength={200}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Help center"
          />
        </FieldRow>
      ),
    },
    {
      id: "origin",
      title: "Where documents come from",
      why: "Uploads and pasted text are added by hand. Web pages, a sitemap or a repository are fetched for you: once when the source is created, then whenever you sync it.",
      done: origin === null,
      requirement: origin ?? undefined,
      children: (
        <>
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
            className="sm:max-w-80"
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
          <p className="m-0 text-xs text-ink-3">{KIND_HELP[f.kind]}</p>
          {f.kind === "url" ? (
            <FieldRow
              label="Pages"
              htmlFor="ks-urls"
              hint={`One URL per line${parseUrls(f.urls).length ? ` · ${parseUrls(f.urls).length} listed` : ""}`}
              error={urlFieldError(f.urls)}
              required
            >
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
              <FieldRow
                label="Sitemap URL"
                htmlFor="ks-sitemap"
                error={urlFieldError(f.urls)}
                required
              >
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
                hint="URL prefixes, one per line (empty: every page), such as https://docs.example.com/help/"
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
                hint={
                  <>
                    A bearer-token credential, for private repositories.{" "}
                    <a className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
                      Add one under Credentials
                    </a>
                    ; this draft is kept.
                  </>
                }
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
            <Notice tone="info">
              PageIndex builds its own section tree, so the search and chunking settings of the next
              steps do not apply and are not saved. Switch back to another kind and they are as you
              left them.
            </Notice>
          ) : null}
        </>
      ),
    },
    isPageIndex
      ? {
          id: "search",
          title: "Choose the indexing model",
          why: "The indexing model reads each PDF and writes the summaries of its sections, which is what a PageIndex retrieval step navigates by. Page text is sent to that model's provider.",
          done: f.indexModel.trim().length > 0,
          requirement: "name the indexing model",
          example:
            "Flash suits PDFs with clear headings and is the cheaper start. Choose Standard when the layout does not show the structure, such as scanned or flat documents.",
          children: (
            <PageIndexSourceFields
              form={form}
              set={set}
              credentials={credentials.data ?? []}
              models={models.data ?? []}
              providers={providers.data ?? []}
              ws={s.ws}
            />
          ),
        }
      : {
          id: "search",
          title: "Choose how it is searched",
          why: "Searching by meaning finds passages that say the same thing in other words, which is how people ask questions. It needs an embedding model with a key: every chunk is embedded when it is indexed, and every search query too. Keywords only needs no model or key, and finds only passages that use the query's words.",
          // a model without a key fails every document, so it does not finish the step
          done: keywordOnly || (chosen !== undefined && !missingKey),
          requirement: "choose an embedding model that is ready, or keywords only",
          example:
            "Meaning and keywords is the usual choice. Keywords only suits exact terms such as product codes or error messages, or trying the source out before adding a key.",
          children: (
            <>
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
                    description="No embedding model or key needed; matches the words a search uses. Retrieve steps and Semantic searches do not work on it."
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
                        description={
                          o.ready
                            ? "Ready"
                            : o.provider === "ollama"
                              ? "Needs its server address"
                              : "Needs a key"
                        }
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
                  to search by meaning; this draft is kept while you do.
                </p>
              ) : null}
              {missingKey && chosen ? (
                <p role="status" className="text-xs text-warn-text">
                  {chosen.provider === "ollama"
                    ? "No Ollama server address is set (OLLAMA_HOST or a credential)"
                    : `${providerName(chosen.provider)} has no API key in this workspace`}
                  , so documents will fail to index.{" "}
                  <a className="underline" href={`/${s.ws}/credentials`}>
                    Add a credential
                  </a>
                  , pick a ready model, or search by keywords only.
                </p>
              ) : null}
              <p className="m-0 text-xs text-ink-3">
                The source page has no setting to change this later, so choose now.
              </p>
            </>
          ),
        },
    {
      id: "chunking",
      title: "Split text into chunks",
      why: isPageIndex
        ? "PageIndex splits PDFs into their own sections, so there is nothing to set here."
        : "Documents are split into chunks, and every search hit is one chunk. The defaults (by paragraph, 400 tokens, 60 overlapping) suit most prose; change them only for a reason.",
      done: isPageIndex || (chunking === null && chunkingChanged(form)),
      optional: true,
      example: isPageIndex ? undefined : (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
          <li>
            Smaller chunks (200–300) give more precise hits with less around them; larger ones
            (600–1,000) keep more context per hit but match less sharply and fill more of a prompt.
          </li>
          <li>
            Overlap repeats the end of one chunk at the start of the next, so a sentence cut at a
            boundary is still found. About a sixth of the chunk size is plenty.
          </li>
          <li>
            By Markdown heading keeps each section together and records its heading; Fixed windows
            suits text without structure, such as transcripts or logs.
          </li>
          <li>
            If Try a search returns passages cut off mid-thought, raise the size or the overlap.
          </li>
        </ul>
      ),
      children: isPageIndex ? (
        <p className="m-0 text-sm text-ink-3">Not used by PageIndex sources.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldRow label="Chunking" htmlFor="ks-strategy">
            <Select
              id="ks-strategy"
              value={f.strategy}
              onValueChange={(v) => set("strategy", v as SourceForm["strategy"])}
            >
              {(Object.keys(STRATEGY_LABEL) as SourceForm["strategy"][]).map((k) => (
                <SelectItem key={k} value={k}>
                  {STRATEGY_LABEL[k]}
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
          <FieldRow label="Chunk tokens" htmlFor="ks-tokens" hint="20–4,000 (default 400)">
            <NumberInput
              id="ks-tokens"
              value={f.chunkTokens}
              min={20}
              max={4000}
              onValueChange={(v) => set("chunkTokens", v ?? EMPTY_SOURCE.chunkTokens)}
            />
          </FieldRow>
          <FieldRow
            label="Overlap tokens"
            htmlFor="ks-overlap"
            hint="Below the chunk size (default 60)"
            error={chunking ? "Must be smaller than the chunk size" : undefined}
          >
            <NumberInput
              id="ks-overlap"
              value={f.overlapTokens}
              min={0}
              max={1000}
              onValueChange={(v) => set("overlapTokens", v ?? 0)}
            />
          </FieldRow>
        </div>
      ),
    },
    {
      id: "review",
      title: "Review and create",
      why: "Check what the source will be. Creating it saves the source; for web pages, a sitemap or a repository it also starts the first sync.",
      done: error === null && blockers(reviewChecks).length === 0,
      doneLabel: "Ready to create",
      requirement: "fix the items marked as needed",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Name</dt>
            <dd className="m-0 text-ink">{f.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Documents</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{originLine(form)}</dd>
            {isPageIndex ? (
              <>
                <dt className="text-ink-3">Indexing</dt>
                <dd className="m-0 font-mono text-ink">
                  {providerName(f.indexProvider)} · {f.indexModel.trim() || "—"} ·{" "}
                  {f.indexMode === "standard" ? "Standard" : "Flash"}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-ink-3">Search</dt>
                <dd className="m-0 text-ink">
                  {keywordOnly
                    ? "Keywords only"
                    : `Meaning and keywords · ${providerName(chosenProvider)} · ${chosenModel}`}
                </dd>
                <dt className="text-ink-3">Chunks</dt>
                <dd className="m-0 text-ink">
                  {STRATEGY_LABEL[f.strategy]} · {f.chunkTokens} tokens · {f.overlapTokens} overlap
                </dd>
              </>
            )}
          </dl>
          <CheckList checks={reviewChecks} aria-label="Before you create" />
          <QualityNote>
            These checks confirm the source can be created and indexed. Whether it finds the right
            passages shows only when you search it: once documents are indexed, use Try a search on
            its page with questions people really ask.
          </QualityNote>
        </>
      ),
    },
  ];

  if (created)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {created.name} is created
            </DialogTitle>
            <DialogDescription>What happens next:</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              {created.kind === "pageindex" ? (
                <li>
                  Upload PDFs on its page. Each is indexed into a tree of sections by the indexing
                  model; the page shows when it is ready.
                </li>
              ) : isUploadKind(created.kind) ? (
                <li>
                  Add documents on its page. Each is chunked and indexed in the background, and the
                  table shows when it is.
                </li>
              ) : (
                <li>
                  The first sync has started: documents are fetched, chunked and indexed in the
                  background. The source shows Syncing, then Ready; sync again whenever the content
                  changes.
                </li>
              )}
              <li>
                {created.kind === "pageindex"
                  ? "Ask a question under Try a question to see the sections a step would read."
                  : "Try a search on its page to see the passages a step would receive."}
              </li>
              <li>
                In a workflow, add a{" "}
                {created.kind === "pageindex"
                  ? "PageIndex: Retrieve evidence"
                  : "Knowledge base or Hybrid search"}{" "}
                step and pick {created.name}.
              </li>
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button variant="primary" asChild>
              <Link href={`/${s.ws}/knowledge/${created.id}`}>Open {created.name}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New knowledge source</DialogTitle>
          <DialogDescription>
            {isPageIndex
              ? "PDFs are indexed into a tree of sections with their pages, so retrieval nodes can navigate them and cite the pages they read."
              : "Documents are split into chunks, embedded and indexed so retrieval nodes can search them by meaning and by keyword."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <GuidedFlow
            steps={steps}
            status={
              <DraftStatus
                dirty={kept.dirty}
                restored={kept.restored}
                onDiscard={kept.discard}
                what="the source"
              />
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={create.isPending}
            disabled={error !== null}
            onClick={() => create.mutate(undefined)}
          >
            Create source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Web pages · 3 URLs", "GitHub repository · acme/docs (docs)". */
function originLine(f: SourceForm): string {
  const label = KIND_LABEL[f.kind];
  switch (f.kind) {
    case "url": {
      const n = parseUrls(f.urls).length;
      return `${label} · ${n} URL${n === 1 ? "" : "s"}`;
    }
    case "sitemap":
      return `${label} · ${f.urls.trim() || "—"}${parseUrls(f.include).length ? ` (only ${parseUrls(f.include).join(", ")})` : ""}`;
    case "github":
      return `${label} · ${f.repo.trim() || "—"}${f.path.trim() ? ` (${f.path.trim()})` : ""}${f.credentialId ? " · with a token" : ""}`;
    case "files":
    case "text":
    case "pageindex":
      return `${label} · added after creating`;
  }
}
