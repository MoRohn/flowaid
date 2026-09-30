import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { GuidedFlow, type FlowStep } from "./GuidedFlow";
import { PageIntro } from "./PageIntro";
import { CheckList, blockers } from "./Readiness";
import { useKeptDraft } from "./useKeptDraft";
import type { CapabilityGuide } from "./capabilities/types";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

beforeAll(() => {
  installDomStubs();
  // Node's own storage globals shadow the DOM's; use plain in-memory ones
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
});
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

function Form() {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const steps: FlowStep[] = [
    {
      id: "name",
      title: "Name it",
      why: "The name identifies it.",
      done: name.trim().length > 0,
      requirement: "enter a name",
      children: <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />,
    },
    {
      id: "notes",
      title: "Add notes",
      why: "Optional context.",
      done: notes.length > 0,
      optional: true,
      children: (
        <input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      ),
    },
    {
      id: "review",
      title: "Review",
      why: "Check it.",
      done: name.trim().length > 0,
      children: <p>Name: {name}</p>,
    },
  ];
  return <GuidedFlow steps={steps} />;
}

describe("GuidedFlow", () => {
  it("marks steps done from the draft, not from pressing Next", () => {
    render(<Form />);
    const next = screen.getByRole("button", { name: /Next: Add notes/ });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("To continue: enter a name");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Refunds" } });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next);
    // the optional step offers Skip, and is not marked done
    expect(screen.getByRole("heading", { name: "Add notes" })).toBeDefined();
    const rail = screen.getByRole("navigation", { name: "Steps" });
    expect(rail.textContent).toContain("Optional");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Skip: Review/ }).disabled).toBe(
      false,
    );
  });

  it("keeps later work when going back, and moves focus to the step title", () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Refunds" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: Add notes/ }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "for finance" } });
    expect(document.activeElement?.textContent).toBe("Add notes");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Refunds");
    const rail = screen.getByRole("navigation", { name: "Steps" });
    fireEvent.click(within(rail).getByRole("button", { name: /Add notes/ }));
    expect(screen.getByLabelText<HTMLInputElement>("Notes").value).toBe("for finance");
  });

  it("shows every field at once in All fields, editing the same draft", () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Refunds" } });
    fireEvent.mouseDown(screen.getByRole("radio", { name: "All fields" }));
    fireEvent.click(screen.getByRole("radio", { name: "All fields" }));
    expect(screen.getByLabelText("Notes")).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Refunds");
    expect(window.localStorage.getItem("flowaid:guided-mode")).toBe("all");
  });
});

const GUIDE: CapabilityGuide = {
  id: "things",
  title: "Things",
  what: "Make things.",
  when: "When you need a thing.",
  needs: "A key.",
  start: "Press New thing.",
  result: "A thing.",
};

describe("PageIntro", () => {
  it("answers the five questions and lists live checks", () => {
    render(
      <PageIntro
        guide={GUIDE}
        checks={[
          { id: "k", label: "Key", state: "blocker", fix: <a href="/x">Add it</a> },
          { id: "t", label: "Tools ready", state: "ok" },
        ]}
      />,
    );
    for (const term of ["What you can do here", "When to use it", "What you get", "How to start"])
      expect(screen.getByText(term)).toBeDefined();
    expect(screen.getByText("Add it")).toBeDefined();
  });

  it("collapses to one line that still flags missing setup, and remembers it", () => {
    const { unmount } = render(
      <PageIntro guide={GUIDE} checks={[{ id: "k", label: "Key", state: "blocker" }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByText("1 thing to set up")).toBeDefined();
    unmount();
    render(<PageIntro guide={GUIDE} />);
    const reopen = screen.getByRole("button", { name: /About Things/ });
    fireEvent.click(reopen);
    expect(screen.getByText("What you can do here")).toBeDefined();
  });

  it("starts collapsed on a page with content unless the person opened it", () => {
    render(<PageIntro guide={GUIDE} defaultCollapsed />);
    expect(screen.queryByText("What you can do here")).toBeNull();
  });
});

describe("CheckList", () => {
  it("names each state for screen readers and only offers fixes when not ready", () => {
    render(
      <CheckList
        checks={[
          { id: "a", label: "A", state: "ok", fix: <span>fix a</span> },
          { id: "b", label: "B", state: "blocker", fix: <span>fix b</span> },
        ]}
      />,
    );
    expect(screen.getByText("Ready:")).toBeDefined();
    expect(screen.getByText("Needed:")).toBeDefined();
    expect(screen.queryByText("fix a")).toBeNull();
    expect(screen.getByText("fix b")).toBeDefined();
    expect(blockers([{ id: "b", label: "B", state: "blocker" }])).toHaveLength(1);
  });
});

describe("useKeptDraft", () => {
  const init = () => ({ name: "", secret: "" });
  const omit = (d: { name: string; secret: string }) => ({ name: d.name });

  it("keeps a new item's draft in this tab, without the fields it must not store", () => {
    const first = renderHook(() => useKeptDraft("k", init, omit));
    act(() => first.result.current.setDraft({ name: "Refunds", secret: "sk-live" }));
    expect(window.sessionStorage.getItem("k")).toBe('{"name":"Refunds"}');
    first.unmount();
    const again = renderHook(() => useKeptDraft("k", init, omit));
    expect(again.result.current.restored).toBe(true);
    expect(again.result.current.draft).toEqual({ name: "Refunds", secret: "" });
    act(() => again.result.current.discard());
    expect(again.result.current.draft).toEqual(init());
    expect(window.sessionStorage.getItem("k")).toBeNull();
  });

  it("keeps nothing without a key (editing a saved item)", () => {
    const h = renderHook(() => useKeptDraft(null, init));
    act(() => h.result.current.setDraft({ name: "x", secret: "" }));
    expect(window.sessionStorage.length).toBe(0);
    expect(h.result.current.dirty).toBe(true);
  });
});
