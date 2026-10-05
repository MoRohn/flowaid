/**
 * The builder store (UI.md §4.1): zustand + immer. `definition` is the truth; every action mutates
 * it through `produceWithPatches` and records the inverse patches, so undo/redo replays exact
 * changes (layout-only moves are not recorded). Compile results arrive from the Web Worker.
 */
import { createStore } from "zustand/vanilla";
import { applyJsonPatch, JsonPatchError, type JsonPatchOperation } from "@flowaid/shared";
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import type {
  Binding,
  Diagnostic,
  ExecutionPlan,
  JsonSchema,
  JsonValue,
  NodePolicy,
  WorkflowDefinition,
  WorkflowNode,
} from "@flowaid/workflow-core";
import { bindingRefs, nodeBindings, uniqueEdgeId } from "./model";

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Edits with the same key in quick succession (typing in one field) are one undo step. */
  coalesce?: { key: string; at: number };
}

/** How long after an edit another edit of the same field still joins its undo step. */
export const COALESCE_MS = 1000;

export type SaveState = "saved" | "unsaved" | "saving" | "error";

export interface BuilderState {
  workflowId: string;
  definition: WorkflowDefinition;
  /** server revision the definition was last saved or loaded at (If-Match) */
  draftRevision: number;
  /** bumps on every change; a save acknowledges the version it sent */
  version: number;
  savedVersion: number;
  saving: boolean;
  saveError: string | null;
  conflict: { theirs: WorkflowDefinition; revision: number } | null;
  compile: { plan: ExecutionPlan | null; diagnostics: Diagnostic[]; at: number; pending: boolean };
  /** the last plan that compiled, for ports and edges while the current draft has errors */
  lastPlan: ExecutionPlan | null;
  selection: { nodes: string[]; edges: string[] };
  history: { past: HistoryEntry[]; future: HistoryEntry[] };
  notice: { id: number; message: string } | null;
  /** bumps when the definition changes from outside the forms (undo, redo, reload, JSON edits): forms remount */
  epoch: number;

  /**
   * Adds a node; with `after`, also a control edge from that node's port to it, and with `secrets`
   * the workflow secrets its credential slots were bound to (one undo step).
   */
  addNode(
    node: WorkflowNode,
    position: { x: number; y: number },
    after?: { node: string; port: string },
    secrets?: readonly { name: string; credentialType: string; required: boolean }[],
  ): string;
  removeNodes(ids: string[]): void;
  /** `coalesce` joins quick successive edits with the same key into one undo step (typing). */
  updateNode(
    id: string,
    recipe: (n: Draft<WorkflowNode>) => void,
    label?: string,
    coalesce?: string,
  ): void;
  setNodeConfig(id: string, config: Record<string, unknown>): void;
  setBinding(id: string, port: string, binding: Binding | undefined): void;
  setNodePolicy(id: string, policy: NodePolicy | undefined): void;
  renameNode(id: string, name: string): void;
  addControlEdge(
    from: { node: string; port: string },
    to: string,
  ): { ok: true } | { ok: false; code: string; message: string };
  removeControlEdges(ids: string[]): void;
  setParent(
    ids: string[],
    parent: string | undefined,
    positions?: Record<string, { x: number; y: number }>,
  ): void;
  /** Moves nodes; `w`/`h` also size containers (auto layout fits them around their children). */
  moveNodes(positions: Record<string, { x: number; y: number; w?: number; h?: number }>): void;
  setInputsSchema(schema: JsonSchema): void;
  setOutputsSchema(schema: JsonSchema): void;
  updateDefinition(recipe: (d: Draft<WorkflowDefinition>) => void, label: string): void;
  /**
   * Applies RFC 6902 operations (an advisor fix) as one undoable edit; forms remount. False, with a
   * notice, when an operation does not apply to the current definition.
   */
  applyPatch(patch: readonly JsonPatchOperation[], label: string): boolean;
  replaceDefinition(def: WorkflowDefinition, revision: number): void;
  bumpEpoch(): void;
  select(selection: { nodes: string[]; edges: string[] }): void;
  setCompile(result: { plan: ExecutionPlan | null; diagnostics: Diagnostic[] }): void;
  markSaved(revision: number, version: number): void;
  setSaving(saving: boolean, error?: string | null): void;
  setConflict(conflict: BuilderState["conflict"]): void;
  undo(): void;
  redo(): void;
}

