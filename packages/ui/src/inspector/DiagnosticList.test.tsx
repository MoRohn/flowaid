import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Diagnostic } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { Button } from "@/primitives";
import { DiagnosticList } from "./Inspector";

installDomStubs();
afterEach(cleanup);

const DIAG: Diagnostic = {
  code: "E_CREDENTIAL_SLOT_UNBOUND",
  severity: "error",
  message: "Credential slot 'llm' (openai.api_key) is required",
  location: { nodeId: "generate_1", path: "/nodes/2/credentials" },
};

describe("DiagnosticList", () => {
  it("keeps the compiler's code and pointer for technical readers", () => {
    render(<DiagnosticList diagnostics={[DIAG]} />);
    expect(screen.getByText(DIAG.message)).toBeInTheDocument();
    expect(screen.getByText("E_CREDENTIAL_SLOT_UNBOUND")).toBeInTheDocument();
    expect(screen.getByText("/nodes/2/credentials")).toBeInTheDocument();
  });

  it("adds a plain location, a hint and the app's actions", async () => {
    const show = vi.fn();
    render(
      <DiagnosticList
        diagnostics={[DIAG]}
        describe={() => ({
          where: "Generate text",
          hint: "This step needs a key.",
          actions: <Button onClick={show}>Show node</Button>,
        })}
      />,
    );
    expect(screen.getByText("Generate text:")).toBeInTheDocument();
    expect(screen.getByText("This step needs a key.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show node" }));
    expect(show).toHaveBeenCalled();
    expect(screen.getByText("E_CREDENTIAL_SLOT_UNBOUND")).toBeInTheDocument();
  });
});
