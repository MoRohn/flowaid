import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { DataTable, createDataTableColumns, type DataTableColumns } from "./DataTable";

afterEach(cleanup);
beforeAll(() => installDomStubs());

interface Item {
  id: string;
  name: string;
  cost: number;
  at: string;
}

const helper = createDataTableColumns<Item>();
const columns: DataTableColumns<Item> = helper.columns([
  helper.accessor("name", { header: "Name", size: 200, meta: { grow: true } }),
  helper.accessor("cost", { header: "Cost", size: 100, meta: { numeric: true }, sortFn: "basic" }),
  helper.accessor("at", { header: "Started", size: 120, sortFn: "datetime" }),
]);

const items: Item[] = [
  { id: "b", name: "Beta", cost: 0.02, at: "2026-09-22T10:00:00.000Z" },
  { id: "a", name: "Alpha", cost: 0.05, at: "2026-09-22T09:00:00.000Z" },
  { id: "c", name: "Gamma", cost: 0.01, at: "2026-09-22T11:00:00.000Z" },
];

function bodyNames(): string[] {
  const grid = screen.getByRole("grid");
  const rows = within(grid).getAllByRole("row").slice(1);
  return rows.map((r) => within(r).getAllByRole("gridcell")[0]?.textContent ?? "");
}

describe("DataTable sorting", () => {
  it("sorts by a column on header click and toggles direction", async () => {
    const user = userEvent.setup();
    render(
      <DataTable columns={columns} data={items} showColumnMenu={false} showDensityToggle={false} />,
    );
    expect(bodyNames()).toEqual(["Beta", "Alpha", "Gamma"]);
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(bodyNames()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(bodyNames()).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("sorts numeric columns by value and reports sorting changes", async () => {
    const user = userEvent.setup();
    const onSortingChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={items}
        onSortingChange={onSortingChange}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    // Numeric columns sort descending first (largest on top), like the auto sort direction.
    await user.click(screen.getByRole("button", { name: "Cost" }));
    expect(bodyNames()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: "cost", desc: true }]);
    await user.click(screen.getByRole("button", { name: "Cost" }));
    expect(bodyNames()).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("adds a secondary sort with shift+click", async () => {
    const user = userEvent.setup();
    const data: Item[] = [
      { id: "1", name: "Same", cost: 0.03, at: "2026-09-22T10:00:00.000Z" },
      { id: "2", name: "Same", cost: 0.01, at: "2026-09-22T10:00:00.000Z" },
      { id: "3", name: "Other", cost: 0.02, at: "2026-09-22T10:00:00.000Z" },
    ];
    const onSortingChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={data}
        onSortingChange={onSortingChange}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Name" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Cost" }));
    await user.keyboard("{/Shift}");
    expect(onSortingChange).toHaveBeenLastCalledWith([
      { id: "name", desc: false },
      { id: "cost", desc: true },
    ]);
    const grid = screen.getByRole("grid");
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("gridcell")[1]?.textContent)).toEqual([
      "0.02",
      "0.03",
      "0.01",
    ]);
  });

  it("respects controlled sorting", () => {
    render(
      <DataTable
        columns={columns}
        data={items}
        sorting={[{ id: "at", desc: true }]}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    expect(bodyNames()).toEqual(["Gamma", "Beta", "Alpha"]);
  });
});

describe("DataTable selection", () => {
  it("selects rows, shows the selection toolbar and clears", async () => {
    const user = userEvent.setup();
    const onRowSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={items}
        selectable
        onRowSelectionChange={onRowSelectionChange}
        selectionToolbar={({ count, rows }) => (
          <span data-testid="sel">
            {count}:{rows.map((r) => r.id).join(",")}
          </span>
        )}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    expect(onRowSelectionChange).toHaveBeenLastCalledWith({ b: true });
    expect(screen.getByTestId("sel")).toHaveTextContent("1:b");
    expect(screen.getByText("1 of 3 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByTestId("sel")).toHaveTextContent("3:b,a,c");
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByTestId("sel")).not.toBeInTheDocument();
    expect(screen.getByText("3 rows")).toBeInTheDocument();
  });

  it("selects a range with shift+click", async () => {
    const user = userEvent.setup();
    const onRowSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={items}
        selectable
        onRowSelectionChange={onRowSelectionChange}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select row 3" }));
    await user.keyboard("{/Shift}");
    expect(onRowSelectionChange).toHaveBeenLastCalledWith({ b: true, a: true, c: true });
  });

  it("honours canSelectRow", () => {
    render(
      <DataTable
        columns={columns}
        data={items}
        selectable
        canSelectRow={(r) => r.id !== "a"}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Select row 2" })).toBeDisabled();
  });
});

describe("DataTable keyboard", () => {
  it("moves focus with arrows, activates with Enter and toggles with Space", async () => {
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    const onRowSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={items}
        selectable
        onRowActivate={onRowActivate}
        onRowSelectionChange={onRowSelectionChange}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    const grid = screen.getByRole("grid");
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveAttribute("tabindex", "0");
    expect(rows[1]).toHaveAttribute("tabindex", "-1");
    rows[0]?.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    await user.keyboard("{Enter}");
    expect(onRowActivate).toHaveBeenCalledWith(items[1]);
    await user.keyboard(" ");
    expect(onRowSelectionChange).toHaveBeenLastCalledWith({ a: true });
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(rows[2]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(rows[0]);
  });
});

describe("DataTable states", () => {
  it("renders skeleton rows while loading without data", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        loading
        skeletonRows={4}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-busy", "true");
    expect(grid.querySelectorAll("tbody tr")).toHaveLength(4);
  });

  it("renders the empty slot and the error panel", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(
      <DataTable
        columns={columns}
        data={[]}
        emptyState={<p>Nothing here</p>}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    rerender(
      <DataTable
        columns={columns}
        data={[]}
        error={{ message: "502 from runs-api", onRetry }}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("502 from runs-api");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("paginates and reports the range", async () => {
    const user = userEvent.setup();
    const many: Item[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Item ${i}`,
      cost: i,
      at: "2026-09-22T10:00:00.000Z",
    }));
    render(
      <DataTable
        columns={columns}
        data={many}
        pagination={{ pageSize: 5 }}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    expect(bodyNames()).toHaveLength(5);
    expect(screen.getByText("1 to 5 of 12")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("6 to 10 of 12")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(bodyNames()).toEqual(["Item 10", "Item 11"]);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("switches density and hides columns from the menu", async () => {
    const user = userEvent.setup();
    const onDensityChange = vi.fn();
    render(<DataTable columns={columns} data={items} onDensityChange={onDensityChange} />);
    await user.click(screen.getByRole("radio", { name: "Compact rows" }));
    expect(onDensityChange).toHaveBeenCalledWith("compact");
    const grid = screen.getByRole("grid");
    const row = within(grid).getAllByRole("row")[1];
    expect(row?.style.height).toBe("28px");
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Cost" }));
    expect(screen.queryByRole("columnheader", { name: /Cost/ })).not.toBeInTheDocument();
  });

  it("calls onRowClick and marks the active row", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={items}
        onRowClick={onRowClick}
        isRowActive={(r) => r.id === "a"}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    const grid = screen.getByRole("grid");
    const rows = within(grid).getAllByRole("row").slice(1);
    fireEvent.click(rows[0] as HTMLElement);
    expect(onRowClick).toHaveBeenCalledWith(items[0], expect.anything());
    expect(rows[1]).toHaveAttribute("data-active", "true");
  });
});
