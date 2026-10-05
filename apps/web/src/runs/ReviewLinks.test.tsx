import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { ReviewLinks, linkReach } from "./ReviewLinks";
import type { ReviewLinkInfo } from "./types";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock("~/api/client", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  ...api,
}));

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  api.get.mockReset();
  api.post.mockReset();
  api.del.mockReset();
});

const link = (id: string, status: ReviewLinkInfo["status"]): ReviewLinkInfo => ({
  id,
  status,
  createdAt: "2026-09-27T10:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  usedAt: null,
  revokedAt: null,
  createdBy: "user:u1",
});

const renderLinks = (local = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewLinks taskId="t1" local={local} />
    </QueryClientProvider>,
  );

describe("linkReach", () => {
  it("tells this computer, a private network and the internet apart", () => {
    for (const a of [
      "http://flowaid.localhost:3100",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ])
      expect(linkReach(a)).toBe("computer");
    for (const a of [
      "http://192.168.1.20:3000",
      "http://10.0.0.5",
      "http://172.20.1.1",
      "http://nas.local:3000",
      "http://flowaid:3000",
    ])
      expect(linkReach(a)).toBe("network");
    for (const a of ["https://flowaid.example.com", "http://172.32.0.1", "not a url"])
      expect(linkReach(a)).toBe("anyone");
  });
});

describe("ReviewLinks", () => {
  it("says before a link is made that only this computer can open it (local mode)", async () => {
    api.get.mockResolvedValue([]);
    renderLinks(true);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("Only this computer can open these links");
    expect(note.textContent).toContain("FLOWAID_WEB_URL");
  });

  it("goes by the address a created link really has", async () => {
    api.get.mockResolvedValueOnce([]).mockResolvedValue([link("n", "active")]);
    api.post.mockResolvedValue({
      id: "n",
      url: "http://192.168.1.20:3000/review#t=secret",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    renderLinks();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    });
    await screen.findByLabelText("Review link");
    expect(screen.getByRole("note").textContent).toContain(
      "Only people on your network can open these links",
    );
  });

  it("lists every link of the task with its state, revocable while active", async () => {
    api.get.mockResolvedValue([link("a", "active"), link("u", "used"), link("r", "revoked")]);
    api.del.mockResolvedValue(undefined);
    renderLinks();
    expect(await screen.findByText("Answered")).toBeTruthy();
    expect(screen.getByText("Revoked")).toBeTruthy();
    const revoke = screen.getAllByRole("button", { name: "Revoke" });
    expect(revoke).toHaveLength(1);
    act(() => {
      fireEvent.click(revoke[0] as HTMLElement);
    });
    await waitFor(() => expect(api.del).toHaveBeenCalledWith("/v1/human-tasks/t1/review-link/a"));
  });

  it("shows a new link's URL once, right after it is created", async () => {
    api.get.mockResolvedValueOnce([]).mockResolvedValue([link("n", "active")]);
    api.post.mockResolvedValue({
      id: "n",
      url: "https://app.example/review#t=secret",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    renderLinks();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    });
    const input = await screen.findByLabelText("Review link");
    expect((input as HTMLInputElement).value).toBe("https://app.example/review#t=secret");
  });
});
