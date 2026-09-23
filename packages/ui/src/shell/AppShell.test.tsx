import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workflow } from "lucide-react";
import { ThemeProvider } from "@/theme";
import { installDomStubs } from "@/primitives/testStubs";
import { AppShell } from "./AppShell";
import { BottomPanel } from "./BottomPanel";
import { CommandMenu } from "./CommandMenu";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";

/** happy-dom's storage object has no methods in this environment; use an in-memory Storage. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

beforeAll(() => {
  installDomStubs();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function Shell({
  compact = false,
  storageKey = null,
}: {
  compact?: boolean;
  storageKey?: string | null;
}) {
  return (
    <ThemeProvider defaultSetting="light">
      <AppShell
        platform="mac"
        storageKey={storageKey}
        forceCompact={compact}
        topbar={
          <TopBar
            breadcrumbs={[
              { id: "ws", label: "Acme" },
              { id: "wf", label: "Support triage" },
            ]}
            saveState="saved"
            onRun={() => undefined}
            onPublish={() => undefined}
          />
        }
        nav={
          <SideNav
            items={[{ id: "workflows", label: "Workflows", icon: <Workflow /> }]}
            activeId="workflows"
          />
        }
        inspector={<div>Inspector body</div>}
        bottomPanel={
          <BottomPanel tabs={[{ id: "logs", label: "Logs", content: <div>Log lines</div> }]} />
        }
        commandMenu={
          <CommandMenu pages={[{ id: "runs", label: "Runs", onSelect: () => undefined }]} />
        }
      >
        <div>Canvas</div>
      </AppShell>
    </ThemeProvider>
  );
}

describe("AppShell", () => {
  it("renders every slot on desktop", () => {
    render(<Shell />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent(
      "Inspector body",
    );
    expect(screen.getByRole("region", { name: "Bottom panel" })).toBeInTheDocument();
    expect(screen.getByText("Canvas")).toBeInTheDocument();
  });

  it("toggles the nav rail with mod+B and persists it", () => {
    render(<Shell storageKey="test:shell" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).not.toHaveAttribute("data-collapsed");
    fireEvent.keyDown(document.body, { key: "b", metaKey: true });
    expect(nav).toHaveAttribute("data-collapsed", "true");
    const stored = JSON.parse(window.localStorage.getItem("test:shell") ?? "{}") as {
      navCollapsed?: boolean;
    };
    expect(stored.navCollapsed).toBe(true);
    fireEvent.keyDown(document.body, { key: "b", metaKey: true });
    expect(nav).not.toHaveAttribute("data-collapsed");
  });

  it("toggles the bottom panel with mod+J and the inspector with mod+I", () => {
    render(<Shell />);
    fireEvent.keyDown(document.body, { key: "j", metaKey: true });
    expect(screen.queryByRole("region", { name: "Bottom panel" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "j", metaKey: true });
    expect(screen.getByRole("region", { name: "Bottom panel" })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "i", metaKey: true });
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "i", metaKey: true });
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
  });

  it("opens the command menu with mod+K and the shortcuts dialog with ?", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByRole("dialog", { name: "Command menu" });
    expect(within(palette).getByRole("option", { name: /Runs/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Command menu" })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getByText("Toggle navigation")).toBeInTheDocument();
    expect(within(dialog).getByText("Command menu")).toBeInTheDocument();
  });

  it("restores a persisted layout and ignores corrupt storage", () => {
    localStorage.setItem(
      "test:shell",
      JSON.stringify({ navCollapsed: true, inspectorOpen: false }),
    );
    const { unmount } = render(<Shell storageKey="test:shell" />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    unmount();
    window.localStorage.setItem("test:shell", "not json");
    render(<Shell storageKey="test:shell" />);
    expect(screen.getByRole("navigation", { name: "Primary" })).not.toHaveAttribute(
      "data-collapsed",
    );
  });

  it("uses a drawer for the nav and a sheet for the inspector in compact mode", async () => {
    const user = userEvent.setup();
    render(<Shell compact />);
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Show inspector" }));
    expect(await screen.findByRole("complementary", { name: "Inspector" })).toHaveTextContent(
      "Inspector body",
    );
  });
});
