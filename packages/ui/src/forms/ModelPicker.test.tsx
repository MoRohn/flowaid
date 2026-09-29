import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ModelView } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { ModelPicker } from "./ModelPicker";

installDomStubs();
afterEach(cleanup);

const MODELS: ModelView[] = [
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    name: "gpt-4.1-mini",
    kind: "generation",
    needsKey: true,
  },
  { id: "claude-x", provider: "anthropic", name: "claude-x", kind: "generation" },
];

describe("ModelPicker", () => {
  it("marks models whose provider has no key and lists providers with a key first", async () => {
    render(<ModelPicker models={MODELS} aria-label="Model" />);
    await userEvent.click(screen.getByRole("combobox", { name: "Model" }));
    const list = await screen.findByRole("listbox");
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveTextContent("claude-x");
    expect(options[1]).toHaveTextContent("gpt-4.1-mini");
    expect(options[1]).toHaveTextContent("no key");
    expect(options[0]).not.toHaveTextContent("no key");
  });

  it("shows the mark on the chosen model too", () => {
    render(<ModelPicker models={MODELS} value="gpt-4.1-mini" aria-label="Model" />);
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("no key");
  });
});
