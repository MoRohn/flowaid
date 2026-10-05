import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  description: "",
  config: {
    model: { provider: "openai", model: "gpt-test" },
    tools: [
      { name: "lookup_order", approval: "never" },
      { name: "calculator", approval: "never" },
    ],
  },
  active: true,
  createdAt: "",
  updatedAt: "",
};

const card = (known: ReadonlySet<string> | undefined) =>
  render(
    withClient(
      <AgentCard
        agent={agent}
        known={known}
        canWrite
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    ),
  );

describe("an agent card", () => {
  it("flags a tool the workspace no longer offers", () => {
    card(new Set(["calculator"]));
    expect(screen.getByText(/no longer available/).parentElement?.textContent).toBe(
      "lookup_order · no longer available",
    );
    expect(screen.getByText(/Runs of this agent fail until that tool is removed/)).toBeDefined();
  });

  it("says nothing while the tool list is still loading", () => {
    card(undefined);
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });
});
