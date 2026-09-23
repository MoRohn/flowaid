import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NodeManifestSchema, type NodeManifest, type SecretDecl } from "@flowaid/workflow-core";
import type { ModelView } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { SchemaForm } from "./SchemaForm";
import { fromContractSchema } from "./schema";
import { createSchemaValidator } from "./validation";

installDomStubs();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** `packages/workflow-core/fixtures/manifests/`, resolved from this test file. */
function manifestsDir(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not report the test path");
  return join(dirname(testPath), "../../../workflow-core/fixtures/manifests/");
}

const MANIFESTS: NodeManifest[] = readdirSync(manifestsDir())
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => NodeManifestSchema.parse(JSON.parse(readFileSync(join(manifestsDir(), f), "utf8"))));

const SECRETS: SecretDecl[] = [
  { name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: true },
  { name: "OPENAI_KEY", credentialType: "openai.api_key", required: true },
  { name: "SUPPORT_API_TOKEN", credentialType: "http.bearer", required: false },
];

const MODELS: ModelView[] = [
  { id: "gpt-5-mini", provider: "openai", name: "gpt-5-mini", kind: "generation" },
];

function manifest(id: string): NodeManifest {
  const found = MANIFESTS.find((m) => m.id === id);
  if (!found) throw new Error(`fixture manifest ${id} missing`);
  return found;
}

describe("workflow-core fixture manifests through SchemaForm", () => {
  it("has the five fixture manifests", () => {
    expect(MANIFESTS.map((m) => m.id)).toEqual([
      "flowaid.ai.generate",
      "flowaid.decision.boolean",
      "flowaid.decision.choice",
      "flowaid.decision.confidence_gate",
      "flowaid.tools.http",
    ]);
  });

  it.each(MANIFESTS.map((m) => [m.id, m] as const))(
    "%s renders without unknown-widget or deprecation warnings",
    (_id, m) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const schema = fromContractSchema(m.configSchema);
      expect(createSchemaValidator(schema).validate({})).toBeInstanceOf(Array);
      render(
        <SchemaForm
          schema={schema}
          nodeType={m.id}
          models={MODELS}
          secretSlots={{ slots: m.credentials, secrets: SECRETS, value: {} }}
          aria-label={m.metadata.name}
        />,
      );
      expect(screen.getByRole("form", { name: m.metadata.name })).toBeInTheDocument();
      const schemaFormWarnings = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((text) => text.includes("SchemaForm"));
      expect(schemaFormWarnings).toEqual([]);
      if (m.credentials.length > 0)
        expect(screen.getByRole("region", { name: "Credentials" })).toBeInTheDocument();
    },
  );

  it("flowaid.tools.http: body shows for POST (showWhen) and is bindable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={fromContractSchema(manifest("flowaid.tools.http").configSchema)}
        defaultValues={{ url: "https://api.example.com/items" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Url" })).toHaveTextContent(
      "https://api.example.com/items",
    );
    expect(screen.queryByRole("radiogroup", { name: "Body source" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Method" }));
    await user.click(await screen.findByRole("option", { name: "POST" }));
    expect(await screen.findByRole("radiogroup", { name: "Body source" })).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        {
          method: "POST",
          url: "https://api.example.com/items",
          headers: {},
          query: {},
          responseType: "json",
          timeoutMs: 30000,
        },
        true,
      ),
    );
  });

  it("flowaid.decision.confidence_gate: threshold is a bindable slider, the config validates with ajv", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SchemaForm
        schema={fromContractSchema(manifest("flowaid.decision.confidence_gate").configSchema)}
        defaultValues={{ threshold: 0.8 }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Threshold source" })).toBeInTheDocument();
    expect(screen.getAllByRole("slider").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("radio", { name: "Ref" }));
    await user.type(
      screen.getByRole("textbox", { name: "Threshold reference" }),
      "$vars.gate_threshold",
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        {
          threshold: { kind: "ref", ref: { kind: "var", name: "gate_threshold" } },
          requireValue: false,
        },
        true,
      ),
    );
  });

  it("flowaid.decision.choice: the option map keeps minProperties / propertyNames for ajv", () => {
    const validator = createSchemaValidator(
      fromContractSchema(manifest("flowaid.decision.choice").configSchema),
    );
    expect(
      validator.validate({
        instructions: "Which team?",
        options: { billing: "Money", technical: "Bugs" },
      }),
    ).toEqual([]);
    const issues = validator.validate({ instructions: "Which team?", options: { "Bad Key": "x" } });
    expect(issues.map((i) => [i.path, i.keyword])).toEqual(
      expect.arrayContaining([
        ["options", "minProperties"],
        ["options", "propertyNames"],
      ]),
    );
  });

  it("flowaid.ai.generate: the model widget stores a ModelRef", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SchemaForm
        schema={fromContractSchema(manifest("flowaid.ai.generate").configSchema)}
        models={MODELS}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.click(await screen.findByRole("option", { name: /gpt-5-mini/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: { provider: "openai", model: "gpt-5-mini" } }),
        true,
      ),
    );
  });
});
