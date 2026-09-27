/**
 * Builder and review surfaces (P0-20): ImportDialog, VersionCompare, SideBySideDiff,
 * EscalationDialog, ReviewPage and CommandMenu, exercised through their roles.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { TooltipProvider } from "@/primitives";
import { emptyWorkflowDiff } from "@/lib/workflowDiff";
import type { ApprovalRequestView } from "@/types";
import { ImportDialog, type ImportMigrationReport } from "./ImportDialog";
import { VersionCompare } from "./VersionCompare";
import { SideBySideDiff } from "./SideBySideDiff";
import { EscalationDialog } from "@/human/EscalationDialog";
import { ReviewPage } from "@/human/ReviewPage";
import { CommandMenu } from "@/shell/CommandMenu";
import { ShortcutProvider } from "@/shell/ShortcutProvider";
import { ThemeProvider } from "@/theme";

afterEach(cleanup);
beforeAll(() => installDomStubs());

const REPORT: ImportMigrationReport = {
  fileName: "triage.json",
  workflowName: "Support triage",
  counts: { imported: 2, converted: 1, needsConfig: 1, unsupported: 1 },
  nodes: [
    {
      id: "a",
      sourceType: "chatOpenAI",
      name: "Chat",
      targetType: "flowaid.ai.generate",
      status: "converted",
    },
    {
      id: "b",
      sourceType: "httpRequest",
      name: "Lookup",
      targetType: "flowaid.tools.http",
      status: "needs_config",
      message: "Set the URL",
    },
    {
      id: "c",
      sourceType: "customJs",
      name: "Legacy",
      status: "unsupported",
      message: "No equivalent",
    },
  ],
};

describe("ImportDialog", () => {
  it("lists what converts, what needs work and imports on confirm", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(
      <ImportDialog
        open
        onOpenChange={() => undefined}
        report={REPORT}
        status="ready"
        onFile={() => undefined}
        onImport={onImport}
        onCancel={() => undefined}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Lookup")).toBeInTheDocument();
    expect(within(dialog).getByText("Set the URL")).toBeInTheDocument();
    expect(within(dialog).getByText("Legacy")).toBeInTheDocument();
    expect(within(dialog).getByText(/1 unsupported/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^Import/ }));
    expect(onImport).toHaveBeenCalledWith(REPORT);
  });

  it("shows the error and offers no import while failed", () => {
    render(
      <ImportDialog
        open
        onOpenChange={() => undefined}
        report={null}
        status="error"
        error="Not a workflow export"
        onFile={() => undefined}
        onImport={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText("Not a workflow export")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import$/ })).toBeDisabled();
  });
});

describe("VersionCompare", () => {
  const base = {
    id: "v1",
    version: 1,
    status: "production" as const,
    createdAt: "2026-09-20T10:00:00Z",
    nodeCount: 5,
  };
  const candidate = {
    id: "v2",
    version: 2,
    status: "published" as const,
    createdAt: "2026-09-21T10:00:00Z",
    nodeCount: 6,
  };

  it("summarises added and changed nodes and hands the candidate to promote", async () => {
    const user = userEvent.setup();
    const onPromote = vi.fn();
    const onFocusNode = vi.fn();
    const diff = emptyWorkflowDiff();
    diff.nodes.added.push("gate");
    diff.nodes.changed.push({
      id: "intent",
      patch: [{ op: "replace", path: "/config/instructions", value: "x" }],
    });
    render(
      <TooltipProvider>
        <VersionCompare
          base={base}
          candidate={candidate}
          diff={diff}
          nodeName={(id) => ({ gate: "Confidence gate", intent: "Intent" })[id]}
          metrics={[
            {
              key: "pass",
              label: "Pass rate",
              base: 0.9,
              candidate: 0.95,
              unit: "ratio",
              higherIsBetter: true,
            },
          ]}
          onPromote={onPromote}
          onFocusNode={onFocusNode}
        />
      </TooltipProvider>,
    );
    expect(screen.getAllByText(/Confidence gate/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Intent/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/95\.0%/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Promote/ }));
    expect(onPromote).toHaveBeenCalledWith(candidate);
  });
});

describe("SideBySideDiff", () => {
  it("shows removed and added lines side by side", () => {
    render(
      <SideBySideDiff
        before={"a: 1\nb: 2\nc: 3"}
        after={"a: 1\nb: 20\nc: 3\nd: 4"}
        beforeLabel="v1"
        afterLabel="v2"
      />,
    );
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getAllByText(/b: 2$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/b: 20/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/d: 4/).length).toBeGreaterThan(0);
  });
});

describe("EscalationDialog", () => {
  it("escalates to the chosen target with a comment and the notify flag", async () => {
    const user = userEvent.setup();
    const onEscalate = vi.fn();
    render(
      <EscalationDialog
        open
        onOpenChange={() => undefined}
        targets={[
          { id: "team:billing", name: "Billing", kind: "team", description: "4 in queue" },
          { id: "user:dana", name: "Dana Whitfield", kind: "person" },
        ]}
        defaultTo="team:billing"
        onEscalate={onEscalate}
      />,
    );
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "Needs a refund decision");
    await user.click(within(dialog).getByRole("button", { name: /^Escalate/ }));
    await waitFor(() => expect(onEscalate).toHaveBeenCalled());
    const [response, options] = onEscalate.mock.calls[0] as [
      { action: string; to: string[]; comment?: string },
      { notify: boolean },
    ];
    expect(response).toEqual({
      action: "escalate",
      to: ["team:billing"],
      comment: "Needs a refund decision",
    });
    expect(options.notify).toBe(true);
  });
});

describe("ReviewPage", () => {
  const request: ApprovalRequestView = {
    id: "task_1",
    runId: "run_1",
    nodeId: "approve",
    nodeName: "Approve refund",
    requestedAt: "2026-09-27T10:00:00Z",
    request: {
      title: "Refund request for order 1182",
      context: { amount: 42 },
      mode: { type: "approval" },
      assignees: [],
      expiresAt: null,
      externalReview: false,
      origin: "human_node",
    },
  };

  it("approves with a comment and shows the run so far", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(
      <TooltipProvider>
        <ReviewPage
          card={{
            request,
            workflowName: "Refund triage",
            onRespond,
            hotkeys: false,
            now: Date.parse("2026-09-27T10:05:00Z"),
          }}
          runId="run_1"
          defaultRunOpen
          nodeRuns={[
            {
              id: "nr1",
              nodeId: "ticket",
              nodeName: "Ticket",
              nodeType: "input",
              category: "flow",
              status: "completed",
              attempt: 1,
            },
          ]}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("Refund request for order 1182")).toBeInTheDocument();
    expect(screen.getByText("Ticket")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Approve/ }));
    await waitFor(() => expect(onRespond).toHaveBeenCalled());
    expect((onRespond.mock.calls[0] as [{ action: string }])[0].action).toBe("approve");
  });
});

describe("CommandMenu", () => {
  it("filters pages and actions and runs the chosen one", async () => {
    const user = userEvent.setup();
    const onRuns = vi.fn();
    const onPublish = vi.fn();
    render(
      <ThemeProvider>
        <ShortcutProvider>
          <CommandMenu
            open
            onOpenChange={() => undefined}
            pages={[
              { id: "workflows", label: "Workflows", onSelect: () => undefined },
              { id: "runs", label: "Runs", onSelect: onRuns },
            ]}
            actions={[
              { id: "publish", label: "Publish a new version", onSelect: onPublish },
              { id: "delete", label: "Delete workflow", disabled: true, onSelect: () => undefined },
            ]}
          />
        </ShortcutProvider>
      </ThemeProvider>,
    );
    const input = screen.getByRole("combobox");
    await user.type(input, "publ");
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onRuns).not.toHaveBeenCalled();
  });
});
