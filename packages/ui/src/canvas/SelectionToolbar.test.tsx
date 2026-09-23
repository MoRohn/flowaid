import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { SelectionToolbar } from "./SelectionToolbar";

installDomStubs();
afterEach(cleanup);

describe("SelectionToolbar", () => {
  it("fires align, distribute, group and delete callbacks", async () => {
    const user = userEvent.setup();
    const onAlign = vi.fn();
    const onDistribute = vi.fn();
    const onGroup = vi.fn();
    const onDelete = vi.fn();
    render(
      <SelectionToolbar
        count={3}
        onAlign={onAlign}
        onDistribute={onDistribute}
        onGroup={onGroup}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByRole("toolbar", { name: "3 nodes selected" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Align left" }));
    await user.click(screen.getByRole("button", { name: "Align bottom" }));
    await user.click(screen.getByRole("button", { name: "Distribute horizontally" }));
    await user.click(screen.getByRole("button", { name: "Group into subflow" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onAlign).toHaveBeenNthCalledWith(1, "left");
    expect(onAlign).toHaveBeenNthCalledWith(2, "bottom");
    expect(onDistribute).toHaveBeenCalledWith("horizontal");
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("disables distribute below three nodes and hides group without a handler", () => {
    render(
      <SelectionToolbar count={2} onAlign={vi.fn()} onDistribute={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Distribute vertically" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Align top" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Group into subflow" })).not.toBeInTheDocument();
  });
});
