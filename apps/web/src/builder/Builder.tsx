"use client";
/**
 * The builder (UI.md §2–§4): the store owns the definition; the canvas is its projection; every
 * XYFlow callback maps to one store action (§4.2 table). Autosaves 1 s after the last change with
 * If-Match (412 → conflict dialog), compiles in a Web Worker, runs the draft and overlays the live
 * run on the canvas.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  useReactFlow,
  useStore as useXyStore,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  CircleDollarSign,
  Copy,
  Download,
  FolderDown,
  ListChecks,
  Rocket,
  Trash2,
} from "lucide-react";
import type {
  CompileResult,
  NodeManifest,
  SubflowSignature,
  ToolDefinition,
  WorkflowDefinition,
} from "@flowaid/workflow-core";
import type { RunView } from "@flowaid/ui";
import { DiagnosticSchema, type Diagnostic } from "@flowaid/workflow-core";
import {
  FlowCanvas,
  autoLayout,
  estimateNodeHeight,
  toCanvasEdge,
  type CanvasEdge,
  type CanvasNode,
  type NodeDefinitionView,
} from "@flowaid/ui/canvas";
import { NODE_WIDTH, toFlowNode } from "@flowaid/ui/node";
import { Inspector, DiagnosticList } from "@flowaid/ui/inspector";
import { BottomPanel } from "@flowaid/ui/builder";
import { TraceTimeline } from "@flowaid/ui/trace";
import { JsonView } from "@flowaid/ui/data";
import { withDefaults } from "@flowaid/ui/forms";
import { isEditableTarget, useAppShellOptional } from "@flowaid/ui/shell";
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
import { del, get, getAll, patch, post } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { useSession } from "~/session";
import { AppFrame } from "~/shell/AppFrame";
import { WorkflowTabs } from "~/shell/WorkflowTabs";
import {
  Catalog,
  STRUCTURAL_KINDS,
  bindingDataEdges,
  categoryOf,
  defaultControlOuts,
  manifestOf,
  needsLayout,
  newNode,
  parseDataEdgeId,
  project,
} from "./model";
import { createBuilderStore, type BuilderStore } from "./store";
import {
  freeControlPort,
  lastStep,
  branchConditionAfter,
  centreToShow,
  quickAddPlan,
  readRecentKinds,
  rememberRecentKind,
  suggestNext,
} from "./quickAdd";
import { useCompiler } from "./useCompiler";
import { useDraftSave } from "./useDraftSave";
import { newStepConfig } from "./stepConfig";
import { useLiveRun } from "./useLiveRun";
import { describeInputIssue, describeRunError, type RunStartError } from "./errors";
import { diagnosticNodeId, presentDiagnostic } from "./diagnostics";
import { RunResult } from "./RunResult";
import { WorkflowPanel, type ExecutionField } from "./WorkflowPanel";
import { useGuideContext } from "~/guide/GuideProvider";
import { explainRun } from "~/guide/explain";
import { NodeInspector } from "./NodeInspector";
import { useKeySources } from "./CredentialSlots";
import { autoBindSlots } from "./keySources";
import { agentPaletteDescription, agentPresetKind, agentStepFor, presetIdOf } from "./agentSteps";
import { activeAgentsKey } from "~/agents/AgentActiveSwitch";
import type { AgentPreset } from "~/agents/logic";
import { PublishDialog } from "./PublishDialog";
import { CodeExportDialog } from "~/workflows/CodeExport";
import { RunTab, missingRequired } from "./RunTab";
import { CostTab, ReviewTab, advisorAvailability, costDiagnostics, useAdvisor } from "./advisor";

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
  // A newer draft on the server (restored from a version, saved in another tab) replaces this one
  // while nothing here is unsaved. The builder's own saves are already at the server's revision,
  // so a publish or a refetch leaves the canvas, the run view and the run input as they are.
  useEffect(() => {
    const st = store.getState();
    if (
      workflow.draftRevision > st.draftRevision &&
      st.version === st.savedVersion &&
      !st.saving &&
      !st.conflict
    )
      st.replaceDefinition(workflow.draft, workflow.draftRevision);
  }, [store, workflow.draft, workflow.draftRevision]);
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
    // cards at the size they will render at, so taller ones (decisions, routes) do not overlap
    const views = new Map(project(d, null, [], catalog).nodes.map((v) => [v.id, v]));
    const { positions, sizes } = autoLayout(
      d.nodes.map((n) => {
        const v = views.get(n.id);
        return {
          id: n.id,
          ...(n.parent ? { parent: n.parent } : {}),
          ...(v && n.kind !== "loop" && n.kind !== "foreach"
            ? { width: 232, height: estimateNodeHeight(v) }
            : {}),
        };
      }),
      [
        ...d.edges.map((e) => ({ id: e.id, source: e.from.node, target: e.to.node })),
        // data dependencies order the layers too (a gate sits after what it reads)
        ...bindingDataEdges(d).map((e) => ({
          source: e.from.node,
          target: e.to.node,
          lane: false,
        })),
      ],
    );
    store.getState().moveNodes(
      Object.fromEntries(
        [...positions].map(([id, p]) => {
          const size = sizes.get(id);
          return [id, size ? { ...p, w: size.width, h: size.height } : p];
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [store]);

  // --- live run overlay ---
  const [runId, setRunId] = useState<string | null>(null);
  const [runInput, setRunInput] = useState<Record<string, unknown> | null>(null);
  const [envId, setEnvId] = useState<string | null>(
    () => s.environments.find((e) => !e.protected)?.id ?? s.environments[0]?.id ?? null,
  );
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<RunStartError | null>(null);
  // the draft's edit counter when the shown run started: a later edit makes its result stale
  const [runVersion, setRunVersion] = useState<number | null>(null);
  const [bottomTab, setBottomTab] = useState("run");
  // "Show" on a problem or a failed step: select the node, pan to it, open the inspector
  const [reveal, setReveal] = useState<{ nodeId: string; n: number } | null>(null);
  const showNode = useCallback(
    (nodeId: string) => {
      store.getState().select({ nodes: [nodeId], edges: [] });
      setReveal((cur) => ({ nodeId, n: (cur?.n ?? 0) + 1 }));
    },
    [store],
  );
  const clearSelection = useCallback(
    () => store.getState().select({ nodes: [], edges: [] }),
    [store],
  );
  // "Set a cost limit" on a problem: the workflow panel, opened at that Execution field
  const [panelFocus, setPanelFocus] = useState<{ field: ExecutionField; n: number } | null>(null);
  const openExecution = useCallback(
    (field: ExecutionField) => {
      clearSelection();
      setPanelFocus((cur) => ({ field, n: (cur?.n ?? 0) + 1 }));
    },
    [clearSelection],
  );
  const advisorOn = advisorAvailability(s.features, !readOnly).advisor;
  const advisor = useAdvisor({ workflowId: workflow.id, store, enabled: advisorOn });
  const problems = useMemo(
    () => [...compiled.diagnostics, ...costDiagnostics(advisor, version)],
    [advisor, compiled.diagnostics, version],
  );
  const openAdvisorTab = (tab: "review" | "cost") => {
    setBottomTab(tab);
    if (tab === "review") advisor.runReview();
    else advisor.runCost();
  };
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
  // a run that finishes while its trace is on screen shows its result: that is what it was for
  const liveStatus = live?.status;
  const [seenStatus, setSeenStatus] = useState(liveStatus);
  if (liveStatus !== seenStatus) {
    setSeenStatus(liveStatus);
    const ended =
      liveStatus === "completed" ||
      liveStatus === "failed" ||
      liveStatus === "cancelled" ||
      liveStatus === "timed_out";
    if (ended && bottomTab === "trace") setBottomTab("output");
  }
  const runView = useMemo<RunView | undefined>(
    () =>
      live
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
        : undefined,
    [live, workflow.id, title],
  );

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
  // active agents (Agents page) are offered as steps of their own, set up to use that agent
  const activeAgents = useQuery({
    queryKey: activeAgentsKey(s.ws),
    queryFn: () => getAll<AgentPreset>("/v1/agents", { active: "true" }),
    enabled: s.features.agents !== false && s.can("tools:read"),
    staleTime: 30_000,
  });
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
      ...(activeAgents.data ?? [])
        .filter((a) => a.active !== false)
        .map((a) => ({
          kind: agentPresetKind(a.id),
          name: a.name,
          category: "agent" as const,
          description: agentPaletteDescription(a),
          // shown where other steps show their type id
          provider: "your agent",
        })),
    ],
    [catalog, activeAgents.data],
  );
  // Quick add: a new step follows the selected one, or with nothing selected the step the
  // palette's suggestions were for (placed beside it, unless the palette opened at a right-click,
  // and connected from its first free port); the view then pans to it if it is out of sight.
  const [recentKinds, setRecentKinds] = useState<string[]>(readRecentKinds);
  const [keepInView, setKeepInView] = useState<{
    rect: { x: number; y: number; w: number; h: number };
    n: number;
  } | null>(null);
  const keySources = useKeySources();
  const addNode = useCallback(
    (def: NodeDefinitionView, wanted: { x: number; y: number }, origin: "pointer" | "view") => {
      const st = store.getState();
      const d = st.definition;
      const { after, position } = quickAddPlan(d, st.selection.nodes, wanted, origin);
      const presetId = presetIdOf(def.kind);
      const preset = presetId ? activeAgents.data?.find((a) => a.id === presetId) : undefined;
      const node = preset
        ? agentStepFor(d, preset, catalog, after?.parent)
        : newNode(d, def.kind, catalog, newStepConfig, after?.parent);
      if (!node) return;
      // a Branch after a yes/no decision routes on its answer from the start
      const when = branchConditionAfter(
        after,
        after?.kind === "task" ? catalog.get(after.type)?.decision?.kind : undefined,
      );
      if (node.kind === "branch" && when && node.cases[0])
        node.cases[0] = { ...node.cases[0], when };
      const port = after
        ? freeControlPort(d, after, defaultControlOuts(after, catalog))
        : undefined;
      // a key the workflow or the server already has is bound now, not left as an error
      const bound =
        node.kind === "task"
          ? autoBindSlots(catalog.get(node.type)?.credentials ?? [], d.secrets, keySources)
          : undefined;
      if (bound && node.kind === "task")
        node.credentials = { ...bound.credentials, ...node.credentials };
      st.addNode(
        node,
        position,
        after && port ? { node: after.id, port } : undefined,
        bound?.declare,
      );
      setRecentKinds((prev) => rememberRecentKind(prev, def.kind));
      // a step inside a container sits relative to its frame: leave the view alone there
      if (!node.parent)
        setKeepInView((cur) => ({
          rect: { ...position, w: NODE_WIDTH, h: 96 },
          n: (cur?.n ?? 0) + 1,
        }));
    },
    [store, catalog, keySources, activeAgents.data],
  );

  // --- save (autosave, ⌘S, before run/publish, and on the way out) ---
  const saveNow = useDraftSave({ store, workflowId: workflow.id, ws: s.ws, enabled: !readOnly });
  useEffect(() => {
    if (notice) toast(notice.message);
  }, [notice]);

  // --- run ---
  const errors = compiled.diagnostics.filter((d) => d.severity === "error");
  const startRun = useCallback(
    async (input: Record<string, unknown>) => {
      if (starting) return;
      setStarting(true);
      setRunError(null);
      try {
        await saveNow();
        const startedAt = store.getState().version;
        const res = await post<{ run_id: string }>(`/v1/workflows/${workflow.id}/run`, {
          input,
          draft: true,
          mode: "async",
          ...(envId ? { environmentId: envId } : {}),
        });
        setRunId(res.run_id);
        setRunVersion(startedAt);
        setBottomTab("trace");
      } catch (e) {
        const described = describeRunError(e);
        setRunError(described);
        setBottomTab("run");
        toast.error(described.title);
      } finally {
        setStarting(false);
      }
    },
    [saveNow, workflow.id, envId, starting, store],
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
        setBottomTab("run");
        if (errors.length) return;
        const input = runInput ?? withDefaults(definition.inputs as never, {});
        const gaps = missingRequired(definition.inputs, input);
        if (gaps.length)
          setRunError({
            kind: "input",
            title: "Some required input is empty, so the run did not start.",
            action: "Fill in the fields below and run again.",
            items: gaps.map((k) =>
              describeInputIssue({ message: `must have required property '${k}'` }),
            ),
          });
        else void startRun(input);
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
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectedId = selection.nodes.length === 1 ? selection.nodes[0] : undefined;
  // what to suggest in the palette: after the selected step, else after the last step
  const suggestAfter = useMemo(
    () => (selectedId ? definition.nodes.find((n) => n.id === selectedId) : lastStep(definition)),
    [definition, selectedId],
  );
  const suggestions = useMemo(
    () => suggestNext(definition, suggestAfter, palette, recentKinds),
    [definition, suggestAfter, palette, recentKinds],
  );
  const selectedNode = selectedId ? definition.nodes.find((n) => n.id === selectedId) : undefined;
  const selectedView = selectedId ? projection.nodes.find((n) => n.id === selectedId) : undefined;
  const selectedRun =
    selectedId && live
      ? [...live.folded.nodeRuns].reverse().find((r) => r.nodeId === selectedId)
      : undefined;

  // the Guide explains the workflow, the selected step and the last run in plain words
  const selectedManifest = selectedNode ? manifestOf(selectedNode, catalog) : undefined;
  useGuideContext(
    useMemo(
      () => ({
        kind: "builder" as const,
        definition,
        ...(selectedNode ? { selected: selectedNode } : {}),
        ...(selectedManifest ? { manifest: selectedManifest } : {}),
        onSelectStep: showNode,
        onClearStep: clearSelection,
        ...(runView ? { run: runView } : {}),
      }),
      [definition, selectedNode, selectedManifest, showNode, clearSelection, runView],
    ),
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${workflow.slug || "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // the workflow's name (lists, runs) and the definition's name move together
  const renameWorkflow = (name: string) => {
    const next = name.trim().slice(0, 120);
    if (!next || next === title) return;
    setTitle(next);
    store.getState().updateDefinition((d) => {
      d.name = next;
    }, "Rename workflow");
    void patch(`/v1/workflows/${workflow.id}`, { name: next })
      .then(() => qc.invalidateQueries({ queryKey: ["workflows", s.ws] }))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Rename failed"));
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
      <WorkflowPanel
        definition={definition}
        store={store}
        readOnly={readOnly}
        name={title}
        {...(!readOnly ? { onRename: renameWorkflow } : {})}
        {...(panelFocus ? { focus: panelFocus } : {})}
        onDescribe={(description) =>
          void patch(`/v1/workflows/${workflow.id}`, { description })
            .then(() => qc.invalidateQueries({ queryKey: ["workflows", s.ws] }))
            .catch((e: unknown) =>
              toast.error(e instanceof Error ? e.message : "Could not save the description"),
            )
        }
      />
    );

  const describeProblem = (d: Diagnostic, beforeShow?: () => void) => {
    const shown = presentDiagnostic(d, definition);
    const nodeId = diagnosticNodeId(d, definition);
    return {
      ...(shown.where ? { where: shown.where } : {}),
      ...(shown.hint ? { hint: shown.hint } : {}),
      actions: (
        <>
          {shown.remedy === "integration" ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/${s.ws}/integrations`}>Integrations</Link>
            </Button>
          ) : shown.remedy === "knowledge" ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/${s.ws}/knowledge`}>Knowledge</Link>
            </Button>
          ) : (shown.remedy === "cost-limit" || shown.remedy === "time-limit") && !readOnly ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                beforeShow?.();
                openExecution(shown.remedy === "cost-limit" ? "max-cost" : "timeout");
              }}
            >
              {shown.remedy === "cost-limit" ? "Set a cost limit" : "Set the run time limit"}
            </Button>
          ) : null}
          {nodeId ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                beforeShow?.();
                showNode(nodeId);
              }}
            >
              Show node
            </Button>
          ) : null}
        </>
      ),
    };
  };
  // the compiler's words without a pointer the location already names
  const readable = (list: readonly Diagnostic[]) =>
    list.map((d) => ({ ...d, message: presentDiagnostic(d, definition).message }));
  const blocking = errors.map((d, i) => {
    const shown = presentDiagnostic(d, definition);
    const nodeId = diagnosticNodeId(d, definition);
    return {
      key: `${d.code}-${i}`,
      // a known blocker reads as what to do; anything else as the compiler said it
      text: `${shown.where ? `${shown.where}: ` : ""}${shown.hint ?? shown.message}`,
      ...(nodeId ? { onShow: () => showNode(nodeId) } : {}),
    };
  });

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
              error={runError}
              secretsHref={`/${s.ws}/workflows/${workflow.id}/settings?tab=secrets`}
              {...(s.can("runs:create")
                ? {
                    aiFill: {
                      workflowId: workflow.id,
                      getDefinition: () => store.getState().definition,
                      // on when the workspace has a text model (the same check as the AI builder)
                      available: s.features.ai_builder === true,
                    },
                  }
                : {})}
              problems={errors.length ? blocking : []}
              onShowProblems={() => setBottomTab("problems")}
              disabledReason={
                errors.length
                  ? `Fix ${errors.length} problem${errors.length > 1 ? "s" : ""} in the draft before it can run.`
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
            <div className="flex h-full flex-col gap-3 overflow-auto p-3">
              {runView ? (
                <RunResult
                  run={runView}
                  story={explainRun(runView, definition)}
                  ws={s.ws}
                  stale={runVersion !== null && version !== runVersion}
                  onShowNode={showNode}
                />
              ) : null}
              {runView?.output !== undefined ? (
                <JsonView value={runView.output} expandDepth={3} />
              ) : !runView ? (
                <EmptyState
                  size="sm"
                  title="No output yet"
                  description="Run the draft from the Run tab; what the workflow returns appears here."
                />
              ) : runView.status === "completed" ? (
                <p className="text-xs text-ink-3">The run returned no output value.</p>
              ) : null}
            </div>
          ),
        },
        {
          id: "problems",
          label: "Problems",
          count: problems.length,
          countTone: errors.length ? "danger" : "warn",
          content: (
            <div className="h-full overflow-auto p-3">
              {problems.length ? (
                <DiagnosticList
                  diagnostics={readable(problems)}
                  describe={describeProblem}
                  {...(!readOnly ? { onApplyFix: advisor.applyDiagnosticFix } : {})}
                />
              ) : (
                <EmptyState
                  size="sm"
                  title="No problems"
                  description="The draft compiles cleanly and is ready to run."
                />
              )}
            </div>
          ),
        },
        ...(advisorOn
          ? [
              {
                id: "review",
                label: "Review",
                ...(advisor.review ? { count: advisor.review.data.advice.length } : {}),
                content: (
                  <ReviewTab
                    advisor={advisor}
                    definition={definition}
                    onFocusNode={(id) => store.getState().select({ nodes: [id], edges: [] })}
                  />
                ),
              },
              {
                id: "cost",
                label: "Cost",
                ...(advisor.cost ? { count: advisor.cost.data.suggestions.length } : {}),
                content: <CostTab advisor={advisor} definition={definition} catalog={catalog} />,
              },
            ]
          : []),
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
      {...(!readOnly ? { onRename: renameWorkflow } : {})}
      saveState={saveState}
      {...(saveError ? { saveError } : {})}
      onRun={() => setBottomTab("run")}
      running={starting || live?.status === "running" || live?.status === "queued"}
      {...(s.can("workflows:publish") ? { onPublish: () => setPublishOpen(true) } : {})}
      onExportJson={exportJson}
      onDownloadCode={() => setExportOpen(true)}
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
          id: "download-code",
          label: "Download code",
          icon: <FolderDown strokeWidth={1.75} />,
          onSelect: () => setExportOpen(true),
        },
        ...(advisorOn
          ? [
              {
                id: "review",
                label: "Review this workflow",
                icon: <ListChecks strokeWidth={1.75} />,
                onSelect: () => openAdvisorTab("review"),
              },
              {
                id: "cost",
                label: "Find cost savings",
                icon: <CircleDollarSign strokeWidth={1.75} />,
                onSelect: () => openAdvisorTab("cost"),
              },
            ]
          : []),
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
            void post<{ id: string }>(`/v1/workflows/${workflow.id}/clone`, {})
              .then((w) => router.push(`/${s.ws}/workflows/${w.id}`))
              .catch((e: unknown) =>
                toast.error(e instanceof Error ? e.message : "Could not duplicate"),
              ),
        },
      ]}
    >
      <div className="flex h-full flex-col">
        <OpenInspectorOnSelect
          nodeId={selection.nodes.length === 1 ? selection.nodes[0] : undefined}
          reveal={(reveal?.n ?? 0) + (panelFocus?.n ?? 0)}
        />
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
            {...(!readOnly
              ? {
                  catalog: palette,
                  onAddNode: addNode,
                  recentKinds,
                  suggestions,
                  ...(suggestAfter ? { suggestionsFor: suggestAfter.name } : {}),
                }
              : {})}
            onSetParent={(ids, parent, positions) =>
              store.getState().setParent(ids, parent, positions)
            }
            diagnostics={compiled.diagnostics}
            locked={readOnly}
            fitViewOnInit
          >
            <FocusNode request={reveal} />
            <KeepInView request={keepInView} />
          </FlowCanvas>
        </div>
      </div>

      <CodeExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        workflow={{ id: workflow.id, name: title, slug: workflow.slug }}
        defaultTarget="draft"
        draft={{
          saveDraft: saveNow,
          describe: (d) => {
            const parsed = DiagnosticSchema.safeParse(d);
            if (!parsed.success) return d.message;
            const shown = presentDiagnostic(parsed.data, definition);
            return `${shown.where ? `${shown.where}: ` : ""}${shown.message}`;
          },
        }}
      />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        workflowId={workflow.id}
        latestVersionId={workflow.latestVersionId}
        draft={definition}
        diagnostics={readable(compiled.diagnostics)}
        describe={(d) => describeProblem(d, () => setPublishOpen(false))}
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

/**
 * Under the compact breakpoint the inspector is a sheet the canvas does not show: selecting a
 * node opens it, so a tap on a node leads somewhere on a phone as it does on a desktop.
 */
