import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import {
  ShortcutProvider,
  comboFromKeyboardEvent,
  isEditableTarget,
  parseShortcutCombo,
  parseShortcutSequence,
  shortcutComboMatches,
  useShortcut,
  useShortcuts,
} from "./ShortcutProvider";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Bound({
  keys,
  onFire,
  global,
  enabled,
  description,
  group,
}: {
  keys: string | string[];
  onFire: () => void;
  global?: boolean;
  enabled?: boolean;
  description?: string;
  group?: string;
}) {
  useShortcut(keys, onFire, { global, enabled, description, group });
  return null;
}

function List() {
  const shortcuts = useShortcuts();
  return (
    <ul>
      {shortcuts.map((s) => (
        <li key={s.id}>
          {s.group}: {s.description} ({s.bindings.join(" | ")})
        </li>
      ))}
    </ul>
  );
}

describe("shortcut parsing", () => {
  it("parses combos and folds ctrl into mod on non-mac platforms", () => {
    expect(parseShortcutCombo("mod+shift+k", "mac")).toEqual({
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
      key: "k",
    });
    expect(parseShortcutCombo("ctrl+k", "mac").ctrl).toBe(true);
    expect(parseShortcutCombo("ctrl+k", "other")).toEqual({
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
      key: "k",
    });
    expect(parseShortcutCombo("Escape", "mac").key).toBe("esc");
  });

  it("parses sequences", () => {
    const seq = parseShortcutSequence("g w", "mac");
    expect(seq).toHaveLength(2);
    expect(seq[0]?.key).toBe("g");
    expect(seq[1]?.key).toBe("w");
  });

  it("maps events to combos per platform and ignores bare modifiers", () => {
    const mac = comboFromKeyboardEvent(
      { key: "b", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
      "mac",
    );
    expect(mac?.mod).toBe(true);
    const other = comboFromKeyboardEvent(
      { key: "b", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
      "other",
    );
    expect(other?.mod).toBe(true);
    expect(
      comboFromKeyboardEvent(
        { key: "Meta", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "mac",
      ),
    ).toBeNull();
  });

  it("ignores shift for symbol keys so ? matches shift+/", () => {
    const binding = parseShortcutCombo("?", "mac");
    const pressed = { mod: false, ctrl: false, alt: false, shift: true, key: "?" };
    expect(shortcutComboMatches(binding, pressed)).toBe(true);
    expect(shortcutComboMatches(parseShortcutCombo("b", "mac"), { ...pressed, key: "b" })).toBe(
      false,
    );
  });

  it("detects editable targets", () => {
    const input = document.createElement("input");
    const div = document.createElement("div");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(input, div, editable);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(editable)).toBe(true);
    input.remove();
    div.remove();
    editable.remove();
  });
});

describe("ShortcutProvider", () => {
  it("fires mod shortcuts with meta on mac and ctrl elsewhere", () => {
    const onFire = vi.fn();
    const { unmount } = render(
      <ShortcutProvider platform="mac">
        <Bound keys="mod+b" onFire={onFire} />
      </ShortcutProvider>,
    );
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(onFire).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "b", metaKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <ShortcutProvider platform="other">
        <Bound keys="mod+b" onFire={onFire} />
      </ShortcutProvider>,
    );
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it("supports two-key sequences and resets after the timeout", () => {
    vi.useFakeTimers();
    const goWorkflows = vi.fn();
    const goRuns = vi.fn();
    render(
      <ShortcutProvider platform="mac" sequenceTimeoutMs={500}>
        <Bound keys="g w" onFire={goWorkflows} />
        <Bound keys="g r" onFire={goRuns} />
      </ShortcutProvider>,
    );
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "w" });
    expect(goWorkflows).toHaveBeenCalledTimes(1);
    expect(goRuns).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "g" });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.keyDown(document.body, { key: "r" });
    expect(goRuns).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "r" });
    expect(goRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores keystrokes inside inputs unless the shortcut is global", () => {
    const local = vi.fn();
    const global = vi.fn();
    render(
      <ShortcutProvider platform="mac">
        <Bound keys="?" onFire={local} />
        <Bound keys="mod+k" onFire={global} global />
        <input aria-label="Search" />
      </ShortcutProvider>,
    );
    const input = screen.getByLabelText("Search");
    fireEvent.keyDown(input, { key: "?", shiftKey: true });
    expect(local).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "k", metaKey: true });
    expect(global).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(local).toHaveBeenCalledTimes(1);
  });

  it("fires a scoped shortcut only inside its scope, where it wins over an app-wide one", () => {
    const app = vi.fn();
    const local = vi.fn();
    function Scoped() {
      const ref = useRef<HTMLDivElement>(null);
      useShortcut("mod+k", local, { scope: ref, description: "Open palette", group: "Canvas" });
      return (
        <div ref={ref} tabIndex={-1} data-testid="scope">
          <span>inside</span>
        </div>
      );
    }
    render(
      <ShortcutProvider platform="mac">
        <Bound keys="mod+k" onFire={app} description="Command menu" />
        <Scoped />
        <List />
      </ShortcutProvider>,
    );
    fireEvent.keyDown(screen.getByText("inside"), { key: "k", metaKey: true });
    expect(local).toHaveBeenCalledTimes(1);
    expect(app).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(app).toHaveBeenCalledTimes(1);
    expect(local).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Canvas: Open palette (mod+k)")).toBeInTheDocument();
  });

  it("skips disabled shortcuts and events another handler already prevented", () => {
    const onFire = vi.fn();
    render(
      <ShortcutProvider platform="mac">
        <Bound keys="mod+j" onFire={onFire} enabled={false} />
      </ShortcutProvider>,
    );
    fireEvent.keyDown(document.body, { key: "j", metaKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it("exposes described, enabled shortcuts for the dialog and drops them on unmount", () => {
    const { rerender } = render(
      <ShortcutProvider platform="mac">
        <Bound keys="mod+b" onFire={() => undefined} description="Toggle nav" group="Panels" />
        <Bound
          keys={["delete", "backspace"]}
          onFire={() => undefined}
          description="Delete"
          group="Canvas"
        />
        <Bound keys="mod+x" onFire={() => undefined} />
        <Bound keys="mod+y" onFire={() => undefined} description="Hidden" enabled={false} />
        <List />
      </ShortcutProvider>,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Panels: Toggle nav (mod+b)", "Canvas: Delete (delete | backspace)"]);
    rerender(
      <ShortcutProvider platform="mac">
        <List />
      </ShortcutProvider>,
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("uses the outer registry when providers nest", () => {
    const onFire = vi.fn();
    render(
      <ShortcutProvider platform="mac">
        <ShortcutProvider platform="other">
          <Bound keys="mod+b" onFire={onFire} />
        </ShortcutProvider>
      </ShortcutProvider>,
    );
    fireEvent.keyDown(document.body, { key: "b", metaKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
