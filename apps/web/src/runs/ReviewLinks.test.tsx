import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { ReviewLinks } from "./ReviewLinks";
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

const renderLinks = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewLinks taskId="t1" />
    </QueryClientProvider>,
  );

describe("ReviewLinks", () => {
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