function OpenInspectorOnSelect({ nodeId, reveal }: { nodeId: string | undefined; reveal: number }) {
  const shell = useAppShellOptional();
  const compact = shell?.compact ?? false;
  const open = shell?.setInspectorOpen;
  useEffect(() => {
    if (compact && nodeId) open?.(true);
  }, [compact, nodeId, open]);
  // "Show node" (and "Set a cost limit") opens the inspector even where the person had closed it
  useEffect(() => {
    if (reveal > 0) open?.(true);
  }, [reveal, open]);
  return null;
}

/**
 * Pans, at the same zoom, to a step just added when it landed out of sight (beside a step at the
 * edge of the view, or under a panel); a step already in view leaves the canvas where it is.
 */
function KeepInView({
  request,
}: {
  request: { rect: { x: number; y: number; w: number; h: number }; n: number } | null;
}) {
  const flow = useReactFlow();
  const width = useXyStore((s) => s.width);
  const height = useXyStore((s) => s.height);
  useEffect(() => {
    if (!request) return;
    const view = flow.getViewport();
    const centre = centreToShow(request.rect, view, { width, height });
    if (!centre) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    void flow.setCenter(centre.x, centre.y, { zoom: view.zoom, duration: still ? 0 : 240 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per added step, not per resize
  }, [request, flow]);
  return null;
}

/** Pans the canvas to a node someone asked to see (a problem's or a failed step's). */
function FocusNode({ request }: { request: { nodeId: string; n: number } | null }) {
  const flow = useReactFlow();
  useEffect(() => {
    if (!request) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    void flow.fitView({
      nodes: [{ id: request.nodeId }],
      maxZoom: 1,
      padding: 0.4,
      duration: still ? 0 : 240,
    });
  }, [request, flow]);
  return null;
}
