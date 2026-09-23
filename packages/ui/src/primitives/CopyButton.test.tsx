import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyButton, copyToClipboard } from "./CopyButton";

afterEach(cleanup);

/** user-event installs its own clipboard stub on setup, so the mock is attached afterwards. */
function mockClipboard(): Mock<(text: string) => Promise<void>> {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

describe("CopyButton", () => {
  let writeText: Mock<(text: string) => Promise<void>>;

  beforeEach(() => {
    // Reduced motion keeps motion from starting Web Animations that happy-dom cancels noisily.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    writeText = mockClipboard();
  });

  it("writes the value and shows Copied, then reverts after the timeout", async () => {
    const user = userEvent.setup();
    writeText = mockClipboard();
    const onCopied = vi.fn();
    render(<CopyButton value="run_01j8x2" timeout={60} onCopied={onCopied} tooltip={false} />);
    const btn = screen.getByRole("button", { name: "Copy" });
    await user.click(btn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("run_01j8x2");
    expect(onCopied).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Copied" })).toHaveAttribute("data-copied", "true");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy" })).not.toHaveAttribute("data-copied"),
    );
  });

  it("calls a value function at click time", async () => {
    const user = userEvent.setup();
    writeText = mockClipboard();
    const getValue = vi.fn(() => "later");
    render(<CopyButton value={getValue} tooltip={false} />);
    expect(getValue).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button"));
    expect(getValue).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("later");
  });

  it("renders the labelled button variant", async () => {
    const user = userEvent.setup();
    writeText = mockClipboard();
    render(<CopyButton value="x" variantStyle="button" label="Copy id" copiedLabel="Copied id" />);
    await user.click(screen.getByRole("button", { name: "Copy id" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Copied id" })).toBeInTheDocument();
  });

  it("falls back to execCommand when the Clipboard API is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    await expect(copyToClipboard("legacy")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports failure when the clipboard rejects and execCommand is unavailable", async () => {
    writeText.mockImplementation(() => Promise.reject(new Error("denied")));
    Object.defineProperty(document, "execCommand", { value: undefined, configurable: true });
    await expect(copyToClipboard("nope")).resolves.toBe(false);
  });
});
