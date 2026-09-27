"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FileUp, LayoutTemplate, SquarePlus } from "lucide-react";
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
import { ApiError, post } from "~/api/client";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

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
                A FlowAId definition as JSON or YAML. The compiler migrates older versions and
                reports what changed.
              </CardDescription>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <label className="text-sm text-accent underline-offset-2 hover:underline">
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
                onClick={() => importer.mutate()}
              >
                Import
              </Button>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </AppFrame>
  );
}
