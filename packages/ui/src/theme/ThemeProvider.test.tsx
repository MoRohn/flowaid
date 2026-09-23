import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme, type ThemeSetting } from "./ThemeProvider";

/** A controllable `prefers-color-scheme: dark` media query. */
function installColorScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return query.includes("prefers-color-scheme: dark") ? dark : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
      addListener: (cb: () => void) => listeners.add(cb),
      removeListener: (cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    }),
  });
  return {
    setDark(next: boolean) {
      dark = next;
      for (const cb of listeners) cb();
    },
    restore() {
      if (original) Object.defineProperty(window, "matchMedia", original);
    },
  };
}

function Probe() {
  const { setting, resolved, setTheme } = useTheme();
  const options: ThemeSetting[] = ["light", "dark", "system"];
  return (
    <div>
      <p>
        {setting}/{resolved}
      </p>
      {options.map((o) => (
        <button key={o} type="button" onClick={() => setTheme(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

let scheme: ReturnType<typeof installColorScheme> | undefined;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  scheme?.restore();
  scheme = undefined;
});

describe("ThemeProvider", () => {
  it('writes data-theme="dark" for the system setting under an OS dark preference', () => {
    scheme = installColorScheme(true);
    render(
      <ThemeProvider defaultSetting="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText("system/dark")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows the OS preference while the setting is system", () => {
    scheme = installColorScheme(false);
    render(
      <ThemeProvider defaultSetting="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    act(() => scheme?.setDark(true));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    act(() => scheme?.setDark(false));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("writes an explicit setting over the OS preference", async () => {
    scheme = installColorScheme(true);
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultSetting="system">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByText("light/light")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "system" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