const HISTORY_LIMIT = 200;

export type BuilderStore = ReturnType<typeof createBuilderStore>;

export function createBuilderStore(init: {
  workflowId: string;
  definition: WorkflowDefinition;
  draftRevision: number;
}) {
  let noticeId = 0;
  return createStore<BuilderState>()((set, get) => {
    const notify = (message: string) => set({ notice: { id: ++noticeId, message } });

    /**
     * Applies a recipe to the definition; records history unless `record` is false. With
     * `coalesce`, an edit that follows one with the same key within `COALESCE_MS` joins its undo
     * step, so typing in a field undoes as one change and does not push structural edits out of
     * the history.
     */
    const mutate = (
      label: string,
      recipe: (d: Draft<WorkflowDefinition>) => void | WorkflowDefinition,
      record: boolean | { coalesce: string } = true,
    ) => {
      const [next, patches, inverse] = produceWithPatches(get().definition, recipe);
      if (patches.length === 0) return;
      const { past, future } = get().history;
      const key = typeof record === "object" ? record.coalesce : undefined;
      const now = Date.now();
      const last = past.at(-1);
      const joins =
        key !== undefined &&
        future.length === 0 &&
        last?.coalesce?.key === key &&
        now - last.coalesce.at <= COALESCE_MS;
      const entry: HistoryEntry = joins
        ? {
            label: last.label,
            patches: [...last.patches, ...patches],
            // undoing the joined step undoes the newest edit first
            inverse: [...inverse, ...last.inverse],
            coalesce: { key, at: now },
          }
        : { label, patches, inverse, ...(key !== undefined ? { coalesce: { key, at: now } } : {}) };
      set((s) => ({
        definition: next,
        version: s.version + 1,
        ...(record
          ? {
              history: {
                past: [...(joins ? past.slice(0, -1) : past), entry].slice(-HISTORY_LIMIT),
                future: [],
              },
            }
          : {}),
      }));
    };

    const findNode = (d: Draft<WorkflowDefinition> | WorkflowDefinition, id: string) =>
      d.nodes.find((n) => n.id === id);

    return {
      workflowId: init.workflowId,
      definition: init.definition,
      draftRevision: init.draftRevision,
      version: 0,
      savedVersion: 0,
      saving: false,
      saveError: null,
      conflict: null,
      compile: { plan: null, diagnostics: [], at: 0, pending: true },
      lastPlan: null,
      selection: { nodes: [], edges: [] },
      history: { past: [], future: [] },
      notice: null,
      epoch: 0,

      addNode(node, position, after, secrets) {
        const from = after ? findNode(get().definition, after.node) : undefined;
        const connect =
          from && after && node.kind !== "input" && node.kind !== "note" ? after : undefined;
        mutate(
          connect && from ? `Add ${node.name} after ${from.name}` : `Add ${node.name}`,
          (d) => {
            d.nodes.push(node);
            for (const x of secrets ?? [])
              if (!d.secrets.some((y) => y.name === x.name)) d.secrets.push({ ...x });
            d.layout ??= { nodes: {} };
            d.layout.nodes[node.id] = { x: Math.round(position.x), y: Math.round(position.y) };
            if (connect)
              d.edges.push({
                id: uniqueEdgeId(d, connect.node, connect.port, node.id),
                from: { node: connect.node, port: connect.port },
                to: { node: node.id },
              });
          },
        );
        set({ selection: { nodes: [node.id], edges: [] } });
        return node.id;
      },

      removeNodes(ids) {
        const gone = new Set(ids);
        // containers take their children with them
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of get().definition.nodes)
            if (n.parent && gone.has(n.parent) && !gone.has(n.id)) {
              gone.add(n.id);
              grew = true;
            }
        }
        const cleared: string[] = [];
        mutate(`Delete ${gone.size === 1 ? [...gone][0] : `${gone.size} nodes`}`, (d) => {
          d.nodes = d.nodes.filter((n) => !gone.has(n.id));
          d.edges = d.edges.filter((e) => !gone.has(e.from.node) && !gone.has(e.to.node));
          for (const n of d.nodes) {
            for (const [port, b] of Object.entries(nodeBindings(n)))
              if (bindingRefs(b).some((r) => gone.has(r.node))) {
                cleared.push(`${n.name}.${port}`);
                clearBinding(n, port);
              }
          }
          if (d.layout) for (const id of gone) delete d.layout.nodes[id];
        });
        set({ selection: { nodes: [], edges: [] } });
        if (cleared.length)
          notify(`Cleared bindings that used the deleted nodes: ${cleared.join(", ")}`);
      },

      updateNode(id, recipe, label = "Edit node", coalesce) {
        mutate(
          label,
          (d) => {
            const n = findNode(d, id);
            if (n) recipe(n);
          },
          coalesce !== undefined ? { coalesce } : true,
        );
      },

      setNodeConfig(id, config) {
        const cur = findNode(get().definition, id);
        if (cur?.kind === "task" && JSON.stringify(cur.config) === JSON.stringify(config)) return;
        mutate(
          "Edit configuration",
          (d) => {
            const n = findNode(d, id);
            if (n?.kind === "task") n.config = config as Draft<typeof n.config>;
          },
          { coalesce: `config:${id}` },
        );
      },

      setBinding(id, port, binding) {
        mutate(
          binding ? `Bind ${port}` : `Unbind ${port}`,
          (d) => {
            const n = findNode(d, id);
            if (!n) return;
            if (!binding) return clearBinding(n, port);
            const b = binding as Draft<Binding>;
            if (n.kind === "task" || n.kind === "join" || n.kind === "subflow") n.inputs[port] = b;
            else if (n.kind === "output" && port === "value") n.value = b;
            else if (n.kind === "foreach" && port === "items") n.items = b;
          },
          // typing a value or a template edits the binding on every key
          { coalesce: `binding:${id}:${port}` },
        );
      },

      setNodePolicy(id, policy) {
        mutate("Edit policy", (d) => {
          const n = findNode(d, id);
          if (!n) return;
          if (policy) n.policy = policy;
          else delete n.policy;
        });
      },

      renameNode(id, name) {
        const trimmed = name.trim().slice(0, 120);
        if (!trimmed) return;
        mutate(`Rename to ${trimmed}`, (d) => {
          const n = findNode(d, id);
          if (n) n.name = trimmed;
        });
      },

      addControlEdge(from, to) {
        const d = get().definition;
        const src = findNode(d, from.node);
        const dst = findNode(d, to);
        if (!src || !dst)
          return { ok: false, code: "E_UNKNOWN_NODE", message: "That node no longer exists." };
        if (src.id === dst.id)
          return { ok: false, code: "E_SELF_EDGE", message: "A node cannot follow itself." };
        if ((src.parent ?? null) !== (dst.parent ?? null)) {
          notify("Control edges cannot cross a loop or for-each boundary.");
          return {
            ok: false,
            code: "E_EDGE_CROSSES_SCOPE",
            message: "Control edges cannot cross a container boundary.",
          };
        }
        if (dst.kind === "input")
          return {
            ok: false,
            code: "E_INPUT_HAS_NO_CONTROL_IN",
            message: "The start node has no incoming control.",
          };
        if (
          d.edges.some(
            (e) => e.from.node === from.node && e.from.port === from.port && e.to.node === to,
          )
        )
          return { ok: true };
        mutate(`Connect ${src.name} → ${dst.name}`, (draft) => {
          draft.edges.push({
            id: uniqueEdgeId(draft, from.node, from.port, to),
            from: { ...from },
            to: { node: to },
          });
        });
        return { ok: true };
      },

      removeControlEdges(ids) {
        const gone = new Set(ids);
        mutate(`Delete ${ids.length === 1 ? "edge" : `${ids.length} edges`}`, (d) => {
          d.edges = d.edges.filter((e) => !gone.has(e.id));
        });
      },

      setParent(ids, parent, positions) {
        const move = new Set(ids);
        let dropped = 0;
        mutate(parent ? "Move into container" : "Move out of container", (d) => {
          for (const n of d.nodes)
            if (move.has(n.id)) {
              if (parent) n.parent = parent;
              else delete n.parent;
            }
          const parentOf = new Map(d.nodes.map((n) => [n.id, n.parent ?? null]));
          const before = d.edges.length;
          d.edges = d.edges.filter((e) => parentOf.get(e.from.node) === parentOf.get(e.to.node));
          dropped = before - d.edges.length;
          if (positions) {
            d.layout ??= { nodes: {} };
            for (const [id, p] of Object.entries(positions))
              d.layout.nodes[id] = {
                ...d.layout.nodes[id],
                x: Math.round(p.x),
                y: Math.round(p.y),
              };
          }
        });
        if (dropped)
          notify(
            `Removed ${dropped} control ${dropped === 1 ? "edge" : "edges"} that crossed the container boundary.`,
          );
      },

      moveNodes(positions) {
        mutate(
          "Move",
          (d) => {
            d.layout ??= { nodes: {} };
            for (const [id, p] of Object.entries(positions)) {
              const cur = d.layout.nodes[id];
              d.layout.nodes[id] = {
                ...cur,
                x: Math.round(p.x),
                y: Math.round(p.y),
                ...(p.w !== undefined ? { w: Math.round(p.w) } : {}),
                ...(p.h !== undefined ? { h: Math.round(p.h) } : {}),
              };
            }
          },
          false,
        );
      },

      setInputsSchema(schema) {
        mutate("Edit inputs", (d) => {
          d.inputs = schema;
        });
      },
      setOutputsSchema(schema) {
        mutate("Edit outputs", (d) => {
          d.outputs = schema;
        });
      },
      updateDefinition(recipe, label) {
        mutate(label, recipe);
      },
      applyPatch(patch, label) {
        let next: WorkflowDefinition;
        try {
          next = applyJsonPatch(
            get().definition as unknown as JsonValue,
            patch,
          ) as unknown as WorkflowDefinition;
        } catch (error) {
          if (!(error instanceof JsonPatchError)) throw error;
          notify(`${label}: the workflow changed since the suggestion was made (${error.message})`);
          return false;
        }
        mutate(label, () => next);
        set((s) => ({ epoch: s.epoch + 1 }));
        return true;
      },
      bumpEpoch() {
        set((s) => ({ epoch: s.epoch + 1 }));
      },
      replaceDefinition(def, revision) {
        set((s) => ({
          definition: def,
          draftRevision: revision,
          version: s.version + 1,
          savedVersion: s.version + 1,
          conflict: null,
          epoch: s.epoch + 1,
          history: { past: [], future: [] },
          selection: { nodes: [], edges: [] },
        }));
      },
      select(selection) {
        const cur = get().selection;
        if (sameList(cur.nodes, selection.nodes) && sameList(cur.edges, selection.edges)) return;
        set({ selection });
      },
      setCompile({ plan, diagnostics }) {
        set((s) => ({
          compile: { plan, diagnostics, at: Date.now(), pending: false },
          lastPlan: plan ?? s.lastPlan,
        }));
      },
      markSaved(revision, version) {
        set({ draftRevision: revision, savedVersion: version, saving: false, saveError: null });
      },
      setSaving(saving, error = null) {
        set({ saving, saveError: error });
      },
      setConflict(conflict) {
        set({ conflict, saving: false });
      },
      undo() {
        const { past, future } = get().history;
        const entry = past.at(-1);
        if (!entry) return;
        set((s) => ({
          definition: applyPatches(s.definition, entry.inverse),
          version: s.version + 1,
          epoch: s.epoch + 1,
          history: { past: past.slice(0, -1), future: [entry, ...future] },
        }));
      },
      redo() {
        const { past, future } = get().history;
        const entry = future[0];
        if (!entry) return;
        set((s) => ({
          definition: applyPatches(s.definition, entry.patches),
          version: s.version + 1,
          epoch: s.epoch + 1,
          history: { past: [...past, entry], future: future.slice(1) },
        }));
      },
    };
  });
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function clearBinding(n: Draft<WorkflowNode>, port: string): void {
  if (n.kind === "task" || n.kind === "join" || n.kind === "subflow") delete n.inputs[port];
  else if (n.kind === "output" && port === "value") n.value = { kind: "literal", value: null };
  else if (n.kind === "foreach" && port === "items") n.items = { kind: "literal", value: [] };
}
