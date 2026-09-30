"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { get, getAll } from "~/api/client";
import type { ModelInfo } from "~/admin/types";
import { providerName } from "~/admin/providerNames";
import { QueryView, useOpenFromQuery } from "~/admin/ui";
import { KNOWLEDGE } from "~/guide/capabilities/knowledge";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { useConnections } from "~/guide/useConnections";
import {
  KIND_LABEL,
  countsLine,
  isPageIndexKind,
  sourceTone,
  type KnowledgeSource,
} from "~/knowledge/model";
import { NewSourceDialog } from "~/knowledge/NewSourceDialog";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

export default function KnowledgePage() {
  const s = useSession();
  const [creating, setCreating] = useOpenFromQuery();
  const canWrite = s.can("knowledge:write");
  const sources = useQuery({
    queryKey: ["knowledge-sources", s.ws],
    queryFn: () => getAll<KnowledgeSource>("/v1/knowledge/sources"),
    refetchInterval: (q) =>
      q.state.data?.some(
        (x) => !isPageIndexKind(x.kind) && (x.status === "syncing" || x.status === "new"),
      )
        ? 3000
        : false,
  });
  const connections = useConnections();
  const models = useQuery({
    queryKey: ["models", s.ws],
    queryFn: () => get<ModelInfo[]>("/v1/models"),
  });
  const embedders = [
    ...new Set(
      (models.data ?? [])
        .filter((m) => m.kind === "embedding" && !m.deprecated)
        .map((m) => m.provider),
    ),
  ];
  const readyEmbedders = embedders.filter(connections.ready);
  const checks: Check[] = [
    connections.loading || models.isPending
      ? { id: "embedding", label: "An embedding key", state: "checking" }
      : readyEmbedders.length
        ? {
            id: "embedding",
            label: `Meaning search ready: ${readyEmbedders.map(providerName).join(", ")}`,
            state: "ok",
          }
        : {
            id: "embedding",
            label: "An embedding key, to search by meaning",
            state: "optional",
            detail: `Without one, new sources search by keywords only.${connections.partial ? " Keys stored as credentials are not visible to your role." : ""}`,
            fix: (
              <a className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
                Add an OpenAI or Gemini key under Credentials
              </a>
            ),
          },
    s.features.pageindex === true
      ? { id: "pageindex", label: "PageIndex service available for PDFs", state: "ok" }
      : {
          id: "pageindex",
          label: "PageIndex service, for PDFs indexed by section",
          state: "optional",
          detail: "Not configured on this server. Other kinds of source work without it.",
          fix: <LearnMore href={HELP.pageindexSetup} label="Setup guide" />,
        },
    ...(canWrite
      ? []
      : [
          {
            id: "role",
            label: "Your role can search sources but not create or change them",
            state: "info",
          } satisfies Check,
        ]),
  ];
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
        <PageIntro
          guide={KNOWLEDGE}
          checks={checks}
          defaultCollapsed={(sources.data?.length ?? 0) > 0}
        />
        <div className="mt-4">
          <QueryView query={sources}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<BookOpen strokeWidth={1.5} />}
                  title="No knowledge sources"
                  description="Create a source, add documents or point it at a site, then search it with the Knowledge base or Hybrid search steps. New source walks through each setting."
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
                        {isPageIndexKind(x.kind) ? null : (
                          <Badge tone={sourceTone(x.status)} dot className="capitalize">
                            {x.status}
                          </Badge>
                        )}
                        <Badge tone="outline">{KIND_LABEL[x.kind]}</Badge>
                        {x.pipeline.embedding || isPageIndexKind(x.kind) ? null : (
                          <Badge tone="outline">Keyword only</Badge>
                        )}
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
      {creating ? <NewSourceDialog open onOpenChange={setCreating} /> : null}
    </AppFrame>
  );
}
