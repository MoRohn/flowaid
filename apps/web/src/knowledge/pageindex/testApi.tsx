/** Test helpers for the PageIndex screens: a query client and a fetch that answers by route. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { Toaster } from "@flowaid/ui/primitives";

export function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      {node}
      <Toaster />
    </QueryClientProvider>
  );
}

export type Handler = (init: RequestInit | undefined, url: string) => unknown;

/** fetch answering `METHOD /path` (query string ignored); unknown routes 404 with the envelope. */
export function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const path = input.split("?")[0] ?? input;
    const key = `${init?.method ?? "GET"} ${path}`;
    const handler = routes[key];
    if (!handler)
      return Promise.resolve(
        Response.json({ error: { code: "NOT_FOUND", message: `no ${key}` } }, { status: 404 }),
      );
    const out = handler(init, input);
    return Promise.resolve(out instanceof Response ? out : Response.json(out));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const apiError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/** A JSON request body, parsed. */
export const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;

/** The calls made to one route. */
export const callsTo = (fetchMock: ReturnType<typeof stubApi>, key: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) => `${init?.method ?? "GET"} ${input.split("?")[0] ?? input}` === key,
  );
