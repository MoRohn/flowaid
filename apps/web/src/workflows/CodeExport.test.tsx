/**
 * Download code from the app (roadmap B-03): the dialog posts the export, follows the job and saves
 * the zip; a draft is saved first and its problems are listed when it cannot be packaged.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import { bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";

const features: Record<string, boolean> = { code_export: true };
vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features, can: () => true }),
}));

const { CodeExportDialog, fileNameOf } = await import("./CodeExport");

const WF = {
  id: "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09",
  name: "Refund triage",
  slug: "refund-triage",
};
const V2 = "01a10d0d-5b66-72be-9f2a-8911ba46c6bd";
const RUN = "01a10db2-bc29-76bd-81bd-a9df095dd813";
const JOB = "01a10d05-d750-7201-9a98-ffb318481bdc";
const ARTIFACT = "01a10d05-d83f-777f-bba8-3b27fbf847ec";

const version = (id: string, n: number) => ({
  id,
  workflowId: WF.id,
  kind: "published",
  version: n,
  label: null,
  definitionHash: "d",
  planHash: "p",
  compilerVersion: "1",
  notes: null,
  publishedBy: null,
  createdAt: "2026-10-01T10:00:00.000Z",
});

let saved: { name: string; size: number }[] = [];
beforeAll(() => {
  installDomStubs();
  URL.createObjectURL = () => "blob:zip";
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, size: 0 });
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  saved = [];
  features.code_export = true;
});

function routes(job: () => unknown, extra: Record<string, () => unknown> = {}) {
  return stubApi({
    [`GET /v1/workflows/${WF.id}/versions`]: () => ({
      items: [version("v1-id", 1), version(V2, 2)],
      next_cursor: null,
    }),
    "GET /v1/runs": () => ({
      items: [{ id: RUN, createdAt: "2026-10-01T11:00:00.000Z", endedAt: null }],
      next_cursor: null,
    }),
    [`GET /v1/jobs/${JOB}`]: job,
    [`GET /v1/artifacts/${ARTIFACT}/download`]: () =>
      new Response(new Blob(["zip"]), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="flowaid-refund-triage-v2.zip"',
        },
      }),
    ...extra,
  });
}

/** Clicks Download code once the versions have loaded (the button waits for a version). */
async function download() {
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "Download code" });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe("Download code", () => {
  it("packages the chosen version, follows the job and saves the zip", async () => {
    const fetchMock = routes(() => ({ id: JOB, status: "completed", artifact_id: ARTIFACT }), {
      [`POST /v1/workflow-versions/${V2}/export/package`]: () => ({ job_id: JOB }),
    });
    render(
      withClient(
        <CodeExportDialog open onOpenChange={() => undefined} workflow={WF} defaultTarget={V2} />,
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Download code" });
    await within(dialog).findByText(/Sample input from the last successful run/);
    await download();
    expect(await screen.findByText("flowaid-refund-triage-v2.zip")).toBeTruthy();
    expect(saved.map((s) => s.name)).toEqual(["flowaid-refund-triage-v2.zip"]);
    expect(
      bodyOf(callsTo(fetchMock, `POST /v1/workflow-versions/${V2}/export/package`)[0]?.[1]),
    ).toEqual({
      mode: "vendored",
      includeSampleFromRunId: RUN,
      includeRecordedRunId: RUN,
    });
  });

  it("saves the draft first and lists the problems that stop it from packaging", async () => {
    const order: string[] = [];
    routes(() => ({ id: JOB, status: "queued" }), {
      [`POST /v1/workflows/${WF.id}/draft/export/package`]: () => {
        order.push("export");
        return Response.json(
          {
            error: {
              code: "WORKFLOW_VALIDATION_ERROR",
              message: "1 diagnostic(s)",
              details: {
                diagnostics: [
                  {
                    code: "E_CONFIG_INVALID",
                    severity: "error",
                    message: "Instructions is required",
                    location: { nodeId: "boolean_1" },
                  },
                  {
                    code: "W_UNREACHABLE",
                    severity: "warning",
                    message: "never runs",
                    location: {},
                  },
                ],
              },
            },
          },
          { status: 422 },
        );
      },
    });
    const saveDraft = vi.fn(() => {
      order.push("save");
      return Promise.resolve();
    });
    render(
      withClient(
        <CodeExportDialog
          open
          onOpenChange={() => undefined}
          workflow={WF}
          defaultTarget="draft"
          draft={{ saveDraft, describe: (d) => `Boolean: ${d.message}` }}
        />,
      ),
    );
    await screen.findByRole("dialog", { name: "Download code" });
    await download();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The draft has 1 problem to fix before it can be packaged.",
    );
    expect(within(alert).getByText("Boolean: Instructions is required")).toBeTruthy();
    expect(order).toEqual(["save", "export"]);
    expect(saved).toEqual([]);
  });

  it("reports the worker's reason when the build fails, and asks for npm where nothing is packed", async () => {
    features.code_export = false;
    const fetchMock = routes(
      () => ({
        id: JOB,
        status: "failed",
        error: { code: "CODEGEN_ROUNDTRIP", message: "the generated code differs" },
      }),
      { [`POST /v1/workflow-versions/${V2}/export/package`]: () => ({ job_id: JOB }) },
    );
    render(
      withClient(
        <CodeExportDialog open onOpenChange={() => undefined} workflow={WF} defaultTarget={V2} />,
      ),
    );
    await screen.findByRole("dialog", { name: "Download code" });
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Self-contained/ }).disabled).toBe(
      true,
    );
    await download();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The package could not be built: the generated code differs",
    );
    expect(
      (
        bodyOf(callsTo(fetchMock, `POST /v1/workflow-versions/${V2}/export/package`)[0]?.[1]) as {
          mode: string;
        }
      ).mode,
    ).toBe("npm");
  });

  it("stops waiting when the dialog closes, and saves nothing", async () => {
    let polls = 0;
    routes(
      () => {
        polls += 1;
        return { id: JOB, status: "running" };
      },
      { [`POST /v1/workflow-versions/${V2}/export/package`]: () => ({ job_id: JOB }) },
    );
    const view = render(
      withClient(
        <CodeExportDialog open onOpenChange={() => undefined} workflow={WF} defaultTarget={V2} />,
      ),
    );
    await screen.findByRole("dialog", { name: "Download code" });
    await download();
    expect(await screen.findByText(/Building the package/)).toBeTruthy();
    view.unmount();
    const seen = polls;
    await new Promise((r) => setTimeout(r, 1200));
    expect(polls).toBe(seen);
    expect(saved).toEqual([]);
  });
});

describe("fileNameOf", () => {
  it("reads the name the API sends", () => {
    expect(fileNameOf('attachment; filename="flowaid-x-v1.zip"')).toBe("flowaid-x-v1.zip");
    expect(fileNameOf("attachment; filename=a.zip")).toBe("a.zip");
    expect(fileNameOf(null)).toBeNull();
  });
});
