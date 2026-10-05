/**
 * F-08: "Start here" decided expanded-or-collapsed from data that had not arrived, so pages with
 * content rendered it expanded and then collapsed it, pushing the table down (CLS 0.15–0.27).
 * While the data loads it now keeps the shape it settled on last time, and phones start collapsed.
 */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { PageIntro } from "./PageIntro";
import type { CapabilityGuide } from "./capabilities/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/acme/things" }));

const GUIDE: CapabilityGuide = {
  id: "things",
  title: "Things",
  what: "Make things.",
  when: "When you need a thing.",
  needs: "A key.",
  start: "Press New thing.",
  result: "A thing.",
};
const LAST = "flowaid:intro-default:acme:things";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

let phone = false;
beforeAll(() => {
  installDomStubs();
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: phone && query.includes("max-width"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});
beforeEach(() => {
  window.localStorage.clear();
  phone = false;
});
afterEach(cleanup);

/** A list page: the intro starts collapsed once the page has things in it. */
function ListPage({ load }: { load: () => Promise<string[]> }) {
  const things = useQuery({ queryKey: ["things"], queryFn: load });
  return <PageIntro guide={GUIDE} defaultCollapsed={(things.data?.length ?? 0) > 0} />;
}

function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const expanded = () => screen.queryByText("What you can do here") !== null;

function renderPage(load: () => Promise<string[]>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ListPage load={load} />
    </QueryClientProvider>,
  );
}

describe("PageIntro while the page loads", () => {
  it("keeps last visit's collapsed line until the data arrives, so nothing below moves", async () => {
    window.localStorage.setItem(LAST, "collapsed");
    const answer = deferred<string[]>();
    renderPage(() => answer.promise);
    expect(expanded()).toBe(false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // still loading: it does not take the not-yet-known `defaultCollapsed={false}` at its word
    expect(expanded()).toBe(false);
    await act(async () => {
      answer.resolve(["a"]);
      await answer.promise;
    });
    expect(expanded()).toBe(false);
  });

  it("follows the data once it arrives and remembers the outcome for next time", async () => {
    window.localStorage.setItem(LAST, "collapsed");
    const answer = deferred<string[]>();
    renderPage(() => answer.promise);
    await act(async () => {
      answer.resolve([]);
      await answer.promise;
    });
    // an empty page opens its intro, and the next load starts that way
    await waitFor(() => expect(expanded()).toBe(true));
    expect(window.localStorage.getItem(LAST)).toBe("expanded");
  });

  it("starts expanded on a first visit, as before", () => {
    renderPage(() => new Promise(() => undefined));
    expect(expanded()).toBe(true);
  });

  it("starts collapsed on a phone so the page comes first, unless opened by hand", () => {
    phone = true;
    const { unmount } = renderPage(() => Promise.resolve([]));
    expect(expanded()).toBe(false);
    unmount();
    window.localStorage.setItem("flowaid:intro:things", "shown");
    renderPage(() => Promise.resolve([]));
    expect(expanded()).toBe(true);
  });
});
