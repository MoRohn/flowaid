"use client";
/**
 * The builder (UI.md §2–§4): the store owns the definition; the canvas is its projection; every
 * XYFlow callback maps to one store action (§4.2 table). Autosaves 1 s after the last change with
 * If-Match (412 → conflict dialog), compiles in a Web Worker, runs the draft and overlays the live
 * run on the canvas.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { Connection, EdgeChange, NodeChange } from "@xyflow/react";
import { Copy, Download, Rocket, Trash2 } from "lucide-react";
import type {
  CompileResult,
  NodeManifest,
  SubflowSignature,
  ToolDefinition,
  WorkflowDefinition,
} from "@flowaid/workflow-core";
import type { RunView } from "@flowaid/ui";
import {
  FlowCanvas,
  applyAutoLayout,
  toCanvasEdge,
  type CanvasEdge,
  type CanvasNode,
  type NodeDefinitionView,
} from "@flowaid/ui/canvas";
import { toFlowNode } from "@flowaid/ui/node";
import { Inspector, DiagnosticList } from "@flowaid/ui/inspector";
import { BottomPanel } from "@flowaid/ui/builder";
import { TraceTimeline } from "@flowaid/ui/trace";
import { JsonView } from "@flowaid/ui/data";
import { withDefaults } from "@flowaid/ui/forms";
import { isEditableTarget } from "@flowaid/ui/shell";
import {
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
  toast,
} from "@flowaid/ui/primitives";
import { ApiError, del, get, patch, post, put } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { useSession } from "~/session";
import { AppFrame } from "~/shell/AppFrame";
import { WorkflowTabs } from "~/shell/WorkflowTabs";
import {
  Catalog,
  STRUCTURAL_KINDS,
  bindingDataEdges,
  categoryOf,
  manifestOf,
  needsLayout,
  newNode,
  parseDataEdgeId,
  project,
} from "./model";
import { createBuilderStore, type BuilderStore } from "./store";
import { useCompiler } from "./useCompiler";
import { useLiveRun } from "./useLiveRun";
import { runErrorMessage } from "./errors";
import { NodeInspector } from "./NodeInspector";
import { PublishDialog } from "./PublishDialog";
import { RunTab } from "./RunTab";

const AUTOSAVE_MS = 1000;

export interface BuilderProps {
  workflow: WorkflowDetail;
  manifests: NodeManifest[];
  tools: ToolDefinition[];
}

export function Builder({ workflow, manifests, tools }: BuilderProps) {
  const [store] = useState(() =>
    createBuilderStore({
      workflowId: workflow.id,
      definition: workflow.draft,
      draftRevision: workflow.draftRevision,
    }),
  );
  return <BuilderView store={store} workflow={workflow} manifests={manifests} tools={tools} />;
}

function BuilderView({
  store,
  workflow,
  manifests,
  tools,
}: BuilderProps & { store: BuilderStore }) {
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const definition = useStore(store, (x) => x.definition);
  const compiled = useStore(store, (x) => x.compile);
  const selection = useStore(store, (x) => x.selection);
  const version = useStore(store, (x) => x.version);
  const savedVersion = useStore(store, (x) => x.savedVersion);
  const saving = useStore(store, (x) => x.saving);
  const saveError = useStore(store, (x) => x.saveError);
  const conflict = useStore(store, (x) => x.conflict);
  const notice = useStore(store, (x) => x.notice);
  const history = useStore(store, (x) => x.history);
  const epoch = useStore(store, (x) => x.epoch);
  const readOnly = !s.can("workflows:write");
  const catalog = useMemo(() => new Catalog(manifests), [manifests]);

  // --- compile (Web Worker, 150 ms debounce) with the subflow signatures the draft references ---
  const subflowIds = useMemo(
    () =>
      [
        ...new Set(definition.nodes.flatMap((n) => (n.kind === "subflow" ? [n.workflowId] : []))),
      ].sort(),
    [definition.nodes],
  );
  const subflows = useQuery({
    queryKey: ["signatures", subflowIds],
    queryFn: async () => {
      const out: Record<string, SubflowSignature | null> = {};
      await Promise.all(
        subflowIds.map(async (id) => {
          out[id] = await get<SubflowSignature>(`/v1/workflows/${id}/signature`).catch(() => null);
        }),
      );
      return out;
    },
  });
  const compileContext = useMemo(
    () => (subflows.data ? { manifests, tools, subflows: subflows.data } : null),
    [manifests, tools, subflows.data],
  );
  useCompiler(
    definition,
    compileContext,
    useCallback(
      (r: CompileResult) =>
        store.getState().setCompile({ plan: r.ok ? r.plan : null, diagnostics: r.diagnostics }),
      [store],
    ),
  );

  // --- one-time auto layout for definitions without usable positions (imports, API, templates) ---
  useEffect(() => {
    const d = store.getState().definition;
    if (!needsLayout(d)) return;
    const laid = applyAutoLayout(
      d.nodes.map((n) => ({
        id: n.id,
        ...(n.parent ? { parent: n.parent } : {}),
        position: { x: 0, y: 0 },
      })),
      [
        ...d.edges.map((e) => ({ id: e.id, source: e.from.node, target: e.to.node })),
        // data dependencies order the layers too (a gate sits after what it reads)
        ...bindingDataEdges(d).map((e, i) => ({
          id: `d${i}`,
          source: e.from.node,
          target: e.to.node,
        })),
      ],
    );
    store.getState().moveNodes(Object.fromEntries(laid.map((n) => [n.id, n.position])));
  }, [store]);

  // --- live run overlay ---
  const [runId, setRunId] = useState<string | null>(null);
  const [runInput, setRunInput] = useState<Record<string, unknown> | null>(null);
  const [envId, setEnvId] = useState<string | null>(
    () => s.environments.find((e) => !e.protected)?.id ?? s.environments[0]?.id ?? null,
  );
  const [starting, setStarting] = useState(false);
  const [bottomTab, setBottomTab] = useState("run");
  const [title, setTitle] = useState(workflow.name);
  const lookup = useMemo(
    () => ({
      categoryFor: (id: string) => {
        const n = definition.nodes.find((x) => x.id === id);
        return n ? categoryOf(n, catalog) : undefined;
      },
      nameFor: (id: string) => definition.nodes.find((x) => x.id === id)?.name,
    }),
    [definition.nodes, catalog],
  );
  const live = useLiveRun(runId, lookup);
  const runView: RunView | undefined = live
    ? {
        id: live.runId,
        workflowId: workflow.id,
        workflowName: title,
        version: "draft",
        status: live.status,
        origin: "ui",
        createdAt: live.run?.createdAt ?? new Date().toISOString(),
        nodeRuns: live.folded.nodeRuns,
        ...(live.run?.startedAt ? { startedAt: live.run.startedAt } : {}),
        ...(live.run?.endedAt ? { endedAt: live.run.endedAt } : {}),
        ...(live.folded.output !== undefined
          ? { output: live.folded.output }
          : live.run?.output !== undefined && live.run.output !== null
            ? { output: live.run.output }
            : {}),
        ...(live.folded.error ? { error: live.folded.error } : {}),
        ...(live.folded.costUsd !== undefined ? { costUsd: live.folded.costUsd } : {}),
      }
    : undefined;

  // --- projection → XYFlow (measured sizes and selection live in local state) ---
  const projection = useMemo(
    () => project(definition, compiled.plan, compiled.diagnostics, catalog),
    [definition, compiled.plan, compiled.diagnostics, catalog],
  );
  const flowNodes = useMemo(
    () =>
      projection.nodes.map((v) => {
        const n = definition.nodes.find((x) => x.id === v.id);
        const pos = definition.layout?.nodes[v.id] ?? { x: 0, y: 0 };
        const m = n ? manifestOf(n, catalog) : undefined;
        const stream = live
          ? Object.entries(live.folded.streams).find(
              ([nr]) => live.folded.nodeRuns.find((r) => r.id === nr)?.nodeId === v.id,
            )?.[1]
          : undefined;
        return toFlowNode(
          v,
          pos,
          undefined,
          stream ? { stream: { text: stream } as never } : undefined,
          m ? { decision: m.decision, metadata: { category: m.metadata.category } } : undefined,
        );
      }),
    [projection.nodes, definition.nodes, definition.layout, catalog, live],
  );
  const flowEdges = useMemo(() => projection.edges.map(toCanvasEdge), [projection.edges]);
  // React Flow's own state is derived, not synced: measured sizes and in-flight drag positions are
  // local, selection comes from the store, everything else from the projection.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const rfNodes = useMemo(() => {
    const sel = new Set(selection.nodes);
    return flowNodes.map((n): CanvasNode => {
      const m = measured[n.id];
      const d = dragging[n.id];
      return {
        ...n,
        selected: sel.has(n.id),
        ...(m ? { measured: m } : {}),
        ...(d ? { position: d, dragging: true } : {}),
      };
    });
  }, [flowNodes, selection.nodes, measured, dragging]);
  const rfEdges = useMemo(() => {
    const sel = new Set(selection.edges);
    return flowEdges.map((e) => ({ ...e, selected: sel.has(e.id) }));
  }, [flowEdges, selection.edges]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const sizes: Record<string, { width: number; height: number }> = {};
      const moving: Record<string, { x: number; y: number }> = {};
      const ended: string[] = [];
      const removals: string[] = [];
      let selectionChanged = false;
      const sel = new Set(store.getState().selection.nodes);
      for (const c of changes) {
        switch (c.type) {
          case "dimensions":
            if (c.dimensions) sizes[c.id] = c.dimensions;
            break;
          case "position":
            if (c.position) moving[c.id] = c.position;
            if (c.dragging === false) ended.push(c.id);
            break;
          case "select":
            selectionChanged = true;
            if (c.selected) sel.add(c.id);
            else sel.delete(c.id);
            break;
          case "remove":
            removals.push(c.id);
            break;
          case "add":
          case "replace":
            break;
        }
      }
      if (Object.keys(sizes).length) setMeasured((cur) => ({ ...cur, ...sizes }));
      if (Object.keys(moving).length || ended.length)
        setDragging((cur) => {
          const next = { ...cur, ...moving };
          if (ended.length && !readOnly) {
            store
              .getState()
              .moveNodes(
                Object.fromEntries(ended.flatMap((id) => (next[id] ? [[id, next[id]]] : []))),
              );
          }
          for (const id of ended) delete next[id];
          return next;
        });
      if (selectionChanged)
        store.getState().select({ nodes: [...sel], edges: store.getState().selection.edges });
      if (removals.length && !readOnly)
        store
          .getState()
          .removeNodes(
            removals.filter((id) => definition.nodes.find((n) => n.id === id)?.kind !== "input"),
          );
    },
    [store, readOnly, definition.nodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      const removals: string[] = [];
      const sel = new Set(store.getState().selection.edges);
      let selectionChanged = false;
      for (const c of changes) {
        if (c.type === "remove") removals.push(c.id);
        else if (c.type === "select") {
          selectionChanged = true;
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        }
      }
      if (selectionChanged)
        store.getState().select({ nodes: store.getState().selection.nodes, edges: [...sel] });
      if (!removals.length || readOnly) return;
      const control = removals.filter((id) => definition.edges.some((e) => e.id === id));
      if (control.length) store.getState().removeControlEdges(control);
      for (const id of removals) {
        const target = parseDataEdgeId(id);
        if (target) store.getState().setBinding(target.node, target.port, undefined);
      }
    },
    [store, readOnly, definition.edges],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (readOnly || !c.sourceHandle || !c.targetHandle) return;
      if (c.sourceHandle.startsWith("out:") && c.targetHandle.startsWith("in:")) {
        store.getState().setBinding(c.target, c.targetHandle.slice(3), {
          kind: "ref",
          ref: { kind: "port", node: c.source, port: c.sourceHandle.slice(4) },
        });
      } else if (c.sourceHandle.startsWith("ctl:") && c.targetHandle === "ctl-in") {
        const r = store
          .getState()
          .addControlEdge({ node: c.source, port: c.sourceHandle.slice(4) }, c.target);
        if (!r.ok) toast.error(r.message);
      }
    },
    [store, readOnly],
  );

  // --- palette ---
  const palette: NodeDefinitionView[] = useMemo(
    () => [
      ...STRUCTURAL_KINDS.map((k) => ({
        kind: k.kind,
        name: k.name,
        category: k.category,
        description: k.description,
      })),
      ...catalog
        .latest()
        .filter((m) => !m.metadata.deprecated)
        .map((m) => ({
          kind: m.id,
          name: m.metadata.name,
          category: m.metadata.category,
          description: m.metadata.description,
        })),
    ],
    [catalog],
  );
  const addNode = useCallback(
    (def: NodeDefinitionView, position: { x: number; y: number }) => {
      const node = newNode(store.getState().definition, def.kind, catalog, (schema) =>
        withDefaults(schema as never, {}),
      );
      if (node) store.getState().addNode(node, position);
    },
    [store, catalog],
  );

  // --- save (autosave, ⌘S, before run/publish) ---
  const saveNow = useCallback(async (): Promise<void> => {
    const st = store.getState();
    if (st.version === st.savedVersion || st.conflict) return;
    const sent = st.version;
    st.setSaving(true);
    try {
      const res = await put<{ draftRevision: number }>(
        `/v1/workflows/${workflow.id}/draft`,
        { definition: st.definition },
        { headers: { "if-match": `"${st.draftRevision}"` } },
      );
      store.getState().markSaved(res.draftRevision, sent);
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        const theirs = await get<WorkflowDetail>(`/v1/workflows/${workflow.id}`);
        store.getState().setConflict({ theirs: theirs.draft, revision: theirs.draftRevision });
      } else store.getState().setSaving(false, e instanceof Error ? e.message : "save failed");
      throw e;
    }
  }, [store, workflow.id]);
  useEffect(() => {
    if (readOnly || version === savedVersion || saving || conflict) return;
    const t = setTimeout(() => void saveNow().catch(() => undefined), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [version, savedVersion, saving, conflict, readOnly, saveNow]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      const st = store.getState();
      if (st.version !== st.savedVersion) e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [store]);
  useEffect(() => {
    if (notice) toast(notice.message);
  }, [notice]);

  // --- run ---
  const errors = compiled.diagnostics.filter((d) => d.severity === "error");
  const startRun = useCallback(
    async (input: Record<string, unknown>) => {
      setStarting(true);
      try {
        await saveNow();
        const res = await post<{ run_id: string }>(`/v1/workflows/${workflow.id}/run`, {
          input,
          draft: true,
          mode: "async",
          ...(envId ? { environmentId: envId } : {}),
        });
        setRunId(res.run_id);
        setBottomTab("trace");
      } catch (e) {
        toast.error(runErrorMessage(e));
      } finally {
        setStarting(false);
      }
    },
    [saveNow, workflow.id, envId],
  );

  // --- keyboard (⌘S save, ⌘Z / ⇧⌘Z undo/redo, ⌘⏎ run) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "s") {
        e.preventDefault();
        void saveNow().catch(() => undefined);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!errors.length) void startRun(runInput ?? withDefaults(definition.inputs as never, {}));
      } else if (e.key.toLowerCase() === "z" && !isEditableTarget(e.target)) {
        e.preventDefault();
        if (e.shiftKey) store.getState().redo();
        else store.getState().undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow, startRun, store, errors.length, runInput, definition.inputs]);

  // --- panels ---
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectedId = selection.nodes.length === 1 ? selection.nodes[0] : undefined;
  const selectedNode = selectedId ? definition.nodes.find((n) => n.id === selectedId) : undefined;
  const selectedView = selectedId ? projection.nodes.find((n) => n.id === selectedId) : undefined;
  const selectedRun =
    selectedId && live
      ? [...live.folded.nodeRuns].reverse().find((r) => r.nodeId === selectedId)
      : undefined;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${workflow.slug || "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const inspector =
    selectedNode && selectedView ? (
      <Inspector
        node={selectedView}
        {...(selectedRun ? { nodeRun: selectedRun } : {})}
        width="fill"
        hideEmptyTabs
        onRename={
          readOnly ? undefined : (name) => store.getState().renameNode(selectedNode.id, name)
        }
        onClose={() => store.getState().select({ nodes: [], edges: [] })}
      >
        <NodeInspector
          node={selectedNode}
          manifest={manifestOf(selectedNode, catalog)}
          definition={definition}
          projection={projection}
          store={store}
          readOnly={readOnly}
          epoch={epoch}
        />
      </Inspector>
    ) : (
      <div className="p-4">
        <EmptyState
          size="sm"
          title="Nothing selected"
          description="Select a node to configure it, or press + to add one."
        />
      </div>
    );

  const bottomPanel = (
    <BottomPanel
      value={bottomTab}
      onValueChange={setBottomTab}
      tabs={[
        {
          id: "run",
          label: "Run",
          content: (
            <RunTab
              inputs={definition.inputs}
              environments={s.environments}
              environmentId={envId}
              onEnvironmentChange={setEnvId}
              value={runInput}
              onValueChange={setRunInput}
              onRun={(input) => void startRun(input)}
              running={starting}
              status={live?.status ?? null}
              disabledReason={
                errors.length
                  ? `Fix ${errors.length} error${errors.length > 1 ? "s" : ""} to run the draft.`
                  : !s.can("runs:create")
                    ? "You cannot start runs in this workspace."
                    : null
              }
            />
          ),
        },
        {
          id: "trace",
          label: "Trace",
          ...(live ? { count: live.folded.nodeRuns.length } : {}),
          content: runView ? (
            <TraceTimeline
              run={runView}
              live={
                live
                  ? !["completed", "failed", "cancelled", "timed_out"].includes(live.status)
                  : false
              }
              height="100%"
              onSelectNode={(nr) => store.getState().select({ nodes: [nr.nodeId], edges: [] })}
            />
          ) : (
            <EmptyState
              size="sm"
              title="No run yet"
              description="Run the draft to see every node's timing, decisions and cost here."
            />
          ),
        },
        {
          id: "output",
          label: "Output",
          content: (
            <div className="h-full overflow-auto p-3">
              {runView?.error ? (
                <p className="mb-3 text-sm text-danger">
                  {runView.error.code}: {runView.error.message}
                </p>
              ) : null}
              {runView?.output !== undefined ? (
                <JsonView value={runView.output} expandDepth={3} />
              ) : (
                <EmptyState
                  size="sm"
                  title="No output yet"
                  description="The run's final output appears here."
                />
              )}
            </div>
          ),
        },
        {
          id: "problems",
          label: "Problems",
          count: compiled.diagnostics.length,
          countTone: errors.length ? "danger" : "warn",
          content: (
            <div className="h-full overflow-auto p-3">
              {compiled.diagnostics.length ? (
                <DiagnosticList diagnostics={compiled.diagnostics} />
              ) : (
                <EmptyState
                  size="sm"
                  title="No problems"
                  description="The draft compiles cleanly."
                />
              )}
            </div>
          ),
        },
      ]}
    />
  );

  const saveState = conflict
    ? "error"
    : saveError
      ? "error"
      : saving
        ? "saving"
        : version !== savedVersion
          ? "unsaved"
          : "saved";

  return (
    <AppFrame
      storageKey="flowaid:builder"
      crumbs={[
        { label: s.workspaceName },
        { label: "Workflows", href: `/${s.ws}/workflows` },
        { label: title },
      ]}
      {...(!readOnly
        ? {
            // the workflow's name (lists, runs) and the definition's name move together
            onRename: (name: string) => {
              const next = name.trim().slice(0, 120);
              if (!next || next === title) return;
              setTitle(next);
              store.getState().updateDefinition((d) => {
                d.name = next;
              }, "Rename workflow");
              void patch(`/v1/workflows/${workflow.id}`, { name: next })
                .then(() => qc.invalidateQueries({ queryKey: ["workflows", s.ws] }))
                .catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Rename failed"),
                );
            },
          }
        : {})}
      saveState={saveState}
      {...(saveError ? { saveError } : {})}
      onRun={() => setBottomTab("run")}
      running={starting || live?.status === "running" || live?.status === "queued"}
      {...(s.can("workflows:publish")
        ? { onPublish: () => setPublishOpen(true), publishDisabled: errors.length > 0 }
        : {})}
      onExportJson={exportJson}
      {...(s.can("workflows:write")
        ? {
            onDuplicate: () =>
              void post<{ id: string }>(`/v1/workflows/${workflow.id}/clone`, {})
                .then((w) => router.push(`/${s.ws}/workflows/${w.id}`))
                .catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Could not duplicate"),
                ),
          }
        : {})}
      {...(s.can("workflows:delete") || s.can("workflows:write")
        ? { onDelete: () => setDeleteOpen(true) }
        : {})}
      inspector={inspector}
      bottomPanel={bottomPanel}
      commands={[
        {
          id: "publish",
          label: "Publish a new version",
          icon: <Rocket strokeWidth={1.75} />,
          onSelect: () => setPublishOpen(true),
        },
        {
          id: "export",
          label: "Export definition (JSON)",
          icon: <Download strokeWidth={1.75} />,
          onSelect: exportJson,
        },
        {
          id: "undo",
          label: `Undo ${history.past.at(-1)?.label ?? ""}`.trim(),
          shortcut: "mod+z",
          onSelect: () => store.getState().undo(),
        },
        {
          id: "redo",
          label: `Redo ${history.future[0]?.label ?? ""}`.trim(),
          shortcut: "shift+mod+z",
          onSelect: () => store.getState().redo(),
        },
        {
          id: "duplicate",
          label: "Duplicate workflow",
          icon: <Copy strokeWidth={1.75} />,
          onSelect: () =>
            void post<{ id: string }>(`/v1/workflows/${workflow.id}/clone`, {}).then((w) =>
              router.push(`/${s.ws}/workflows/${w.id}`),
            ),
        },
      ]}
    >
      <div className="flex h-full flex-col">
        <WorkflowTabs workflowId={workflow.id} active="builder" />
        <div className="min-h-0 flex-1">
          <FlowCanvas
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            {...(runView
              ? {
                  run: runView,
                  // pan with the run while nodes execute; once it waits for a person or ends,
                  // the canvas is the person's again
                  followRun: runView.status === "running" || runView.status === "queued",
                }
              : {})}
            {...(!readOnly ? { catalog: palette, onAddNode: addNode } : {})}
            onSetParent={(ids, parent, positions) =>
              store.getState().setParent(ids, parent, positions)
            }
            diagnostics={compiled.diagnostics}
            locked={readOnly}
            fitViewOnInit
          />
        </div>
      </div>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        workflowId={workflow.id}
        latestVersionId={workflow.latestVersionId}
        draft={definition}
        diagnostics={compiled.diagnostics}
        environments={s.environments}
        flush={saveNow}
        onPublished={() => void qc.invalidateQueries({ queryKey: ["workflows", s.ws] })}
      />
      <ConflictDialog
        conflict={conflict}
        onTakeTheirs={() =>
          conflict && store.getState().replaceDefinition(conflict.theirs, conflict.revision)
        }
        onKeepMine={() => {
          if (!conflict) return;
          store.setState({ draftRevision: conflict.revision, conflict: null });
          void saveNow().catch(() => undefined);
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${title}”?`}
        description="The workflow is archived with its versions and runs; triggers stop firing."
        confirmLabel="Delete workflow"
        variant="danger"
        icon={<Trash2 strokeWidth={1.75} />}
        onConfirm={async () => {
          await del(`/v1/workflows/${workflow.id}`);
          void qc.invalidateQueries({ queryKey: ["workflows", s.ws] });
          router.push(`/${s.ws}/workflows`);
        }}
      />
    </AppFrame>
  );
}

function ConflictDialog({
  conflict,
  onTakeTheirs,
  onKeepMine,
}: {
  conflict: { theirs: WorkflowDefinition; revision: number } | null;
  onTakeTheirs: () => void;
  onKeepMine: () => void;
}) {
  return (
    <Dialog open={conflict !== null}>
      <DialogContent size="sm" hideClose>
        <DialogHeader>
          <DialogTitle>The draft changed elsewhere</DialogTitle>
          <DialogDescription>
            Someone saved revision {conflict?.revision} of this draft while you were editing.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-ink-2">
            Keep your version to overwrite theirs, or load theirs and discard your unsaved changes.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onTakeTheirs}>
            Load theirs
          </Button>
          <Button onClick={onKeepMine}>Keep mine</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
