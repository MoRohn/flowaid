/**
 * F-09: CodeMirror (≈150 KB gzip) loaded up front on every list page and /review. The editors now
 * load it on demand: a box of the editor's size first, then the editor, and every later editor
 * renders at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { lazyEditor, rowsHeight } from "./lazyEditor";

afterEach(cleanup);

interface Props {
  value: string;
}
interface Handle {
  focus: () => string;
}

function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const Real = forwardRef<Handle, Props>(function Real({ value }, ref) {
  useImperativeHandle(ref, () => ({ focus: () => "focused" }));
  return <textarea aria-label="Code" value={value} readOnly />;
});

describe("lazyEditor", () => {
  it("shows the fallback until the editor's code arrives, then the editor with its ref", async () => {
    const chunk = deferred<typeof Real>();
    const load = vi.fn(() => chunk.promise);
    const Editor = lazyEditor<Props, Handle>("Editor", load, ({ value }) => (
      <div data-testid="placeholder">{value.length}</div>
    ));
    const ref = createRef<Handle>();
    render(<Editor ref={ref} value="{}" />);
    expect(screen.getByTestId("placeholder")).toHaveTextContent("2");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await act(async () => {
      chunk.resolve(Real);
      await chunk.promise;
    });
    expect(await screen.findByRole("textbox", { name: "Code" })).toHaveValue("{}");
    expect(ref.current?.focus()).toBe("focused");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("renders at once, without a fallback, once the code has loaded", async () => {
    const load = vi.fn(() => Promise.resolve(Real));
    const Editor = lazyEditor<Props, Handle>("Editor", load, () => (
      <div data-testid="placeholder" />
    ));
    await Editor.preload();
    render(<Editor value="x" />);
    expect(screen.queryByTestId("placeholder")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("x");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("sizes a placeholder like the editor: the text's lines within the row limits", () => {
    expect(rowsHeight("", 6, 24)).toBe("128px");
    expect(rowsHeight("a\nb\nc\nd\ne\nf\ng\nh", 6, 24)).toBe("168px");
    expect(rowsHeight("\n".repeat(40), 6, 24)).toBe("488px");
  });
});
