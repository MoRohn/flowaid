"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { FileUp, LayoutTemplate, SquarePlus } from "lucide-react";
import type { NodeManifest } from "@flowaid/workflow-core";
import { AIBuilderPanel } from "@flowaid/ui/builder";
import { CodeEditor } from "@flowaid/ui/forms";
import {
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
  FieldHint,
  FieldRow,
  Input,
  Label,
  RadioGroup,
  RadioItem,
} from "@flowaid/ui/primitives";
import { PageHeader } from "@flowaid/ui/shell";
import { ApiError, get, post } from "~/api/client";
import { advisorAvailability } from "~/builder/advisor";
import { planFromGenerated, provenanceLine, type GeneratedWorkflow } from "~/builder/aiPlan";
import type { TemplateRow } from "~/admin/types";
import { NEW_WORKFLOW } from "~/guide/capabilities/workflows";
import { DraftStatus, GuidedFlow, useFlowMode, type FlowStep } from "~/guide/GuidedFlow";
import { PageIntro } from "~/guide/PageIntro";
import { CheckList, QualityNote, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { generationCheck, typesafeCheck, useConnections } from "~/guide/useConnections";
import { useSession } from "~/session";
import { businessArea, splitBusinessFlows } from "~/templates/business";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { useExternalImport } from "~/importer/ExternalImport";
import { looksLikeExternalExport, parseJson } from "~/importer/report";
import {
  DESCRIBE_EXAMPLES,
  chosenMethod,
  emptyNewWorkflow,
  startOptions,
  type StartMethod,
} from "~/workflows/startOptions";

interface Created {
  id: string;
}

export default function NewWorkflowPage() {
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  // name, description and the chosen start survive closing the tab's page or a reload; the
  // pasted definition is not kept (exports can carry keys)
  const kept = useKeptDraft(`flowaid:draft:${s.ws}:workflow`, emptyNewWorkflow);
  const { name, description } = kept.draft;
  const setName = (v: string) => kept.setDraft((d) => ({ ...d, name: v }));
  const setDescription = (v: string) => kept.setDraft((d) => ({ ...d, description: v }));
  const [source, setSource] = useState("");
  const [mode] = useFlowMode();
  const done = (w: Created) => {
    kept.discard();
    void qc.invalidateQueries({ queryKey: ["workflows", s.ws] });
    router.push(`/${s.ws}/workflows/${w.id}`);
  };
  const blank = useMutation({
    mutationFn: () =>
      post<Created>("/v1/workflows", {
        name: name.trim(),
        ...(description ? { description } : {}),
      }),
    onSuccess: done,
  });
  const external = useExternalImport({
    ...(name.trim() ? { name: name.trim() } : {}),
    onImported: (id) => done({ id }),
  });
  const importer = useMutation({
    mutationFn: async () => {
      const text = source.trim();
      let body: Record<string, unknown>;
      try {
        body = { definition: JSON.parse(text) as unknown };
      } catch {
        body = { yaml: text };
      }
      const res = await post<{ workflow: Created; diagnostics: unknown[] }>(
        "/v1/workflows/import",
        {
          ...body,
          ...(name.trim() ? { name: name.trim() } : {}),
        },
      );
      return res.workflow;
    },
    onSuccess: done,
  });

  // --- AI builder (features.ai_builder): nothing is saved until the plan is applied ---
  const aiOn = advisorAvailability(s.features, s.can("workflows:write")).aiBuilder;
  const [prompt, setPrompt] = useState("");
  const nodes = useQuery({
    queryKey: ["catalog", "nodes"],
    queryFn: () => get<NodeManifest[]>("/v1/nodes"),
    staleTime: 10 * 60_000,
    enabled: aiOn,
  });
  const generate = useMutation({
    mutationFn: (p: { prompt: string; base?: unknown }) =>
      post<GeneratedWorkflow>("/v1/workflows/ai/generate", {
        prompt: p.prompt,
        ...(p.base ? { baseDefinition: p.base } : {}),
      }),
  });
  const generated = generate.data;
  const plan = generated ? planFromGenerated(generated, nodes.data ?? []) : null;
  const applyGenerated = useMutation({
    mutationFn: () => {
      const def = generated?.definition;
      if (!def) throw new Error("Nothing to apply");
      return post<Created>("/v1/workflows", {
        name: name.trim() || def.name,
        ...(description ? { description } : {}),
        definition: def,
      });
    },
    onSuccess: done,
  });
  const aiError =
    generate.error || applyGenerated.error
      ? (generate.error ?? applyGenerated.error) instanceof ApiError
        ? (generate.error ?? applyGenerated.error)?.message
        : "The AI builder could not draft a workflow."
      : generated && !generated.definition
        ? "The model did not return a workflow. Try describing it differently."
        : undefined;

  const readFile = async (file: File | undefined) => {
    if (file) setSource(await file.text());
  };

  const submitBlank = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) blank.mutate();
  };

  const offered = startOptions({ aiBuilder: aiOn, templates: s.features.templates === true });
  const method = chosenMethod(kept.draft, offered);
  const connections = useConnections();
  const checks: Check[] = [
    {
      ...generationCheck(connections, s.ws, {
        required: method === "describe",
        need: "Describe it and steps that write text",
      }),
    },
    // decision steps fail without it, but a workflow can be created (and built) before it is added
    ((c) => (c.state === "blocker" ? { ...c, state: "warning" as const } : c))(
      typesafeCheck(connections, s.ws, "Decision steps"),
    ),
  ];

  const aiPanel = aiOn ? (
    <AIBuilderPanel
      title="Describe it"
      examplePrompts={DESCRIBE_EXAMPLES}
      // one blocking request, so "generating" rather than "streaming"; Apply is "saving"
      status={
        generate.isPending
          ? "generating"
          : applyGenerated.isPending
            ? "saving"
            : aiError
              ? "error"
              : plan
                ? "done"
                : "idle"
      }
      {...(aiError ? { error: aiError } : {})}
      plan={plan}
      {...(generated?.definition ? { provenance: provenanceLine(generated) } : {})}
      {...(prompt ? { prompt } : {})}
      initialDraft={kept.draft.idea ?? ""}
      onDraftChange={(idea) => kept.setDraft((d) => ({ ...d, idea }))}
      onSubmit={(p) => {
        setPrompt(p);
        generate.mutate({ prompt: p });
      }}
      onRefine={(p) => {
        setPrompt(p);
        generate.mutate({ prompt: p, base: generated?.definition ?? undefined });
      }}
      onRetry={() => prompt && generate.mutate({ prompt })}
      onDiscard={() => {
        generate.reset();
        setPrompt("");
      }}
      onApply={() => applyGenerated.mutate()}
    />
  ) : null;

  const nameFields = (
    <>
      <FieldRow>
        <Label htmlFor="wf-name">Name</Label>
        <Input
          id="wf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="For example: Support triage"
          aria-describedby="wf-name-hint"
        />
        <FieldHint id="wf-name-hint">
          Required to create a blank workflow; replaces the name a drafted or imported one comes
          with. You can rename it later from the builder&apos;s title.
        </FieldHint>
      </FieldRow>
      <FieldRow>
        <Label htmlFor="wf-desc">Description</Label>
        <Input
          id="wf-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          placeholder="Optional: what this workflow is for"
        />
      </FieldRow>
    </>
  );

  const blankForm = (
    <form onSubmit={submitBlank} className="flex flex-col gap-3">
      <p className="m-0 text-sm text-ink-2">
        {name.trim() ? (
          <>
            Creates <span className="font-medium text-ink">{name.trim()}</span>
            {description.trim() ? " with your description" : ""} and opens it in the builder.
          </>
        ) : (
          "Go back to the first step and give it a name."
        )}
      </p>
      {blank.error ? (
        <FieldError>
          {blank.error instanceof ApiError ? blank.error.message : "Could not create the workflow."}{" "}
          Your name and description are kept; try again.
        </FieldError>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        disabled={!name.trim()}
        loading={blank.isPending}
        className="self-start"
      >
        Create
      </Button>
    </form>
  );

  const templatePicks = s.features.templates ? (
    <div className="flex flex-col gap-3">
      <BusinessFlowPicks ws={s.ws} />
      <Button asChild variant="secondary" className="self-start">
        <Link href={`/${s.ws}/templates`}>Browse all templates</Link>
      </Button>
    </div>
  ) : (
    <p className="text-sm text-ink-3">Templates are not enabled on this server.</p>
  );

  const importForm = (
    <div className="flex flex-col gap-3">
      {/* the input is visually hidden: its keyboard focus ring is drawn on the label */}
      <label className="cursor-pointer self-start rounded-xs px-0.5 text-sm text-accent underline-offset-2 hover:underline has-[:focus-visible]:underline has-[:focus-visible]:shadow-(--focus)">
        <input
          type="file"
          accept=".json,.yaml,.yml,application/json,text/yaml"
          className="sr-only"
          onChange={(e) => void readFile(e.target.files?.[0])}
        />
        Choose a file…
      </label>
      <CodeEditor
        language={source.trim().startsWith("{") ? "json" : "yaml"}
        value={source}
        onChange={setSource}
        minRows={6}
        maxRows={14}
        placeholder="…or paste a definition"
        aria-label="Definition"
      />
      <FieldHint>
        The name above, when set, replaces the imported name. The pasted text is not kept if you
        leave this page.
      </FieldHint>
      {importer.error ? (
        <FieldError>
          {importer.error instanceof ApiError ? importer.error.message : "Import failed."}
        </FieldError>
      ) : null}
      <Button
        variant="secondary"
        className="self-start"
        disabled={!source.trim()}
        loading={importer.isPending}
        onClick={() =>
          // an external flow export goes through the FlowAId importer and its report
          looksLikeExternalExport(parseJson(source))
            ? external.analyse(source, "pasted flow")
            : importer.mutate()
        }
      >
        Import
      </Button>
      <div className="border-t border-border pt-3">
        <Button variant="ghost" onClick={() => external.setOpen(true)}>
          Import an external flow export…
        </Button>
        <FieldHint>
          Agent flows and LangChain chat flows from other visual builders. You see what each node
          becomes before anything is saved.
        </FieldHint>
      </div>
      {external.dialog}
    </div>
  );

  const build: Record<StartMethod, ReactNode> = {
    describe: (
      <div className="flex flex-col gap-3">
        {!connections.loading && connections.generation.length === 0 ? (
          <CheckList checks={checks.slice(0, 1)} aria-label="What Describe it needs" />
        ) : null}
        {aiPanel}
        <QualityNote>
          Generate plan calls your text model, which your provider charges for as usual; the plan
          says what the call recorded. The plan is a first draft: read each decision and step before
          applying it, then run the draft on real examples in the builder. Nothing runs until you
          press Run there.
        </QualityNote>
      </div>
    ),
    blank: blankForm,
    template: templatePicks,
    import: importForm,
  };

  const chooser = (
    <RadioGroup
      value={method ?? ""}
      onValueChange={(v) => kept.setDraft((d) => ({ ...d, method: v as StartMethod }))}
      aria-label="How to start"
    >
      {offered.map((o) => (
        <RadioItem
          key={o.id}
          value={o.id}
          label={o.title}
          description={
            <span className="flex flex-col gap-0.5">
              <span>{o.fits}</span>
              <span>
                <span className="font-medium text-ink-2">You get: </span>
                {o.produces}
              </span>
              <span>
                <span className="font-medium text-ink-2">Needs: </span>
                {o.needs}
              </span>
            </span>
          }
        />
      ))}
    </RadioGroup>
  );

  const chosen = offered.find((o) => o.id === method);
  const steps: FlowStep[] = [
    {
      id: "name",
      title: "Name it",
      why: "A name people will recognise in the list and in run traces. The description helps whoever opens it later.",
      done: name.trim() !== "",
      // only a blank workflow needs it; the other ways bring (or ask for) a name of their own
      optional: true,
      optionalLabel: "Needed for Blank",
      requirement: "enter a name",
      example: (
        <>
          Example: <span className="font-medium">Support triage</span>, described as “Sorts incoming
          support messages by topic and urgency, and asks a person before replying to urgent billing
          ones.”
        </>
      ),
      children: nameFields,
    },
    {
      id: "start",
      title: "Choose how to start",
      why: "Each way ends in the same place: a workflow whose draft opens in the builder. Pick the one that saves you the most work.",
      done: method !== undefined,
      requirement: "choose one",
      children: chooser,
    },
    {
      id: "build",
      title: chosen ? `${chosen.title}` : "Create it",
      why: chosen
        ? `${chosen.produces} It opens in the builder, where you can run the draft when you are ready.`
        : "Choose how to start in the previous step first.",
      done: false,
      ...(method === "describe"
        ? {
            example:
              "The suggestions under the box are examples: pick one to fill the box, then edit it to describe your own job.",
          }
        : {}),
      children: method ? build[method] : null,
    },
  ];

  return (
    <AppFrame
      crumbs={[
        { label: s.workspaceName },
        { label: "Workflows", href: `/${s.ws}/workflows` },
        { label: "New" },
      ]}
    >
      <PageBody>
        <PageHeader
          title="New workflow"
          description="Describe it, start blank, pick a template, or import a definition you already have."
        />
        <PageIntro guide={NEW_WORKFLOW} checks={checks} defaultCollapsed={kept.dirty} />
        {mode === "guided" ? (
          <section
            aria-label="New workflow"
            className="mt-6 rounded-md border border-border bg-surface p-4 shadow-1"
          >
            <GuidedFlow
              steps={steps}
              initialStep={kept.restored ? (method ? 2 : name.trim() ? 1 : 0) : 0}
              status={
                <DraftStatus
                  dirty={kept.dirty}
                  restored={kept.restored}
                  onDiscard={kept.discard}
                  what="the workflow"
                />
              }
            />
          </section>
        ) : (
          <>
            <section
              aria-label="Name and description"
              className="mt-6 flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1"
            >
              {/* the same toggle and draft as the step-by-step view */}
              <GuidedFlow
                steps={[{ ...steps[0], children: nameFields } as FlowStep]}
                status={
                  <DraftStatus
                    dirty={kept.dirty}
                    restored={kept.restored}
                    onDiscard={kept.discard}
                    what="the workflow"
                  />
                }
              />
            </section>
            {aiPanel ? <div className="mt-6">{aiPanel}</div> : null}
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <SquarePlus className="size-5 text-ink-3" strokeWidth={1.5} aria-hidden />
                  <CardTitle>Blank</CardTitle>
                  <CardDescription>
                    An input and an output, wired together. Add nodes from the palette.
                  </CardDescription>
                </CardHeader>
                <CardBody>
                  <form onSubmit={submitBlank} className="flex flex-col gap-3">
                    {blank.error ? (
                      <FieldError>
                        {blank.error instanceof ApiError
                          ? blank.error.message
                          : "Could not create the workflow."}
                      </FieldError>
                    ) : null}
                    <FieldHint>Uses the name and description above.</FieldHint>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!name.trim()}
                      loading={blank.isPending}
                    >
                      Create
                    </Button>
                  </form>
                </CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <LayoutTemplate className="size-5 text-ink-3" strokeWidth={1.5} aria-hidden />
                  <CardTitle>From a template</CardTitle>
                  <CardDescription>
                    Complete business flows for finance, sales, IT and customer service, plus
                    triage, research and document templates. Each says what it needs.
                  </CardDescription>
                </CardHeader>
                <CardBody>{templatePicks}</CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <FileUp className="size-5 text-ink-3" strokeWidth={1.5} aria-hidden />
                  <CardTitle>Import</CardTitle>
                  <CardDescription>
                    A FlowAId definition as JSON or YAML, or a flow exported from another visual
                    builder. The compiler migrates older versions and reports what changed.
                  </CardDescription>
                </CardHeader>
                <CardBody>{importForm}</CardBody>
              </Card>
            </div>
          </>
        )}
      </PageBody>
    </AppFrame>
  );
}

/** The business flows as one-click starting points (each opens its template dialog). */
function BusinessFlowPicks({ ws }: { ws: string }) {
  const templates = useQuery({
    queryKey: ["templates", ws],
    queryFn: () => get<TemplateRow[]>("/v1/templates"),
    staleTime: 5 * 60_000,
  });
  const { business } = splitBusinessFlows(templates.data ?? []);
  if (!business.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-ink">Business flows, ready to run</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {business.map((t) => (
          <li key={t.id}>
            <Link
              href={`/${ws}/templates?use=${encodeURIComponent(t.slug)}`}
              className="flex flex-col rounded-sm border border-border px-2.5 py-1.5 hover:bg-surface-3 focus-visible:shadow-(--focus) focus-visible:outline-none"
            >
              <span className="text-2xs text-ink-3">{businessArea(t)}</span>
              <span className="text-xs font-medium text-ink">{t.name}</span>
              <span className="text-2xs text-ink-2">{t.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
