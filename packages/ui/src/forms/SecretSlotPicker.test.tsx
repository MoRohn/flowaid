import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CredentialSlot, SecretDecl } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { SecretSlotPicker, secretsForSlot } from "./SecretSlotPicker";
import { SchemaForm } from "./SchemaForm";

installDomStubs();
afterEach(cleanup);

const LLM_SLOT: CredentialSlot = {
  name: "llm",
  types: ["openai.api_key", "anthropic.api_key"],
  required: true,
  description: "Provider key.",
};
const AUTH_SLOT: CredentialSlot = { name: "auth", types: ["http.bearer"], required: false };
const SLOTS: CredentialSlot[] = [LLM_SLOT, AUTH_SLOT];
const SECRETS: SecretDecl[] = [
  { name: "OPENAI_KEY", credentialType: "openai.api_key", required: true },
  { name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: true },
  {
    name: "CLAUDE_KEY",
    credentialType: "anthropic.api_key",
    required: true,
    description: "Anthropic workspace key",
  },
];

describe("SecretSlotPicker", () => {
  it("lists the declared secrets of a matching credentialType", () => {
    expect(secretsForSlot(LLM_SLOT, SECRETS).map((s) => s.name)).toEqual([
      "OPENAI_KEY",
      "CLAUDE_KEY",
    ]);
  });

  it("binds a slot, offers 'declare new secret' and flags unbound required slots", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onDeclareSecret = vi.fn();
    render(
      <SecretSlotPicker
        slots={SLOTS}
        secrets={SECRETS}
        value={{}}
        onChange={onChange}
        onDeclareSecret={onDeclareSecret}
      />,
    );
    const section = screen.getByRole("region", { name: "Credentials" });
    expect(within(section).getByText("Choose a secret")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /Llm/ }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("OPENAI_KEY"),
      expect.stringContaining("CLAUDE_KEY"),
      "Declare new secret…",
    ]);
    await user.click(screen.getByRole("option", { name: /CLAUDE_KEY/ }));
    expect(onChange).toHaveBeenLastCalledWith({ llm: "CLAUDE_KEY" });
    await user.click(screen.getByRole("combobox", { name: /Auth/ }));
    expect(await screen.findByRole("option", { name: "None" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Declare new secret…" }));
    expect(onDeclareSecret).toHaveBeenCalledWith(AUTH_SLOT);
  });

  it("renders above the config form through SchemaForm.secretSlots", () => {
    render(
      <SchemaForm
        schema={{ type: "object", properties: { url: { type: "string", title: "URL" } } }}
        secretSlots={{ slots: SLOTS, secrets: SECRETS, value: { llm: "OPENAI_KEY" } }}
      />,
    );
    const form = screen.getByRole("region", { name: "Credentials" });
    const url = screen.getByRole("textbox", { name: "URL" });
    expect(form.compareDocumentPosition(url) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Llm/ })).toHaveTextContent("OPENAI_KEY");
  });
});
