import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftProvider, isTabDirty, useDirtyKeys, usePreservedDraft } from "./drafts";

afterEach(cleanup);

function NameForm({ saved }: { saved: string }) {
  const { draft, setDraft, dirty, reset } = usePreservedDraft("workspace", { name: saved });
  return (
    <div>
      <input
        aria-label="Name"
        value={draft.name}
        onChange={(e) => setDraft({ name: e.target.value })}
      />
      <span data-testid="dirty">{String(dirty)}</span>
      <button type="button" onClick={reset}>
        Discard
      </button>
    </div>
  );
}

function Page({ saved = "Acme" }: { saved?: string }) {
  const [tab, setTab] = useState<"workspace" | "keys">("workspace");
  const dirty = useDirtyKeys();
  return (
    <>
      <button type="button" onClick={() => setTab("workspace")}>
        Workspace{isTabDirty(dirty, "workspace") ? " •" : ""}
      </button>
      <button type="button" onClick={() => setTab("keys")}>
        Keys
      </button>
      {tab === "workspace" ? <NameForm saved={saved} /> : <p>API keys</p>}
    </>
  );
}

const name = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });

describe("usePreservedDraft", () => {
  it("keeps an unsaved edit while another tab is open and marks its tab", () => {
    render(
      <DraftProvider>
        <Page />
      </DraftProvider>,
    );
    fireEvent.change(name(), { target: { value: "Team Name" } });
    expect(screen.getByTestId("dirty").textContent).toBe("true");
    expect(screen.getByRole("button", { name: "Workspace •" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keys" }));
    expect(screen.getByText("API keys")).toBeTruthy();
    // still marked while the form is not on screen
    fireEvent.click(screen.getByRole("button", { name: "Workspace •" }));
    expect(name().value).toBe("Team Name");
  });

  it("discarding clears the draft and the mark", () => {
    render(
      <DraftProvider>
        <Page />
      </DraftProvider>,
    );
    fireEvent.change(name(), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(name().value).toBe("Acme");
    expect(screen.getByRole("button", { name: "Workspace" })).toBeTruthy();
  });

  it("starts again from a new saved value", () => {
    const { rerender } = render(
      <DraftProvider>
        <Page saved="Acme" />
      </DraftProvider>,
    );
    fireEvent.change(name(), { target: { value: "Team Name" } });
    rerender(
      <DraftProvider>
        <Page saved="Team Name" />
      </DraftProvider>,
    );
    expect(name().value).toBe("Team Name");
    expect(screen.getByTestId("dirty").textContent).toBe("false");
  });

  it("asks before the page unloads while any tab has unsaved edits", () => {
    render(
      <DraftProvider>
        <Page />
      </DraftProvider>,
    );
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    fireEvent.change(name(), { target: { value: "Team Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Keys" }));
    expect(unload()).toBe(true);
  });

  it("asks before an in-app link leaves unsaved edits, and stays when told to", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(
      <DraftProvider>
        <Page />
        <a href="/team-name/runs">Runs</a>
      </DraftProvider>,
    );
    fireEvent.change(name(), { target: { value: "Team Name" } });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Runs" }).dispatchEvent(click);
    expect(confirm).toHaveBeenCalledOnce();
    expect(click.defaultPrevented).toBe(true);
    vi.unstubAllGlobals();
  });

  it("works as plain state without a provider", () => {
    render(<NameForm saved="Acme" />);
    fireEvent.change(name(), { target: { value: "B" } });
    expect(name().value).toBe("B");
    expect(screen.getByTestId("dirty").textContent).toBe("true");
  });
});
