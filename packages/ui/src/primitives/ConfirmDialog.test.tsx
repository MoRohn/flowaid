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
});
