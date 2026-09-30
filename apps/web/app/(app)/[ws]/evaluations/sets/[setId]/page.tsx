"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import { FlaskConical, Pencil, Play, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  IconButton,
  Input,
  NumberInput,
  ProgressBar,
  Select,
  SelectItem,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@flowaid/ui/primitives";
import { SchemaForm, withDefaults } from "@flowaid/ui/forms";
import {
  DataTable,
  RelativeTime,
  createDataTableColumns,
  type DataTableColumns,
} from "@flowaid/ui/data";
import { formatPercent } from "@flowaid/ui/lib";
import { PageHeader } from "@flowaid/ui/shell";
import { del, get, getAll, patch, post, qs } from "~/api/client";
import type { Page, VersionSummary, WorkflowDetail, WorkflowSummary } from "~/api/types";
import {
  expectationSummary,
  expectationTemplate,
  parseJsonObject,
  parseJsonText,
  parseTags,
  pretty,
  runTone,
} from "~/admin/logic";
import type { EvaluationCase, EvaluationRun, EvaluationSet } from "~/admin/types";
import { JsonField, Notice, QueryView, Section, useConfirm, useMutate } from "~/admin/ui";
import { caseCoverage } from "~/evaluations/logic";
import { CaseGuide, EXAMPLE_EXPECTATION, ExpectationHelp } from "~/evaluations/SetGuide";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { errorMessage } from "~/shell/states";

const DRAFT = "__draft";
const NONE = "__none";

/** Required top-level input fields the value leaves out (or leaves as empty text). */
function missingRequired(schema: unknown, value: unknown): string[] {
  const s = schema as { required?: unknown; properties?: Record<string, { title?: string }> };
  if (!Array.isArray(s?.required)) return [];
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return (s.required as string[])
    .filter((k) => obj[k] === undefined || obj[k] === "")
    .map((k) => s.properties?.[k]?.title ?? k);
}

