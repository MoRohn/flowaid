"use client";
/**
 * "Use template": what the template needs against what the workspace has, a name for the copy,
 * the MCP servers for its slots, and what creating it gives you. The draft (name and servers) is
 * kept in this browser tab per template, so connecting a server first loses nothing. Creating it
 * saves a draft workflow and opens it; nothing runs until Run draft in the builder.
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Badge,
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
  Select,
  SelectItem,
} from "@flowaid/ui/primitives";
import { getAll, post } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { templateResourceSlots } from "~/admin/logic";
import type { McpServer, TemplateRow } from "~/admin/types";
import { Notice, useMutate } from "~/admin/ui";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import type { KnowledgeSource } from "~/knowledge/model";
import { KIND_LABEL } from "~/knowledge/model";
import { businessArea } from "./business";
import {
  pickKey,
  slotSourceKind,
  sourcesForSlot,
  templateChecks,
  type TemplateNeed,
} from "./readiness";

interface TemplateDraft {
  name: string;
  /** slot key → MCP server id */
  picked: Record<string, string>;
}

const PAGE: Record<NonNullable<TemplateNeed["where"]>, { path: string; label: string }> = {
  credentials: { path: "credentials", label: "Add it under Credentials" },
  integrations: { path: "integrations", label: "Connect one under Integrations" },
  knowledge: { path: "knowledge", label: "Add one under Knowledge" },
};

