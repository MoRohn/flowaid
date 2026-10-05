/** ExportDialog: the choices it sends, the progress it shows and how it reports failure. */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { TooltipProvider } from "@/primitives";
import { ExportDialog, type ExportDialogProps } from "./ExportDialog";

afterEach(cleanup);
beforeAll(() => installDomStubs());

const TARGETS = [
  { id: "draft", label: "Current draft" },
  { id: "v2-id", label: "v2", detail: "Published yesterday · live in production" },
  { id: "v1-id", label: "v1" },
];

function show(props: Partial<ExportDialogProps> = {}) {
  const onExport = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <TooltipProvider>
      <ExportDialog
        open
        onOpenChange={onOpenChange}
        workflowName="Refund triage"
        targets={TARGETS}
        vendoredAvailable
        sampleRun={{ label: "the last successful run" }}
        status={{ phase: "idle" }}
        onExport={onExport}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onExport, onOpenChange, view };
}

describe("ExportDialog", () => {
  it("sends the chosen version, runtime and run options", async () => {
    const user = userEvent.setup();
    const { onExport } = show({ defaultTarget: "v2-id" });
    const dialog = screen.getByRole("dialog", { name: "Download code" });
    expect(within(dialog).getByText(/live in production/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /npm packages/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /recorded run/ }));
    await user.click(within(dialog).getByRole("button", { name: "Download code" }));
    expect(onExport).toHaveBeenCalledWith({
      target: "v2-id",
      mode: "npm",
      includeSample: true,
      includeRecorded: false,
    });
  });

  it("offers only npm where the runtime packages are not packed, and no run options without a run", async () => {
    const user = userEvent.setup();
    const { onExport } = show({ vendoredAvailable: false, sampleRun: null });
    const dialog = screen.getByRole("dialog", { name: "Download code" });
    expect(within(dialog).getByRole("radio", { name: /Self-contained/ })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: /npm packages/ })).toBeChecked();
    expect(within(dialog).getByText(/FLOWAID_VENDOR_DIR/)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Sample input/ })).toBeDisabled();
    expect(within(dialog).getByText(/No successful run yet/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Download code" }));
    expect(onExport).toHaveBeenCalledWith({
      target: "draft",
      mode: "npm",
      includeSample: false,
      includeRecorded: false,
    });
  });

  it("shows the build in progress and blocks a second request", () => {
    show({ status: { phase: "building" } });
    const dialog = screen.getByRole("dialog", { name: "Download code" });
    expect(within(dialog).getByText(/Building the package/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Download code/ })).toBeDisabled();
    expect(within(dialog).queryByRole("radio")).toBeNull();
  });

  it("lists what stops a draft from packaging and lets the person try again", async () => {
    const user = userEvent.setup();
    const { onExport } = show({
      status: {
        phase: "failed",
        message: "The draft has 2 problems to fix before it can be packaged.",
        problems: ["Boolean: Instructions is required", "Output: Result is not connected"],
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("2 problems");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("names the saved file and how to run it", async () => {
    const user = userEvent.setup();
    const onDownloadAgain = vi.fn();
    const { onOpenChange } = show({
      status: { phase: "done", fileName: "flowaid-refund-triage-v2.zip" },
      onDownloadAgain,
    });
    expect(screen.getByText("flowaid-refund-triage-v2.zip")).toBeInTheDocument();
    expect(screen.getByText(/pnpm install/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download again" }));
    expect(onDownloadAgain).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
