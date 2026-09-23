import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEdgesState, useNodesState, type Connection } from "@xyflow/react";
import { useState } from "react";
import { toFlowNode } from "@/node";
import { installSizedLayoutStubs } from "@/node/flowTestStubs";
import { installDomStubs } from "@/primitives/testStubs";
import { KeyboardShortcutsDialog, ShortcutProvider } from "@/shell";
import type { WorkflowNodeView } from "@/types";
import { CANVAS_SHORTCUTS } from "./canvasShortcuts";
import { FlowCanvas, type FlowCanvasProps } from "./FlowCanvas";
import { SAMPLE_CATALOG } from "./sampleWorkflow";
import type { CanvasEdge, CanvasNode, NodeDefinitionView } from "./types";

installDomStubs();
let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = installSizedLayoutStubs();
});
afterAll(() => restoreLayout());
afterEach(cleanup);

const draft: WorkflowNodeView = {
  id: "draft",
  kind: "task",
  nodeType: "flowaid.generation.text",
  category: "generation",
  name: "Draft reply",
  inputs: [],
  outputs: [{ id: "reply", label: "reply", type: "string" }],
};
const send: WorkflowNodeView = {
  id: "send",
  kind: "task",
  nodeType: "flowaid.tools.http",
  category: "tool",
  name: "Send email",
  inputs: [{ id: "body", label: "body", type: "string" }],
  outputs: [],
};
const audit: WorkflowNodeView = {
  id: "audit",
  kind: "task",
  nodeType: "flowaid.data.transform",
  category: "data",
  name: "Audit log",
  inputs: [{ id: "count", label: "count", type: "number" }],
  outputs: [],
};

function initialNodes(selected: string[] = []): CanvasNode[] {
  return [
    { ...toFlowNode(draft, { x: 0, y: 0 }), selected: selected.includes("draft") },
    { ...toFlowNode(send, { x: 320, y: 0 }), selected: selected.includes("send") },
    { ...toFlowNode(audit, { x: 320, y: 200 }), selected: selected.includes("audit") },
  ];
}

type HarnessProps = Partial<
  Omit<FlowCanvasProps, "nodes" | "edges" | "onNodesChange" | "onEdgesChange">
> & {
  selected?: string[];
  onPositions?: (positions: Record<string, { x: number; y: number }>) => void;
};