export function UseTemplateDialog({
  template,
  needs,
  onClose,
}: {
  template: TemplateRow;
  needs: TemplateNeed[];
  onClose: () => void;
}) {
  const s = useSession();
  const router = useRouter();
  const kept = useKeptDraft<TemplateDraft>(`flowaid:draft:${s.ws}:template:${template.id}`, () => ({
    name: "",
    picked: {},
  }));
  const { draft, setDraft } = kept;
  const slots = templateResourceSlots(template);
  const needsMcp = slots.some((x) => x.kind === "mcpServers");
  const needsSources = slots.some((x) => x.kind === "knowledgeSources");
  const servers = useQuery({
    queryKey: ["mcp-servers", s.ws],
    queryFn: () => getAll<McpServer>("/v1/mcp/servers"),
    enabled: needsMcp && s.can("mcp:read"),
  });
  const sources = useQuery({
    queryKey: ["knowledge-sources", s.ws],
    queryFn: () => getAll<KnowledgeSource>("/v1/knowledge/sources"),
    enabled: needsSources && s.features.knowledge === true,
  });
  const name = (draft.name || template.name).trim();
  const readiness = templateChecks(
    needs,
    slots,
    draft.picked,
    (id) =>
      servers.data?.find((m) => m.id === id)?.name ?? sources.data?.find((k) => k.id === id)?.name,
  );
  const create = useMutate(
    () =>
      post<WorkflowDetail>("/v1/workflows", {
        name,
        templateId: template.id,
        ...(Object.keys(draft.picked).length ? { resources: draft.picked } : {}),
      }),
    {
      success: (w) => `Created ${w.name}`,
      invalidate: [["workflows", s.ws]],
      // a refused create keeps the name and servers in the form
      errorTitle: "Could not create the workflow",
      onSuccess: (w) => {
        kept.discard();
        router.push(`/${s.ws}/workflows/${w.id}`);
      },
    },
  );
  const checks: Check[] = readiness.checks.map((c) => ({
    id: c.id,
    label: c.label,
    state: c.state,
    detail: c.detail,
    ...(c.where
      ? {
          fix: (
            <a className="text-accent-text hover:underline" href={`/${s.ws}/${PAGE[c.where].path}`}>
              {PAGE[c.where].label}
            </a>
          ),
        }
      : {}),
  }));
  const area = businessArea(template);
  const slotsTitle = !needsSources
    ? "Choose its servers"
    : !needsMcp
      ? "Choose its documents"
      : "Choose its servers and documents";

  const steps: FlowStep[] = [
    {
      id: "needs",
      title: "Check what it needs",
      why: "The template lists the keys, servers and documents its steps use; each line says whether this workspace has it. You can create the copy either way: whatever is missing only stops the steps that use it.",
      done: true,
      example: readiness.ready
        ? "Everything it needs is set up: the copy can run as soon as it is created."
        : "Missing something? Your choices here are kept while you set it up on another page; come back and they are still here.",
      children: checks.length ? (
        <CheckList checks={checks} aria-label="What the template needs" />
      ) : (
        <p className="m-0 text-sm text-ink-3">It needs no keys, servers or documents.</p>
      ),
    },
    {
      id: "name",
      title: "Name your copy",
      why: "The copy is a separate workflow you own; the template stays as it is. Name it after the job it will do for you, so it is easy to find among your workflows.",
      done: name.length > 0,
      requirement: "give the workflow a name",
      example: (
        <>
          <strong className="font-medium text-ink">
            {area ? `${template.name} (${area})` : `${template.name} for support`}
          </strong>{" "}
          or the team that uses it. Leave it empty to keep the template&apos;s name.
        </>
      ),
      children: (
        <FieldRow
          label="Workflow name"
          htmlFor="tpl-name"
          hint="Rename it later in the builder at any time"
        >
          <Input
            id="tpl-name"
            value={draft.name}
            placeholder={template.name}
            maxLength={200}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </FieldRow>
      ),
    },
    ...(slots.length
      ? [
          {
            id: "servers",
            title: slotsTitle,
            why: [
              needsMcp
                ? "Some steps call tools on an MCP server: pick which of your connected servers they use; the list shows the tools each slot expects."
                : "",
              needsSources
                ? "Some steps read documents: pick the knowledge source they search."
                : "",
              "You can create the copy first and choose in the builder later, but those steps fail until one is chosen.",
            ]
              .filter(Boolean)
              .join(" "),
            done: slots.every((x) => draft.picked[pickKey(x)]),
            optional: true,
            optionalLabel: "Can wait",
            children: (
              <>
                {slots.map((slot) =>
                  slot.kind === "mcpServers" ? (
                    <FieldRow
                      key={slot.key}
                      label={`MCP server: ${slot.key}`}
                      htmlFor={`tpl-res-${slot.key}`}
                      hint={
                        <>
                          {slot.description}
                          {slot.requiredTools.length ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {slot.requiredTools.map((t) => (
                                <Badge key={t} tone="outline" mono size="sm">
                                  {t}
                                </Badge>
                              ))}
                            </span>
                          ) : null}
                        </>
                      }
                    >
                      <Select
                        id={`tpl-res-${slot.key}`}
                        value={draft.picked[slot.key] ?? ""}
                        placeholder={
                          (servers.data ?? []).length
                            ? "Choose a server"
                            : "No MCP servers connected"
                        }
                        onValueChange={(v) =>
                          setDraft((d) => ({ ...d, picked: { ...d.picked, [slot.key]: v } }))
                        }
                      >
                        {(servers.data ?? []).map((m) => (
                          <SelectItem key={m.id} value={m.id} meta={`${m.toolCount} tools`}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </Select>
                    </FieldRow>
                  ) : (
                    <SourceSlot
                      key={slot.key}
                      slot={slot}
                      sources={sources.data ?? []}
                      loading={sources.isPending && s.features.knowledge === true}
                      value={draft.picked[pickKey(slot)] ?? ""}
                      onChange={(v) =>
                        setDraft((d) => ({ ...d, picked: { ...d.picked, [pickKey(slot)]: v } }))
                      }
                    />
                  ),
                )}
                {needsMcp && servers.data && servers.data.length === 0 ? (
                  <Notice>
                    Connect an MCP server under Integrations first, or create the workflow now and
                    pick the server in the builder.
                  </Notice>
                ) : null}
              </>
            ),
          } satisfies FlowStep,
        ]
      : []),
    {
      id: "review",
      doneLabel: "Ready to create",
      title: "Review and create",
      why: "Creating it saves your copy as a draft and opens it in the builder. Nothing runs, publishes or deploys until you press those buttons there.",
      done: name.length > 0,
      requirement: "give the workflow a name",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Template</dt>
            <dd className="m-0 text-ink">{template.name}</dd>
            <dt className="text-ink-3">Your copy</dt>
            <dd className="m-0 text-ink">{name || "—"}</dd>
            <dt className="text-ink-3">Needs</dt>
            <dd className="m-0 text-ink">
              {readiness.ready
                ? "Everything is set up"
                : `${readiness.checks.filter((c) => c.state === "warning").length} still to set up`}
            </dd>
          </dl>
          <div className="text-sm text-ink-2">
            <p className="m-0 font-medium text-ink">Then, in the builder</p>
            <ol className="m-0 mt-1 flex list-decimal flex-col gap-1 pl-5">
              {readiness.ready ? null : (
                <li>
                  Set up what is missing; the builder marks the steps that need it, and a saved key
                  is bound under Settings → Secrets.
                </li>
              )}
              <li>Press Run draft with an example of your own and read what each step did.</li>
              <li>
                Change steps, wording and limits until it fits; every change is saved as a draft.
              </li>
              <li>Publish and deploy it when webhooks, schedules or your code should call it.</li>
            </ol>
          </div>
          <QualityNote>
            “Ready to run” means FlowAId can find the keys and servers the template uses. Whether
            its decisions suit your cases shows only when you run it on real examples.
          </QualityNote>
        </>
      ),
    },
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent size="lg">
        {/* created only from the labelled button: Enter in the name field must not skip Review */}
        <form onSubmit={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Use “{template.name}”</DialogTitle>
            <DialogDescription>{template.description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <GuidedFlow
              steps={steps}
              status={
                <DraftStatus
                  dirty={kept.dirty}
                  restored={kept.restored}
                  onDiscard={kept.discard}
                  what="the workflow"
                />
              }
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={create.isPending}
              disabled={!name}
              onClick={() => create.mutate(undefined)}
            >
              Create workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A knowledge source for one of the template's slots, from the sources of the kind it reads
 * (PageIndex PDFs, or chunked documents); sent with the create request, so the copy opens with
 * its steps pointed at it.
 */
function SourceSlot({
  slot,
  sources,
  loading,
  value,
  onChange,
}: {
  slot: { key: string; description: string };
  sources: readonly KnowledgeSource[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const s = useSession();
  const pageindex = slotSourceKind(slot) === "pageindex";
  const fits = sourcesForSlot(slot, sources);
  return (
    <FieldRow
      label={`Knowledge source: ${slot.key}`}
      htmlFor={`tpl-src-${slot.key}`}
      hint={
        <>
          {slot.description}
          {!loading && fits.length === 0 ? (
            <>
              {" "}
              No {pageindex ? "PageIndex source" : "source of this kind"} yet:{" "}
              <a className="text-accent-text hover:underline" href={`/${s.ws}/knowledge`}>
                add one under Knowledge
              </a>
              ; your choices here are kept.
            </>
          ) : null}
        </>
      }
    >
      <Select
        id={`tpl-src-${slot.key}`}
        value={value}
        disabled={fits.length === 0}
        placeholder={
          loading
            ? "Loading…"
            : fits.length
              ? "Choose a source"
              : pageindex
                ? "No PageIndex sources"
                : "No sources"
        }
        onValueChange={onChange}
      >
        {fits.map((k) => (
          <SelectItem
            key={k.id}
            value={k.id}
            meta={`${k.documents} doc${k.documents === 1 ? "" : "s"}`}
            description={KIND_LABEL[k.kind]}
          >
            {k.name}
          </SelectItem>
        ))}
      </Select>
    </FieldRow>
  );
}
