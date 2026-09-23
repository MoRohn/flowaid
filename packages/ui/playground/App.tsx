import { Suspense, lazy, useEffect, useState, type ReactElement } from "react";
import { useTheme } from "@/theme";
import { GALLERY } from "./gallery";

function useHashSlug(): [string, (s: string) => void] {
  const [slug, setSlug] = useState(
    () => location.hash.replace(/^#\/?/, "") || GALLERY[0]?.slug || "",
  );
  useEffect(() => {
    const on = () => setSlug(location.hash.replace(/^#\/?/, "") || GALLERY[0]?.slug || "");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [slug, (s) => (location.hash = `/${s}`)];
}

function Missing({ title }: { title: string }) {
  return (
    <div className="p-8 text-ink-3">
      <p>
        No gallery yet for <b className="text-ink">{title}</b>. Add <code>gallery.tsx</code> to its
        folder.
      </p>
    </div>
  );
}

/** One lazy page element per slug, built once at module scope so render only picks one (never creates a component). */
const PAGES: ReadonlyMap<string, ReactElement> = new Map(
  GALLERY.map((p) => {
    const LazyPage = lazy(() =>
      p.load().catch(() => ({ default: () => <Missing title={p.title} /> })),
    );
    return [p.slug, <LazyPage key={p.slug} />];
  }),
);

export function App() {
  const [slug, go] = useHashSlug();
  const { setting, resolved, setTheme } = useTheme();
  const page = GALLERY.find((p) => p.slug === slug) ?? GALLERY[0];

  return (
    <div className="flex h-dvh">
      <nav className="w-52 shrink-0 border-r border-border bg-surface flex flex-col">
        <div className="h-11 px-4 flex items-center gap-2 border-b border-border">
          <svg
            viewBox="0 0 32 32"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 16h8" />
            <path d="M12 16c6 0 6-9 12-9" />
            <path d="M12 16h12" opacity="0.42" />
            <path d="M12 16c6 0 6 9 12 9" opacity="0.18" />
            <circle cx="26" cy="7" r="2.6" fill="var(--accent)" stroke="none" />
          </svg>
          <span className="font-semibold text-sm tracking-tight">UI playground</span>
        </div>
        <ul className="p-2 flex-1 overflow-auto">
          {GALLERY.map((p) => (
            <li key={p.slug}>
              <button
                type="button"
                onClick={() => go(p.slug)}
                className={
                  "w-full text-left px-2 h-7 rounded-sm text-xs " +
                  (p.slug === page?.slug
                    ? "bg-surface-3 text-ink font-medium"
                    : "text-ink-2 hover:bg-surface-3")
                }
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
        <div className="p-2 border-t border-border flex gap-1">
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={setting === t}
              onClick={() => setTheme(t)}
              className={
                "flex-1 h-6 rounded-xs text-2xs font-mono uppercase tracking-wider " +
                (setting === t ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink")
              }
            >
              {t}
            </button>
          ))}
        </div>
        <div className="px-3 pb-2 text-2xs font-mono text-ink-4">resolved: {resolved}</div>
      </nav>
      <main className="flex-1 overflow-auto">
        <Suspense fallback={<div className="p-8 text-ink-3 text-xs font-mono">loading…</div>}>
          {page ? (PAGES.get(page.slug) ?? null) : null}
        </Suspense>
      </main>
    </div>
  );
}
