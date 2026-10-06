import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Diagnostic, WorkflowDefinition } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";
import { blankDefinition } from "./model";

vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features: {}, can: () => true }),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const { PublishDialog } = await import("./PublishDialog");

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WF = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";
const environments = [
  { id: "env-dev", name: "dev", protected: false },
  { id: "env-prod", name: "prod", protected: true },
];
const draft = (): WorkflowDefinition => {
  const d = blankDefinition(WF, "Refunds");
  d.secrets = [{ name: "OPENAI_KEY", credentialType: "openai.api_key", required: true }];
  return d;
};

const open = (diagnostics: Diagnostic[] = [], onPublished = vi.fn()) =>
  render(
    withClient(
      <PublishDialog
        open
        onOpenChange={() => undefined}
        workflowId={WF}
        latestVersionId={null}
        draft={draft()}
        diagnostics={diagnostics}
        environments={environments}
        flush={() => Promise.resolve()}
        onPublished={onPublished}
      />,
    ),
  );

const publishButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: /^Publish( and deploy)?$/ });

describe("publish review", () => {
  it("publishes only, deploying nowhere unless an environment is ticked", async () => {
    const fetchMock = stubApi({
      "GET /v1/evaluations/sets": () => ({ items: [], next_cursor: null }),
      [`POST /v1/workflows/${WF}/publish`]: () => ({ id: "v1", version: 1 }),
    });
    const onPublished = vi.fn();
    open([], onPublished);
    const checks = screen.getByRole("list", { name: "Publish checks" });
    expect(within(checks).getByText("The draft compiles without errors")).toBeTruthy();
    expect(within(checks).getByText("This will be the first version, v1")).toBeTruthy();
    expect(screen.getByText(/Deploys nothing: v1 runs nowhere/)).toBeTruthy();
    fireEvent.click(publishButton());
    await waitFor(() => expect(onPublished).toHaveBeenCalled());
    const [call] = callsTo(fetchMock, `POST /v1/workflows/${WF}/publish`);
    expect(bodyOf(call?.[1])).toEqual({});
    // the toast offers the next step: deploying the new version
    fireEvent.click(await screen.findByRole("button", { name: "Deploy" }));
    expect(push).toHaveBeenCalledWith(`/acme/workflows/${WF}/deployments?version=v1`);
  });

  it("blocks deploying to an environment whose required secret is unbound", async () => {
    stubApi({
      "GET /v1/evaluations/sets": () => ({ items: [], next_cursor: null }),
      [`GET /v1/workflows/${WF}/secrets/env-prod`]: () => ({}),
    });
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: /prod/ }));
    expect(await screen.findByText(/Required secrets not bound in prod: OPENAI_KEY/)).toBeTruthy();
    expect(publishButton().textContent).toBe("Publish and deploy");
    expect(publishButton().disabled).toBe(true);
    // unticking it clears the blocker: publishing alone is still possible
    fireEvent.click(screen.getByRole("checkbox", { name: /prod/ }));
    await waitFor(() => expect(publishButton().disabled).toBe(false));
  });

  it("blocks on compiler errors", () => {
    stubApi({ "GET /v1/evaluations/sets": () => ({ items: [], next_cursor: null }) });
    open([
      {
        code: "E_NO_OUTPUT_NODE",
        severity: "error",
        message: "the output is not connected",
        location: { path: "/" },
      },
    ]);
    expect(screen.getByText("1 error to fix in the draft")).toBeTruthy();
    expect(publishButton().disabled).toBe(true);
  });
});
