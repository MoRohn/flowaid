import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeSetting = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  setting: ThemeSetting;
  resolved: ResolvedTheme;
  setTheme: (t: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "flowaid:theme";

function readStored(): ThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !("matchMedia" in window)) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Applies the resolved theme to `data-theme` on <html>, for every setting: "system"
 * writes the OS preference ("light" or "dark") and follows it as it changes, so the
 * `dark:` variant (which matches `[data-theme="dark"]`) applies under OS dark mode too.
 * The `prefers-color-scheme` block in tokens.css stays as the pre-hydration fallback,
 * before this provider has run.
 */
export function ThemeProvider({
  children,
  defaultSetting,
}: {
  children: ReactNode;
  defaultSetting?: ThemeSetting;
}) {
  const [setting, setSetting] = useState<ThemeSetting>(
    () => defaultSetting ?? (typeof window === "undefined" ? "system" : readStored()),
  );
  const [system, setSystem] = useState<ResolvedTheme>(() => systemTheme());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = setting === "system" ? system : setting;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setTheme = useCallback((t: ThemeSetting) => {
    setSetting(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ setting, resolved, setTheme }),
    [setting, resolved, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
