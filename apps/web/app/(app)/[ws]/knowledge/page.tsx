"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { get } from "~/api/client";
import { QueryView, useOpenFromQuery } from "~/admin/ui";
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
    queryFn: () => get<KnowledgeSource[]>("/v1/knowledge/sources"),
    refetchInterval: (q) =>
      q.state.data?.some(
        (x) => !isPageIndexKind(x.kind) && (x.status === "syncing" || x.status === "new"),
      )
        ? 3000
        : false,
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
      <NewSourceDialog open={creating} onOpenChange={setCreating} />
    </AppFrame>
  );
}