function Harness({ selected, onPositions, ...props }: HarnessProps) {
  const [nodes, , onNodesChange] = useNodesState<CanvasNode>(initialNodes(selected));
  const [edges, , onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const [selection, setSelection] = useState("");
  return (
    <div style={{ width: 800, height: 600 }}>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => {
          onNodesChange(changes);
          const moved: Record<string, { x: number; y: number }> = {};
          for (const c of changes)
            if (c.type === "position" && c.position) moved[c.id] = c.position;
          if (Object.keys(moved).length) onPositions?.(moved);
        }}
        onEdgesChange={onEdgesChange}
        onSelectionChange={({ nodes: sel }) => setSelection(sel.map((n) => n.id).join(","))}
        fitViewOnInit={false}
        defaultShowMinimap={false}
        {...props}
      />
      <output aria-label="selection">{selection}</output>
    </div>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function nodeElement(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`node ${id} not rendered`);
  return el;
}

describe("FlowCanvas keyboard model", () => {
  it("is a named Tab stop described by its shortcut summary", async () => {
    const user = userEvent.setup();
    render(<Harness onConnect={vi.fn()} catalog={SAMPLE_CATALOG} onOpenInspector={vi.fn()} />);
    await settle();
    const canvas = screen.getByRole("application", { name: "Workflow canvas" });
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(canvas).toHaveAccessibleDescription(/C connects the focused node/);
    expect(canvas).toHaveAccessibleDescription(/Enter opens the focused node in the inspector/);
    await user.tab();
    expect(canvas).toHaveFocus();
  });

  it("selects every node with mod+A", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await settle();
    screen.getByRole("application", { name: "Workflow canvas" }).focus();
    await user.keyboard("{Control>}a{/Control}");
    await settle();
    expect(screen.getByRole("status", { name: "selection" })).toHaveTextContent("draft,send,audit");
  });

  it("nudges the selection 8 px with arrows and 32 px with Shift", async () => {
    const user = userEvent.setup();
    const moves: Array<Record<string, { x: number; y: number }>> = [];
    render(<Harness selected={["send"]} onPositions={(p) => moves.push(p)} />);
    await settle();
    screen.getByRole("application", { name: "Workflow canvas" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(moves.at(-1)).toEqual({ send: { x: 328, y: 0 } });
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(moves.at(-1)).toEqual({ send: { x: 328, y: 32 } });
    expect(moves).toHaveLength(2);
  });

  it("does not nudge while locked", async () => {
    const user = userEvent.setup();
    const onPositions = vi.fn();
    render(<Harness selected={["send"]} onPositions={onPositions} locked />);
    await settle();
    screen.getByRole("application", { name: "Workflow canvas" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(onPositions).not.toHaveBeenCalled();
  });

  it("connects from a focused node with C: compatible targets only, prefixed handle ids", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn<(c: Connection) => void>();
    const { container } = render(<Harness onConnect={onConnect} />);
    await settle();
    const node = nodeElement(container, "draft");
    node.focus();
    await user.keyboard("c");
    const list = await screen.findByRole("dialog", { name: "Connect Draft reply to" });
    const options = within(list)
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    // Control: done → each node's control-in; data: reply (string) → body (string) only,
    // never count (number).
    expect(options).toEqual([
      expect.stringMatching(/^done.*Send email · control in/),
      expect.stringMatching(/^done.*Audit log · control in/),
      expect.stringMatching(/^reply.*Send email · body/),
    ]);
    await user.keyboard("body");
    await user.keyboard("{Enter}");
    expect(onConnect).toHaveBeenCalledWith({
      source: "draft",
      sourceHandle: "out:reply",
      target: "send",
      targetHandle: "in:body",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(node).toHaveFocus());
  });

  it("closes the connect list with Escape without connecting", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const { container } = render(<Harness onConnect={onConnect} />);
    await settle();
    const node = nodeElement(container, "draft");
    node.focus();
    await user.keyboard("c");
    await screen.findByRole("dialog", { name: "Connect Draft reply to" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
    await waitFor(() => expect(node).toHaveFocus());
  });

  it("opens the focused node in the inspector with Enter", async () => {
    const user = userEvent.setup();
    const onOpenInspector = vi.fn<(n: CanvasNode) => void>();
    const { container } = render(<Harness onOpenInspector={onOpenInspector} />);
    await settle();
    nodeElement(container, "send").focus();
    await user.keyboard("{Enter}");
    expect(onOpenInspector).toHaveBeenCalledTimes(1);
    expect(onOpenInspector.mock.calls[0]?.[0].id).toBe("send");
  });

  it("opens the palette with / and mod+K and adds the picked node", async () => {
    const user = userEvent.setup();
    const onAddNode = vi.fn<(def: NodeDefinitionView, p: { x: number; y: number }) => void>();
    render(<Harness catalog={SAMPLE_CATALOG} onAddNode={onAddNode} />);
    await settle();
    const canvas = screen.getByRole("application", { name: "Workflow canvas" });
    canvas.focus();
    await user.keyboard("/");
    const palette = await screen.findByRole("dialog", { name: "Add node" });
    expect(within(palette).getByRole("combobox")).toHaveFocus();
    await user.keyboard("yes / no");
    await user.keyboard("{Enter}");
    expect(onAddNode).toHaveBeenCalledTimes(1);
    expect(onAddNode.mock.calls[0]?.[0].name).toMatch(/Yes \/ no/i);

    canvas.focus();
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog", { name: "Add node" })).toBeInTheDocument();
  });

  it("leaves keys typed into a control inside the canvas alone", async () => {
    const user = userEvent.setup();
    const onPositions = vi.fn();
    render(<Harness selected={["send"]} onPositions={onPositions} catalog={SAMPLE_CATALOG} />);
    await settle();
    const add = screen.getByRole("button", { name: /Add node/ });
    add.focus();
    await user.keyboard("{ArrowRight}");
    expect(onPositions).not.toHaveBeenCalled();
  });

  it("registers every canvas shortcut with the app's registry, so the dialog lists them", async () => {
    render(
      <ShortcutProvider platform="other">
        <Harness
          onConnect={vi.fn()}
          catalog={SAMPLE_CATALOG}
          onOpenInspector={vi.fn()}
          onDuplicateNodes={vi.fn()}
          onGroupNodes={vi.fn()}
        />
        <KeyboardShortcutsDialog open onOpenChange={() => undefined} />
      </ShortcutProvider>,
    );
    await settle();
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const canvasSection = within(dialog)
      .getByRole("heading", { name: "Canvas" })
      .closest("section");
    if (!(canvasSection instanceof HTMLElement)) throw new Error("no Canvas section");
    const listed = within(canvasSection)
      .getAllByRole("listitem")
      .map((li) => li.firstElementChild?.textContent ?? "");
    expect(listed.sort()).toEqual(
      Object.values(CANVAS_SHORTCUTS)
        .map((s) => s.description)
        .sort(),
    );
  });
});
