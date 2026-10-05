import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { withClient } from "~/knowledge/pageindex/testApi";
import type { AgentPreset } from "./logic";

vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features: {}, can: () => true }),
}));
const { AgentCard } = await import("./AgentCard");

beforeAll(() => installDomStubs());
afterEach(() => cleanup());

const agent: AgentPreset = {
  id: "a1",
  name: "Stale helper",
  description: "Answers order questions",
  config: {
    model: { provider: "openai", model: "gpt-test" },
    tools: [
      { name: "lookup_order", approval: "never" },
      { name: "calculator", approval: "irreversible" },
      { name: "refund", approval: "irreversible" },
    ],
  },
  active: true,
  createdAt: "",
  updatedAt: "",
};

const tool = (name: string, idempotency: "safe" | "none"): ToolDefinition => ({
  name,
  description: name,
  inputSchema: {},
  idempotency,
  approvalRequired: false,
  source: { kind: "builtin", id: name },
});

const card = (catalog: ToolDefinition[] | undefined) =>
  render(
    withClient(
      <AgentCard
        agent={agent}
        catalog={catalog}
        canWrite
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    ),
  );

describe("an agent card", () => {
  it("flags a tool the workspace no longer offers", () => {
    card([tool("calculator", "safe"), tool("refund", "none")]);
    expect(screen.getByText(/no longer available/).parentElement?.textContent).toBe(
      "lookup_order · no longer available",
    );
    expect(screen.getByText(/Runs of this agent fail until that tool is removed/)).toBeDefined();
  });

  it("says nothing about missing tools while the tool list is still loading", () => {
    card(undefined);
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });

  it("marks approval only where a person is really asked", () => {
    card([tool("calculator", "safe"), tool("refund", "none")]);
    // "Ask for irreversible calls" on a read-only tool never asks
    expect(screen.getByText("calculator").parentElement?.textContent).toBe(
      "calculator (runs without asking)",
    );
    expect(screen.getByText("refund").parentElement?.textContent).toBe(
      "refund (asks a person first) · approval",
    );
  });

  it("marks an inactive agent without dimming its text", () => {
    const { container } = render(
      withClient(
        <AgentCard
          agent={{ ...agent, active: false }}
          catalog={[]}
          canWrite
          onEdit={() => undefined}
          onDelete={() => undefined}
        />,
      ),
    );
    const cardEl = container.querySelector("[data-inactive]");
    expect(cardEl).not.toBeNull();
    // opacity took the labels and tool chips below 4.5:1 contrast (axe, light theme)
    expect(cardEl?.className).not.toMatch(/(^|\s)opacity-/);
    expect(screen.getByRole("switch", { name: /^Stale helper: Inactive/ })).toBeDefined();
  });

  it("names its actions and its switch after the agent", () => {
    card([]);
    expect(screen.getByRole("button", { name: "Edit Stale helper" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete Stale helper" })).toBeDefined();
    expect(screen.getByRole("switch", { name: /^Stale helper: Active/ })).toBeDefined();
  });
});
