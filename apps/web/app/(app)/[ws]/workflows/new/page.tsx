"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
} from "@flowaid/ui/primitives";
import { PageHeader } from "@flowaid/ui/shell";
import { ApiError, get, post } from "~/api/client";
import { advisorAvailability } from "~/builder/advisor";
import { planFromGenerated, provenanceLine, type GeneratedWorkflow } from "~/builder/aiPlan";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { useExternalImport } from "~/importer/ExternalImport";
import { looksLikeExternalExport, parseJson } from "~/importer/report";

interface Created {
  id: string;
}

export default function NewWorkflowPage() {
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const done = (w: Created) => {
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
          description="Start from a blank canvas, a template, or a definition you already have."
        />
        {aiOn ? (
          <AIBuilderPanel
            className="mt-6"
            title="Describe it"
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
        ) : null}
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
                <FieldRow>
                  <Label htmlFor="wf-name">Name</Label>
                  <Input
                    id="wf-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={200}
                    placeholder="Support triage"
                  />
                </FieldRow>
                <FieldRow>
                  <Label htmlFor="wf-desc">Description</Label>
                  <Input
                    id="wf-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={4000}
                    placeholder="optional"
                  />
                </FieldRow>
                {blank.error ? (
                  <FieldError>
                    {blank.error instanceof ApiError
                      ? blank.error.message
                      : "Could not create the workflow."}
                  </FieldError>
                ) : null}
                <Button type="submit" disabled={!name.trim()} loading={blank.isPending}>
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
                Tested decision workflows for triage, research and routing, with their credentials
                listed up front.
              </CardDescription>
            </CardHeader>
            <CardBody>
              {s.features.templates ? (
                <Button asChild variant="secondary">
                  <Link href={`/${s.ws}/templates`}>Browse templates</Link>
                </Button>
              ) : (
                <p className="text-sm text-ink-3">Templates are not enabled on this server.</p>
              )}
            </CardBody>
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
            <CardBody className="flex flex-col gap-3">
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
              <FieldHint>The name above, when set, replaces the imported name.</FieldHint>
              {importer.error ? (
                <FieldError>
                  {importer.error instanceof ApiError ? importer.error.message : "Import failed."}
                </FieldError>
              ) : null}
              <Button
                variant="secondary"
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
                  Agent flows and LangChain chat flows from other visual builders. You see what each
                  node becomes before anything is saved.
                </FieldHint>
              </div>
              {external.dialog}
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </AppFrame>
  );
}
