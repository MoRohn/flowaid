import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JsonSchema, ModelView } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import {
  ModelFallbacks,
  selectionCandidates,
  toModelSelection,
  type ModelSelectionValue,
} from "./ModelFallbacks";
import { SchemaForm } from "./SchemaForm";
import { acceptsGenerationPolicy } from "./widgets";

installDomStubs();
afterEach(cleanup);

const MODELS: ModelView[] = [
  { id: "gpt-6-sol", provider: "openai", name: "gpt-6-sol", kind: "generation", health: "healthy" },
  { id: "gpt-6-luna", provider: "openai", name: "gpt-6-luna", kind: "generation" },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    name: "claude-sonnet-5",
    kind: "generation",
    health: "healthy",
  },
];

const SOL = { provider: "openai", model: "gpt-6-sol" };
const SONNET = { provider: "anthropic", model: "claude-sonnet-5" };

describe("model selection values", () => {
  it("reads the candidates of a ref, a policy, and nothing else", () => {
    expect(selectionCandidates(SOL)).toEqual([SOL]);
    expect(selectionCandidates({ candidates: [SOL, SONNET], strategy: "cheapest" })).toEqual([
      SOL,
      SONNET,
    ]);
    expect(selectionCandidates(undefined)).toEqual([]);
    expect(selectionCandidates("gpt-6-sol")).toEqual([]);
  });

  it("stores one model as a plain ref and several as a policy", () => {
    expect(toModelSelection([SOL], "ordered")).toEqual(SOL);
    expect(toModelSelection([SOL, SONNET], "fastest")).toEqual({
      candidates: [SOL, SONNET],
      strategy: "fastest",
    });
    expect(toModelSelection([], "ordered")).toBeUndefined();
  });

  it("keeps requirements and the cost cap the policy already had", () => {
    const previous = {
      candidates: [SOL, SONNET],
      strategy: "ordered",
      requirements: { tools: true },
      maxCostUsdPerCall: 0.02,
    };
    expect(toModelSelection([SOL], "ordered", previous)).toEqual({
      candidates: [SOL],
      strategy: "ordered",
      requirements: { tools: true },
      maxCostUsdPerCall: 0.02,
    });
  });
});

function Harness({ initial, onChange }: { initial: unknown; onChange: (v: unknown) => void }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <ModelFallbacks
      models={MODELS}
      value={value}
      onValueChange={(v: ModelSelectionValue | undefined) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, trigger: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: trigger }));
  await user.click(await screen.findByRole("option", { name: new RegExp(option) }));
}

describe("ModelFallbacks", () => {
  it("adds a fallback, turning the ref into an ordered policy", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={SOL} onChange={onChange} />);
    expect(screen.queryByRole("list", { name: "Fallback models" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add fallback" }));
    await pick(user, "Fallback 1", "claude-sonnet-5");
    expect(onChange).toHaveBeenLastCalledWith({ candidates: [SOL, SONNET], strategy: "ordered" });
    expect(
      within(screen.getByRole("list", { name: "Fallback models" })).getAllByRole("listitem"),
    ).toHaveLength(1);
  });

  it("changes the routing strategy and removes a fallback back to a plain ref", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness initial={{ candidates: [SOL, SONNET], strategy: "ordered" }} onChange={onChange} />,
    );
    await user.click(screen.getByRole("combobox", { name: "Routing" }));
    await user.click(await screen.findByRole("option", { name: "Cheapest first" }));
    expect(onChange).toHaveBeenLastCalledWith({ candidates: [SOL, SONNET], strategy: "cheapest" });
    expect(screen.getByText(/lowest catalog price first/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove fallback 1" }));
    expect(onChange).toHaveBeenLastCalledWith(SOL);
    expect(screen.queryByRole("combobox", { name: "Routing" })).toBeNull();
  });

  it("replaces the primary model and caps the list at five", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const five = { candidates: [SOL, SONNET, SOL, SONNET, SOL], strategy: "healthiest" };
    render(<Harness initial={five} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Add fallback" })).toBeNull();
    await pick(user, "Model", "gpt-6-luna");
    expect(onChange).toHaveBeenLastCalledWith({
      candidates: [{ provider: "openai", model: "gpt-6-luna" }, SONNET, SOL, SONNET, SOL],
      strategy: "healthiest",
    });
  });
});

describe("the model widget", () => {
  const union: JsonSchema = {
    anyOf: [
      {
        type: "object",
        properties: { provider: { type: "string" }, model: { type: "string" } },
        required: ["provider", "model"],
      },
      {
        type: "object",
        properties: { candidates: { type: "array" } },
        required: ["candidates"],
      },
    ],
  };

  it("recognises a schema that accepts a generation policy", () => {
    expect(acceptsGenerationPolicy(union)).toBe(true);
    expect(acceptsGenerationPolicy({ type: "object" })).toBe(false);
  });

  it("renders the fallbacks editor for such a field", () => {
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: { model: { ...union, "x-ui": { widget: "model" } } },
        }}
        defaultValues={{ model: { candidates: [SOL, SONNET], strategy: "fastest" } }}
        models={MODELS}
      />,
    );
    expect(screen.getByRole("list", { name: "Fallback models" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Routing" })).toHaveTextContent("Fastest first");
  });
});