function CaseDialog({
  setId,
  workflowId,
  editing,
  onClose,
}: {
  setId: string;
  /** the set's workflow: its input schema turns the input into a form */
  workflowId: string | null;
  editing: EvaluationCase | "new" | null;
  onClose: () => void;
}) {
  const s = useSession();
  const existing = editing && editing !== "new" ? editing : null;
  const workflow = useQuery({
    queryKey: ["workflow", s.ws, workflowId],
    queryFn: () => get<WorkflowDetail>(`/v1/workflows/${workflowId as string}`),
    enabled: Boolean(workflowId),
  });
  const schema = workflow.data?.draft.inputs as
    { type?: string; properties?: Record<string, unknown> } | undefined;
  const hasForm = Boolean(schema?.properties && Object.keys(schema.properties).length > 0);
  const [inputMode, setInputMode] = useState<"form" | "json" | null>(null);
  const mode = inputMode ?? (hasForm ? "form" : "json");
  // the form is uncontrolled: it re-seeds when the JSON editor hands a value back
  const [seed, setSeed] = useState(0);
  const [input, setInput] = useState<string | null>(existing ? pretty(existing.input) : null);
  const inputText =
    input ?? pretty(schema && hasForm ? withDefaults(schema as never, {}) : { message: "" });
  const [expected, setExpected] = useState(pretty(existing?.expected ?? expectationTemplate()));
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const inputOk = parseJsonText(inputText);
  const expectedOk = parseJsonObject(expected);
  // a case without the workflow's required inputs only tests the input check
  const missing = inputOk.ok ? missingRequired(schema, inputOk.value) : [];
  const save = useMutate(
    () => {
      const body = {
        input: inputOk.ok ? inputOk.value : null,
        expected: expectedOk.ok ? expectedOk.value : {},
        tags: parseTags(tags),
      };
      return existing
        ? patch(`/v1/evaluations/cases/${existing.id}`, body)
        : post(`/v1/evaluations/sets/${setId}/cases`, body);
    },
    {
      success: existing ? "Case saved" : "Case added",
      invalidate: [["evaluation-cases", s.ws, setId]],
      onSuccess: onClose,
      errorTitle: "The case was not saved",
    },
  );
  return (
    <Dialog open={editing !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg">
        {/* not a <form>: the input form (SchemaForm) renders its own, and forms cannot nest */}
        <div>
          <DialogHeader>
            <DialogTitle>{existing ? `Edit case ${existing.ordinal + 1}` : "New case"}</DialogTitle>
            <DialogDescription>
              The expectation uses the evaluation schema: <code className="font-mono">output</code>{" "}
              matchers (equals, contains, regex, schema, range, judge),{" "}
              <code className="font-mono">decisions</code>,{" "}
              <code className="font-mono">branches</code>, tools, status, latency and cost bounds.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid max-h-[70vh] gap-4 overflow-auto lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              {hasForm ? (
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={mode}
                  onValueChange={(v) => {
                    if (v === "form") setSeed((n) => n + 1);
                    if (v === "form" || v === "json") setInputMode(v);
                  }}
                  aria-label="Input editor"
                  className="self-start"
                >
                  <ToggleGroupItem value="form">Form</ToggleGroupItem>
                  <ToggleGroupItem value="json">JSON</ToggleGroupItem>
                </ToggleGroup>
              ) : null}
              {mode === "form" && hasForm ? (
                <FieldRow
                  label="Input"
                  hint="What the run starts with, from the workflow's inputs"
                  {...(missing.length
                    ? {
                        error: `Fill in the required ${missing.length === 1 ? "field" : "fields"}: ${missing.join(", ")}`,
                      }
                    : {})}
                >
                  <SchemaForm
                    key={seed}
                    schema={schema as never}
                    defaultValues={(inputOk.ok ? inputOk.value : {}) as Record<string, unknown>}
                    onChange={(v) => setInput(pretty(v))}
                    aria-label="Case input"
                  />
                </FieldRow>
              ) : (
                <JsonField
                  id="case-input"
                  label="Input"
                  value={inputText}
                  onChange={setInput}
                  error={
                    inputOk.ok
                      ? missing.length
                        ? `Leaves out required ${missing.length === 1 ? "field" : "fields"} ${missing.join(", ")}. Runs refuse such input; keep it only to test that refusal.`
                        : null
                      : inputOk.error
                  }
                  minRows={10}
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <JsonField
                id="case-expected"
                label="Expected"
                value={expected}
                onChange={setExpected}
                error={expectedOk.ok ? null : expectedOk.error}
                minRows={10}
              />
              <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                <span>
                  Check the answer, not only that the run finishes. The example's step ids are
                  placeholders: use your workflow's.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  onClick={() => setExpected(pretty(EXAMPLE_EXPECTATION))}
                >
                  Use the example
                </Button>
              </p>
              <ExpectationHelp />
            </div>
            <FieldRow
              label="Tags"
              htmlFor="case-tags"
              hint="Comma separated"
              className="lg:col-span-2"
            >
              <Input id="case-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </FieldRow>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={save.isPending}
              // the form view blocks a case missing required fields; JSON (for testing the
              // refusal on purpose) only warns
              disabled={!inputOk.ok || !expectedOk.ok || (mode === "form" && missing.length > 0)}
              onClick={() => save.mutate(undefined)}
            >
              {existing ? "Save case" : "Add case"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RunDialog({
  set,
  open,
  onOpenChange,
  previous,
  caseCount,
}: {
  set: EvaluationSet;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  previous: EvaluationRun[];
  caseCount: number;
}) {
  const s = useSession();
  const router = useRouter();
  const [workflowId, setWorkflowId] = useState(set.workflowId ?? "");
  // null until chosen: the latest published version when there is one (what callers run), else the draft
  const [chosenVersion, setVersion] = useState<string | null>(null);
  const [env, setEnv] = useState(s.environments[0]?.id ?? "");
  const [baseline, setBaseline] = useState(NONE);
  const [concurrency, setConcurrency] = useState<number | null>(4);
  const [gated, setGated] = useState(false);
  const [minPass, setMinPass] = useState<number | null>(0.9);
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=200"),
    select: (p) => p.items,
    enabled: open && !set.workflowId,
  });
  const versions = useQuery({
    queryKey: ["versions", s.ws, workflowId],
    queryFn: () => getAll<VersionSummary>(`/v1/workflows/${workflowId}/versions`),
    enabled: open && Boolean(workflowId),
    select: (v) =>
      v.filter((x) => x.kind === "published").sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
  });
  const version = chosenVersion ?? versions.data?.[0]?.id ?? DRAFT;
  const start = useMutate(
    () =>
      post<EvaluationRun>("/v1/evaluations/runs", {
        setId: set.id,
        workflowId,
        ...(version === DRAFT ? { draft: true } : { versionId: version }),
        environmentId: env,
        concurrency: concurrency ?? 4,
        ...(baseline !== NONE ? { baselineEvaluationRunId: baseline } : {}),
        ...(gated && minPass !== null ? { gate: { minPassRate: minPass } } : {}),
      }),
    {
      success: "Evaluation started",
      invalidate: [["evaluation-runs", s.ws]],
      onSuccess: (r) => router.push(`/${s.ws}/evaluations/runs/${r.id}`),
    },
  );
  const baselines = previous.filter((r) => r.status === "completed" && r.workflowId === workflowId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {/* runs start only from the labelled button, never from Enter in a field */}
        <form onSubmit={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Run “{set.name}”</DialogTitle>
            <DialogDescription>
              Every case runs as a real workflow run (labelled as an evaluation), with human steps
              auto-answered from the case.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Notice tone="info">
              Starting runs the workflow {caseCount} time{caseCount === 1 ? "" : "s"}, once per
              case. Its steps call their models and tools for real with the chosen environment's
              keys, so this may cost money with your providers and any tool that changes data will
              change it. Nothing is published or deployed.
            </Notice>
            {!set.workflowId ? (
              <FieldRow label="Workflow" htmlFor="run-wf" required>
                <Select
                  id="run-wf"
                  value={workflowId}
                  placeholder="Choose a workflow"
                  onValueChange={(v) => {
                    setWorkflowId(v);
                    setVersion(null);
                    setBaseline(NONE);
                  }}
                >
                  {(workflows.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow
                label="Version"
                htmlFor="run-version"
                required
                hint="The draft tests unpublished changes; a version tests what callers run."
              >
                <Select id="run-version" value={version} onValueChange={setVersion} mono>
                  <SelectItem value={DRAFT}>Current draft</SelectItem>
                  {(versions.data ?? []).map((v, i) => (
                    <SelectItem
                      key={v.id}
                      value={v.id}
                      {...(i === 0 ? { description: "Latest published" } : {})}
                    >
                      v{v.version}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              <FieldRow
                label="Environment"
                htmlFor="run-env"
                required
                hint="Secrets and variables come from here"
              >
                <Select id="run-env" value={env} onValueChange={setEnv}>
                  {s.environments.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              <FieldRow
                label="Compare with"
                htmlFor="run-baseline"
                hint="An earlier run of this set: the report shows what changed per case."
              >
                <Select id="run-baseline" value={baseline} onValueChange={setBaseline}>
                  <SelectItem value={NONE}>No baseline</SelectItem>
                  {baselines.map((r) => (
                    <SelectItem
                      key={r.id}
                      value={r.id}
                      meta={r.summary ? formatPercent(r.summary.passRate) : undefined}
                    >
                      {new Date(r.createdAt).toLocaleString()}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              <FieldRow
                label="Concurrency"
                htmlFor="run-conc"
                hint="Cases in flight at once (1–16)"
              >
                <NumberInput
                  id="run-conc"
                  value={concurrency}
                  min={1}
                  max={16}
                  onValueChange={setConcurrency}
                />
              </FieldRow>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <Switch size="sm" checked={gated} onCheckedChange={setGated} />
                Gate on pass rate
              </label>
              {gated ? (
                <NumberInput
                  aria-label="Minimum pass rate"
                  value={minPass}
                  min={0}
                  max={1}
                  step={0.05}
                  precision={2}
                  onValueChange={setMinPass}
                  className="w-28"
                />
              ) : null}
              <p className="m-0 w-full text-xs text-ink-3">
                {gated
                  ? `The report is marked Gate failed below ${Math.round((minPass ?? 0) * 100)}% of cases passing. It blocks nothing by itself: publishing checks its own gate when you publish.`
                  : "Optional: marks the report pass or fail against a minimum share of passing cases."}
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              leadingIcon={<Play strokeWidth={1.75} />}
              onClick={() => start.mutate(undefined)}
              loading={start.isPending}
              disabled={!workflowId || !env}
            >
              Start evaluation ({caseCount} run{caseCount === 1 ? "" : "s"})
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SetPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = use(params);
  const s = useSession();
  const router = useRouter();
  const canWrite = s.can("evaluations:write");
  const [editing, setEditing] = useState<EvaluationCase | "new" | null>(null);
  const [running, setRunning] = useState(false);
  const confirmCase = useConfirm<EvaluationCase>();
  const [deleting, setDeleting] = useState(false);
  const set = useQuery({
    queryKey: ["evaluation-set", s.ws, setId],
    queryFn: () => get<EvaluationSet>(`/v1/evaluations/sets/${setId}`),
  });
  const cases = useQuery({
    queryKey: ["evaluation-cases", s.ws, setId],
    queryFn: () => get<Page<EvaluationCase>>(`/v1/evaluations/sets/${setId}/cases?limit=200`),
  });
  const runs = useQuery({
    queryKey: ["evaluation-runs", s.ws, setId],
    queryFn: () => get<Page<EvaluationRun>>(`/v1/evaluations/runs${qs({ setId, limit: 50 })}`),
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === "running" || r.status === "queued")
        ? 3000
        : false,
  });
  const versionNo = useQuery({
    queryKey: ["versions", s.ws, set.data?.workflowId],
    queryFn: () => getAll<VersionSummary>(`/v1/workflows/${set.data?.workflowId ?? ""}/versions`),
    enabled: Boolean(set.data?.workflowId),
    select: (vs) => new Map(vs.map((v) => [v.id, v.version])),
  });
  const versionLabel = (id: string | null) => {
    if (!id) return "draft";
    const n = versionNo.data?.get(id);
    // the draft is compiled into a version without a number
    return n ? `v${n}` : versionNo.data?.has(id) ? "draft" : "";
  };
  const removeCase = useMutate((c: EvaluationCase) => del(`/v1/evaluations/cases/${c.id}`), {
    success: "Case deleted",
    invalidate: [["evaluation-cases", s.ws, setId]],
    onSuccess: confirmCase.close,
  });
  const removeSet = useMutate(() => del(`/v1/evaluations/sets/${setId}`), {
    success: "Set deleted",
    invalidate: [["evaluation-sets", s.ws]],
    onSuccess: () => router.push(`/${s.ws}/evaluations`),
  });

  const col = createDataTableColumns<EvaluationCase>();
  const columns = useMemo<DataTableColumns<EvaluationCase>>(
    () =>
      col.columns([
        col.accessor("ordinal", {
          header: "#",
          size: 56,
          meta: { numeric: true, mono: true },
          cell: ({ getValue }) => getValue() + 1,
        }),
        col.accessor((c) => JSON.stringify(c.input), {
          id: "input",
          header: "Input",
          size: 320,
          meta: { grow: true, mono: true },
          cell: ({ getValue }) => (
            <span className="block truncate text-2xs text-ink-2">{getValue()}</span>
          ),
        }),
        col.accessor((c) => expectationSummary(c.expected), {
          id: "expects",
          header: "Expects",
          size: 240,
          cell: ({ getValue }) => <span className="text-xs text-ink-2">{getValue()}</span>,
        }),
        col.accessor((c) => c.tags.join(" "), {
          id: "tags",
          header: "Tags",
          size: 160,
          cell: ({ row }) => (
            <span className="flex flex-wrap gap-1">
              {row.original.tags.map((t) => (
                <Badge key={t} tone="outline" size="sm">
                  {t}
                </Badge>
              ))}
              {row.original.sourceRunId ? (
                <Badge tone="info" size="sm">
                  from run
                </Badge>
              ) : null}
            </span>
          ),
        }),
        col.display({
          id: "actions",
          header: "",
          size: 80,
          cell: ({ row }) =>
            canWrite ? (
              <span className="flex justify-end gap-1">
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Edit case ${row.original.ordinal + 1}`}
                  onClick={() => setEditing(row.original)}
                >
                  <Pencil strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Delete case ${row.original.ordinal + 1}`}
                  onClick={() => confirmCase.ask(row.original)}
                >
                  <Trash2 strokeWidth={1.75} />
                </IconButton>
              </span>
            ) : null,
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite],
  );
  const caseCount = cases.data?.items.length ?? 0;
  const testedWorkflowId = set.data?.workflowId ?? null;
  const tested = useQuery({
    queryKey: ["workflow", s.ws, testedWorkflowId],
    queryFn: () => get<WorkflowDetail>(`/v1/workflows/${testedWorkflowId as string}`),
    enabled: Boolean(testedWorkflowId),
  });
  const coverage = useMemo(() => caseCoverage(cases.data?.items ?? []), [cases.data]);

  return (
    <AppFrame
      crumbs={[
        { label: s.workspaceName },
        { label: "Evaluations", href: `/${s.ws}/evaluations` },
        { label: set.data?.name ?? "…" },
      ]}
    >
      <PageBody>
        <QueryView query={set}>
          {(x) => (
            <>
              <PageHeader
                title={x.name}
                description={
                  [
                    x.workflowId
                      ? `Tests ${tested.data?.name ?? "its workflow"}.`
                      : "Not tied to a workflow: choose one when you run it.",
                    x.description,
                    canWrite && cases.data && caseCount === 0
                      ? "Add a case before running an evaluation."
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                actions={
                  canWrite ? (
                    <>
                      <Button variant="danger" onClick={() => setDeleting(true)}>
                        Delete set
                      </Button>
                      <Button
                        leadingIcon={<Plus strokeWidth={1.75} />}
                        onClick={() => setEditing("new")}
                      >
                        Add case
                      </Button>
                      <Button
                        variant="primary"
                        leadingIcon={<Play strokeWidth={1.75} />}
                        disabled={caseCount === 0}
                        onClick={() => setRunning(true)}
                      >
                        Run evaluation
                      </Button>
                    </>
                  ) : null
                }
              />
              <div className="mt-5 flex flex-col gap-5">
                {cases.data ? <CaseGuide coverage={coverage} count={caseCount} /> : null}
                <Section
                  title={`Cases (${caseCount})`}
                  description="Each case is an input and what a right run looks like. Cases marked “from run” were captured from real runs."
                >
                  <DataTable
                    columns={columns}
                    data={cases.data?.items ?? []}
                    getRowId={(c) => c.id}
                    loading={cases.isPending}
                    error={
                      cases.isError
                        ? {
                            message: errorMessage(cases.error),
                            onRetry: () => void cases.refetch(),
                          }
                        : null
                    }
                    emptyState={
                      <EmptyState
                        size="sm"
                        icon={<FlaskConical strokeWidth={1.5} />}
                        title="No cases yet"
                        description="Add cases by hand, or open a finished run and choose “Add to evaluation” to capture its input, decisions and branches."
                      />
                    }
                    itemLabel={["case", "cases"]}
                    aria-label="Cases"
                  />
                </Section>
                <Section
                  title="Runs"
                  description="Each evaluation run scores every case against one version. Open one for its report."
                >
                  <QueryView query={runs} rows={2}>
                    {(p) =>
                      p.items.length === 0 ? (
                        <p className="text-xs text-ink-3">This set has not been run yet.</p>
                      ) : (
                        <ul
                          className="flex flex-col divide-y divide-border rounded-md border border-border"
                          role="list"
                        >
                          {p.items.map((r) => (
                            <li key={r.id}>
                              <Link
                                href={`/${s.ws}/evaluations/runs/${r.id}`}
                                className="flex flex-wrap items-center gap-3 px-3 py-2 hover:bg-surface-3"
                              >
                                <Badge tone={runTone(r.status)} dot className="capitalize">
                                  {r.status}
                                </Badge>
                                <span className="text-xs text-ink-2">
                                  <RelativeTime date={r.createdAt} />
                                </span>
                                <span className="font-mono text-2xs text-ink-3">
                                  {versionLabel(r.workflowVersionId)}
                                </span>
                                {r.status === "running" || r.status === "queued" ? (
                                  <ProgressBar
                                    value={r.total ? r.completed / r.total : 0}
                                    className="w-40"
                                    aria-label="Progress"
                                  />
                                ) : null}
                                <span className="ml-auto flex items-center gap-2 text-xs">
                                  {r.summary ? (
                                    <span className="font-mono text-ink">
                                      {formatPercent(r.summary.passRate)} pass
                                    </span>
                                  ) : null}
                                  {r.report?.gate ? (
                                    <Badge tone={r.report.verdict === "pass" ? "ok" : "danger"}>
                                      {r.report.verdict === "pass" ? "Gate passed" : "Gate failed"}
                                    </Badge>
                                  ) : null}
                                  <span className="text-ink-3">
                                    {r.completed}/{r.total}
                                  </span>
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  </QueryView>
                </Section>
              </div>
              {running ? (
                <RunDialog
                  set={x}
                  open={running}
                  onOpenChange={setRunning}
                  previous={runs.data?.items ?? []}
                  caseCount={caseCount}
                />
              ) : null}
            </>
          )}
        </QueryView>
      </PageBody>
      {editing !== null ? (
        <CaseDialog
          key={editing === "new" ? "new" : editing.id}
          setId={setId}
          workflowId={set.data?.workflowId ?? null}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmCase.target !== null}
        onOpenChange={(o) => (o ? undefined : confirmCase.close())}
        title={`Delete case ${(confirmCase.target?.ordinal ?? 0) + 1}?`}
        variant="danger"
        confirmLabel="Delete"
        loading={removeCase.isPending}
        onConfirm={() => {
          if (confirmCase.target) removeCase.mutate(confirmCase.target);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${set.data?.name ?? "this set"}?`}
        description="Its cases and evaluation reports are deleted. Workflow runs made by evaluations are kept."
        variant="danger"
        confirmLabel="Delete set"
        loading={removeSet.isPending}
        onConfirm={() => removeSet.mutate(undefined)}
      />
    </AppFrame>
  );
}
