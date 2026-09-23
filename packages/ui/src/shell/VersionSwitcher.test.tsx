import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowVersionView } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { VersionSwitcher, versionLabel } from "./VersionSwitcher";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const versions: WorkflowVersionView[] = [
  {
    id: "v13",
    version: 13,
    status: "draft",
    createdAt: "2026-09-22T08:12:00Z",
    message: "Raise threshold",
    nodeCount: 11,
  },
  {
    id: "v12",
    version: 12,
    status: "production",
    createdAt: "2026-09-18T15:40:00Z",
    message: "Add guard",
    nodeCount: 10,
  },
  { id: "v11", version: 11, status: "published", createdAt: "2026-09-11T10:03:00Z", nodeCount: 9 },
  { id: "v10", version: 10, status: "archived", createdAt: "2026-09-02T09:30:00Z", nodeCount: 8 },
];

describe("VersionSwitcher", () => {
  it("labels versions by status", () => {
    expect(versionLabel(undefined)).toBe("Draft");
    expect(versionLabel(versions[0])).toBe("v13 Draft");
    expect(versionLabel(versions[1])).toBe("v12 Production");
    expect(versionLabel(versions[2])).toBe("v11");
    expect(versionLabel(versions[3])).toBe("v10 Archived");
  });

  it("shows the current version, defaulting to the draft", () => {
    const { rerender } = render(<VersionSwitcher versions={versions} />);
    expect(screen.getByRole("button", { name: "Version: v13 Draft" })).toBeInTheDocument();
    rerender(<VersionSwitcher versions={versions} currentId="v12" />);
    expect(screen.getByRole("button", { name: "Version: v12 Production" })).toBeInTheDocument();
    rerender(<VersionSwitcher versions={[]} />);
    expect(screen.getByRole("button", { name: "Version: Draft" })).toBeInTheDocument();
  });

  it("lists versions in the menu and opens one", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<VersionSwitcher versions={versions} currentId="v13" onOpen={onOpen} limit={3} />);
    await user.click(screen.getByRole("button", { name: /Version/ }));
    const menu = await screen.findByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(menu).toHaveTextContent("11 nodes");
    await user.click(items[1] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "v12" }));
  });
});
