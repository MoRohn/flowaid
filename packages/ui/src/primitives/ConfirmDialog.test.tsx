import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "./testStubs";
import { ConfirmDialog } from "./ConfirmDialog";

installDomStubs();
afterEach(cleanup);

describe("ConfirmDialog", () => {
  it("closes once a successful confirm settles", async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete it?"
        confirmLabel="Delete"
        onConfirm={() => Promise.resolve()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open and says why when the confirm action fails", async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete it?"
        confirmLabel="Delete"
        onConfirm={() => Promise.reject(new Error("The server is unreachable."))}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The server is unreachable.");
    expect(onOpenChange).not.toHaveBeenCalled();
    // the action can be tried again
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  // F-04: "Quit FlowAId" opened on its destructive button, one Enter from stopping everything
  it("opens a danger confirmation on Cancel, as an alert dialog, so Enter cancels", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        variant="danger"
        onOpenChange={onOpenChange}
        title="Quit FlowAId?"
        confirmLabel="Quit FlowAId"
        onConfirm={onConfirm}
      />,
    );
    const dialog = await screen.findByRole("alertdialog", { name: "Quit FlowAId?" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens an ordinary confirmation on its confirm button, as a dialog", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Switch to production?"
        confirmLabel="Switch"
        onConfirm={onConfirm}
      />,
    );
    await screen.findByRole("dialog", { name: "Switch to production?" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
