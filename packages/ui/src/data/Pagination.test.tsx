import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination, formatPageRange, pageRange } from "./Pagination";

afterEach(cleanup);

describe("pageRange", () => {
  it("computes 1-based ranges and clamps the last page", () => {
    expect(pageRange(0, 50, 1204)).toEqual({ from: 1, to: 50, pageCount: 25 });
    expect(pageRange(24, 50, 1204)).toEqual({ from: 1201, to: 1204, pageCount: 25 });
    expect(pageRange(99, 50, 1204)).toEqual({ from: 1201, to: 1204, pageCount: 25 });
  });

  it("handles empty and tiny sets", () => {
    expect(pageRange(0, 50, 0)).toEqual({ from: 0, to: 0, pageCount: 1 });
    expect(pageRange(0, 50, 3)).toEqual({ from: 1, to: 3, pageCount: 1 });
    expect(pageRange(0, 0, 3)).toEqual({ from: 1, to: 1, pageCount: 3 });
  });

  it("formats with thousands separators", () => {
    expect(formatPageRange(0, 50, 1204)).toBe("1 to 50 of 1,204");
    expect(formatPageRange(24, 50, 1204)).toBe("1,201 to 1,204 of 1,204");
    expect(formatPageRange(0, 25, 0)).toBe("0 of 0");
  });
});

describe("Pagination", () => {
  it("disables prev on the first page and next on the last", async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    const { rerender } = render(
      <Pagination
        pageIndex={0}
        pageSize={50}
        total={120}
        onPageIndexChange={onPage}
        showPageSize={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(1);
    rerender(
      <Pagination
        pageIndex={2}
        pageSize={50}
        total={120}
        onPageIndexChange={onPage}
        showPageSize={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByText("101 to 120 of 120")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenLastCalledWith(1);
  });

  it("shows edge buttons when asked", () => {
    render(
      <Pagination
        pageIndex={1}
        pageSize={10}
        total={100}
        onPageIndexChange={vi.fn()}
        showEdges
        showPageSize={false}
      />,
    );
    expect(screen.getByRole("button", { name: "First page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Last page" })).toBeEnabled();
  });
});
